import { supabase } from './supabase'
import { errorMessage } from './errors'
import type { Account, PostWithAccount, Profile, PublishLog } from './types'

/** Toute erreur supabase remonte comme une vraie Error, lisible a l'ecran. */
function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw new Error(errorMessage(res.error))
  return res.data as T
}

// ---------------------------------------------------------------------------
// Comptes
// ---------------------------------------------------------------------------

export async function listAccounts(): Promise<Account[]> {
  return unwrap(
    await supabase.from('accounts').select('*').order('brand').order('platform'),
  )
}

export type AccountInput = {
  platform: string
  brand: string
  account_name: string
  external_account_id: string | null
  access_token: string | null
  refresh_token: string | null
  token_expiry: string | null
  status: string
}

export async function createAccount(input: AccountInput): Promise<Account> {
  const rows = unwrap(await supabase.from('accounts').insert(input).select())
  return rows[0]
}

export async function updateAccount(id: string, input: Partial<AccountInput>): Promise<void> {
  unwrap(await supabase.from('accounts').update(input).eq('id', id).select('id'))
}

export async function deleteAccount(id: string): Promise<void> {
  const { error } = await supabase.from('accounts').delete().eq('id', id)
  if (error) throw new Error(errorMessage(error))
}

// ---------------------------------------------------------------------------
// Publications
// ---------------------------------------------------------------------------

export async function listPosts(): Promise<PostWithAccount[]> {
  return unwrap(
    await supabase
      .from('posts')
      .select('*, accounts(*)')
      .order('scheduled_at', { ascending: false })
      .limit(400),
  ) as PostWithAccount[]
}

/** Une cible = un compte, avec son horaire et sa legende propres. */
export type TargetInput = {
  account_id: string
  scheduled_at: string
  caption: string
  hashtags: string[]
}

export async function createPostGroup(
  videoUrl: string,
  targets: TargetInput[],
): Promise<number> {
  const groupId = crypto.randomUUID()
  const rows = targets.map((t) => ({
    group_id: groupId,
    account_id: t.account_id,
    video_url: videoUrl,
    caption: t.caption || null,
    hashtags: t.hashtags.length ? t.hashtags : null,
    scheduled_at: t.scheduled_at,
    status: 'pending',
  }))
  const inserted = unwrap(await supabase.from('posts').insert(rows).select('id'))
  return inserted.length
}

export async function updatePost(
  id: string,
  patch: { caption?: string | null; hashtags?: string[] | null; scheduled_at?: string; video_url?: string },
): Promise<void> {
  unwrap(await supabase.from('posts').update(patch).eq('id', id).select('id'))
}

/** Annule un post encore non publie. */
export async function cancelPost(id: string): Promise<void> {
  unwrap(
    await supabase
      .from('posts')
      .update({ status: 'cancelled', next_attempt_at: null })
      .eq('id', id)
      .select('id'),
  )
}

/** Remet un post en attente : sert apres une erreur, ou pour annuler une annulation. */
export async function retryPost(id: string): Promise<void> {
  unwrap(
    await supabase
      .from('posts')
      .update({
        status: 'pending',
        attempts: 0,
        error_message: null,
        next_attempt_at: null,
        container_id: null,
      })
      .eq('id', id)
      .select('id'),
  )
}

export async function deletePost(id: string): Promise<void> {
  const { error } = await supabase.from('posts').delete().eq('id', id)
  if (error) throw new Error(errorMessage(error))
}

export async function listLogs(postId: string): Promise<PublishLog[]> {
  return unwrap(
    await supabase
      .from('publish_logs')
      .select('*')
      .eq('post_id', postId)
      .order('created_at', { ascending: false }),
  )
}

// ---------------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------------

/**
 * Depose la video dans le bucket public 'videos'.
 * Le bucket doit rester public : ce sont les serveurs de Meta, YouTube et
 * TikTok qui viennent telecharger le fichier, sans aucune authentification.
 */
export async function uploadVideo(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4'
  const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`

  onProgress?.(10)
  const { error } = await supabase.storage.from('videos').upload(path, file, {
    contentType: file.type || 'video/mp4',
    upsert: false,
  })
  if (error) throw new Error(errorMessage(error))

  onProgress?.(100)
  return supabase.storage.from('videos').getPublicUrl(path).data.publicUrl
}

// ---------------------------------------------------------------------------
// Legendes par l'API Claude
// ---------------------------------------------------------------------------

export type CaptionResult = { caption: string; hashtags: string[] }

export async function generateCaption(input: {
  subject: string
  platform: string
  brand?: string
  language?: string
  tone?: string
}): Promise<CaptionResult> {
  const { data, error } = await supabase.functions.invoke<CaptionResult & { error?: string }>(
    'generate-caption',
    { body: input },
  )
  if (error) throw new Error(errorMessage(error))
  if (!data || data.error) throw new Error(data?.error ?? 'Reponse vide')
  return { caption: data.caption, hashtags: data.hashtags ?? [] }
}

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

export async function myProfile(): Promise<Profile | null> {
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return null
  const { data } = await supabase.from('profiles').select('*').eq('id', auth.user.id).maybeSingle()
  return data
}

export async function listProfiles(): Promise<Profile[]> {
  return unwrap(await supabase.from('profiles').select('*').order('created_at'))
}

export async function setProfileRole(id: string, role: string): Promise<void> {
  unwrap(await supabase.from('profiles').update({ role }).eq('id', id).select('id'))
}

export async function listSettings(): Promise<Record<string, unknown>> {
  const rows = unwrap(await supabase.from('app_settings').select('key, value'))
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}

export async function saveSetting(key: string, value: unknown): Promise<void> {
  unwrap(
    await supabase
      .from('app_settings')
      .update({ value: value as never, updated_at: new Date().toISOString() })
      .eq('key', key)
      .select('key'),
  )
}

export type SetupStatus = {
  anthropic: boolean
  telegram: boolean
  google: boolean
  tiktok?: boolean
  /** Publique par construction : elle apparait en clair dans l'URL d'autorisation. */
  tiktok_client_key?: string | null
  tiktok_redirect_uri?: string | null
}

/**
 * Quelles cles serveur sont en place. Ne renvoie que des booleens, jamais les
 * valeurs : elles ne doivent pas descendre jusqu'au navigateur.
 */
export async function setupStatus(): Promise<SetupStatus> {
  const { data, error } = await supabase.functions.invoke<SetupStatus>('setup-status', {
    body: {},
  })
  if (error) throw new Error(errorMessage(error))
  return data ?? { anthropic: false, telegram: false, google: false }
}

export type AccountCheck = {
  ok: boolean
  message: string
  remote_name?: string
  technical?: string
  status_updated?: string
}

/**
 * Teste un compte aupres de sa plateforme : token valide, identifiant correct,
 * droits suffisants. Met aussi le statut du compte a jour.
 */
export async function checkAccount(accountId: string): Promise<AccountCheck> {
  const { data, error } = await supabase.functions.invoke<AccountCheck & { error?: string }>(
    'check-account',
    { body: { account_id: accountId } },
  )
  if (error) throw new Error(errorMessage(error))
  if (!data) throw new Error('Reponse vide')
  if (data.error) throw new Error(data.error)
  return data
}

/** Declenche un passage du scheduler tout de suite, sans attendre le cron. */
export async function runSchedulerNow(): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke('scheduler', { body: {} })
  if (error) throw new Error(errorMessage(error))
  return data
}
