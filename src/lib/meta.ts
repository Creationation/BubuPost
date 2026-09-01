import { supabase } from './supabase'
import { errorMessage } from './errors'
import { setupStatus } from './api'

const AUTH_URL = 'https://www.facebook.com/v21.0/dialog/oauth'
const SCOPES =
  'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement'
const CLE_FLOW = 'bubupost.meta.flow'
const DUREE_MAX_MS = 15 * 60 * 1000

type Flow = { state: string; brand: string; at: number }

function randomState(): string {
  const octets = new Uint8Array(16)
  crypto.getRandomValues(octets)
  return Array.from(octets, (o) => o.toString(16).padStart(2, '0')).join('')
}

export function saveMetaFlow(brand: string): string {
  const state = randomState()
  const flow: Flow = { state, brand, at: Date.now() }
  try {
    sessionStorage.setItem(CLE_FLOW, JSON.stringify(flow))
  } catch {
    // Navigation privee stricte : la verification du state echouera avec un
    // message clair, plutot que de partir de travers en silence.
  }
  return state
}

export function readMetaFlow(): Flow | null {
  try {
    const brut = sessionStorage.getItem(CLE_FLOW)
    if (!brut) return null
    const flow = JSON.parse(brut) as Flow
    if (!flow?.state || Date.now() - flow.at > DUREE_MAX_MS) return null
    return flow
  } catch {
    return null
  }
}

export function clearMetaFlow(): void {
  try {
    sessionStorage.removeItem(CLE_FLOW)
  } catch {
    // Sans importance, le flow expire de lui-meme.
  }
}

/**
 * App ID Meta.
 * Public par nature, il apparait en clair dans l'URL d'autorisation. On prend
 * la variable d'environnement si elle existe, sinon la valeur servie par le
 * serveur : cela evite d'avoir la meme information a deux endroits qui
 * peuvent diverger.
 */
async function appId(): Promise<string> {
  const local = import.meta.env.VITE_META_APP_ID
  if (local) return local

  const status = await setupStatus()
  if (status.meta_app_id) return status.meta_app_id

  throw new Error(
    "L'App ID Meta n'est pas configure. Previens-moi, je le pose sur le serveur.",
  )
}

export async function buildMetaAuthUrl(brand: string): Promise<string> {
  const id = await appId()
  const status = await setupStatus()
  const state = saveMetaFlow(brand)

  const params = new URLSearchParams({
    client_id: id,
    display: 'page',
    redirect_uri:
      status.meta_redirect_uri ?? `${window.location.origin}/auth/meta/callback`,
    response_type: 'token',
    scope: SCOPES,
    state,
  })

  return `${AUTH_URL}?${params.toString()}`
}

/**
 * Ce que Meta depose dans le fragment de l'URL de retour.
 * Un fragment n'est jamais transmis au serveur : seul le navigateur le voit,
 * c'est donc ici qu'il faut le lire.
 */
export type FragmentMeta = {
  token: string | null
  longLivedToken: string | null
  expiresIn: number | null
  dataAccessExpiration: number | null
  error: string | null
  errorDescription: string | null
  state: string | null
}

export function lireFragment(hash: string, search: string): FragmentMeta {
  const f = new URLSearchParams(hash.replace(/^#/, ''))
  // Une annulation revient parfois dans la query plutot que dans le fragment.
  const q = new URLSearchParams(search.replace(/^\?/, ''))

  const nombre = (v: string | null) => (v && !Number.isNaN(Number(v)) ? Number(v) : null)

  return {
    token: f.get('access_token'),
    longLivedToken: f.get('long_lived_token'),
    expiresIn: nombre(f.get('expires_in')),
    dataAccessExpiration: nombre(f.get('data_access_expiration_time')),
    error: f.get('error') ?? q.get('error') ?? q.get('error_code'),
    errorDescription:
      f.get('error_description') ??
      q.get('error_description') ??
      q.get('error_message') ??
      f.get('error_reason') ??
      q.get('error_reason'),
    state: f.get('state') ?? q.get('state'),
  }
}

export type CompteMeta = {
  ig_user_id: string
  ig_username: string | null
  page_name: string
}

export type FinalisationMeta = {
  ok: boolean
  message: string
  account_name?: string
  choix_requis?: boolean
  comptes?: CompteMeta[]
}

export async function finaliserMeta(input: {
  token: string
  brand: string
  expires_in?: number | null
  data_access_expiration_time?: number | null
  ig_user_id?: string
}): Promise<FinalisationMeta> {
  const { data, error } = await supabase.functions.invoke<FinalisationMeta & { error?: string }>(
    'meta-oauth-finalize',
    { body: input },
  )

  // Une Edge Function qui repond 4xx remonte comme une erreur : le message
  // utile est dans le corps, pas dans error.message.
  if (error) {
    const contexte = (error as { context?: Response }).context
    if (contexte && typeof contexte.json === 'function') {
      try {
        const corps = await contexte.json()
        if (corps?.error) throw new Error(corps.error)
      } catch (err) {
        if (err instanceof Error && err.message && !err.message.includes('non-2xx')) throw err
      }
    }
    throw new Error(errorMessage(error))
  }

  if (!data) throw new Error('Reponse vide du serveur')
  if (!data.ok) throw new Error(data.error ?? 'Connexion impossible')
  return data
}
