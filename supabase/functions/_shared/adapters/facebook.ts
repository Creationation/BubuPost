// Facebook Reels : meme Graph API qu'Instagram, mais un autre endpoint.
// La video se depose sur /video_reels de la Page, puis on la publie.
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

export const facebook: PlatformAdapter = {
  label: 'Facebook Reels',

  async createContainer(account: Account, videoUrl: string, caption: string): Promise<string> {
    const token = requireToken(account)
    const pageId = requireExternalId(account)

    // 1. Ouvrir une session d'upload : Facebook renvoie un video_id.
    const start = await apiFetch(
      `${GRAPH}/${pageId}/video_reels`,
      {
        method: 'POST',
        body: new URLSearchParams({ upload_phase: 'start', access_token: token }),
      },
      'Facebook ouverture de la session',
    )

    const videoId = start.video_id
    if (typeof videoId !== 'string') {
      throw new PlatformError('Facebook n\'a pas renvoye de video_id', { detail: start })
    }

    // 2. Facebook telecharge la video depuis notre URL publique.
    await apiFetch(
      `https://rupload.facebook.com/video-upload/v21.0/${videoId}`,
      {
        method: 'POST',
        headers: {
          Authorization: `OAuth ${token}`,
          file_url: videoUrl,
        },
      },
      'Facebook envoi de la video',
    )

    // La legende est fournie au moment de la publication, on la garde de cote
    // en la collant a l'identifiant, separee par un caractere improbable.
    return `${videoId}::${caption}`
  },

  async checkStatus(account: Account, containerId: string): Promise<MediaStatus> {
    const token = requireToken(account)
    const [videoId] = containerId.split('::')

    const json = await apiFetch(
      `${GRAPH}/${videoId}?fields=status&access_token=${encodeURIComponent(token)}`,
      { method: 'GET' },
      'Facebook statut de la video',
    )

    const status = (json.status ?? {}) as Record<string, unknown>
    const phase = status.video_status ?? status.processing_phase

    if (phase === 'ready' || phase === 'complete') return 'ready'
    if (phase === 'error') {
      throw new PlatformError('Facebook a rejete la video', { detail: json })
    }
    return 'processing'
  },

  async publish(account: Account, containerId: string): Promise<string> {
    const token = requireToken(account)
    const pageId = requireExternalId(account)
    const sep = containerId.indexOf('::')
    const videoId = sep === -1 ? containerId : containerId.slice(0, sep)
    const caption = sep === -1 ? '' : containerId.slice(sep + 2)

    await apiFetch(
      `${GRAPH}/${pageId}/video_reels`,
      {
        method: 'POST',
        body: new URLSearchParams({
          upload_phase: 'finish',
          video_id: videoId,
          video_state: 'PUBLISHED',
          description: caption,
          access_token: token,
        }),
      },
      'Facebook publication',
    )

    return videoId
  },

  async verify(account: Account): Promise<string> {
    const token = requireToken(account)
    const pageId = requireExternalId(account)

    const json = await apiFetch(
      `${GRAPH}/${pageId}?fields=name,category&access_token=${encodeURIComponent(token)}`,
      { method: 'GET' },
      'Facebook verification du compte',
    )

    if (typeof json.name !== 'string') {
      throw new PlatformError(
        "Facebook repond, mais cet identifiant ne correspond pas a une Page. Verifie que tu as bien colle le Page ID.",
        { detail: json },
      )
    }
    return String(json.name)
  },
}
