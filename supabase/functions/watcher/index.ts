// Le point d'entree du watcher local. INGESTION UNIQUEMENT.
//
// Il ne cree plus de campagne. Il depose la video dans la bibliotheque, et
// c'est tout. La programmation appartient au moteur de cadence, qui pioche
// dans une file que Diego ordonne : l'ordre de publication est un choix
// editorial, il ne doit pas dependre de l'ordre alphabetique d'un dossier.
//
// SECURITE, en un paragraphe. Le watcher tourne sur le PC de Diego et n'a
// AUCUN acces a la base. Il ne possede pas de session Supabase : la politique
// accounts_rw vaut `using (true)`, donc n'importe quel utilisateur connecte
// lit accounts.access_token, c'est-a-dire les jetons Instagram, TikTok et
// YouTube. Un compte dedie au watcher les lui donnerait.
//
// A la place il porte un seul secret partage, WATCHER_TOKEN, qui n'ouvre que
// cette fonction. Ce qu'il peut faire tient en quatre verbes :
//   config      lire les regles, et signaler qu'il est vivant
//   upload-url  demander un creneau d'envoi signe, valable quelques minutes,
//               pour UN chemin precis
//   ingest      deposer une video dans la bibliotheque
//   ping        signaler qu'il est vivant, sans rien demander
// Il ne peut ni lire un compte, ni lire une publication, ni supprimer quoi que
// ce soit. La cle service_role reste ici, cote serveur.
//
// Deployee avec --no-verify-jwt : le watcher n'a pas de JWT. C'est donc cette
// fonction qui verifie le secret, a duree constante.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { jwtRole, memeSecret } from '../_shared/auth.ts'
import {
  avantLeDepart,
  lireChemin,
  lireNom,
  marqueCanonique,
  rangChronologique,
  sujetDepuisChemin,
  type Config,
} from '../_shared/automatisation.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const WATCHER_TOKEN = Deno.env.get('WATCHER_TOKEN') ?? ''

async function lireConfig(db: SupabaseClient): Promise<Config> {
  const { data } = await db.from('automation_config').select('reglages').eq('id', true).single()
  return (data?.reglages ?? {}) as Config
}

async function lireDossiers(db: SupabaseClient) {
  const { data } = await db
    .from('watch_folders')
    .select(
      'id, chemin, actif, marque, marques, profil, recursif, deplacer, mode_nommage, modele_sujet, depuis_date',
    )
    .order('ordre')
  return data ?? []
}

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

type CorpsIngestion = {
  fichier: string
  dossier?: string
  taille?: number
  video_url: string
  /** Renseigne quand le dossier impose une marque. */
  marque?: string
  /** Plusieurs marques : une entree de bibliotheque sera creee pour chacune. */
  marques?: string[]
  profil?: string
  /** Point de depart du dossier, au format AAAA-MM-JJ. */
  depuis_date?: string | null
  /**
   * Chemin du fichier relatif au dossier surveille, separateurs compris.
   * C'est lui qui porte l'information en mode « chemin », et c'est aussi
   * l'identite stable du fichier source.
   */
  chemin_relatif?: string
  mode_nommage?: 'champs' | 'chemin'
  modele_sujet?: string
}

async function ingerer(db: SupabaseClient, body: CorpsIngestion) {
  const config = await lireConfig(db)

  if (config.actif === false) {
    return json({ ok: false, error: "L'automatisation est suspendue dans l'application" }, 409)
  }

  const mode = body.mode_nommage ?? 'champs'
  const sourceCle = body.chemin_relatif || body.fichier

  // Second garde-fou. Le watcher filtre deja avant d'envoyer quoi que ce soit,
  // ce qui evite d'uploader pour rien ; celui-ci protege d'un dossier
  // reconfigure entre le ramassage et l'envoi.
  if (avantLeDepart(sourceCle, body.depuis_date ?? null)) {
    return json({
      ok: false,
      ignore: true,
      error: `anterieur au point de depart (${body.depuis_date})`,
    })
  }

  let marquesDemandees: string[] = []
  let sujet = ''
  let langue = ''
  // Rang impose par la date du chemin, quand il y en a une.
  let rangImpose: number | null = null

  if (mode === 'chemin') {
    // Le chemin informe, le nom du fichier ne dit rien. Les marques viennent
    // donc forcement du dossier surveille.
    const lu = lireChemin(sourceCle)
    if (!lu.date) {
      await journal(db, body, 'rejete', 'aucune date lisible dans le chemin, attendu JJMMAAAA', {})
      return json({ ok: false, rejete: true, error: 'Aucune date lisible dans le chemin' })
    }
    sujet = sujetDepuisChemin(body.modele_sujet ?? '', lu)
    // La file suit la chronologie du tournage, pas l'ordre du disque.
    rangImpose = rangChronologique(lu)
    langue = config.nommage.defauts.langue || 'en'
    marquesDemandees = body.marques?.length
      ? body.marques
      : body.marque
        ? [body.marque]
        : []

    if (marquesDemandees.length === 0) {
      await journal(db, body, 'rejete', 'ce dossier ne declare aucune marque', { sujet, langue })
      return json({
        ok: false,
        rejete: true,
        error: 'Ce dossier est en mode chemin mais ne declare aucune marque',
      })
    }
  } else {
    const lecture = lireNom(body.fichier, config.nommage)
    sujet = lecture.sujet
    langue = lecture.langue

    const marqueLue = (body.marque ?? '').trim() || lecture.marque
    const manquants = lecture.manquants.filter((m) => !(m === 'marque' && body.marque))

    if (manquants.length > 0) {
      if (config.nommage.surNonConforme === 'rejeter') {
        await journal(db, body, 'rejete', `nom non conforme, il manque : ${manquants.join(', ')}`, {
          marque: marqueLue,
          sujet,
          langue,
        })
        return json({
          ok: false,
          rejete: true,
          error: `Nom non conforme, il manque : ${manquants.join(', ')}`,
        })
      }
      sujet = sujet || body.fichier.replace(/\.[^.]+$/, '').replace(/[-_+]/g, ' ')
      langue = langue || config.nommage.defauts.langue || 'en'
    }

    marquesDemandees = body.marques?.length
      ? body.marques
      : marqueLue
        ? [marqueLue]
        : config.nommage.defauts.marque
          ? [config.nommage.defauts.marque]
          : []
  }

  if (marquesDemandees.length === 0) {
    await journal(db, body, 'rejete', 'aucune marque, ni dans le nom ni en valeur par defaut', {})
    return json({ ok: false, rejete: true, error: 'Aucune marque determinee' })
  }
  if (!sujet) {
    await journal(db, body, 'rejete', 'aucun sujet lisible', { langue })
    return json({ ok: false, rejete: true, error: 'Aucun sujet determine' })
  }

  // La langue lue doit faire partie des langues reconnues, sinon on ne saura
  // pas dans quelle langue ecrire et le texte partirait au hasard.
  const reconnues = config.nommage.languesReconnues ?? ['fr', 'en']
  if (langue && !reconnues.includes(langue)) {
    await journal(db, body, 'rejete', `langue « ${langue} » non reconnue, attendu : ${reconnues.join(', ')}`, {
      sujet,
      langue,
    })
    return json({
      ok: false,
      rejete: true,
      error: `Langue non reconnue : ${langue}. Attendu : ${reconnues.join(', ')}`,
    })
  }
  langue = langue || config.nommage.defauts.langue || 'en'

  // Les marques sont ramenees a la forme exacte des comptes : « edgesyncfx »
  // et « EdgeSyncFX » designent la meme chose.
  const { data: toutesMarques } = await db.from('accounts').select('brand')
  const connues = [...new Set((toutesMarques ?? []).map((a: { brand: string }) => a.brand))]

  const retenues: string[] = []
  const inconnues: string[] = []
  for (const m of marquesDemandees) {
    const canonique = marqueCanonique(m, connues)
    if (canonique) {
      if (!retenues.includes(canonique)) retenues.push(canonique)
    } else {
      inconnues.push(m)
    }
  }

  if (retenues.length === 0) {
    await journal(
      db,
      body,
      'rejete',
      `marque(s) inconnue(s) : ${inconnues.join(', ')}. Existantes : ${connues.join(', ')}`,
      { sujet, langue },
    )
    return json({
      ok: false,
      rejete: true,
      error: `Marque inconnue : ${inconnues.join(', ')}. Connues : ${connues.join(', ')}`,
    })
  }

  // Une entree par marque. L'index unique (source_cle, marque) fait le reste :
  // rejouer le dossier entier ne cree rien, et une marque ajoutee plus tard
  // rattrape son retard toute seule.
  const creees: string[] = []
  const deja: string[] = []

  for (const marque of retenues) {
    const { data: existe } = await db
      .from('bibliotheque')
      .select('id')
      .eq('source_cle', sourceCle)
      .eq('marque', marque)
      .maybeSingle()

    if (existe) {
      deja.push(marque)
      continue
    }

    // En mode chemin, la date decide. Sinon on ajoute a la fin de la file.
    let rang = rangImpose
    if (rang === null) {
      const { data: suivant } = await db.rpc('rang_suivant', { p_marque: marque })
      rang = Number(suivant ?? 1000)
    }

    const { error } = await db.from('bibliotheque').insert({
      video_url: body.video_url,
      fichier: body.fichier,
      source_cle: sourceCle,
      taille: body.taille ?? null,
      marque,
      sujet,
      langue: langue || null,
      profil: body.profil ?? null,
      rang,
      statut: 'en_file',
    })

    // Course entre deux passages : l'index unique a tranche, ce n'est pas une
    // erreur mais la preuve que le verrou fonctionne.
    if (error) {
      if (error.code === '23505') deja.push(marque)
      else {
        await journal(db, body, 'rejete', `ecriture impossible : ${error.message}`, { sujet, langue })
        return json({ ok: false, error: error.message }, 500)
      }
      continue
    }

    creees.push(marque)
  }

  const avertissements: string[] = []
  if (deja.length > 0) avertissements.push(`deja en bibliotheque pour : ${deja.join(', ')}`)
  if (inconnues.length > 0) avertissements.push(`marque(s) inconnue(s) ignoree(s) : ${inconnues.join(', ')}`)

  await journal(db, body, 'importe', avertissements.join(' ; ') || null, {
    marque: retenues[0],
    sujet,
    langue,
    video_url: body.video_url,
    publications: 0,
  })

  const { count } = await db
    .from('bibliotheque')
    .select('id', { count: 'exact', head: true })
    .eq('statut', 'en_file')

  return json({
    ok: true,
    marques_creees: creees,
    marques_deja_presentes: deja,
    sujet,
    langue,
    source: sourceCle,
    en_reserve: count ?? 0,
    avertissements,
  })
}

async function journal(
  db: SupabaseClient,
  body: CorpsIngestion,
  statut: 'importe' | 'rejete',
  raison: string | null,
  extra: Record<string, unknown>,
) {
  await db.from('imports').upsert(
    {
      // Le chemin relatif, pas seulement le nom : 07092026/1_matin/x.mp4 et
      // 04092026/1_matin/x.mp4 sont deux videos differentes.
      cle: `${body.chemin_relatif || body.fichier}#${body.taille ?? 0}`,
      fichier: body.fichier,
      dossier: body.dossier ?? null,
      taille: body.taille ?? null,
      statut,
      raison,
      ...extra,
    },
    { onConflict: 'cle' },
  )
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Deux appelants possibles : le watcher avec son secret, ou Diego depuis
  // l'application avec sa session.
  const secret = req.headers.get('x-bubupost-watcher') ?? ''
  const bearer = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()

  let appelant: 'watcher' | 'app' | null = null

  if (WATCHER_TOKEN && secret && memeSecret(secret, WATCHER_TOKEN)) {
    appelant = 'watcher'
  } else if (bearer && bearer !== ANON_KEY) {
    if (bearer === SERVICE_KEY || jwtRole(bearer) === 'service_role') {
      appelant = 'app'
    } else {
      const check = createClient(SUPABASE_URL, ANON_KEY)
      const { data, error } = await check.auth.getUser(bearer)
      if (!error && data.user) appelant = 'app'
    }
  }

  if (!appelant) return json({ error: 'Non autorise' }, 401)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Corps de requete illisible' }, 400)
  }

  const action = String(body.action ?? '')

  try {
    switch (action) {
      case 'config': {
        await signeDeVie(db, body)

        // Le watcher rapporte ce qu'il voit sur le disque : l'application ne
        // peut pas le savoir autrement, et c'est ce qui permet de choisir un
        // point de depart dans une vraie liste au lieu de taper une date.
        const inventaires = (body.inventaires ?? {}) as Record<string, unknown>
        for (const [id, contenu] of Object.entries(inventaires)) {
          await db
            .from('watch_folders')
            .update({ inventaire: contenu, inventaire_vu_a: new Date().toISOString() })
            .eq('id', id)
        }

        const config = await lireConfig(db)
        const dossiers = await lireDossiers(db)
        return json({
          ok: true,
          actif: config.actif !== false,
          intervalleSecondes: 60,
          dossiers: dossiers.filter((d) => d.actif),
          extensions: ['.mp4', '.mov', '.m4v'],
        })
      }

      case 'ping': {
        await signeDeVie(db, body)
        return json({ ok: true })
      }

      case 'upload-url': {
        const fichier = String(body.fichier ?? '')
        if (!fichier) return json({ error: 'Nom de fichier manquant' }, 400)

        const ext = (fichier.split('.').pop() ?? 'mp4').toLowerCase()
        const chemin = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`

        const { data, error } = await db.storage.from('videos').createSignedUploadUrl(chemin)
        if (error) return json({ error: error.message }, 500)

        return json({
          ok: true,
          chemin,
          signedUrl: data.signedUrl,
          token: data.token,
          video_url: db.storage.from('videos').getPublicUrl(chemin).data.publicUrl,
        })
      }

      case 'deja-traites': {
        // Un dossier qu'on ne remue pas est relu a chaque passage. Sans cette
        // question prealable, chaque video repartait en upload toutes les
        // soixante secondes pour s'entendre dire qu'elle etait deja la. Le
        // journal des imports est la memoire : ce qui y est accepte ne
        // revient pas, meme retire de la reserve entre-temps.
        const cles = Array.isArray(body.cles) ? body.cles.map(String).slice(0, 500) : []
        if (cles.length === 0) return json({ ok: true, traites: [] })

        const { data, error } = await db
          .from('imports')
          .select('cle')
          .eq('statut', 'importe')
          .in('cle', cles)
        if (error) return json({ error: error.message }, 500)

        return json({ ok: true, traites: (data ?? []).map((l) => l.cle) })
      }

      case 'tester-nom': {
        // Reserve a l'application : le watcher n'a rien a tester, il envoie.
        if (appelant !== 'app') return json({ error: 'Non autorise' }, 403)
        const config = await lireConfig(db)
        return json({ ok: true, lecture: lireNom(String(body.fichier ?? ''), config.nommage) })
      }

      case 'ingest':
        return await ingerer(db, body as unknown as CorpsIngestion)

      default:
        return json({ error: `Action inconnue : ${action}` }, 400)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('watcher', action, message)
    return json({ error: message }, 500)
  }
})

async function signeDeVie(db: SupabaseClient, body: Record<string, unknown>) {
  await db.from('watcher_ping').upsert({
    id: true,
    vu_a: new Date().toISOString(),
    version: String(body.version ?? ''),
    dossiers: Number(body.dossiers ?? 0),
    detail: (body.detail ?? null) as Record<string, unknown> | null,
  })
}
