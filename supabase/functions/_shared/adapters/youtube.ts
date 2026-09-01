// YouTube Shorts via la YouTube Data API v3.
// Particularite : pas de conteneur cote plateforme, on envoie les octets nous-memes
// (upload resumable). La video part en 'private' puis passe en 'public' a la
// publication, ce qui permet de coller a l'heure prevue a la minute pres.
import {
  Account,
  MediaStatus,
  PlatformAdapter,
  PlatformError,
  apiFetch,
  requireToken,
} from './types.ts'

const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3/videos'
const API = 'https://www.googleapis.com/youtube/v3/videos'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

/**
 * Les access tokens Google durent une heure. On repart donc toujours du
 * refresh_token, qui lui ne bouge pas.
 */
async function accessToken(account: Account): Promise<string> {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID')
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')

  if (!account.refresh_token) {
    // Pas de refresh token : on se rabat sur l'access token brut, valable 1 h.
    return requireToken(account)
  }
  if (!clientId || !clientSecret) {
    throw new PlatformError(
      'Secrets GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET absents de la fonction',
      { retryable: false },
    )
  }

  const json = await apiFetch(
    TOKEN_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: account.refresh_token,
        grant_type: 'refresh_token',
      }),
    },
    'YouTube rafraichissement du token',
  )

  const token = json.access_token
  if (typeof token !== 'string') {
    throw new PlatformError('YouTube n\'a pas renvoye d\'access token', { detail: json })
  }
  return token
}

/** Coupe le titre a 100 caracteres, la limite YouTube, sans casser un mot. */
function toTitle(caption: string): string {
  const firstLine = caption.split('\n')[0].trim() || 'Nouvelle video'
  if (firstLine.length <= 100) return firstLine
  return firstLine.slice(0, 97).trimEnd() + '...'
}

export const youtube: PlatformAdapter = {
  label: 'YouTube',

  async createContainer(account: Account, videoUrl: string, caption: string): Promise<string> {
    const token = await accessToken(account)

    const videoRes = await fetch(videoUrl)
    if (!videoRes.ok || !videoRes.body) {
      throw new PlatformError(`YouTube : video introuvable a l'URL fournie (${videoRes.status})`, {
        retryable: true,
      })
    }
    const bytes = new Uint8Array(await videoRes.arrayBuffer())

    // 1. Ouvrir la session resumable avec les metadonnees.
    const initRes = await fetch(
      `${UPLOAD}?uploadType=resumable&part=snippet,status`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': 'video/mp4',
          'X-Upload-Content-Length': String(bytes.byteLength),
        },
        body: JSON.stringify({
          snippet: {
            title: toTitle(caption),
            description: caption,
            categoryId: '22',
          },
          status: {
            privacyStatus: 'private',
            selfDeclaredMadeForKids: false,
          },
        }),
      },
    )

    if (!initRes.ok) {
      const detail = await initRes.text()
      throw new PlatformError(`YouTube ouverture de la session : ${initRes.status}`, {
        retryable: initRes.status === 429 || initRes.status >= 500,
        detail: detail.slice(0, 500),
      })
    }

    const location = initRes.headers.get('location')
    if (!location) {
      throw new PlatformError('YouTube n\'a pas renvoye d\'URL d\'upload', { retryable: true })
    }

    // 2. Envoyer les octets.
    const uploadRes = await fetch(location, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(bytes.byteLength) },
      body: bytes,
    })

    const uploadBody = await uploadRes.text()
    if (!uploadRes.ok) {
      throw new PlatformError(`YouTube envoi de la video : ${uploadRes.status}`, {
        retryable: uploadRes.status === 429 || uploadRes.status >= 500,
        detail: uploadBody.slice(0, 500),
      })
    }

    const parsed = JSON.parse(uploadBody) as Record<string, unknown>
    const id = parsed.id
    if (typeof id !== 'string') {
      throw new PlatformError('YouTube n\'a pas renvoye d\'identifiant de video', {
        detail: parsed,
      })
    }
    return id
  },

  async checkStatus(account: Account, containerId: string): Promise<MediaStatus> {
    const token = await accessToken(account)
    const json = await apiFetch(
      `${API}?part=status,processingDetails&id=${containerId}`,
      { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
      'YouTube statut de la video',
    )

    const items = (json.items ?? []) as Array<Record<string, unknown>>
    if (items.length === 0) {
      throw new PlatformError('YouTube ne trouve plus la video envoyee', { detail: json })
    }

    const status = (items[0].status ?? {}) as Record<string, unknown>
    if (status.uploadStatus === 'processed') return 'ready'
    if (status.uploadStatus === 'failed' || status.uploadStatus === 'rejected') {
      throw new PlatformError(
        `YouTube a rejete la video : ${status.failureReason ?? status.rejectionReason}`,
        { detail: items[0] },
      )
    }
    return 'processing'
  },

  async publish(account: Account, containerId: string): Promise<string> {
    const token = await accessToken(account)
    await apiFetch(
      `${API}?part=status`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: containerId,
          status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
        }),
      },
      'YouTube passage en public',
    )
    return containerId
  },
}
