// Echange un authorization code TikTok contre un access token, puis enregistre
// le compte directement dans la table accounts.
//
// Le client_secret ne descend jamais dans le navigateur, et le token non plus :
// la reponse ne contient que de quoi afficher une confirmation. C'est le seul
// moyen d'avoir un ajout de compte en un clic sans exposer de secret.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import {
  TikTokOAuthError,
  decoderCode,
  echangerCode,
  explain,
  nomDuCompte,
} from '../_shared/tiktok-oauth.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // 1. Autorisation avant tout appel externe.
  const bearer = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
  const auth = createClient(SUPABASE_URL, ANON_KEY)
  const { data: userData, error: userErr } = await auth.auth.getUser(bearer)
  if (userErr || !userData.user) return json({ ok: false, error: 'Non autorise' }, 401)

  let body: { code?: string; brand?: string }
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'Corps de requete illisible' }, 400)
  }

  const codeBrut = (body.code ?? '').trim()
  if (!codeBrut) return json({ ok: false, error: "Le code d'autorisation est manquant" }, 400)

  const brand = (body.brand ?? '').trim() || 'TikTok'

  // 2. Echanger le code.
  let tokens
  try {
    tokens = await echangerCode(decoderCode(codeBrut))
  } catch (err) {
    const e = err instanceof TikTokOAuthError ? err : null
    console.error('Echange TikTok en echec', e?.code, e?.description, e?.logId)
    return json(
      {
        ok: false,
        error: e ? explain(e.code, e.description) : String(err),
        technical: e ? `${e.code}: ${e.description}` : undefined,
      },
      e?.code === 'missing_secrets' ? 500 : 400,
    )
  }

  // Le token est journalise cote serveur uniquement, jamais renvoye au client.
  console.log(
    'Echange TikTok reussi',
    JSON.stringify({
      open_id: tokens.openId,
      scope: tokens.scope,
      expires_in: tokens.expiresIn,
      a_un_refresh_token: Boolean(tokens.refreshToken),
    }),
  )

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const nom = (await nomDuCompte(tokens.accessToken)) ?? `TikTok ${tokens.openId?.slice(0, 8) ?? ''}`
  const expiry = tokens.expiresIn
    ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString()
    : null

  const valeurs = {
    platform: 'tiktok',
    brand,
    account_name: nom,
    external_account_id: tokens.openId,
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    token_expiry: expiry,
    status: 'active',
    // Conserve pour pouvoir repondre plus tard a « ce compte peut-il publier »
    // sans avoir a reinterroger TikTok.
    scope: tokens.scope,
  }

  // 3. Enregistrer. On cherche d'abord un compte deja connecte avec le meme
  //    open_id : reconnecter un compte doit le mettre a jour, pas en creer un
  //    deuxieme a cote.
  let existant: string | null = null
  if (tokens.openId) {
    const { data } = await db
      .from('accounts')
      .select('id')
      .eq('platform', 'tiktok')
      .eq('external_account_id', tokens.openId)
      .maybeSingle()
    existant = data?.id ?? null
  }

  if (existant) {
    const { error } = await db.from('accounts').update(valeurs).eq('id', existant)
    if (error) {
      console.error('Mise a jour du compte impossible', error.message)
      return json({ ok: false, error: `Enregistrement impossible : ${error.message}` }, 500)
    }
  } else {
    const { error } = await db.from('accounts').insert(valeurs)
    if (error) {
      console.error('Creation du compte impossible', error.message)
      return json({ ok: false, error: `Enregistrement impossible : ${error.message}` }, 500)
    }
  }

  // 4. Confirmation, sans le moindre token.
  return json({
    ok: true,
    account_name: nom,
    open_id: tokens.openId,
    scope: tokens.scope,
    token_expiry: expiry,
    updated: Boolean(existant),
    message: existant
      ? `Le compte ${nom} a ete reconnecte.`
      : `Le compte ${nom} a ete ajoute et il est actif.`,
  })
})
