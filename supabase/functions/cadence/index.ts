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
import { menagerStockage } from '../_shared/stockage.ts'
import {
  assembler,
  choisirCta,
  cleJour,
  creerCampagne,
  genererTextes,
  type Compte,
  creneauxLibres,
  dejaProgramme,
  type Config,
  type Creneau,
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
    .select('id, video_url, fichier, marque, sujet, langue, profil, rang, prioritaire, statut, metriques')
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

/** Demande de Diego, 8 octobre 2026 : etre prevenu quand il ne reste que 10 videos. */
const SEUIL_STOCK_DEFAUT = 10

/**
 * Combien de VIDEOS restent a publier, toutes marques confondues.
 *
 * Une video compte une fois, qu'elle soit deja programmee (publications a
 * venir) ou encore en file dans la reserve, et quel que soit le nombre de
 * marques ou de comptes qui la publieront. Les videos en pause ne comptent
 * pas : elles ne partiront pas sans decision.
 */
async function videosRestantes(db: SupabaseClient): Promise<number> {
  const cles = new Set<string>()

  const { data: posts } = await db
    .from('posts')
    .select('video_url')
    .in('status', ['pending', 'a_valider', 'processing'])
  const urls = [...new Set((posts ?? []).map((p: { video_url: string }) => p.video_url).filter(Boolean))]
  if (urls.length > 0) {
    const { data: sources } = await db.from('bibliotheque').select('video_url, source_cle').in('video_url', urls)
    const parUrl = new Map((sources ?? []).map((s: { video_url: string; source_cle: string | null }) => [s.video_url, s.source_cle]))
    for (const u of urls) cles.add(parUrl.get(u) || u)
  }

  const { data: file } = await db.from('bibliotheque').select('source_cle, video_url').eq('statut', 'en_file')
  for (const b of file ?? []) cles.add((b as { source_cle: string | null }).source_cle || (b as { video_url: string }).video_url)

  return cles.size
}

/**
 * L'alerte qu'on ne peut pas rater : plus que N videos a publier.
 *
 * Paliers 10, 5, 2, 0 (pour un seuil de 10) : un message a chaque palier
 * franchi vers le bas, et un rappel par 24 h tant que le stock reste sous le
 * seuil. Des que le stock remonte au-dessus, la memoire est effacee.
 */
async function alerterStock(db: SupabaseClient, seuil: number) {
  const reste = await videosRestantes(db)
  const { data } = await db.from('app_settings').select('value').eq('key', 'alerte_stock_videos').maybeSingle()
  const vu = (data?.value ?? null) as { palier: number; a: string } | null

  if (reste > seuil) {
    if (vu) await db.from('app_settings').delete().eq('key', 'alerte_stock_videos')
    return
  }

  const paliers = [seuil, Math.ceil(seuil / 2), Math.min(2, seuil), 0]
  const palier = Math.min(...paliers.filter((p) => reste <= p))
  const empire = !vu || palier < vu.palier
  const rappel = vu && Date.now() - new Date(vu.a).getTime() > 24 * 3_600_000
  if (!empire && !rappel) return

  const texte = [
    reste === 0 ? '🚨 <b>Plus aucune video a publier</b>' : `🚨 <b>Plus que ${reste} video${reste > 1 ? 's' : ''} a publier</b>`,
    '',
    reste === 0
      ? "BubuPost n'a plus rien a publier : les prochains creneaux seront sautes."
      : `Toutes marques confondues, il reste ${reste} video${reste > 1 ? 's' : ''} (programmees ou en reserve) avant que BubuPost n'ait plus rien a publier.`,
    '',
    'Enregistre de nouvelles seances (OBS) : EdgeSyncFX Studio fabriquera les Reels et le watcher les deposera tout seul.',
    'https://bubu-post.vercel.app/bibliotheque',
  ].join('\n')

  if (await notifyTelegram(texte, db)) {
    await db.from('app_settings').upsert({
      key: 'alerte_stock_videos',
      value: { palier, reste, a: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    })
  }
}

/**
 * Ce qui empeche le moteur de travailler, retenu d un passage a l autre.
 *
 * Un passage qui echoue remet la video en file et repart : sans trace, la
 * chaine peut s arreter des jours sans que rien ne le dise. C est arrive du
 * 20 au 24 septembre 2026, credit Anthropic epuise.
 */
export type Panne = { message: string; depuis: string; a: string }

async function lirePanne(db: SupabaseClient): Promise<Panne | null> {
  const { data } = await db.from('app_settings').select('value').eq('key', 'panne_moteur').single()
  const v = data?.value as Panne | null
  return v && v.message ? v : null
}

/** Une panne commence, ou se poursuit. Telegram au debut, puis toutes les 6 h. */
async function signalerPanne(db: SupabaseClient, message: string) {
  const vue = await lirePanne(db)
  const maintenant = new Date()
  const nouvelle = !vue || vue.message !== message
  const vieille = vue && maintenant.getTime() - new Date(vue.a).getTime() > 6 * 3_600_000

  if (nouvelle || vieille) {
    await notifyTelegram(
      [
        '🛑 La creation de campagnes est bloquee',
        '',
        message,
        '',
        vue && !nouvelle ? `Depuis le ${new Date(vue.depuis).toLocaleString('fr-FR')}.` : '',
        'Rien ne part tant que ce point n est pas regle. Les videos restent en reserve.',
      ]
        .filter(Boolean)
        .join('\n'),
      db,
    )
  }

  await db.from('app_settings').upsert({
    key: 'panne_moteur',
    value: {
      message,
      depuis: nouvelle ? maintenant.toISOString() : (vue?.depuis ?? maintenant.toISOString()),
      a: nouvelle || vieille ? maintenant.toISOString() : (vue?.a ?? maintenant.toISOString()),
    },
    updated_at: maintenant.toISOString(),
  })
}

/** La panne est finie : une campagne vient d etre creee. */
async function oublierPanne(db: SupabaseClient) {
  const vue = await lirePanne(db)
  if (!vue) return
  await db.from('app_settings').upsert({
    key: 'panne_moteur',
    value: {},
    updated_at: new Date().toISOString(),
  })
  await notifyTelegram(
    ['✅ La creation de campagnes est repartie', '', `Elle etait bloquee depuis le ${new Date(vue.depuis).toLocaleString('fr-FR')}.`].join('\n'),
    db,
  )
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

  // Chaque marque prepare sa file et ses creneaux, puis on sert UNE video par
  // marque et par tour. Servir une marque jusqu'au plafond avant de passer a
  // la suivante laissait EdgeSyncFX sans rien tant que CosmicSucces n'avait
  // pas rempli ses trois jours d'horizon.
  type Tour = { marque: string; attente: EntreeBibliotheque[]; creneaux: Creneau[]; i: number }
  const tours: Tour[] = []

  for (const marque of await marquesEnFile(db)) {
    const attente = await file(db, marque)
    if (attente.length === 0) continue

    const deja = await dejaProgramme(db, marque)
    const creneaux = creneauxLibres(
      config.cadence,
      deja,
      marque,
      maintenant,
      Math.min(attente.length, MAX_PAR_PASSAGE),
      horizon,
    )
    if (creneaux.length === 0) continue
    tours.push({ marque, attente, creneaux, i: 0 })
  }

  let progres = true
  while (creees < MAX_PAR_PASSAGE && progres) {
    progres = false

    for (const tour of tours) {
      if (creees >= MAX_PAR_PASSAGE) break
      if (tour.i >= tour.creneaux.length || tour.i >= tour.attente.length) continue

      const { marque } = tour
      const entree = tour.attente[tour.i]
      const quand = tour.creneaux[tour.i].quand
      tour.i++
      progres = true

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

      const resultat = await creerCampagne(db, SUPABASE_URL, SERVICE_KEY, entree, config, quand)

      if (!resultat.ok) {
        // On la remet en file, a sa place : l'echec vient de la generation ou
        // d'un quota, pas de la video. Elle repassera au prochain tour.
        await db.from('bibliotheque').update({ statut: 'en_file' }).eq('id', entree.id)
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
  await alerterStock(db, config.reserve?.seuilGlobal ?? SEUIL_STOCK_DEFAUT)

  // Le menage du stockage, un peu a chaque passage. Supprimer apres chaque
  // publication ne suffit pas : restent les campagnes annulees, les echecs
  // definitifs et les fichiers remplaces. Deux cents par passage, toutes les
  // quinze minutes, suffisent largement a ne jamais reprendre de retard.
  const menage = await menagerStockage(db, 200)
  if (menage.effaces > 0) {
    console.log(`stockage : ${menage.effaces} fichier(s) effaces, ${Math.round(menage.octets / 1048576)} Mo`)
  }

  // Rien cree alors qu il y avait du travail : on le dit, une fois, au lieu
  // de rejouer le meme echec toutes les quinze minutes en silence.
  const echecs = resultats.filter((r) => typeof r.echec === 'string')
  if (creees > 0) {
    await oublierPanne(db)
  } else if (echecs.length > 0) {
    await signalerPanne(db, String(echecs[0].echec))
  }

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
        return json({
          ok: true,
          previsions: await apercu(db, config),
          reserve: await etatReserve(db, config),
          panne: await lirePanne(db),
        })

      case 'retexter': {
        // Reecrire les textes d une campagne pas encore partie, sans toucher
        // a ses dates : quand les consignes changent, ou quand les chiffres
        // de la video viennent d etre lus.
        const campaignId = String(body.campaign_id ?? '')
        if (!campaignId) return json({ error: 'campaign_id est obligatoire' }, 400)

        const { data: entree } = await db
          .from('bibliotheque')
          .select('id, video_url, fichier, marque, sujet, langue, profil, rang, prioritaire, statut, metriques')
          .eq('campaign_id', campaignId)
          .maybeSingle()
        if (!entree) return json({ error: 'Aucune video de la reserve pour cette campagne' }, 404)

        const { data: posts } = await db
          .from('posts')
          .select('id, account_id, status, accounts!inner(id, platform, brand, account_name, language, status)')
          .eq('campaign_id', campaignId)
          .in('status', ['pending', 'a_valider'])
        const lignes = (posts ?? []) as unknown as Array<{ id: string; accounts: Compte }>
        if (lignes.length === 0) return json({ ok: true, reecrits: 0, raison: 'rien en attente' })

        const cibles = lignes.map((l) => l.accounts)
        const generes = await genererTextes(SUPABASE_URL, SERVICE_KEY, entree as EntreeBibliotheque, cibles)
        if (!generes.ok) return json({ error: generes.erreur }, 502)

        const { count: rang } = await db
          .from('posts')
          .select('id', { count: 'exact', head: true })
          .not('campaign_id', 'is', null)

        let reecrits = 0
        for (const [i, l] of lignes.entries()) {
          const texte = generes.parId.get(l.accounts.id)
          if (!texte) continue
          const cta = choisirCta(config.contenu, entree.marque, l.accounts.platform, (rang ?? 0) + i)
          const lien = config.contenu?.liens?.[entree.marque]?.[l.accounts.platform] ?? ''
          const { error } = await db
            .from('posts')
            .update({
              caption: assembler(texte.caption ?? '', cta, lien, config.contenu?.position ?? 'fin'),
              hashtags: texte.hashtags?.length ? texte.hashtags : null,
              title: l.accounts.platform === 'youtube' ? (texte.title ?? null) : null,
            })
            .eq('id', l.id)
            .in('status', ['pending', 'a_valider'])
          if (!error) reecrits++
        }
        return json({ ok: true, reecrits })
      }

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
          .select('id, video_url, fichier, marque, sujet, langue, profil, rang, prioritaire, statut, metriques')

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

        return json(resultat)
      }

      case 'moteur':
      default: {
        // Un seul passage a la fois. Le cron et le bouton de l'application
        // peuvent tomber a la meme seconde ; sans ce bail, les deux lisent
        // les memes creneaux libres et les remplissent chacun de leur cote.
        const { data: pris } = await db.rpc('prendre_verrou_moteur')
        if (!pris) {
          return json({ ok: true, ignore: 'un passage est deja en cours', creees: 0 })
        }
        try {
          return json(await passage(db, config, body.forcer === true))
        } finally {
          await db.rpc('liberer_verrou_moteur')
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('cadence', action, message)
    return json({ error: message }, 500)
  }
})
