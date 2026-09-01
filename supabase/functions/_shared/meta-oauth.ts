// Logique OAuth Meta, partagee entre la finalisation de connexion et le
// renouvellement des tokens.
//
// Meta fonctionne autrement que TikTok : avec response_type=token, le jeton
// revient directement dans le fragment de l'URL, sans code a echanger. Le
// travail cote serveur consiste donc a transformer ce jeton utilisateur en ce
// qui sert reellement a publier, le Page Access Token.

const GRAPH = 'https://graph.facebook.com/v21.0'

export const REDIRECT_URI =
  Deno.env.get('META_REDIRECT_URI') ?? 'https://bubu-post.vercel.app/auth/meta/callback'

export const SCOPES =
  'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement'

export class MetaError extends Error {
  code: string
  detail: unknown

  constructor(message: string, code: string, detail: unknown = null) {
    super(message)
    this.name = 'MetaError'
    this.code = code
    this.detail = detail
  }
}

/** Traduit les erreurs de la Graph API en conseil actionnable. */
export function explain(message: string, code: string): string {
  const m = `${code} ${message}`.toLowerCase()

  if (m.includes('missing_secrets')) {
    return "Les identifiants Meta ne sont pas configures sur le serveur. Previens-moi, je les pose."
  }
  if (m.includes('session has expired') || m.includes('code 190') || m.includes('access token')) {
    return "Le jeton Meta n'est plus valide. Relance la connexion depuis l'onglet Comptes."
  }
  if (m.includes('permission') || m.includes('#200') || m.includes('#10')) {
    return "Il manque une permission. Relance la connexion et accepte bien l'acces aux Pages et a la publication Instagram."
  }
  if (m.includes('aucune_page')) {
    return [
      "Facebook a bien accepte la connexion et accorde toutes les permissions, mais il ne rattache aucune Page a l'application.",
      "Sur l'ecran d'autorisation, il y a deux etapes distinctes : le choix des comptes Instagram, puis le choix des Pages Facebook.",
      "C'est la seconde qui compte ici. Si elle ne s'affiche pas, ou si aucune Page n'y est cochee, la liste revient vide comme maintenant.",
    ].join(' ')
  }
  if (m.includes('aucun_instagram')) {
    return "Aucune de tes Pages n'a de compte Instagram professionnel rattache. Dans Instagram, passe le compte en Professionnel, puis relie-le a ta Page Facebook."
  }
  if (m.includes('reseau')) {
    return "Meta est injoignable pour le moment. Reessaie dans quelques minutes."
  }
  return message || `Meta a repondu une erreur : ${code}`
}

export function credentials(): { id: string; secret: string } {
  const id = Deno.env.get('META_APP_ID')
  const secret = Deno.env.get('META_APP_SECRET')
  if (!id || !secret) {
    throw new MetaError('Identifiants Meta absents du serveur', 'missing_secrets')
  }
  return { id, secret }
}

async function graph(url: string, contexte: string): Promise<Record<string, unknown>> {
  let res: Response
  try {
    res = await fetch(url)
  } catch (err) {
    throw new MetaError(`${contexte} : reseau injoignable`, 'reseau', String(err))
  }

  const texte = await res.text()
  let json: Record<string, unknown>
  try {
    json = JSON.parse(texte)
  } catch {
    throw new MetaError(`${contexte} : reponse illisible`, 'bad_response', texte.slice(0, 200))
  }

  if (!res.ok || json.error) {
    const erreur = (json.error ?? {}) as Record<string, unknown>
    throw new MetaError(
      typeof erreur.message === 'string' ? erreur.message : `HTTP ${res.status}`,
      String(erreur.code ?? res.status),
      json,
    )
  }
  return json
}

export type PageInstagram = {
  page_id: string
  page_name: string
  page_access_token: string
  ig_user_id: string
  ig_username: string | null
}

/**
 * Les Pages accessibles, et pour chacune le compte Instagram professionnel
 * rattache. C'est le Page Access Token qui publie, pas le jeton utilisateur :
 * les confondre donne une erreur de permission au moment de publier, bien
 * apres la connexion, quand plus personne ne fait le lien.
 */
export async function pagesAvecInstagram(userToken: string): Promise<PageInstagram[]> {
  const json = await graph(
    `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}` +
      `&limit=100&access_token=${encodeURIComponent(userToken)}`,
    'Lecture des Pages',
  )

  const data = (json.data ?? []) as Array<Record<string, unknown>>
  if (data.length === 0) throw new MetaError('Aucune Page', 'aucune_page', json)

  const pages: PageInstagram[] = []
  for (const page of data) {
    const ig = page.instagram_business_account as Record<string, unknown> | undefined
    if (!ig?.id || typeof page.access_token !== 'string') continue
    pages.push({
      page_id: String(page.id),
      page_name: String(page.name ?? 'Page sans nom'),
      page_access_token: page.access_token,
      ig_user_id: String(ig.id),
      ig_username: typeof ig.username === 'string' ? ig.username : null,
    })
  }

  if (pages.length === 0) throw new MetaError('Aucun Instagram lie', 'aucun_instagram', json)
  return pages
}

/**
 * Prolonge un jeton utilisateur de longue duree.
 * Les Page Access Tokens derives n'expirent pas, mais ils cessent de
 * fonctionner si le jeton utilisateur dont ils viennent expire. C'est donc
 * lui qu'il faut entretenir.
 */
export async function prolongerJeton(
  userToken: string,
): Promise<{ token: string; expiresIn: number | null }> {
  const { id, secret } = credentials()
  const json = await graph(
    `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token` +
      `&client_id=${encodeURIComponent(id)}` +
      `&client_secret=${encodeURIComponent(secret)}` +
      `&fb_exchange_token=${encodeURIComponent(userToken)}`,
    'Prolongation du jeton',
  )

  const token = json.access_token
  if (typeof token !== 'string') {
    throw new MetaError('Meta n a pas renvoye de jeton prolonge', 'no_token', json)
  }
  return {
    token,
    expiresIn: typeof json.expires_in === 'number' ? json.expires_in : null,
  }
}
