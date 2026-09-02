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
  
  // pages_manage_posts et publish_video sont necessaires pour publier des
  // Reels sur la Page. Les ajouter oblige a refaire l'autorisation : Meta ne
  // les accorde pas retroactivement aux jetons deja emis.
  'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,pages_manage_posts,publish_video'

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
/**
 * Ce a quoi Facebook declare avoir donne acces, d'apres lui-meme.
 *
 * C'est la source la plus fiable : granular_scopes liste les identifiants
 * exacts des Pages et des comptes Instagram autorises, meme quand /me/accounts
 * ne les voit pas.
 */
async function perimetreAccorde(
  userToken: string,
): Promise<{ pageIds: string[]; igIds: string[] }> {
  const t = encodeURIComponent(userToken)
  const json = await graph(
    `${GRAPH}/debug_token?input_token=${t}&access_token=${t}`,
    'Lecture du perimetre accorde',
  )

  const data = (json.data ?? {}) as Record<string, unknown>
  const scopes = (data.granular_scopes ?? []) as Array<Record<string, unknown>>

  const cibles = (nom: string): string[] => {
    const entree = scopes.find((s) => s.scope === nom)
    const ids = entree?.target_ids
    return Array.isArray(ids) ? ids.map(String) : []
  }

  return {
    pageIds: [...new Set([...cibles('pages_show_list'), ...cibles('pages_read_engagement')])],
    igIds: [
      ...new Set([...cibles('instagram_basic'), ...cibles('instagram_content_publish')]),
    ],
  }
}

/** Une Page precise, interrogee directement par son identifiant. */
async function lirePage(userToken: string, pageId: string): Promise<PageInstagram | null> {
  try {
    const json = await graph(
      `${GRAPH}/${pageId}?fields=id,name,access_token,instagram_business_account{id,username}` +
        `&access_token=${encodeURIComponent(userToken)}`,
      'Lecture de la Page',
    )
    const ig = json.instagram_business_account as Record<string, unknown> | undefined
    if (!ig?.id) return null

    return {
      page_id: String(json.id),
      page_name: String(json.name ?? 'Page sans nom'),
      // Sans jeton de Page, on se rabat sur le jeton utilisateur : la
      // publication Instagram fonctionne avec lui des lors que
      // instagram_content_publish est accorde sur ce compte.
      page_access_token: typeof json.access_token === 'string' ? json.access_token : userToken,
      ig_user_id: String(ig.id),
      ig_username: typeof ig.username === 'string' ? ig.username : null,
    }
  } catch {
    return null
  }
}

/** Un compte Instagram interroge directement, sans passer par sa Page. */
async function lireInstagram(userToken: string, igId: string): Promise<PageInstagram | null> {
  try {
    const json = await graph(
      `${GRAPH}/${igId}?fields=id,username&access_token=${encodeURIComponent(userToken)}`,
      'Lecture du compte Instagram',
    )
    if (!json.id) return null
    return {
      page_id: '',
      page_name: 'Compte Instagram',
      page_access_token: userToken,
      ig_user_id: String(json.id),
      ig_username: typeof json.username === 'string' ? json.username : null,
    }
  } catch {
    return null
  }
}

/**
 * Les comptes Instagram publiables, et le jeton qui va avec.
 *
 * Trois chemins, du plus direct au plus robuste. Le premier suffit quand les
 * Pages appartiennent personnellement a l'utilisateur. Des qu'elles
 * appartiennent a un portefeuille professionnel, /me/accounts renvoie une
 * liste vide **par construction**, sans erreur ni explication : il ne liste
 * que les Pages administrees en direct. On passe alors par les identifiants
 * que Facebook lui-meme declare avoir autorises.
 */
export async function pagesAvecInstagram(userToken: string): Promise<PageInstagram[]> {
  // 1. Le chemin classique.
  const json = await graph(
    `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}` +
      `&limit=100&access_token=${encodeURIComponent(userToken)}`,
    'Lecture des Pages',
  )

  const data = (json.data ?? []) as Array<Record<string, unknown>>
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

  if (pages.length > 0) return pages

  // 2. Liste vide : on demande a Facebook ce qu'il a reellement autorise.
  const perimetre = await perimetreAccorde(userToken)

  for (const pageId of perimetre.pageIds) {
    const page = await lirePage(userToken, pageId)
    if (page) pages.push(page)
  }

  if (pages.length > 0) return pages

  // 3. Dernier recours : le compte Instagram par son identifiant, sans Page.
  for (const igId of perimetre.igIds) {
    const compte = await lireInstagram(userToken, igId)
    if (compte) pages.push(compte)
  }

  if (pages.length > 0) return pages

  if (perimetre.pageIds.length === 0 && perimetre.igIds.length === 0) {
    throw new MetaError('Aucune Page', 'aucune_page', json)
  }
  throw new MetaError('Aucun Instagram lie', 'aucun_instagram', {
    me_accounts: json,
    perimetre,
  })
}

/**
 * L'echeance reelle d'un jeton, demandee a Meta plutot que deduite.
 *
 * Le fragment de l'URL de retour porte le expires_in du jeton COURT, une ou
 * deux heures. Le garder revenait a afficher une expiration imminente sur un
 * jeton valable soixante jours. Meta connait la vraie valeur, autant la lui
 * demander.
 *
 * Un jeton de Page derive d'un jeton utilisateur longue duree n'expire pas :
 * Meta renvoie alors expires_at a zero. Ce qui limite l'acces dans le temps
 * est data_access_expires_at, c'est donc lui qui fait foi dans ce cas.
 */
export async function expirationReelle(token: string): Promise<string | null> {
  try {
    const t = encodeURIComponent(token)
    const json = await graph(
      `${GRAPH}/debug_token?input_token=${t}&access_token=${t}`,
      'Lecture de l echeance du jeton',
    )
    const data = (json.data ?? {}) as Record<string, unknown>

    const expire = typeof data.expires_at === 'number' ? data.expires_at : 0
    const acces =
      typeof data.data_access_expires_at === 'number' ? data.data_access_expires_at : 0

    // expires_at a zero signifie « n'expire pas ».
    const secondes = expire > 0 ? expire : acces
    return secondes > 0 ? new Date(secondes * 1000).toISOString() : null
  } catch {
    return null
  }
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
