// YouTube Shorts et videos classiques, via la Data API v3.
//
// Deux particularites face aux autres plateformes.
//
// 1. YouTube separe titre et description, alors qu'Instagram, Facebook et
//    TikTok n'ont qu'une legende. Le titre vient du champ dedie s'il existe,
//    sinon du premier segment de la legende.
//
// 2. L'envoi se fait par plages, jamais en chargeant le fichier entier : une
//    video longue depasserait la memoire de la fonction. On ne tient donc
//    qu'un morceau a la fois, quelle que soit la taille du fichier.
import {
  Account,
  MediaStatus,
  PlatformAdapter,
  PlatformError,
  apiFetch,
  requireExternalId,
  requireToken,
} from './types.ts'

const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3/videos'
const API = 'https://www.googleapis.com/youtube/v3'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

/**
 * Taille de morceau. Google impose un multiple de 256 Ko, sauf pour le dernier.
 * 8 Mo est le compromis usuel entre le nombre d'allers-retours et la memoire.
 */
const MORCEAU = 8 * 1024 * 1024

/**
 * Budget de temps pour l'envoi, dans un seul passage de la fonction.
 * Au-dela, on rend la main plutot que de se faire couper en plein transfert.
 */
const BUDGET_MS = 110_000

/** Limite pratique, liee au budget de temps, pas a la memoire. */
const TAILLE_MAX = 1024 * 1024 * 1024

/**
 * Contexte de publication, transporte dans le conteneur.
 * Le scheduler ne conserve qu'une chaine entre deux passages.
 */
type Contexte = {
  type: 'short' | 'video'
  titre: string
  description: string
  tags: string[]
  confidentialite: string
  miniature: string | null
}

/** Les access tokens Google durent une heure : on repart du refresh token. */
async function accessToken(account: Account): Promise<string> {
  const clientId = Deno.env.get('YOUTUBE_CLIENT_ID')
  const clientSecret = Deno.env.get('YOUTUBE_CLIENT_SECRET')

  if (!account.refresh_token) {
    // Pas de refresh token : on tente l'access token brut, valable une heure.
    return requireToken(account)
  }
  if (!clientId || !clientSecret) {
    throw new PlatformError(
      'Secrets YOUTUBE_CLIENT_ID et YOUTUBE_CLIENT_SECRET absents du serveur',
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
    'YouTube rafraichissement du jeton',
  )

  const token = json.access_token
  if (typeof token !== 'string') {
    throw new PlatformError(
      "Google n'a pas renvoye d'access token. En mode Test, les refresh tokens meurent au bout de 7 jours : reconnecte la chaine.",
      { retryable: false, detail: json },
    )
  }
  return token
}

/** Taille du fichier, sans le telecharger. */
async function tailleVideo(url: string): Promise<number> {
  let res: Response
  try {
    res = await fetch(url, { method: 'HEAD' })
  } catch (err) {
    throw new PlatformError("YouTube : la video est injoignable a l'URL fournie", {
      retryable: true,
      detail: String(err),
    })
  }

  if (!res.ok) {
    throw new PlatformError(
      `YouTube : la video est introuvable a l'URL fournie (${res.status}).`,
      { retryable: res.status >= 500 },
    )
  }

  const taille = Number(res.headers.get('content-length') ?? 0)
  if (!taille) {
    throw new PlatformError(
      "YouTube : impossible de connaitre la taille de la video, l'hebergeur ne la renvoie pas.",
      { retryable: false },
    )
  }
  if (taille > TAILLE_MAX) {
    throw new PlatformError(
      `YouTube : la video fait ${Math.round(taille / 1024 / 1024)} Mo. Au-dela de 1 Go, l'envoi ne tient pas dans le temps imparti a la fonction. Compresse-la, ou previens-moi pour qu'on decoupe l'envoi sur plusieurs passages.`,
      { retryable: false },
    )
  }
  return taille
}

/** Un morceau precis, sans charger le reste en memoire. */
async function lireMorceau(url: string, debut: number, fin: number): Promise<Uint8Array> {
  const res = await fetch(url, { headers: { Range: `bytes=${debut}-${fin}` } })
  if (!res.ok && res.status !== 206) {
    throw new PlatformError(`YouTube : lecture de la video impossible (${res.status})`, {
      retryable: true,
    })
  }
  return new Uint8Array(await res.arrayBuffer())
}

/**
 * Decoupe la legende en titre et description.
 *
 * YouTube limite le titre a 100 caracteres. On coupe sur la premiere phrase ou
 * la premiere ligne, pas au caractere pres : un titre tronque en plein mot
 * donne une impression d'abandon.
 */
function decouperLegende(legende: string): { titre: string; description: string } {
  const texte = (legende ?? '').trim()
  if (!texte) return { titre: 'Nouvelle video', description: '' }

  const premiereLigne = texte.split('\n')[0].trim()
  let titre = premiereLigne
  let reste = texte.slice(premiereLigne.length).trim()

  // Ligne trop longue : on cherche une fin de phrase.
  if (titre.length > 100) {
    const coupure = titre.slice(0, 100)
    const fin = Math.max(coupure.lastIndexOf('. '), coupure.lastIndexOf(' : '), coupure.lastIndexOf(', '))
    const point = fin > 40 ? fin + 1 : coupure.lastIndexOf(' ')
    titre = titre.slice(0, point > 40 ? point : 97).trim()
    reste = texte.slice(titre.length).trim()
  }

  return { titre: titre || 'Nouvelle video', description: reste || texte }
}

export const youtube: PlatformAdapter = {
  label: 'YouTube',

  async createContainer(account: Account, videoUrl: string, caption: string): Promise<string> {
    const token = await accessToken(account)
    const taille = await tailleVideo(videoUrl)

    // Le contexte est fourni par le scheduler en tete de legende, sous forme
    // d'un bloc JSON. Absent, on retombe sur un Short tire de la legende.
    let contexte: Contexte
    const marqueur = caption.indexOf('\n---BUBUPOST---\n')
    if (marqueur !== -1) {
      contexte = JSON.parse(caption.slice(0, marqueur)) as Contexte
    } else {
      const { titre, description } = decouperLegende(caption)
      contexte = {
        type: 'short',
        titre,
        description,
        tags: [],
        confidentialite: 'public',
        miniature: null,
      }
    }

    const description =
      contexte.type === 'short' && !/#shorts/i.test(contexte.description)
        ? `${contexte.description}\n\n#Shorts`.trim()
        : contexte.description

    // 1. Ouvrir la session resumable.
    const initRes = await fetch(`${UPLOAD}?uploadType=resumable&part=snippet,status`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Type': 'video/mp4',
        'X-Upload-Content-Length': String(taille),
      },
      body: JSON.stringify({
        snippet: {
          title: contexte.titre.slice(0, 100),
          description: description.slice(0, 5000),
          tags: contexte.tags.slice(0, 30),
          categoryId: '22',
        },
        status: {
          privacyStatus: contexte.confidentialite,
          selfDeclaredMadeForKids: false,
        },
      }),
    })

    if (!initRes.ok) {
      const detail = (await initRes.text()).slice(0, 400)
      throw new PlatformError(
        `YouTube : ouverture de l'envoi refusee (${initRes.status}). ${
          initRes.status === 403
            ? "Le quota du jour est probablement epuise, il se remet a zero a minuit heure du Pacifique."
            : ''
        }`,
        { retryable: initRes.status === 429 || initRes.status >= 500, detail },
      )
    }

    const sessionUrl = initRes.headers.get('location')
    if (!sessionUrl) {
      throw new PlatformError("YouTube n'a pas renvoye d'URL d'envoi", { retryable: true })
    }

    // 2. Envoyer par morceaux, sans jamais tenir tout le fichier en memoire.
    const debutMs = Date.now()
    let envoye = 0
    let videoId: string | null = null

    while (envoye < taille) {
      if (Date.now() - debutMs > BUDGET_MS) {
        throw new PlatformError(
          `YouTube : l'envoi depasse le temps imparti (${Math.round(envoye / 1024 / 1024)} Mo sur ${Math.round(taille / 1024 / 1024)} Mo). Une nouvelle tentative est programmee.`,
          { retryable: true },
        )
      }

      const fin = Math.min(envoye + MORCEAU, taille) - 1
      const octets = await lireMorceau(videoUrl, envoye, fin)

      const res = await fetch(sessionUrl, {
        method: 'PUT',
        headers: {
          'Content-Length': String(octets.byteLength),
          'Content-Range': `bytes ${envoye}-${fin}/${taille}`,
        },
        body: octets,
      })

      // 308 signifie « morceau recu, continue ».
      if (res.status === 308) {
        envoye = fin + 1
        continue
      }

      if (res.ok) {
        const corps = await res.text()
        try {
          const parsed = JSON.parse(corps) as Record<string, unknown>
          if (typeof parsed.id === 'string') videoId = parsed.id
        } catch {
          // Reponse vide sur le dernier morceau : on verifiera au statut.
        }
        envoye = taille
        break
      }

      const detail = (await res.text()).slice(0, 300)
      throw new PlatformError(`YouTube : envoi refuse (${res.status})`, {
        retryable: res.status === 429 || res.status >= 500,
        detail,
      })
    }

    if (!videoId) {
      throw new PlatformError("YouTube n'a pas renvoye d'identifiant de video", {
        retryable: true,
      })
    }

    // La miniature n'existe que pour une video classique : YouTube l'ignore
    // sur un Short.
    if (contexte.type === 'video' && contexte.miniature) {
      try {
        const image = await fetch(contexte.miniature)
        if (image.ok) {
          await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': image.headers.get('content-type') ?? 'image/jpeg',
            },
            body: new Uint8Array(await image.arrayBuffer()),
          })
        }
      } catch (err) {
        // Une miniature ratee ne doit pas annuler une video deja envoyee.
        console.warn('Miniature non appliquee', String(err))
      }
    }

    return videoId
  },

  async checkStatus(account: Account, containerId: string): Promise<MediaStatus> {
    const token = await accessToken(account)
    const json = await apiFetch(
      `${API}/videos?part=status,processingDetails&id=${containerId}`,
      { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
      'YouTube statut de la video',
    )

    const items = (json.items ?? []) as Array<Record<string, unknown>>
    if (items.length === 0) {
      throw new PlatformError('YouTube ne trouve plus la video envoyee', { detail: json })
    }

    const status = (items[0].status ?? {}) as Record<string, unknown>
    if (status.uploadStatus === 'processed' || status.uploadStatus === 'uploaded') return 'ready'
    if (status.uploadStatus === 'failed' || status.uploadStatus === 'rejected') {
      throw new PlatformError(
        `YouTube a rejete la video : ${status.failureReason ?? status.rejectionReason ?? 'raison inconnue'}`,
        { detail: items[0] },
      )
    }
    return 'processing'
  },

  /** La video est publiee des l'envoi : il n'y a pas d'etape separee. */
  publish(_account: Account, containerId: string): Promise<string> {
    return Promise.resolve(containerId)
  },

  /**
   * On demande la chaine, pas le profil : c'est elle qui recoit les videos.
   * Ne demander que des champs documentes, la lecon des champs inexistants
   * ayant deja coute cher sur TikTok et Instagram.
   */
  async verify(account: Account): Promise<string> {
    const token = await accessToken(account)
    const chaineId = requireExternalId(account)

    const json = await apiFetch(
      `${API}/channels?part=snippet&id=${encodeURIComponent(chaineId)}`,
      { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
      'YouTube verification de la chaine',
    )

    const items = (json.items ?? []) as Array<Record<string, unknown>>
    if (items.length === 0) {
      throw new PlatformError(
        "YouTube ne trouve pas cette chaine avec ce compte. Reconnecte-la depuis le bouton Connecter un compte YouTube.",
        { detail: json },
      )
    }

    const snippet = (items[0].snippet ?? {}) as Record<string, unknown>
    return String(snippet.title ?? 'Chaine sans nom')
  },
}

export { decouperLegende }
