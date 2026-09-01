import { supabase } from './supabase'
import { errorMessage } from './errors'
import { setupStatus } from './api'

const AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/'
const SCOPES = 'user.info.basic,video.publish'
const CLE_FLOW = 'bubupost.tiktok.flow'

/** Ce qu'on retient entre le depart vers TikTok et le retour sur le callback. */
type Flow = { state: string; brand: string; at: number }

/** Un flow oublie plus de 15 minutes n'a plus de raison d'aboutir. */
const DUREE_MAX_MS = 15 * 60 * 1000

function randomState(): string {
  const octets = new Uint8Array(16)
  crypto.getRandomValues(octets)
  return Array.from(octets, (o) => o.toString(16).padStart(2, '0')).join('')
}

/**
 * sessionStorage plutot que localStorage : le jeton anti-CSRF ne doit pas
 * survivre a la fermeture de l'onglet ni fuiter vers les autres onglets.
 */
export function saveTikTokFlow(brand: string): string {
  const state = randomState()
  const flow: Flow = { state, brand, at: Date.now() }
  try {
    sessionStorage.setItem(CLE_FLOW, JSON.stringify(flow))
  } catch {
    // Navigation privee stricte : le flow echouera a la verification du state,
    // avec un message clair, plutot que de partir silencieusement de travers.
  }
  return state
}

export function readTikTokFlow(): Flow | null {
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

export function clearTikTokFlow(): void {
  try {
    sessionStorage.removeItem(CLE_FLOW)
  } catch {
    // Sans importance, le flow expire de lui-meme.
  }
}

/**
 * Construit l'URL d'autorisation TikTok.
 * La client_key vient du serveur : elle est publique par construction, elle
 * apparait en clair dans cette URL. Le client_secret, lui, ne quitte jamais
 * les Edge Functions.
 */
export async function buildTikTokAuthUrl(brand: string): Promise<string> {
  const status = await setupStatus()

  if (!status.tiktok_client_key) {
    throw new Error(
      "La cle publique TikTok n'est pas configuree sur le serveur. Previens-moi, je la pose.",
    )
  }

  const state = saveTikTokFlow(brand)
  const params = new URLSearchParams({
    client_key: status.tiktok_client_key,
    scope: SCOPES,
    response_type: 'code',
    redirect_uri:
      status.tiktok_redirect_uri ?? `${window.location.origin}/auth/tiktok/callback`,
    state,

    // Force TikTok a reafficher l'ecran de consentement complet, avec le detail
    // des permissions, meme si l'app a deja ete autorisee. Sans ce parametre,
    // TikTok renvoie directement un code en reconduisant les scopes deja
    // accordes : un scope refuse au premier essai, comme video.publish, ne
    // serait alors plus jamais represente, et la connexion aboutirait sur un
    // compte incapable de publier.
    disable_auto_auth: '1',
  })

  return `${AUTHORIZE_URL}?${params.toString()}`
}

export type TikTokExchangeResult = {
  ok: boolean
  message: string
  account_name?: string
  open_id?: string
  updated?: boolean
}

/**
 * Envoie le code au serveur, qui l'echange et enregistre le compte.
 * Aucun token ne revient jusqu'ici, c'est voulu.
 */
export async function exchangeTikTokCode(
  code: string,
  brand: string,
): Promise<TikTokExchangeResult> {
  const { data, error } = await supabase.functions.invoke<
    TikTokExchangeResult & { error?: string }
  >('tiktok-oauth-exchange', { body: { code, brand } })

  // Une Edge Function qui repond 4xx remonte ici comme une erreur : le message
  // utile est dans le corps, pas dans error.message. Sans cette relecture,
  // Diego verrait "Edge Function returned a non-2xx status code" au lieu de
  // "ce code a expire".
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
  if (!data.ok) throw new Error(data.error ?? 'Echange impossible')
  return data
}
