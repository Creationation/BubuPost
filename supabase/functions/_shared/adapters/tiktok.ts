// TikTok via la Content Posting API, en mode PULL_FROM_URL : TikTok telecharge
// la video depuis notre bucket public.
//
// Attention : l'acces direct au post exige que l'app passe l'app review TikTok.
// Tant qu'elle n'est pas approuvee, l'API repond en mode sandbox et la video
// arrive dans les brouillons du compte au lieu d'etre publiee.
import {
  Account,
  MediaStatus,
  PlatformAdapter,
  PlatformError,
  apiFetch,
  requireToken,
} from './types.ts'

const API = 'https://open.tiktokapis.com/v2'

export const tiktok: PlatformAdapter = {
  label: 'TikTok',

  async createContainer(account: Account, videoUrl: string, caption: string): Promise<string> {
    const token = requireToken(account)

    const json = await apiFetch(
      `${API}/post/publish/video/init/`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({
          post_info: {
            title: caption.slice(0, 2200),
            privacy_level: 'PUBLIC_TO_EVERYONE',
            disable_duet: false,
            disable_comment: false,
            disable_stitch: false,
          },
          source_info: {
            source: 'PULL_FROM_URL',
            video_url: videoUrl,
          },
        }),
      },
      'TikTok initialisation de la publication',
    )

    const data = (json.data ?? {}) as Record<string, unknown>
    const publishId = data.publish_id
    if (typeof publishId !== 'string') {
      throw new PlatformError('TikTok n\'a pas renvoye de publish_id', { detail: json })
    }
    return publishId
  },

  async checkStatus(account: Account, containerId: string): Promise<MediaStatus> {
    const token = requireToken(account)

    const json = await apiFetch(
      `${API}/post/publish/status/fetch/`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({ publish_id: containerId }),
      },
      'TikTok statut de la publication',
    )

    const data = (json.data ?? {}) as Record<string, unknown>
    switch (data.status) {
      case 'PUBLISH_COMPLETE':
      case 'SEND_TO_USER_INBOX':
        return 'ready'
      case 'FAILED':
        throw new PlatformError(`TikTok a rejete la video : ${data.fail_reason ?? 'raison inconnue'}`, {
          detail: json,
        })
      default:
        return 'processing'
    }
  },

  // TikTok publie de lui-meme des que le traitement est termine : il n'y a pas
  // d'etape de publication separee. On se contente de renvoyer l'identifiant.
  publish(_account: Account, containerId: string): Promise<string> {
    return Promise.resolve(containerId)
  },
}
