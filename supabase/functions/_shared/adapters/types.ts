// Interface commune a toutes les plateformes.
// Ajouter une plateforme = ecrire un fichier qui exporte un PlatformAdapter,
// puis l'enregistrer dans index.ts. Rien d'autre ne bouge dans le systeme.

export type Account = {
  id: string
  platform: string
  brand: string
  account_name: string
  external_account_id: string | null
  access_token: string | null
  refresh_token: string | null
  token_expiry: string | null
  status: string
}

export type MediaStatus = 'processing' | 'ready' | 'error'

export type PlatformAdapter = {
  /** Nom lisible, sert dans les logs et les messages d'erreur. */
  label: string

  /** Depose la video chez la plateforme et renvoie l'identifiant du conteneur. */
  createContainer(account: Account, videoUrl: string, caption: string): Promise<string>

  /** Ou en est le traitement du media cote plateforme. */
  checkStatus(account: Account, containerId: string): Promise<MediaStatus>

  /** Publie le conteneur et renvoie l'identifiant du post cree. */
  publish(account: Account, containerId: string): Promise<string>
}

/** Erreur metier d'une plateforme, avec l'info « faut-il reessayer ». */
export class PlatformError extends Error {
  retryable: boolean
  detail: unknown

  constructor(message: string, opts: { retryable?: boolean; detail?: unknown } = {}) {
    super(message)
    this.name = 'PlatformError'
    this.retryable = opts.retryable ?? false
    this.detail = opts.detail ?? null
  }
}

/**
 * Un appel HTTP qui renvoie du JSON et transforme les erreurs en PlatformError.
 * Les 429 et les 5xx sont consideres comme temporaires, donc rejouables.
 */
export async function apiFetch(
  url: string,
  init: RequestInit,
  context: string,
): Promise<Record<string, unknown>> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch (err) {
    throw new PlatformError(`${context} : reseau injoignable`, {
      retryable: true,
      detail: String(err),
    })
  }

  const text = await res.text()
  let body: Record<string, unknown> = {}
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = { raw: text.slice(0, 500) }
    }
  }

  if (!res.ok) {
    const apiError = (body.error ?? body) as Record<string, unknown>
    const message = typeof apiError?.message === 'string' ? apiError.message : text.slice(0, 300)
    throw new PlatformError(`${context} : ${res.status} ${message}`, {
      retryable: res.status === 429 || res.status >= 500,
      detail: body,
    })
  }

  return body
}

/** Le token est-il present et non expire ? */
export function requireToken(account: Account): string {
  if (!account.access_token) {
    throw new PlatformError(`Le compte ${account.account_name} n'a pas de token`, {
      retryable: false,
    })
  }
  if (account.token_expiry && new Date(account.token_expiry) < new Date()) {
    throw new PlatformError(`Le token du compte ${account.account_name} a expire`, {
      retryable: false,
    })
  }
  return account.access_token
}

export function requireExternalId(account: Account): string {
  if (!account.external_account_id) {
    throw new PlatformError(
      `Le compte ${account.account_name} n'a pas d'identifiant de compte externe`,
      { retryable: false },
    )
  }
  return account.external_account_id
}
