// Le moteur de cadence : il vide la bibliotheque selon le rythme configure.
//
// Trois actions :
//   apercu    ce que le moteur ferait, sans rien ecrire. C'est le meme calcul
//             de creneaux que la creation reelle, pas une approximation : un
//             apercu qui differe du resultat ne sert a rien.
//   moteur    la pioche effective, appelee par pg_cron
//   manuelle  programme UNE video a une date choisie, hors cadence
//
// Il ne ramasse rien lui-meme : c'est le watcher qui remplit la bibliotheque,
// Diego qui l'ordonne, et ce moteur qui la vide.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { jwtRole } from '../_shared/auth.ts'
import { notifyTelegram } from '../_shared/notify.ts'
import {
  cleJour,
  creerCampagne,
  creneauxLibres,
  dejaProgramme,
  type Config,
  type EntreeBibliotheque,
} from '../_shared/automatisation.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

/**
 * Campagnes creees au maximum par passage.
 *
 * Chaque creation appelle le modele pour ecrire les textes. Trois par passage,
 * toutes les quinze minutes, remplissent largement une cadence de trois videos
 * par jour et par marque, sans transformer un passage en facture.
 */
const MAX_PAR_PASSAGE = 3

async function lireConfig(db: SupabaseClient): Promise<Config> {
  const { data } = await db.from('automation_config').select('reglages').eq('id', true).single()
  return (data?.reglages ?? {}) as Config
}

/** La file d'une marque, dans l'ordre exact de pioche. */
async function file(db: SupabaseClient, marque?: string): Promise<EntreeBibliotheque[]> {
  let requete = db
    .from('bibliotheque')
    .select('id, video_url, fichier, marque, sujet, langue, profil, rang, prioritaire, statut')
    .eq('statut', 'en_file')
    .order('prioritaire', { ascending: false })
    .order('rang', { ascending: true })

  if (marque) requete = requete.eq('marque', marque)

  const { data } = await requete
  return (data ?? []) as EntreeBibliotheque[]
}

async function marquesEnFile(db: SupabaseClient): Promise<string[]> {
  const { data } = await db.from('bibliotheque').select('marque').eq('statut', 'en_file')
  return [...new Set((data ?? []).map((r: { marque: string }) => r.marque))]
}

// ---------------------------------------------------------------------------
// Apercu
// ---------------------------------------------------------------------------

type Prevision = {
  id: string
  marque: string
  sujet: string
  fichier: string
  prioritaire: boolean
  position: number
  /** Null quand la cadence ne laisse pas de place dans l'horizon. */
  creneau: string | null
}

/**
 * Ce que le moteur ferait, sans rien ecrire.
 *
 * On projette au-dela de l'horizon du moteur pour que la bibliotheque puisse
 * dire « celle-ci ne passera pas avant longtemps » plutot que de laisser un
 * blanc, qui se lit comme une erreur.
 */
async function apercu(db: SupabaseClient, config: Config): Promise<Prevision[]> {
  const maintenant = new Date()
  const horizon = Math.max(14, (config.moteur?.horizonJours ?? 3) * 4)
  const sortie: Prevision[] = []

  for (const marque of await marquesEnFile(db)) {
    const attente = await file(db, marque)
    if (attente.length === 0) continue

    const deja = await dejaProgramme(db, marque)
    const creneaux = creneauxLibres(
      config.cadence,
      deja,
      marque,
      maintenant,
      attente.length,
      horizon,
    )

    attente.forEach((entree, i) => {
      sortie.push({
        id: entree.id,
        marque: entree.marque,
        sujet: entree.sujet,
        fichier: entree.fichier,
        prioritaire: entree.prioritaire,
        position: i + 1,
        creneau: creneaux[i]?.quand.toISOString() ?? null,
      })
    })
  }

  return sortie
}

// ---------------------------------------------------------------------------
// Alertes de reserve
// ---------------------------------------------------------------------------

type EtatReserve = { marque: string; reste: number; seuil: number; creneauSaute: string | null }

/**
 * L'etat de la reserve, marque par marque.
 *
 * On regarde aussi si un creneau va etre saute : une marque a sec dont la
 * cadence prevoit une publication demain matin merite d'etre signalee
 * differemment d'une marque simplement basse.
 */
async function etatReserve(db: SupabaseClient, config: Config): Promise<EtatReserve[]> {
  const { data: comptes } = await db.from('accounts').select('brand').eq('status', 'active')
  const marques = [...new Set((comptes ?? []).map((c: { brand: string }) => c.brand))]

  const sortie: EtatReserve[] = []
  const maintenant = new Date()

  for (const marque of marques) {
    const { count } = await db
      .from('bibliotheque')
      .select('id', { count: 'exact', head: true })
      .eq('marque', marque)
      .eq('statut', 'en_file')

    const reste = count ?? 0
    const seuil = config.reserve?.seuilParMarque?.[marque] ?? config.reserve?.seuilParDefaut ?? 3

    // Le prochain creneau que la cadence prevoit, s'il n'y a rien pour le
    // remplir.
    let creneauSaute: string | null = null
    if (reste === 0) {
      const deja = await dejaProgramme(db, marque)
      const prochain = creneauxLibres(config.cadence, deja, marque, maintenant, 1, 7)[0]
      if (prochain) creneauSaute = prochain.quand.toISOString()
    }

    sortie.push({ marque, reste, seuil, creneauSaute })
  }

  return sortie
}

/**
 * Previent quand la reserve baisse, sans repeter tous les quarts d'heure.
 *
 * On garde en base le niveau deja annonce par marque. Une nouvelle alerte ne
 * part que si la situation empire, ou si douze heures se sont ecoulees. Sans
 * cela, une marque a sec produirait quatre-vingt-seize messages par jour, et
 * Diego couperait les notifications, ce qui est pire que pas d'alerte.
 */
async function alerterReserve(db: SupabaseClient, etats: EtatReserve[]) {
  const { data } = await db.from('app_settings').select('value').eq('key', 'alertes_reserve').single()
  const memoire = (data?.value ?? {}) as Record<string, { niveau: number; a: string }>
  const suite = { ...memoire }

  const aDire: EtatReserve[] = []
  const maintenant = Date.now()

  for (const etat of etats) {
    if (etat.reste > etat.seuil) {
      // La reserve est remontee : on oublie, pour realerter si elle rebaisse.
      delete suite[etat.marque]
      continue
    }

    const vu = memoire[etat.marque]
    const empire = !vu || etat.reste < vu.niveau
    const vieux = vu && maintenant - new Date(vu.a).getTime() > 12 * 3_600_000

    if (empire || vieux) {
      aDire.push(etat)
      suite[etat.marque] = { niveau: etat.reste, a: new Date().toISOString() }
    }
  }

  if (aDire.length === 0) return

  const lignes = ['📉 Reserve de videos basse', '']
  for (const e of aDire) {
    if (e.reste === 0 && e.creneauSaute) {
      lignes.push(
        `${e.marque} : PLUS AUCUNE VIDEO. Le creneau du ${new Date(e.creneauSaute).toLocaleString('fr-FR')} sera saute.`,
      )
    } else if (e.reste === 0) {
      lignes.push(`${e.marque} : plus aucune video en reserve.`)
    } else {
      lignes.push(
        `${e.marque} : ${e.reste} video${e.reste > 1 ? 's' : ''} en reserve, seuil a ${e.seuil}.`,
      )
    }
  }
  lignes.push('', 'Depose de nouvelles videos dans les dossiers surveilles.')

  await notifyTelegram(lignes.join('\n'), db)

  await db.from('app_settings').upsert({
    key: 'alertes_reserve',
    value: suite,
    updated_at: new Date().toISOString(),
  })
}

// ---------------------------------------------------------------------------
// Le passage du moteur
// ---------------------------------------------------------------------------

async function passage(db: SupabaseClient, config: Config, forcer: boolean) {
  if (!config.actif) {
    return { ok: true, ignore: "l'automatisation est suspendue", creees: 0 }
  }
  if (!config.moteur?.actif && !forcer) {
    return { ok: true, ignore: 'le moteur de cadence est arrete', creees: 0 }
  }

  const maintenant = new Date()
  const horizon = config.moteur?.horizonJours ?? 3
  const resultats: Array<Record<string, unknown>> = []
  let creees = 0

  for (const marque of await marquesEnFile(db)) {
    if (creees >= MAX_PAR_PASSAGE) break

    const attente = await file(db, marque)
    if (attente.length === 0) continue

    const deja = await dejaProgramme(db, marque)
    const creneaux = creneauxLibres(
      config.cadence,
      deja,
      marque,
      maintenant,
      Math.min(attente.length, MAX_PAR_PASSAGE - creees),
      horizon,
    )

    for (let i = 0; i < creneaux.length && creees < MAX_PAR_PASSAGE; i++) {
      const entree = attente[i]

      // Verrou : on sort l'entree de la file AVANT de creer la campagne. Deux
      // passages qui se chevauchent ne doivent pas programmer deux fois la
      // meme video, et une creation qui echoue la remettra en file.
      const { data: reservee } = await db
        .from('bibliotheque')
        .update({ statut: 'programmee' })
        .eq('id', entree.id)
        .eq('statut', 'en_file')
        .select('id')

      if (!reservee || reservee.length === 0) continue

      const resultat = await creerCampagne(
        db,
        SUPABASE_URL,
        SERVICE_KEY,
        entree,
        config,
        creneaux[i].quand,
      )

      if (!resultat.ok) {
        // On la remet en file, a sa place : l'echec vient de la generation ou
        // d'un quota, pas de la video. Elle repassera au prochain tour.
        await db
          .from('bibliotheque')
          .update({ statut: 'en_file' })
          .eq('id', entree.id)
        resultats.push({ marque, fichier: entree.fichier, echec: resultat.erreur })
        continue
      }

      await db
        .from('bibliotheque')
        .update({
          campaign_id: resultat.campaign_id,
          programmee_pour: resultat.premiere,
        })
        .eq('id', entree.id)

      creees++
      resultats.push({
        marque,
        fichier: entree.fichier,
        publications: resultat.publications,
        creneau: resultat.premiere,
        a_valider: resultat.a_valider,
      })

      if (resultat.a_valider) {
        await notifyTelegram(
          [
            `📋 Campagne a valider : ${entree.marque}`,
            `Sujet : ${entree.sujet}`,
            `${resultat.publications} publication(s), a partir du ${new Date(resultat.premiere!).toLocaleString('fr-FR')}`,
            '',
            'Relis les textes dans BubuPost avant qu ils partent.',
          ].join('\n'),
          db,
        )
      }
    }
  }

  await alerterReserve(db, await etatReserve(db, config))

  return { ok: true, creees, resultats }
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const bearer = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
  if (!bearer) return json({ error: 'Non autorise' }, 401)

  if (bearer !== SERVICE_KEY && jwtRole(bearer) !== 'service_role') {
    const check = createClient(SUPABASE_URL, ANON_KEY)
    const { data, error } = await check.auth.getUser(bearer)
    if (error || !data.user) return json({ error: 'Non autorise' }, 401)
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    // Le cron appelle sans corps : c'est un passage ordinaire.
  }

  const config = await lireConfig(db)
  const action = String(body.action ?? 'moteur')

  try {
    switch (action) {
      case 'apercu':
        return json({ ok: true, previsions: await apercu(db, config), reserve: await etatReserve(db, config) })

      case 'manuelle': {
        // Programmation explicite d'une video, hors cadence. C'est une decision
        // editoriale : elle ne consomme pas de creneau, elle en cree un.
        const id = String(body.id ?? '')
        const quand = String(body.quand ?? '')
        if (!id || !quand) return json({ error: 'id et quand sont obligatoires' }, 400)

        const { data: entrees } = await db
          .from('bibliotheque')
          .update({ statut: 'programmee' })
          .eq('id', id)
          .in('statut', ['en_file', 'en_pause'])
          .select('id, video_url, fichier, marque, sujet, langue, profil, rang, prioritaire, statut')

        if (!entrees || entrees.length === 0) {
          return json({ error: 'Cette video est deja programmee, ou introuvable' }, 409)
        }

        const resultat = await creerCampagne(
          db,
          SUPABASE_URL,
          SERVICE_KEY,
          entrees[0] as EntreeBibliotheque,
          config,
          new Date(quand),
        )

        if (!resultat.ok) {
          await db.from('bibliotheque').update({ statut: 'en_file' }).eq('id', id)
          return json({ error: resultat.erreur }, 502)
        }

        await db
          .from('bibliotheque')
          .update({ campaign_id: resultat.campaign_id, programmee_pour: resultat.premiere })
          .eq('id', id)

        return json({ ok: true, ...resultat })
      }

      case 'moteur':
      default:
        return json(await passage(db, config, body.forcer === true))
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('cadence', action, message)
    return json({ error: message }, 500)
  }
})
