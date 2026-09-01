// Instagram Reels via la Graph API (Content Publishing).
// Flux en trois temps : creation du conteneur, attente du traitement, publication.
import {
  Account,
  MediaStatus,
  PlatformAdapter,
  PlatformError,
  apiFetch,
  requireExternalId,
  requireToken,
} from './types.ts'

const GRAPH = 'https://graph.facebook.com/v21.0'

export const instagram: PlatformAdapter = {
  label: 'Instagram',

  async createContainer(account: Account, videoUrl: string, caption: string): Promise<string> {
    const token = requireToken(account)
    const igUserId = requireExternalId(account)

    const body = new URLSearchParams({
      media_type: 'REELS',
      video_url: videoUrl,
      caption,
      share_to_feed: 'true',
      access_token: token,
    })

    const json = await apiFetch(
      `${GRAPH}/${igUserId}/media`,
      { method: 'POST', body },
      'Instagram creation du conteneur',
    )

    const id = json.id
    if (typeof id !== 'string') {
      throw new PlatformError('Instagram n\'a pas renvoye d\'identifiant de conteneur', {
        detail: json,
      })
    }
    return id
  },

  async checkStatus(account: Account, containerId: string): Promise<MediaStatus> {
    const token = requireToken(account)
    const json = await apiFetch(
      `${GRAPH}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(token)}`,
      { method: 'GET' },
      'Instagram statut du conteneur',
    )

    switch (json.status_code) {
      case 'FINISHED':
        return 'ready'
      case 'IN_PROGRESS':
        return 'processing'
      case 'ERROR':
      case 'EXPIRED':
        throw new PlatformError(
          `Instagram a rejete la video : ${json.status ?? json.status_code}`,
          { detail: json },
        )
      default:
        return 'processing'
    }
  },

  async publish(account: Account, containerId: string): Promise<string> {
    const token = requireToken(account)
    const igUserId = requireExternalId(account)

    const body = new URLSearchParams({ creation_id: containerId, access_token: token })
    const json = await apiFetch(
      `${GRAPH}/${igUserId}/media_publish`,
      { method: 'POST', body },
      'Instagram publication',
    )

    const id = json.id
    if (typeof id !== 'string') {
      throw new PlatformError('Instagram n\'a pas renvoye d\'identifiant de publication', {
        detail: json,
      })
    }
    return id
  },

  async verify(account: Account): Promise<string> {
    const token = requireToken(account)
    const igUserId = requireExternalId(account)

    const json = await apiFetch(
      `${GRAPH}/${igUserId}?fields=username,account_type&access_token=${encodeURIComponent(token)}`,
      { method: 'GET' },
      'Instagram verification du compte',
    )

    if (typeof json.username !== 'string') {
      throw new PlatformError(
        "Instagram repond, mais cet identifiant n'est pas un compte Instagram professionnel. Verifie que tu as bien colle l'IG User ID, et pas l'ID de la Page Facebook.",
        { detail: json },
      )
    }
    return `@${json.username}`
  },
}
