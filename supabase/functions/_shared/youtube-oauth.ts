// OAuth Google pour YouTube.
//
// Flow « authorization code », comme TikTok : le code revient dans l'URL et
// s'echange cote serveur. Rien a voir avec Meta, dont le jeton arrive dans le
// fragment.

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const API = 'https://www.googleapis.com/youtube/v3'

export const REDIRECT_URI =
  Deno.env.get('YOUTUBE_REDIRECT_URI') ?? 'https://bubu-post.vercel.app/auth/youtube/callback'

/** Doit rester identique a la liste demandee par le frontend. */
export const SCOPES =
  'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly'

export class YouTubeError extends Error {
  code: string
  detail: unknown

  constructor(message: string, code: string, detail: unknown = null) {
    super(message)
    this.name = 'YouTubeError'
    this.code = code
    this.detail = detail
  }
}

/** Traduit les erreurs de Google en conseil actionnable. */
export function explain(code: string, message: string): string {
  const m = `${code} ${message}`.toLowerCase()

  if (m.includes('missing_secrets')) {
    return "Les identifiants Google ne sont pas configures sur le serveur. Previens-moi, je les pose."
  }
  if (m.includes('invalid_grant')) {
    return [
      "Google refuse cette autorisation. Deux causes possibles :",
      "le code a expire, il ne vaut que quelques minutes, relance simplement la connexion ;",
      "ou le refresh token a ete revoque. En mode Test sur l'ecran de consentement Google, les",
      'refresh tokens meurent au bout de 7 jours, il faut alors reconnecter le compte.',
    ].join(' ')
  }
  if (m.includes('invalid_client')) {
    return "Google refuse l'identifiant ou le secret de l'application. Verifie qu'ils viennent bien du meme projet Google Cloud."
  }
  if (m.includes('redirect_uri_mismatch')) {
    return `L'URL de redirection ne correspond pas. Dans Google Cloud, elle doit etre exactement ${REDIRECT_URI}, au caractere pres.`
  }
  if (m.includes('access_denied')) {
    return "L'autorisation a ete refusee sur l'ecran Google. Recommence et accepte l'acces a YouTube."
  }
  if (m.includes('quotaexceeded') || m.includes('quota')) {
    return "Le quota d'API YouTube du jour est epuise. Il se remet a zero a minuit, heure du Pacifique."
  }
  if (m.includes('insufficient authentication scopes') || m.includes('insufficientpermissions')) {
    return "L'autorisation accordee ne suffit pas pour lire les informations de la chaine. Relance la connexion depuis l'onglet Comptes : les permissions demandees ont change."
  }
  if (m.includes('unauthorized') || m.includes('401')) {
    return "Le jeton YouTube n'est plus valide. Reconnecte le compte depuis l'onglet Comptes."
  }
  if (m.includes('reseau')) {
    return 'Google est injoignable pour le moment. Reessaie dans quelques minutes.'
  }
  return message || `Google a repondu une erreur : ${code}`
}

export function credentials(): { id: string; secret: string } {
  const id = Deno.env.get('YOUTUBE_CLIENT_ID')
  const secret = Deno.env.get('YOUTUBE_CLIENT_SECRET')
  if (!id || !secret) {
    throw new YouTubeError('Identifiants Google absents du serveur', 'missing_secrets')
  }
  return { id, secret }
}

export type JetonsYouTube = {
  accessToken: string
  refreshToken: string | null
  expiresIn: number | null
  scope: string | null
}

async function demanderJetons(params: URLSearchParams): Promise<JetonsYouTube> {
  let res: Response
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    })
  } catch (err) {
    throw new YouTubeError('Reseau injoignable', 'reseau', String(err))
  }

  const texte = await res.text()
  let data: Record<string, unknown>
  try {
    data = JSON.parse(texte)
  } catch {
    throw new YouTubeError('Reponse illisible', 'bad_response', texte.slice(0, 200))
  }

  if (!res.ok || data.error) {
    throw new YouTubeError(
      String(data.error_description ?? data.error ?? `HTTP ${res.status}`),
      String(data.error ?? res.status),
      data,
    )
  }

  const accessToken = data.access_token
  if (typeof accessToken !== 'string') {
    throw new YouTubeError("Google n'a pas renvoye d'access token", 'no_token', data)
  }

  return {
    accessToken,
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : null,
    expiresIn: typeof data.expires_in === 'number' ? data.expires_in : null,
    scope: typeof data.scope === 'string' ? data.scope : null,
  }
}

export function echangerCode(code: string): Promise<JetonsYouTube> {
  const { id, secret } = credentials()
  return demanderJetons(
    new URLSearchParams({
      client_id: id,
      client_secret: secret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    }),
  )
}

/**
 * Renouvelle l'access token, qui ne vit qu'une heure.
 * Google ne renvoie pas de nouveau refresh token : on garde l'ancien.
 */
export function rafraichir(refreshToken: string): Promise<JetonsYouTube> {
  const { id, secret } = credentials()
  return demanderJetons(
    new URLSearchParams({
      client_id: id,
      client_secret: secret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  )
}

export type Chaine = {
  id: string
  titre: string
  vignette: string | null
}

/** Les chaines accessibles avec ce jeton. */
export async function chaines(accessToken: string): Promise<Chaine[]> {
  let res: Response
  try {
    res = await fetch(`${API}/channels?part=snippet&mine=true&maxResults=50`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } catch (err) {
    throw new YouTubeError('Reseau injoignable', 'reseau', String(err))
  }

  const texte = await res.text()
  let data: Record<string, unknown>
  try {
    data = JSON.parse(texte)
  } catch {
    throw new YouTubeError('Reponse illisible', 'bad_response', texte.slice(0, 200))
  }

  if (!res.ok || data.error) {
    const erreur = (data.error ?? {}) as Record<string, unknown>
    throw new YouTubeError(
      String(erreur.message ?? `HTTP ${res.status}`),
      String(erreur.code ?? res.status),
      data,
    )
  }

  const items = (data.items ?? []) as Array<Record<string, unknown>>
  return items.map((item) => {
    const snippet = (item.snippet ?? {}) as Record<string, unknown>
    const vignettes = (snippet.thumbnails ?? {}) as Record<string, { url?: string }>
    return {
      id: String(item.id),
      titre: String(snippet.title ?? 'Chaine sans nom'),
      vignette: vignettes.default?.url ?? null,
    }
  })
}
