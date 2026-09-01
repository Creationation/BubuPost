// Threads : API Meta recente, tres proche d'Instagram mais sur son propre domaine
// (graph.threads.net) et avec media_type VIDEO au lieu de REELS.
import {
  Account,
  MediaStatus,
  PlatformAdapter,
  PlatformError,
  apiFetch,
  requireExternalId,
  requireToken,
} from './types.ts'

const GRAPH = 'https://graph.threads.net/v1.0'

export const threads: PlatformAdapter = {
  label: 'Threads',

  async createContainer(account: Account, videoUrl: string, caption: string): Promise<string> {
    const token = requireToken(account)
    const userId = requireExternalId(account)

    const json = await apiFetch(
      `${GRAPH}/${userId}/threads`,
      {
        method: 'POST',
        body: new URLSearchParams({
          media_type: 'VIDEO',
          video_url: videoUrl,
          text: caption,
          access_token: token,
        }),
      },
      'Threads creation du conteneur',
    )

    const id = json.id
    if (typeof id !== 'string') {
      throw new PlatformError('Threads n\'a pas renvoye d\'identifiant de conteneur', {
        detail: json,
      })
    }
    return id
  },

  async checkStatus(account: Account, containerId: string): Promise<MediaStatus> {
    const token = requireToken(account)
    const json = await apiFetch(
      `${GRAPH}/${containerId}?fields=status,error_message&access_token=${encodeURIComponent(token)}`,
      { method: 'GET' },
      'Threads statut du conteneur',
    )

    switch (json.status) {
      case 'FINISHED':
        return 'ready'
      case 'IN_PROGRESS':
        return 'processing'
      case 'ERROR':
      case 'EXPIRED':
        throw new PlatformError(
          `Threads a rejete la video : ${json.error_message ?? json.status}`,
          { detail: json },
        )
      default:
        return 'processing'
    }
  },

  async publish(account: Account, containerId: string): Promise<string> {
    const token = requireToken(account)
    const userId = requireExternalId(account)

    const json = await apiFetch(
      `${GRAPH}/${userId}/threads_publish`,
      {
        method: 'POST',
        body: new URLSearchParams({ creation_id: containerId, access_token: token }),
      },
      'Threads publication',
    )

    const id = json.id
    if (typeof id !== 'string') {
      throw new PlatformError('Threads n\'a pas renvoye d\'identifiant de publication', {
        detail: json,
      })
    }
    return id
  },
}
