// Logique OAuth TikTok partagee entre l'echange initial du code et le
// renouvellement automatique des tokens. Les deux tapent le meme endpoint avec
// un grant_type different, autant n'ecrire les pieges qu'une fois.

const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/'
const USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/'
const CREATOR_INFO_URL = 'https://open.tiktokapis.com/v2/post/publish/creator_info/query/'

/** Doit correspondre au caractere pres a l'URL declaree dans la console TikTok. */
export const REDIRECT_URI =
  Deno.env.get('TIKTOK_REDIRECT_URI') ?? 'https://bubu-post.vercel.app/auth/tiktok/callback'

export const SCOPES = 'user.info.basic,video.publish'

export type TikTokTokens = {
  accessToken: string
  refreshToken: string | null
  openId: string | null
  expiresIn: number | null
  refreshExpiresIn: number | null
  scope: string | null
}

export class TikTokOAuthError extends Error {
  code: string
  description: string
  logId: string | null

  constructor(message: string, code: string, description: string, logId: string | null) {
    super(message)
    this.name = 'TikTokOAuthError'
    this.code = code
    this.description = description
    this.logId = logId
  }
}

export function credentials(): { key: string; secret: string } {
  const key = Deno.env.get('TIKTOK_CLIENT_KEY')
  const secret = Deno.env.get('TIKTOK_CLIENT_SECRET')
  if (!key || !secret) {
    throw new TikTokOAuthError(
      'Les secrets TIKTOK_CLIENT_KEY et TIKTOK_CLIENT_SECRET ne sont pas configures sur le serveur.',
      'missing_secrets',
      '',
      null,
    )
  }
  return { key, secret }
}

/** Traduit les erreurs OAuth de TikTok en quelque chose d'actionnable. */
export function explain(code: string, description: string): string {
  const c = code.toLowerCase()
  const d = description.toLowerCase()

  if (c === 'missing_secrets') {
    return "Les cles TikTok ne sont pas configurees sur le serveur. Previens-moi, je les pose."
  }
  if (d.includes('expired') || c === 'invalid_grant') {
    return "Ce code d'autorisation a expire ou a deja servi. Un code TikTok ne vaut que quelques minutes et ne s'utilise qu'une fois. Relance la connexion."
  }
  if (c === 'invalid_request' && d.includes('redirect')) {
    return `L'URL de redirection ne correspond pas. Dans la console TikTok Developers, l'application doit declarer exactement ${REDIRECT_URI}, au caractere pres.`
  }
  if (c === 'invalid_client' || d.includes('client_key') || d.includes('client_secret')) {
    return "TikTok refuse la cle ou le secret de l'application. Verifie qu'ils viennent bien de la meme application que celle utilisee pour se connecter."
  }
  if (c === 'access_denied') {
    return "L'autorisation a ete refusee cote TikTok. Recommence et accepte les permissions demandees."
  }
  if (c === 'scope_not_authorized' || d.includes('scope')) {
    return "Les permissions demandees ne sont pas accordees a l'application. Tant que l'app review TikTok n'est pas passee, seul le bac a sable est ouvert."
  }
  if (c === 'network') {
    return "TikTok est injoignable pour le moment. Ce n'est pas ta faute, reessaie dans quelques minutes."
  }
  return description || `TikTok a repondu une erreur : ${code}`
}

/** Appel commun aux deux grant types. */
async function demanderToken(params: URLSearchParams): Promise<TikTokTokens> {
  let res: Response
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cache-Control': 'no-cache',
      },
      body: params,
    })
  } catch (err) {
    throw new TikTokOAuthError('Reseau injoignable', 'network', String(err), null)
  }

  const text = await res.text()
  let data: Record<string, unknown>
  try {
    data = JSON.parse(text)
  } catch {
    throw new TikTokOAuthError('Reponse illisible', 'bad_response', text.slice(0, 200), null)
  }

  // TikTok renvoie parfois 200 avec un champ error : le statut HTTP seul ne dit
  // pas si l'echange a reussi.
  const code = typeof data.error === 'string' ? data.error : ''
  const description = typeof data.error_description === 'string' ? data.error_description : ''
  const logId = typeof data.log_id === 'string' ? data.log_id : null

  if (code || !res.ok) {
    throw new TikTokOAuthError(description || code, code || `http_${res.status}`, description, logId)
  }

  const accessToken = data.access_token
  if (typeof accessToken !== 'string') {
    throw new TikTokOAuthError(
      'Aucun access token dans la reponse',
      'no_token',
      text.slice(0, 200),
      logId,
    )
  }

  return {
    accessToken,
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : null,
    openId: typeof data.open_id === 'string' ? data.open_id : null,
    expiresIn: typeof data.expires_in === 'number' ? data.expires_in : null,
    refreshExpiresIn: typeof data.refresh_expires_in === 'number' ? data.refresh_expires_in : null,
    scope: typeof data.scope === 'string' ? data.scope : null,
  }
}

export function echangerCode(code: string): Promise<TikTokTokens> {
  const { key, secret } = credentials()
  return demanderToken(
    new URLSearchParams({
      client_key: key,
      client_secret: secret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    }),
  )
}

export function rafraichir(refreshToken: string): Promise<TikTokTokens> {
  const { key, secret } = credentials()
  return demanderToken(
    new URLSearchParams({
      client_key: key,
      client_secret: secret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  )
}

/**
 * Nom lisible du compte. Sans ca, la ligne s'appellerait comme l'open_id, une
 * suite de caracteres illisible dans laquelle Diego ne reconnaitrait rien.
 * Un echec ici n'est pas bloquant.
 */
export async function nomDuCompte(accessToken: string): Promise<string | null> {
  // D'abord l'endpoint de publication : il donne le nom d'utilisateur reel
  // sans exiger le scope user.info.profile, contrairement au champ username
  // de /user/info/, qui fait echouer toute la requete s'il est demande sans
  // ce scope. C'est exactement ce qui nommait les comptes "TikTok -000-Lx4".
  try {
    const res = await fetch(CREATOR_INFO_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
    })
    if (res.ok) {
      const json = await res.json()
      const data = (json?.data ?? {}) as Record<string, unknown>
      if (typeof data.creator_username === 'string' && data.creator_username) {
        return `@${data.creator_username}`
      }
      if (typeof data.creator_nickname === 'string' && data.creator_nickname) {
        return data.creator_nickname
      }
    }
  } catch {
    // On tente le profil juste en dessous.
  }

  // Repli : display_name seul, couvert par user.info.basic.
  try {
    const res = await fetch(`${USER_INFO_URL}?fields=display_name`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return null
    const json = await res.json()
    const user = (json?.data?.user ?? {}) as Record<string, unknown>
    if (typeof user.display_name === 'string' && user.display_name) return user.display_name
    return null
  } catch {
    return null
  }
}

/**
 * Le code arrive souvent encode depuis l'URL de retour, il finit frequemment
 * par %2A. Envoye tel quel, TikTok le rejette sans expliquer pourquoi.
 */
export function decoderCode(brut: string): string {
  const nettoye = brut.trim()
  try {
    const decode = decodeURIComponent(nettoye)
    return decode !== nettoye ? decode : nettoye
  } catch {
    return nettoye
  }
}
