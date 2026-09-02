import { supabase } from './supabase'
import { errorMessage } from './errors'
import { setupStatus } from './api'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
/**
 * Deux scopes, separes par un espace.
 *
 * youtube.upload suffit a envoyer une video, mais pas a lire quoi que ce soit :
 * l'appel channels qui recupere le nom de la chaine repondait
 * « insufficient authentication scopes ». youtube.readonly comble ce manque.
 */
const SCOPES =
  'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly'
const CLE_FLOW = 'bubupost.youtube.flow'
const DUREE_MAX_MS = 15 * 60 * 1000

type Flow = { state: string; brand: string; at: number }

function randomState(): string {
  const octets = new Uint8Array(16)
  crypto.getRandomValues(octets)
  return Array.from(octets, (o) => o.toString(16).padStart(2, '0')).join('')
}

export function saveYoutubeFlow(brand: string): string {
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

export function readYoutubeFlow(): Flow | null {
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

export function clearYoutubeFlow(): void {
  try {
    sessionStorage.removeItem(CLE_FLOW)
  } catch {
    // Sans importance, le flow expire de lui-meme.
  }
}

/** Public par nature : il apparait en clair dans l'URL d'autorisation. */
async function clientId(): Promise<string> {
  const local = import.meta.env.VITE_YOUTUBE_CLIENT_ID
  if (local) return local

  const status = await setupStatus()
  if (status.youtube_client_id) return status.youtube_client_id

  throw new Error(
    "L'identifiant Google n'est pas configure. Previens-moi, je le pose sur le serveur.",
  )
}

export async function buildYoutubeAuthUrl(brand: string): Promise<string> {
  const id = await clientId()
  const status = await setupStatus()
  const state = saveYoutubeFlow(brand)

  const params = new URLSearchParams({
    client_id: id,
    redirect_uri:
      status.youtube_redirect_uri ?? `${window.location.origin}/auth/youtube/callback`,
    response_type: 'code',
    scope: SCOPES,
    // Sans ces deux parametres, Google ne renvoie pas de jeton de
    // renouvellement, et la chaine cesserait de publier au bout d'une heure.
    access_type: 'offline',
    prompt: 'consent',
    state,
  })

  // URLSearchParams encode l'espace en +, alors que Google attend %20 dans
  // le parametre scope. Aucune autre valeur ici ne contient de +, le
  // remplacement global est donc sans risque.
  return `${AUTH_URL}?${params.toString().replace(/\+/g, '%20')}`
}

export type ChaineYoutube = { id: string; titre: string; vignette: string | null }

export type FinalisationYoutube = {
  ok: boolean
  message: string
  account_name?: string
  choix_requis?: boolean
  chaines?: ChaineYoutube[]
  refresh_token?: string
}

export async function finaliserYoutube(input: {
  code?: string
  refresh_token?: string
  brand: string
  channel_id?: string
}): Promise<FinalisationYoutube> {
  const { data, error } = await supabase.functions.invoke<
    FinalisationYoutube & { error?: string }
  >('youtube-oauth-exchange', { body: input })

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
