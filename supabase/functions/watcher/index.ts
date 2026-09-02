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
import { lireNom, type Config } from '../_shared/automatisation.ts'

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
    .select('id, chemin, actif, marque, profil')
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
  profil?: string
}

async function ingerer(db: SupabaseClient, body: CorpsIngestion) {
  const config = await lireConfig(db)

  if (config.actif === false) {
    return json({ ok: false, error: "L'automatisation est suspendue dans l'application" }, 409)
  }

  const lecture = lireNom(body.fichier, config.nommage)

  // La marque du dossier l'emporte : c'est le reglage le plus explicite.
  let marque = (body.marque ?? '').trim() || lecture.marque
  let langue = lecture.langue
  let sujet = lecture.sujet

  const manquants = lecture.manquants.filter((m) => !(m === 'marque' && body.marque))

  if (manquants.length > 0) {
    if (config.nommage.surNonConforme === 'rejeter') {
      await journal(db, body, 'rejete', `nom non conforme, il manque : ${manquants.join(', ')}`, {
        marque,
        sujet,
        langue,
      })
      return json({
        ok: false,
        rejete: true,
        error: `Nom non conforme, il manque : ${manquants.join(', ')}`,
      })
    }
    marque = marque || config.nommage.defauts.marque
    langue = langue || config.nommage.defauts.langue
    sujet = sujet || body.fichier.replace(/\.[^.]+$/, '').replace(/[-_+]/g, ' ')
  }

  if (!marque) {
    await journal(db, body, 'rejete', 'aucune marque, ni dans le nom ni en valeur par defaut', {})
    return json({ ok: false, rejete: true, error: 'Aucune marque determinee' })
  }
  if (!sujet) {
    await journal(db, body, 'rejete', 'aucun sujet lisible dans le nom', { marque })
    return json({ ok: false, rejete: true, error: 'Aucun sujet determine' })
  }

  // Le rang place la video a la FIN de la file de sa marque. Diego la
  // remontera s'il le souhaite : c'est son role, pas celui du watcher.
  const { data: rang } = await db.rpc('rang_suivant', { p_marque: marque })

  const { data: entree, error } = await db
    .from('bibliotheque')
    .insert({
      video_url: body.video_url,
      fichier: body.fichier,
      taille: body.taille ?? null,
      marque,
      sujet,
      langue: langue || null,
      profil: body.profil ?? null,
      rang: Number(rang ?? 1000),
      statut: 'en_file',
    })
    .select('id')
    .single()

  if (error) {
    await journal(db, body, 'rejete', `ecriture impossible : ${error.message}`, {
      marque,
      sujet,
      langue,
    })
    return json({ ok: false, error: error.message }, 500)
  }

  // Combien de videos attendent devant celle-ci, pour que le journal du
  // watcher dise quelque chose d'utile.
  const { count } = await db
    .from('bibliotheque')
    .select('id', { count: 'exact', head: true })
    .eq('marque', marque)
    .eq('statut', 'en_file')

  await journal(db, body, 'importe', null, {
    marque,
    sujet,
    langue,
    video_url: body.video_url,
    publications: 0,
  })

  return json({
    ok: true,
    bibliotheque_id: entree.id,
    marque,
    sujet,
    langue,
    en_reserve: count ?? 0,
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
      cle: `${body.fichier}#${body.taille ?? 0}`,
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
