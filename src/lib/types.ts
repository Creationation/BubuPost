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

/**
 * Plateformes dont le token se renouvelle tout seul, chaque nuit a 4 h.
 * Pour celles-ci, une echeance proche est le fonctionnement normal, pas une
 * alerte : un token TikTok ne vit que 24 h par construction.
 */
export const RENOUVELLEMENT_AUTO = new Set(['tiktok', 'instagram', 'facebook', 'youtube'])

/** « 3 h », « 12 j », « 2 mois ». Jamais « 0 j », qui ne veut rien dire. */
function dureeLisible(ms: number): string {
  const heures = Math.floor(ms / 3_600_000)
  if (heures < 1) return `${Math.max(1, Math.round(ms / 60_000))} min`
  if (heures < 24) return `${heures} h`

  const jours = Math.floor(heures / 24)
  if (jours < 60) return `${jours} j`
  return `${Math.round(jours / 30)} mois`
}

export type EtatToken = { texte: string; ton: 'ok' | 'warn' | 'bad' }

/**
 * Ce qu'il faut dire de l'echeance d'un token, ou null s'il n'y a rien a dire.
 *
 * Afficher « expire dans 0 j » sur un compte qui vient de publier est pire que
 * de ne rien afficher : ca fait chercher une panne qui n'existe pas.
 */
export function decrireToken(account: Account): EtatToken | null {
  if (!account.access_token) {
    return { texte: 'Aucun token enregistre', ton: 'bad' }
  }

  const auto = RENOUVELLEMENT_AUTO.has(account.platform)

  if (account.status === 'expired') {
    return { texte: 'Token expire, reconnecte le compte', ton: 'bad' }
  }
  if (account.status === 'error') {
    return { texte: 'Derniere verification en echec', ton: 'bad' }
  }

  if (!account.token_expiry) {
    return auto ? { texte: 'Renouvelle automatiquement', ton: 'ok' } : null
  }

  const restant = new Date(account.token_expiry).getTime() - Date.now()

  if (restant <= 0) {
    // Le renouvellement de la nuit n'est peut-etre pas encore passe.
    return auto
      ? { texte: 'Renouvellement attendu cette nuit', ton: 'warn' }
      : { texte: 'Token expire', ton: 'bad' }
  }

  if (auto) {
    return { texte: `Renouvelle automatiquement, valable ${dureeLisible(restant)}`, ton: 'ok' }
  }

  const jours = restant / 86_400_000
  if (jours <= 3) return { texte: `Token expire dans ${dureeLisible(restant)}`, ton: 'bad' }
  if (jours <= 10) return { texte: `Token expire dans ${dureeLisible(restant)}`, ton: 'warn' }
  return null
}
