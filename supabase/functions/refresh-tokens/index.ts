// Renouvellement automatique des tokens, toutes plateformes.
//
// TikTok : l access token ne vit que 24 h, sans ce passage quotidien la
// premiere publication du lendemain echouerait.
// Instagram : le Page Access Token qui publie ne perime pas de lui-meme, mais
// il cesse de fonctionner quand le jeton utilisateur dont il derive expire,
// au bout de 60 jours. On prolonge donc le jeton utilisateur, puis on en tire
// un jeton de Page neuf.
import { createClient, SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { TikTokOAuthError, explain, rafraichir } from '../_shared/tiktok-oauth.ts'
import { notifyTelegram } from '../_shared/notify.ts'
import {
  MetaError,
  explain as expliquerMeta,
  pagesAvecInstagram,
  prolongerJeton,
} from '../_shared/meta-oauth.ts'

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
  platform: string
  account_name: string
  brand: string
  external_account_id: string | null
  refresh_token: string | null
  token_expiry: string | null
  status: string
}

async function renouvelerTikTok(db: SupabaseClient, compte: Compte): Promise<string> {
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
        scope: tokens.scope ?? undefined,
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

/**
 * Instagram : on prolonge le jeton utilisateur, puis on en tire un jeton de
 * Page neuf. Reecrire le meme jeton de Page ne servirait a rien, c'est le
 * jeton utilisateur en amont qui perime, au bout de 60 jours.
 */
async function renouvelerInstagram(db: SupabaseClient, compte: Compte): Promise<string> {
  if (!compte.refresh_token) {
    await db.from('accounts').update({ status: 'expired' }).eq('id', compte.id)
    await notifyTelegram(
      `⚠️ Instagram : le compte ${compte.account_name} n'a pas de jeton utilisateur enregistre. Reconnecte-le depuis l'onglet Comptes.`,
    )
    return 'sans jeton utilisateur'
  }

  try {
    const prolonge = await prolongerJeton(compte.refresh_token)
    const pages = await pagesAvecInstagram(prolonge.token)

    const page = pages.find((p) => p.ig_user_id === compte.external_account_id)
    if (!page) {
      await db.from('accounts').update({ status: 'expired' }).eq('id', compte.id)
      await notifyTelegram(
        `❌ Instagram : le compte ${compte.account_name} n'est plus accessible avec cette autorisation. La Page a peut-etre ete dissociee. Reconnecte-le.`,
      )
      return 'compte introuvable dans les Pages'
    }

    const expiry = prolonge.expiresIn
      ? new Date(Date.now() + prolonge.expiresIn * 1000).toISOString()
      : null

    const { error } = await db
      .from('accounts')
      .update({
        access_token: page.page_access_token,
        refresh_token: prolonge.token,
        token_expiry: expiry,
        status: 'active',
      })
      .eq('id', compte.id)

    if (error) {
      console.error(`${compte.account_name} : ecriture impossible`, error.message)
      return `echec ecriture : ${error.message}`
    }

    console.log(`${compte.account_name} : jeton renouvele jusqu'a ${expiry}`)
    return 'renouvele'
  } catch (err) {
    const e = err instanceof MetaError ? err : null
    const raison = e ? expliquerMeta(e.message, e.code) : String(err)

    await db.from('accounts').update({ status: 'expired' }).eq('id', compte.id)
    console.error(`${compte.account_name} : renouvellement en echec`, e?.code, e?.message)

    await notifyTelegram(
      [
        '❌ <b>Instagram : renouvellement impossible</b>',
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

/** Aiguillage par plateforme. */
function renouveler(db: SupabaseClient, compte: Compte): Promise<string> {
  if (compte.platform === 'instagram') return renouvelerInstagram(db, compte)
  return renouvelerTikTok(db, compte)
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
    .select('id, platform, account_name, brand, external_account_id, refresh_token, token_expiry, status')
    .in('platform', ['tiktok', 'instagram'])
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
