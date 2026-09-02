// Facebook Reels : meme app Meta et meme Page Access Token qu'Instagram, mais
// on publie sur la PAGE, pas sur le compte Instagram, et le flux differe.
//
// Instagram fait telecharger la video par Meta depuis une URL. Facebook Reels
// veut recevoir les octets : on ouvre une session, on envoie le fichier, puis
// on publie. C'est la meme lecon que TikTok, transferer plutot que faire tirer.
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
const RUPLOAD = 'https://rupload.facebook.com/video-upload/v21.0'

/** Au-dela, l'envoi depasserait la memoire et le temps d'une Edge Function. */
const TAILLE_MAX = 150 * 1024 * 1024

/** Separe l'identifiant video de la legende dans le conteneur. */
const SEP = '::'

async function tailleVideo(url: string): Promise<number> {
  let res: Response
  try {
    res = await fetch(url, { method: 'HEAD' })
  } catch (err) {
    throw new PlatformError("Facebook : la video est injoignable a l'URL fournie", {
      retryable: true,
      detail: String(err),
    })
  }

  if (!res.ok) {
    throw new PlatformError(
      `Facebook : la video est introuvable a l'URL fournie (${res.status}). Verifie qu'elle est bien publique.`,
      { retryable: res.status >= 500 },
    )
  }

  const taille = Number(res.headers.get('content-length') ?? 0)
  if (!taille) {
    throw new PlatformError(
      "Facebook : impossible de connaitre la taille de la video, l'hebergeur ne la renvoie pas.",
      { retryable: false },
    )
  }
  if (taille > TAILLE_MAX) {
    throw new PlatformError(
      `Facebook : la video fait ${Math.round(taille / 1024 / 1024)} Mo, c'est trop lourd pour l'envoi automatique. Compresse-la sous 150 Mo.`,
      { retryable: false },
    )
  }
  return taille
}

export const facebook: PlatformAdapter = {
  label: 'Facebook Reels',

  async createContainer(account: Account, videoUrl: string, caption: string): Promise<string> {
    const token = requireToken(account)
    const pageId = requireExternalId(account)
    const taille = await tailleVideo(videoUrl)

    // 1. Ouvrir la session : Facebook renvoie un video_id et une URL d'envoi.
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
      throw new PlatformError("Facebook n'a pas renvoye d'identifiant de video", { detail: start })
    }
    const uploadUrl =
      typeof start.upload_url === 'string' ? start.upload_url : `${RUPLOAD}/${videoId}`

    // 2. Envoyer les octets.
    const videoRes = await fetch(videoUrl)
    if (!videoRes.ok) {
      throw new PlatformError(`Facebook : lecture de la video impossible (${videoRes.status})`, {
        retryable: true,
      })
    }
    const octets = new Uint8Array(await videoRes.arrayBuffer())

    let envoi: Response
    try {
      envoi = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: `OAuth ${token}`,
          offset: '0',
          file_size: String(octets.byteLength),
          'Content-Type': 'application/octet-stream',
        },
        body: octets,
      })
    } catch (err) {
      throw new PlatformError('Facebook : envoi de la video interrompu', {
        retryable: true,
        detail: String(err),
      })
    }

    if (!envoi.ok) {
      const detail = (await envoi.text()).slice(0, 300)
      throw new PlatformError(`Facebook : envoi de la video refuse (${envoi.status})`, {
        retryable: envoi.status === 429 || envoi.status >= 500,
        detail,
      })
    }

    // La legende n'est fournie qu'a la publication : on la transporte avec
    // l'identifiant, le scheduler ne conservant qu'une seule chaine entre deux
    // passages.
    return `${videoId}${SEP}${caption}`
  },

  /**
   * Ici « pret » veut dire « pret a etre finalise », pas « encode ».
   *
   * Facebook ne demarre l'encodage qu'apres l'appel de finalisation. Attendre
   * processing_phase a complete avant de finaliser bloque des deux cotes :
   * l'application attend Facebook, qui attend l'application. La video reste
   * indefiniment en upload_complete, processing_phase not_started.
   *
   * Le seul signal qui compte a cette etape est donc la fin du televersement.
   */
  async checkStatus(account: Account, containerId: string): Promise<MediaStatus> {
    const token = requireToken(account)
    const sep = containerId.indexOf(SEP)
    const videoId = sep === -1 ? containerId : containerId.slice(0, sep)

    const json = await apiFetch(
      `${GRAPH}/${videoId}?fields=status&access_token=${encodeURIComponent(token)}`,
      { method: 'GET' },
      'Facebook statut de la video',
    )

    const status = (json.status ?? {}) as Record<string, unknown>
    const televersement = (status.uploading_phase ?? {}) as Record<string, unknown>
    const global = String(status.video_status ?? '').toLowerCase()
    const phaseUpload = String(televersement.status ?? '').toLowerCase()

    if (phaseUpload === 'error' || global === 'error') {
      throw new PlatformError(
        `Facebook a rejete la video : ${televersement.error ?? status.error ?? 'raison inconnue'}`,
        { detail: json },
      )
    }

    // upload_complete, ou la phase de televersement terminee : on peut finaliser.
    if (
      phaseUpload === 'complete' ||
      global === 'upload_complete' ||
      global === 'ready' ||
      global === 'published'
    ) {
      return 'ready'
    }

    return 'processing'
  },

  async publish(account: Account, containerId: string): Promise<string> {
    const token = requireToken(account)
    const pageId = requireExternalId(account)
    const sep = containerId.indexOf(SEP)
    const videoId = sep === -1 ? containerId : containerId.slice(0, sep)
    const caption = sep === -1 ? '' : containerId.slice(sep + SEP.length)

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

  /**
   * Ne jamais demander le champ tasks : il n'existe pas sur une lecture
   * directe de Page, et un seul champ inconnu fait echouer toute la requete
   * en erreur #100. Verifie empiriquement : name et category repondent.
   */
  async verify(account: Account): Promise<string> {
    const token = requireToken(account)
    const pageId = requireExternalId(account)

    const json = await apiFetch(
      `${GRAPH}/${pageId}?fields=name,category&access_token=${encodeURIComponent(token)}`,
      { method: 'GET' },
      'Facebook verification de la Page',
    )

    if (typeof json.name !== 'string') {
      throw new PlatformError(
        "Facebook repond, mais cet identifiant ne correspond pas a une Page. Reconnecte le compte depuis le bouton Connecter un compte Instagram, qui enregistre aussi la Page.",
        { detail: json },
      )
    }
    return String(json.name)
  },
}
