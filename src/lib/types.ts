import type { Tables } from './database.types'

export type Account = Tables<'accounts'>
export type Post = Tables<'posts'>
export type PublishLog = Tables<'publish_logs'>
export type Profile = Tables<'profiles'>
export type AppSetting = Tables<'app_settings'>

/** Un post enrichi de son compte, tel que renvoye par les jointures. */
export type PostWithAccount = Post & { accounts: Account | null }

export type Platform = 'instagram' | 'facebook' | 'threads' | 'youtube' | 'tiktok'
export type AccountStatus = 'active' | 'expired' | 'error' | 'paused'
export type PostStatus = 'pending' | 'processing' | 'published' | 'failed' | 'cancelled'

export const PLATFORMS: { value: Platform; label: string; icon: string }[] = [
  { value: 'instagram', label: 'Instagram', icon: '◐' },
  { value: 'facebook', label: 'Facebook Reels', icon: '◑' },
  { value: 'threads', label: 'Threads', icon: '◒' },
  { value: 'youtube', label: 'YouTube', icon: '▶' },
  { value: 'tiktok', label: 'TikTok', icon: '♪' },
]

export const PLATFORM_LABEL: Record<string, string> = Object.fromEntries(
  PLATFORMS.map((p) => [p.value, p.label]),
)

export const PLATFORM_ICON: Record<string, string> = Object.fromEntries(
  PLATFORMS.map((p) => [p.value, p.icon]),
)

export const ACCOUNT_STATUSES: { value: AccountStatus; label: string }[] = [
  { value: 'active', label: 'Actif' },
  { value: 'paused', label: 'En pause' },
  { value: 'expired', label: 'Token expire' },
  { value: 'error', label: 'En erreur' },
]

export const POST_STATUS_LABEL: Record<string, string> = {
  pending: 'En attente',
  processing: 'En cours',
  published: 'Publie',
  failed: 'Erreur',
  cancelled: 'Annule',
}

export const POST_STATUS_ICON: Record<string, string> = {
  pending: '⏳',
  processing: '◌',
  published: '✓',
  failed: '✗',
  cancelled: '⊘',
}

/** Classes Tailwind de la pastille de statut, une par statut de post. */
export const POST_STATUS_CLASS: Record<string, string> = {
  pending: 'bg-warn-400/10 text-warn-400 border-warn-400/30',
  processing: 'bg-idle-400/10 text-idle-400 border-idle-400/30',
  published: 'bg-ok-400/10 text-ok-400 border-ok-400/30',
  failed: 'bg-bad-400/10 text-bad-400 border-bad-400/30',
  cancelled: 'bg-mist-500/10 text-mist-500 border-mist-500/30',
}

export const ACCOUNT_STATUS_CLASS: Record<string, string> = {
  active: 'bg-ok-400/10 text-ok-400 border-ok-400/30',
  paused: 'bg-mist-500/10 text-mist-500 border-mist-500/30',
  expired: 'bg-warn-400/10 text-warn-400 border-warn-400/30',
  error: 'bg-bad-400/10 text-bad-400 border-bad-400/30',
}

/** Un post encore modifiable ou annulable. */
export function isEditable(status: string): boolean {
  return status === 'pending' || status === 'failed'
}

/** Jours restants avant expiration du token, null si aucune date connue. */
export function daysUntilExpiry(expiry: string | null): number | null {
  if (!expiry) return null
  const ms = new Date(expiry).getTime() - Date.now()
  return Math.floor(ms / 86_400_000)
}
