// Coeur de l'automatisation : appele toutes les 5 minutes par pg_cron.
//
// Un passage ne bloque jamais longtemps. Si le media n'est pas encore pret chez
// la plateforme au bout d'une minute, le post reste en 'processing' et c'est le
// passage suivant qui reprend la ou on s'est arrete. Rien n'est perdu.
import { createClient, SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { adapterFor, Account, PlatformError } from '../_shared/adapters/index.ts'
import {
  messageEchecs,
  messageQuota,
  notifyTelegram,
  type EchecPublication,
} from '../_shared/notify.ts'
import { corsHeaders, json } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

/** Nombre de posts traites par passage, pour rester loin du timeout. */
const BATCH_SIZE = 10
/** Duree maximale d'attente du traitement du media, par post et par passage. */
const POLL_ATTEMPTS = 10
const POLL_DELAY_MS = 5000

/**
 * Duree du bail pose sur une publication pendant qu'on la traite.
 *
 * Assez long pour couvrir l'envoi d'une grosse video, assez court pour qu'une
 * fonction interrompue en plein travail ne bloque pas la publication pour la
 * journee. Au-dela, un autre passage la reprendra.
 */
const BAIL_MINUTES = 10

type Post = {
  id: string
  account_id: string
  video_url: string
  caption: string | null
  hashtags: string[] | null
  scheduled_at: string
  status: string
  attempts: number
  container_id: string | null
  youtube_type: string | null
  title: string | null
  thumbnail_url: string | null
  accounts: Account
}

type Settings = {
  retry: { max_attempts: number; backoff_minutes: number[] }
  limits: Record<string, number>
  notify: { telegram_enabled: boolean; notify_on_success: boolean }
  quotaYoutube: {
    quota_journalier: number
    cout_envoi: number
    cout_miniature: number
    seuil_alerte: number
  }
}

const DEFAULTS: Settings = {
  retry: { max_attempts: 3, backoff_minutes: [5, 20, 60] },
  limits: { instagram: 25, facebook: 25, threads: 250, youtube: 6, tiktok: 15 },
  notify: { telegram_enabled: true, notify_on_success: false },
  quotaYoutube: {
    quota_journalier: 10000,
    cout_envoi: 1600,
    cout_miniature: 50,
    seuil_alerte: 0.8,
  },
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Le role porte par un JWT, ou null si le jeton n'en est pas un. */
function jwtRole(token: string): string | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const pad = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(pad.padEnd(Math.ceil(pad.length / 4) * 4, '=')))
    return typeof payload.role === 'string' ? payload.role : null
  } catch {
    return null
  }
}

async function loadSettings(db: SupabaseClient): Promise<Settings> {
  const { data } = await db.from('app_settings').select('key, value')
  const out = { ...DEFAULTS }
  for (const row of data ?? []) {
    if (row.key === 'retry') out.retry = { ...DEFAULTS.retry, ...row.value }
    if (row.key === 'limits') out.limits = { ...DEFAULTS.limits, ...row.value }
    if (row.key === 'notify') out.notify = { ...DEFAULTS.notify, ...row.value }
    if (row.key === 'quota_youtube') {
      out.quotaYoutube = { ...DEFAULTS.quotaYoutube, ...row.value }
    }
  }
  return out
}

async function log(
  db: SupabaseClient,
  postId: string,
  event: string,
  detail: unknown = null,
): Promise<void> {
  await db.from('publish_logs').insert({ post_id: postId, event, detail })
}

/** La legende finale : le texte, puis les hashtags sur leur propre ligne. */
function buildCaption(post: Post): string {
  const caption = (post.caption ?? '').trim()
  const tags = (post.hashtags ?? [])
    .map((t) => (t.startsWith('#') ? t : `#${t}`))
    .join(' ')
  return tags ? `${caption}\n\n${tags}`.trim() : caption
}

/**
 * YouTube a besoin de plus qu'une legende : un titre distinct, une
 * description, des tags, un niveau de confidentialite, parfois une miniature.
 * L'interface commune des adapters ne transmet qu'une chaine, on y prefixe
 * donc un bloc structure, separe par un marqueur.
 */
function buildYoutubePayload(post: Post): string {
  const legende = (post.caption ?? '').trim()
  const type = post.youtube_type === 'video' ? 'video' : 'short'

  // Le titre saisi a la main l'emporte. Sinon on le tire de la legende, ce qui
  // suffit pour un Short mais serait pauvre pour une video longue.
  const titre = (post.title ?? '').trim()

  const contexte = {
    type,
    titre: titre || legende.split('\n')[0].slice(0, 100) || 'Nouvelle video',
    description: legende,
    tags: post.hashtags ?? [],
    confidentialite: 'public',
    miniature: type === 'video' ? post.thumbnail_url : null,
  }

  return `${JSON.stringify(contexte)}\n---BUBUPOST---\n${legende}`
}

/** Combien de publications reussies sur ce compte dans les 24 dernieres heures. */
async function publishedLast24h(db: SupabaseClient, accountId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const { count } = await db
    .from('posts')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('status', 'published')
    .gte('published_at', since)
  return count ?? 0
}

/**
 * Reserve une publication pour ce passage, ou renonce.
 *
 * Sans ca, deux passages qui se chevauchent traiteraient la meme publication :
 * le premier envoie la video, le second, lance pendant ce temps, la voit encore
 * en attente et l'envoie une deuxieme fois. Le compte recevrait deux fois la
 * meme video. Le risque etait deja la a 5 minutes, il devient courant a 2.
 *
 * L'ecriture conditionnelle sert de verrou : Postgres reevalue la condition
 * apres avoir verrouille la ligne, donc un seul passage peut gagner. Le bail
 * inscrit dans next_attempt_at libere la publication si le passage meurt.
 */
async function reserver(db: SupabaseClient, post: Post): Promise<boolean> {
  const maintenant = new Date().toISOString()
  const bail = new Date(Date.now() + BAIL_MINUTES * 60_000).toISOString()

  const { data, error } = await db
    .from('posts')
    .update({ next_attempt_at: bail })
    .eq('id', post.id)
    .in('status', ['pending', 'processing'])
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${maintenant}`)
    .select('id')

  if (error) {
    console.error('Reservation impossible', post.id, error.message)
    return false
  }
  return (data ?? []).length > 0
}

async function handleFailure(
  db: SupabaseClient,
  post: Post,
  err: unknown,
  settings: Settings,
  echecs: EchecPublication[],
): Promise<void> {
  const platformErr = err instanceof PlatformError ? err : null
  const reason = err instanceof Error ? err.message : String(err)
  const attempts = post.attempts + 1
  const max = settings.retry.max_attempts

  /**
   * YouTube ne se relance JAMAIS tout seul.
   *
   * Le quota du jour est de 10 000 unites et six publications en consomment
   * deja 9600 : il reste 400 unites, alors qu'une seule relance en coute 1600.
   * Une relance automatique ferait donc perdre une publication de la journee
   * pour tenter d'en sauver une autre. C'est a Diego de trancher, prevenu par
   * Telegram, pas au scheduler de decider a sa place.
   */
  const relanceInterdite = post.accounts.platform === 'youtube'
  const canRetry = !relanceInterdite && (platformErr?.retryable ?? false) && attempts < max

  /**
   * Le quota reserve est rendu si l'envoi n'a jamais commence.
   *
   * On reserve 1600 unites avant d'appeler Google, parce qu'il facture meme un
   * appel qui echoue. Mais si l'echec survient AVANT le moindre appel a
   * l'API des videos, un jeton refuse par exemple, Google n'a rien facture :
   * garder la reservation ferait perdre une publication de la journee pour
   * rien. Avec 400 unites de marge, ca compte.
   *
   * L'absence de conteneur est le signe : il n'est pose qu'une fois l'envoi
   * accepte par YouTube.
   */
  if (post.accounts.platform === 'youtube' && !post.container_id) {
    const cout = settings.quotaYoutube.cout_envoi
    const { data: total } = await db.rpc('consommer_quota', {
      p_platform: 'youtube',
      p_units: -cout,
    })
    await log(db, post.id, 'quota_youtube_rendu', { rendu: cout, total })
  }

  const messageComplet = relanceInterdite
    ? `${reason} Aucune relance automatique sur YouTube : elle couterait 1600 unites de quota, sur les 400 qui restent une fois tes 6 publications faites. A toi de relancer depuis l'onglet Publications si tu le souhaites.`
    : reason

  if (canRetry) {
    const backoff = settings.retry.backoff_minutes
    const minutes = backoff[Math.min(attempts - 1, backoff.length - 1)] ?? 30
    await db
      .from('posts')
      .update({
        status: 'pending',
        attempts,
        next_attempt_at: new Date(Date.now() + minutes * 60_000).toISOString(),
        error_message: reason,
      })
      .eq('id', post.id)
    await log(db, post.id, 'retry_scheduled', {
      reason,
      attempts,
      next_in_minutes: minutes,
      detail: platformErr?.detail ?? null,
    })
  } else {
    await db
      .from('posts')
      .update({
        status: 'failed',
        attempts,
        error_message: messageComplet,
        next_attempt_at: null,
      })
      .eq('id', post.id)
    await log(db, post.id, 'failed', { reason, attempts, detail: platformErr?.detail ?? null })
  }

  // On n'alerte que sur un abandon definitif. Prevenir a chaque tentative
  // intermediaire ferait trois messages pour un incident qui se resout parfois
  // tout seul au deuxieme essai.
  if (!canRetry && settings.notify.telegram_enabled) {
    echecs.push({
      platform: post.accounts.platform,
      accountName: post.accounts.account_name,
      brand: post.accounts.brand,
      videoUrl: post.video_url,
      scheduledAt: post.scheduled_at,
      reason: messageComplet,
      definitif: true,
    })
  }
}

async function processPost(
  db: SupabaseClient,
  post: Post,
  settings: Settings,
  echecs: EchecPublication[],
): Promise<string> {
  const account = post.accounts

  // Verrou d'abord : tout ce qui suit ecrit en base ou appelle une plateforme.
  if (!(await reserver(db, post))) {
    return 'deja pris par un autre passage'
  }

  if (account.status !== 'active') {
    const raison =
      account.status === 'paused'
        ? 'Le compte est en pause, la publication ne part pas.'
        : account.status === 'expired'
          ? "Le token du compte a expire, il faut le reconnecter depuis l'onglet Comptes."
          : "Le compte est en erreur, teste sa connexion depuis l'onglet Comptes."

    await db
      .from('posts')
      .update({ status: 'failed', error_message: raison })
      .eq('id', post.id)
    await log(db, post.id, 'skipped_account_inactive', { account_status: account.status })

    // Une mise en pause est un choix delibere : prevenir serait du bruit. Un
    // compte expire ou en erreur, en revanche, fait echouer les publications
    // sans que rien ne le signale, et c'est exactement ce qu'on veut savoir.
    if (account.status !== 'paused' && settings.notify.telegram_enabled) {
      echecs.push({
        platform: account.platform,
        accountName: account.account_name,
        brand: account.brand,
        videoUrl: post.video_url,
        scheduledAt: post.scheduled_at,
        reason: raison,
        definitif: true,
      })
    }
    return 'compte inactif'
  }

  const limit = settings.limits[account.platform] ?? 25
  const used = await publishedLast24h(db, account.id)
  if (used >= limit) {
    // On ne marque pas en echec : on repousse d'une heure, le quota se libere tout seul.
    // On remplace le bail par le vrai delai d'attente du quota.
    await db
      .from('posts')
      .update({ next_attempt_at: new Date(Date.now() + 3600_000).toISOString() })
      .eq('id', post.id)
    await log(db, post.id, 'rate_limited', { used, limit, platform: account.platform })

    if (settings.notify.telegram_enabled) {
      await notifyTelegram(
        messageQuota({
          platform: account.platform,
          accountName: account.account_name,
          used,
          limit,
          videoUrl: post.video_url,
        }),
        db,
      )
    }
    return 'quota atteint'
  }

  // Le quota YouTube appartient au projet Google, pas a la chaine : trois
  // chaines se partagent les memes 10 000 unites par jour. Le verifier ici
  // evite une erreur brute de Google en plein milieu de la journee.
  if (account.platform === 'youtube') {
    const q = settings.quotaYoutube
    const cout = q.cout_envoi + (post.thumbnail_url && post.youtube_type === 'video' ? q.cout_miniature : 0)

    const { data: consomme } = await db.rpc('quota_du_jour', { p_platform: 'youtube' })
    const dejaUtilise = typeof consomme === 'number' ? consomme : 0

    if (dejaUtilise + cout > q.quota_journalier) {
      await db
        .from('posts')
        .update({
          status: 'failed',
          error_message: `Quota YouTube epuise pour aujourd'hui : ${dejaUtilise} unites sur ${q.quota_journalier}, et cet envoi en demande ${cout}. Le quota se remet a zero a minuit, heure du Pacifique.`,
        })
        .eq('id', post.id)
      await log(db, post.id, 'quota_youtube_epuise', {
        deja_utilise: dejaUtilise,
        cout,
        quota: q.quota_journalier,
      })

      if (settings.notify.telegram_enabled) {
        await notifyTelegram(
          messageQuota({
            platform: 'youtube',
            accountName: account.account_name,
            used: dejaUtilise,
            limit: q.quota_journalier,
            videoUrl: post.video_url,
          }),
          db,
        )
      }
      return 'quota youtube epuise'
    }

    // On reserve avant d'envoyer : Google facture l'appel meme s'il echoue.
    const { data: total } = await db.rpc('consommer_quota', {
      p_platform: 'youtube',
      p_units: cout,
    })
    await log(db, post.id, 'quota_youtube_consomme', { cout, total })

    const seuil = q.quota_journalier * q.seuil_alerte
    if (typeof total === 'number' && total >= seuil && dejaUtilise < seuil) {
      await notifyTelegram(
        [
          '⚠️ <b>Quota YouTube bientot epuise</b>',
          '',
          `${total} unites consommees sur ${q.quota_journalier}.`,
          `Il reste de quoi envoyer ${Math.floor((q.quota_journalier - total) / q.cout_envoi)} video(s) aujourd'hui.`,
          '',
          'Le quota se remet a zero a minuit, heure du Pacifique.',
          'https://bubu-post.vercel.app/posts',
        ].join('\n'),
        db,
      )
    }
  }

  const adapter = adapterFor(account.platform)

  // Marquer la prise en charge AVANT le moindre appel externe. La creation du
  // conteneur et l'envoi de la video prennent parfois une minute : sans ce
  // marquage, l'interface continuerait d'afficher un compte a rebours alors
  // que le travail a deja commence.
  if (post.status !== 'processing') {
    await db.from('posts').update({ status: 'processing' }).eq('id', post.id)
    await log(db, post.id, 'processing_started', { platform: account.platform })
  }

  try {
    // 1. Creer le conteneur, sauf s'il existe deja d'un passage precedent.
    let containerId = post.container_id
    if (!containerId) {
      containerId = await adapter.createContainer(
        account,
        post.video_url,
        account.platform === 'youtube' ? buildYoutubePayload(post) : buildCaption(post),
      )
      await db.from('posts').update({ container_id: containerId }).eq('id', post.id)
      await log(db, post.id, 'container_created', { container_id: containerId })
    }

    // 2. Attendre que le media soit pret, sans depasser le budget de ce passage.
    let ready = false
    for (let i = 0; i < POLL_ATTEMPTS; i++) {
      const state = await adapter.checkStatus(account, containerId)
      if (state === 'ready') {
        ready = true
        break
      }
      await sleep(POLL_DELAY_MS)
    }

    if (!ready) {
      // Toujours en traitement : on rendra la main au prochain passage.
      await db
        .from('posts')
        .update({
          status: 'processing',
          next_attempt_at: new Date(Date.now() + 120_000).toISOString(),
        })
        .eq('id', post.id)
      await log(db, post.id, 'still_processing', { container_id: containerId })
      return 'encore en traitement'
    }

    // 3. Publier.
    const platformPostId = await adapter.publish(account, containerId)
    await db
      .from('posts')
      .update({
        status: 'published',
        published_at: new Date().toISOString(),
        platform_post_id: platformPostId,
        error_message: null,
        next_attempt_at: null,
      })
      .eq('id', post.id)
    await log(db, post.id, 'published', { platform_post_id: platformPostId })

    if (settings.notify.notify_on_success) {
      await notifyTelegram(
        `✅ Publie sur ${adapter.label} (${account.account_name})\n${platformPostId}`,
        db,
      )
    }
    return 'publie'
  } catch (err) {
    await handleFailure(db, post, err, settings, echecs)
    return 'echec'
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // Seul le porteur de la cle service_role (le cron) ou un utilisateur connecte
  // peut declencher un passage. La passerelle Supabase a deja verifie la
  // signature du jeton avant d'arriver ici, on peut donc lire son contenu.
  const auth = req.headers.get('Authorization') ?? ''
  const bearer = auth.replace('Bearer ', '').trim()
  if (!bearer) return json({ error: 'Non autorise' }, 401)

  if (bearer !== SERVICE_KEY && jwtRole(bearer) !== 'service_role') {
    const check = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '')
    const { data, error } = await check.auth.getUser(bearer)
    if (error || !data.user) return json({ error: 'Non autorise' }, 401)
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const settings = await loadSettings(db)
  const now = new Date().toISOString()

  // Trace du passage, ouverte des maintenant : c'est elle qui permet a
  // l'interface de savoir quand tombera reellement le prochain, au lieu de le
  // supposer a partir du cycle theorique.
  const { data: passage } = await db
    .from('scheduler_runs')
    .insert({ started_at: now })
    .select('id')
    .single()

  const { data: posts, error } = await db
    .from('posts')
    .select('*, accounts(*)')
    .in('status', ['pending', 'processing'])
    .lte('scheduled_at', now)
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${now}`)
    .order('scheduled_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (error) {
    console.error('Lecture des posts impossible', error)
    return json({ error: error.message }, 500)
  }

  const results: Array<{ post: string; outcome: string }> = []

  // Les echecs sont collectes puis annonces ensemble : un token expire fait
  // tomber toutes les publications du jour, et neuf messages pour un seul
  // probleme finiraient par ne plus etre lus.
  const echecs: EchecPublication[] = []

  for (const post of (posts ?? []) as Post[]) {
    if (!post.accounts) {
      await log(db, post.id, 'skipped_no_account', null)
      continue
    }
    const outcome = await processPost(db, post, settings, echecs)
    results.push({ post: post.id, outcome })
  }

  if (echecs.length > 0) {
    await notifyTelegram(messageEchecs(echecs), db)
  }

  if (passage?.id) {
    await db
      .from('scheduler_runs')
      .update({ finished_at: new Date().toISOString(), processed: results.length })
      .eq('id', passage.id)

    // Un passage toutes les 5 minutes fait environ 105 000 lignes par an.
    // On garde une semaine, largement de quoi diagnostiquer un trou.
    await db
      .from('scheduler_runs')
      .delete()
      .lt('started_at', new Date(Date.now() - 7 * 86_400_000).toISOString())
  }

  return json({ ran_at: now, processed: results.length, results })
})
