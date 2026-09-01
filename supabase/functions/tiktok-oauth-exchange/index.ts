// Echange un authorization code TikTok contre un access token.
//
// Flow OAuth v2 de TikTok. La fonction ne stocke rien : elle renvoie les
// valeurs au frontend, a charge de l'utilisateur de les coller dans le
// formulaire "Ajouter un compte", comme il le fait deja a la main.
//
// Le client_secret ne doit jamais descendre dans le navigateur, c'est
// precisement pour ca que l'echange se fait ici et pas cote client.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/'

// Doit correspondre au caractere pres a l'URL declaree dans la console TikTok,
// sinon TikTok repond invalid_grant sans plus d'explication.
const REDIRECT_URI = Deno.env.get('TIKTOK_REDIRECT_URI') ?? 'https://bubu-post.vercel.app/'

/** Traduit les erreurs OAuth de TikTok en quelque chose d'actionnable. */
function explain(error: string, description: string): string {
  const e = error.toLowerCase()
  const d = description.toLowerCase()

  if (d.includes('expired') || e === 'invalid_grant') {
    return "Ce code a expire ou a deja ete utilise. Un code TikTok ne vaut que quelques minutes et ne sert qu'une seule fois : relance l'autorisation depuis TikTok et recolle le nouveau code tout de suite."
  }
  if (e === 'invalid_request' && d.includes('redirect')) {
    return `L'URL de redirection ne correspond pas. TikTok attend exactement celle declaree dans la console developpeur, ici ${REDIRECT_URI}, au caractere pres, slash final compris.`
  }
  if (e === 'invalid_client' || d.includes('client_key') || d.includes('client_secret')) {
    return "La cle ou le secret client sont refuses par TikTok. Verifie que ce sont bien ceux de la meme application que celle qui a genere le code."
  }
  if (e === 'invalid_request') {
    return `TikTok a refuse la requete : ${description || 'requete invalide'}. Verifie que le code a ete colle en entier, sans espace ni retour a la ligne.`
  }
  if (e === 'access_denied') {
    return "L'autorisation a ete refusee cote TikTok. Recommence et accepte les permissions demandees."
  }
  return description || `TikTok a repondu une erreur : ${error}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // 1. Autorisation d'abord. Un appelant anonyme n'a pas a savoir quels
  //    secrets sont configures ici, ni a consommer un echange OAuth.
  const bearer = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
  const auth = createClient(SUPABASE_URL, ANON_KEY)
  const { data: userData, error: userErr } = await auth.auth.getUser(bearer)
  if (userErr || !userData.user) return json({ error: 'Non autorise' }, 401)

  const clientKey = Deno.env.get('TIKTOK_CLIENT_KEY')
  const clientSecret = Deno.env.get('TIKTOK_CLIENT_SECRET')
  if (!clientKey || !clientSecret) {
    return json(
      {
        error:
          "Les secrets TIKTOK_CLIENT_KEY et TIKTOK_CLIENT_SECRET ne sont pas configures sur le serveur. Ils se trouvent dans la console TikTok Developers, onglet de ton application.",
      },
      500,
    )
  }

  // 2. Recuperer le code.
  let body: { code?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Corps de requete illisible, il faut du JSON' }, 400)
  }

  const raw = (body.code ?? '').trim()
  if (!raw) {
    return json({ error: "Le code d'autorisation est obligatoire" }, 400)
  }

  // TikTok renvoie le code dans l'URL, souvent encode : il finit fréquemment
  // par %2A, qui est une etoile. Colle tel quel depuis la barre d'adresse, le
  // code part encode et TikTok le rejette. On decode donc systematiquement.
  let code = raw
  try {
    const decoded = decodeURIComponent(raw)
    if (decoded !== raw) code = decoded
  } catch {
    // Code contenant un % isole : on garde la valeur brute.
  }

  // 3. Echanger le code.
  const params = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT_URI,
  })

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
    return json(
      {
        error: "TikTok est injoignable pour le moment. Ce n'est pas ton code, reessaie dans quelques minutes.",
        technical: String(err),
      },
      502,
    )
  }

  const text = await res.text()
  let data: Record<string, unknown>
  try {
    data = JSON.parse(text)
  } catch {
    return json(
      {
        error: "Reponse illisible de TikTok. Reessaie, et previens-moi si ca se reproduit.",
        technical: text.slice(0, 300),
      },
      502,
    )
  }

  // TikTok repond parfois 200 avec un champ error : le statut HTTP ne suffit
  // pas a savoir si l'echange a reussi.
  const tiktokError = typeof data.error === 'string' ? data.error : ''
  if (tiktokError || !res.ok) {
    const description = typeof data.error_description === 'string' ? data.error_description : ''
    return json(
      {
        error: explain(tiktokError, description),
        technical: tiktokError ? `${tiktokError}: ${description}` : `HTTP ${res.status}`,
        log_id: data.log_id ?? null,
      },
      400,
    )
  }

  const accessToken = data.access_token
  if (typeof accessToken !== 'string') {
    return json(
      {
        error: "TikTok a repondu sans access token. Verifie que ton application a bien les scopes demandes.",
        technical: text.slice(0, 300),
      },
      502,
    )
  }

  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : null
  const refreshExpiresIn =
    typeof data.refresh_expires_in === 'number' ? data.refresh_expires_in : null

  // 4. Renvoyer au frontend, sans rien stocker.
  //    On calcule aussi les dates absolues : c'est ce format que le champ
  //    "Expiration du token" du formulaire attend, plutot qu'un nombre de
  //    secondes qu'il faudrait convertir a la main.
  return json({
    ok: true,
    access_token: accessToken,
    refresh_token: typeof data.refresh_token === 'string' ? data.refresh_token : null,
    expires_in: expiresIn,
    refresh_expires_in: refreshExpiresIn,
    open_id: typeof data.open_id === 'string' ? data.open_id : null,
    scope: typeof data.scope === 'string' ? data.scope : null,
    token_type: typeof data.token_type === 'string' ? data.token_type : null,
    expires_at: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
    refresh_expires_at: refreshExpiresIn
      ? new Date(Date.now() + refreshExpiresIn * 1000).toISOString()
      : null,
    message:
      "Echange reussi. Copie l'access token dans le formulaire Ajouter un compte, avec la date d'expiration.",
  })
})
