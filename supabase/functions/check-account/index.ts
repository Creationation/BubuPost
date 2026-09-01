// Teste un compte de reseau social et repond en francais comprehensible.
//
// C'est le filet de securite : plutot que de decouvrir qu'un token est mauvais
// le jour ou une publication rate, on le verifie au moment ou on l'enregistre.
// La fonction met aussi le statut du compte a jour, pour que le dashboard le
// reflete immediatement.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { adapterFor, Account, PlatformError } from '../_shared/adapters/index.ts'
import { corsHeaders, json } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

/**
 * Traduit une erreur de plateforme en conseil actionnable.
 * Les messages des API sont en anglais et supposent qu'on connait leur jargon.
 */
function explain(platform: string, message: string): string {
  const m = message.toLowerCase()

  if (m.includes('invalid oauth') || m.includes('cannot parse access token')) {
    return "Le token n'est pas valide. Il a peut-etre ete tronque au copier-coller : verifie qu'il n'y a ni espace ni retour a la ligne au debut ou a la fin."
  }
  if (m.includes('session has expired') || m.includes('expired') || m.includes('code 190')) {
    return "Le token a expire. Il faut en generer un nouveau, puis le recoller ici. Sur Meta, un token longue duree tient 60 jours."
  }
  if (m.includes('permission') || m.includes('scope') || m.includes('#200') || m.includes('#10')) {
    return "Le token fonctionne mais il n'a pas les droits necessaires. Regenere-le en cochant bien toutes les permissions demandees pour cette plateforme."
  }
  if (m.includes('unsupported get request') || m.includes('does not exist') || m.includes('#803')) {
    return "L'identifiant de compte ne correspond a rien, ou ce token n'y a pas acces. C'est presque toujours une confusion entre l'ID de la Page Facebook et celui du compte Instagram."
  }
  if (m.includes("n'a pas de token")) {
    return "Aucun token n'est enregistre pour ce compte. Ouvre le compte, colle le token, et enregistre."
  }
  if (m.includes('a expire')) {
    return "La date d'expiration enregistree est deja passee. Genere un nouveau token et mets la date a jour."
  }
  if (m.includes('reseau injoignable')) {
    return 'La plateforme est injoignable pour le moment. Ce n est pas ton token, reessaie dans quelques minutes.'
  }
  if (platform === 'tiktok' && (m.includes('scope') || m.includes('403'))) {
    return "TikTok refuse l'acces. Tant que ton app n'a pas passe l'app review, seules les fonctions du bac a sable sont ouvertes."
  }
  return message
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // Reserve aux utilisateurs connectes : la fonction lit des tokens.
  const bearer = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
  const auth = createClient(SUPABASE_URL, ANON_KEY)
  const { data: userData, error: userErr } = await auth.auth.getUser(bearer)
  if (userErr || !userData.user) return json({ error: 'Non autorise' }, 401)

  let accountId: string
  try {
    accountId = (await req.json()).account_id
  } catch {
    return json({ error: 'Corps de requete illisible' }, 400)
  }
  if (!accountId) return json({ error: 'account_id manquant' }, 400)

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: account, error } = await db
    .from('accounts')
    .select('*')
    .eq('id', accountId)
    .maybeSingle()

  if (error || !account) return json({ error: 'Compte introuvable' }, 404)

  const typed = account as Account

  try {
    const adapter = adapterFor(typed.platform)
    const name = await adapter.verify(typed)

    // Le compte repond : on le remet actif s'il etait tombe en erreur.
    const correctif: Record<string, string> = {}
    if (typed.status === 'error' || typed.status === 'expired') correctif.status = 'active'

    // Repare aussi les noms de repli du genre "TikTok -000-Lx4", poses quand la
    // plateforme n'avait pas pu donner le vrai nom. On ne touche jamais a un
    // nom choisi a la main.
    if (/^TikTok [A-Za-z0-9_-]{0,12}$/.test(typed.account_name) && name !== typed.account_name) {
      correctif.account_name = name
    }

    if (Object.keys(correctif).length > 0) {
      await db.from('accounts').update(correctif).eq('id', accountId)
    }

    return json({
      ok: true,
      remote_name: name,
      message: `Connexion reussie. La plateforme repond pour le compte ${name}.`,
      status_updated: typed.status === 'error' || typed.status === 'expired' ? 'active' : typed.status,
    })
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    const expired = raw.toLowerCase().includes('expire')
    const newStatus = expired ? 'expired' : 'error'

    // On ne bascule pas un compte en pause : c'est un choix volontaire de Diego.
    if (typed.status !== 'paused') {
      await db.from('accounts').update({ status: newStatus }).eq('id', accountId)
    }

    return json({
      ok: false,
      message: explain(typed.platform, raw),
      technical: raw,
      detail: err instanceof PlatformError ? err.detail : null,
      status_updated: typed.status !== 'paused' ? newStatus : typed.status,
    })
  }
})
