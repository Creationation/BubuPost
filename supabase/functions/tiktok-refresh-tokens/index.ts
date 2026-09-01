// Renouvellement automatique des tokens TikTok.
//
// Un access token TikTok ne vit que 24 h. Sans ce passage quotidien, la
// premiere publication du lendemain echouerait, et il faudrait tout
// reconnecter a la main. Le refresh token, lui, tient un an.
import { createClient, SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { TikTokOAuthError, explain, rafraichir } from '../_shared/tiktok-oauth.ts'
import { notifyTelegram } from '../_shared/notify.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

/** On renouvelle des qu'il reste moins de 24 h, sans attendre l'expiration. */
const MARGE_HEURES = 24

/** Le role porte par un JWT, ou null si le jeton n'en est pas un. */
function jwtRole(token: string): string | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const pad = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(pad.padEnd(Math.ceil(pad.length / 4) * 4, '=')))
    return typeof payload.role === 'string' ? payload.role : null
  } catch {
    return null
  }
}

type Compte = {
  id: string
  account_name: string
  brand: string
  refresh_token: string | null
  token_expiry: string | null
  status: string
}

async function renouveler(db: SupabaseClient, compte: Compte): Promise<string> {
  if (!compte.refresh_token) {
    await db.from('accounts').update({ status: 'expired' }).eq('id', compte.id)
    console.warn(`${compte.account_name} : aucun refresh token, statut passe a expired`)
    await notifyTelegram(
      `⚠️ TikTok : le compte ${compte.account_name} n'a pas de refresh token. Reconnecte-le depuis l'onglet Comptes.`,
    )
    return 'sans refresh token'
  }

  try {
    const tokens = await rafraichir(compte.refresh_token)
    const expiry = tokens.expiresIn
      ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString()
      : null

    const { error } = await db
      .from('accounts')
      .update({
        access_token: tokens.accessToken,
        // TikTok renvoie un refresh token neuf a chaque renouvellement. Garder
        // l'ancien ferait echouer le passage suivant.
        refresh_token: tokens.refreshToken ?? compte.refresh_token,
        token_expiry: expiry,
        status: 'active',
      })
      .eq('id', compte.id)

    if (error) {
      console.error(`${compte.account_name} : ecriture impossible`, error.message)
      return `echec ecriture : ${error.message}`
    }

    console.log(`${compte.account_name} : token renouvele jusqu'a ${expiry}`)
    return 'renouvele'
  } catch (err) {
    const e = err instanceof TikTokOAuthError ? err : null
    const raison = e ? explain(e.code, e.description) : String(err)

    // Le refresh a echoue : plus rien ne peut sauver ce compte automatiquement,
    // il faut une reconnexion humaine. On le marque pour que le dashboard le
    // montre en rouge plutot que de laisser croire que tout va bien.
    await db.from('accounts').update({ status: 'expired' }).eq('id', compte.id)
    console.error(`${compte.account_name} : renouvellement en echec`, e?.code, e?.description)

    await notifyTelegram(
      [
        '❌ <b>TikTok : renouvellement impossible</b>',
        `Compte : ${compte.account_name}`,
        `Marque : ${compte.brand}`,
        '',
        `Raison : ${raison}`,
        '',
        "Le compte est passe en expire. Reconnecte-le depuis l'onglet Comptes.",
      ].join('\n'),
    )
    return `echec : ${raison}`
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // Le cron porte la cle service_role, un utilisateur connecte peut aussi
  // declencher un passage a la main.
  const bearer = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
  if (!bearer) return json({ error: 'Non autorise' }, 401)

  if (bearer !== SERVICE_KEY && jwtRole(bearer) !== 'service_role') {
    const auth = createClient(SUPABASE_URL, ANON_KEY)
    const { data, error } = await auth.auth.getUser(bearer)
    if (error || !data.user) return json({ error: 'Non autorise' }, 401)
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const limite = new Date(Date.now() + MARGE_HEURES * 3600 * 1000).toISOString()

  // Les comptes en pause sont volontairement laisses de cote.
  const { data: comptes, error } = await db
    .from('accounts')
    .select('id, account_name, brand, refresh_token, token_expiry, status')
    .eq('platform', 'tiktok')
    .in('status', ['active', 'error', 'expired'])
    .or(`token_expiry.is.null,token_expiry.lte.${limite}`)

  if (error) {
    console.error('Lecture des comptes impossible', error.message)
    return json({ error: error.message }, 500)
  }

  const resultats: Array<{ compte: string; issue: string }> = []
  for (const compte of (comptes ?? []) as Compte[]) {
    resultats.push({ compte: compte.account_name, issue: await renouveler(db, compte) })
  }

  return json({
    ran_at: new Date().toISOString(),
    examines: resultats.length,
    resultats,
  })
})
