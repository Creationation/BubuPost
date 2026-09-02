// Echange un authorization code Google contre des jetons, puis enregistre la
// chaine YouTube.
//
// Le client_secret ne descend jamais dans le navigateur, et aucun jeton ne
// repart : la reponse ne contient que de quoi afficher une confirmation.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import {
  YouTubeError,
  chaines,
  echangerCode,
  explain,
  rafraichir,
} from '../_shared/youtube-oauth.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // Autorisation avant tout appel externe.
  const bearer = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
  const auth = createClient(SUPABASE_URL, ANON_KEY)
  const { data: userData, error: userErr } = await auth.auth.getUser(bearer)
  if (userErr || !userData.user) return json({ ok: false, error: 'Non autorise' }, 401)

  let body: { code?: string; brand?: string; channel_id?: string; refresh_token?: string }
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'Corps de requete illisible' }, 400)
  }

  const brand = (body.brand ?? '').trim() || 'YouTube'

  try {
    // Deux entrees possibles : le code au premier passage, ou le refresh token
    // deja obtenu quand l'utilisateur choisit parmi plusieurs chaines. Le code
    // Google ne sert qu'une fois, on ne peut pas le rejouer.
    let jetons
    if (body.refresh_token) {
      jetons = await rafraichir(body.refresh_token)
      jetons = { ...jetons, refreshToken: body.refresh_token }
    } else {
      const code = (body.code ?? '').trim()
      if (!code) return json({ ok: false, error: "Le code d'autorisation est manquant" }, 400)
      jetons = await echangerCode(code)
    }

    if (!jetons.refreshToken) {
      return json(
        {
          ok: false,
          error:
            "Google n'a pas fourni de jeton de renouvellement. L'autorisation doit demander access_type=offline et prompt=consent, sinon la chaine cesserait de publier au bout d'une heure. Relance la connexion.",
        },
        400,
      )
    }

    const liste = await chaines(jetons.accessToken)
    if (liste.length === 0) {
      return json(
        {
          ok: false,
          error:
            "Aucune chaine YouTube n'est rattachee a ce compte Google. Cree une chaine sur YouTube, puis relance la connexion.",
        },
        400,
      )
    }

    console.log(
      'Connexion YouTube',
      JSON.stringify({
        chaines: liste.length,
        noms: liste.map((c) => c.titre),
        scope: jetons.scope,
      }),
    )

    // Plusieurs chaines : on laisse choisir plutot que de tout importer.
    if (liste.length > 1 && !body.channel_id) {
      return json({
        ok: true,
        choix_requis: true,
        // Le refresh token permet de reprendre sans rejouer le code, qui est
        // deja consomme. Il ne quitte pas la session de l'utilisateur.
        refresh_token: jetons.refreshToken,
        chaines: liste.map((c) => ({ id: c.id, titre: c.titre, vignette: c.vignette })),
        message: 'Plusieurs chaines sont disponibles, choisis celle a connecter.',
      })
    }

    const chaine = body.channel_id
      ? liste.find((c) => c.id === body.channel_id)
      : liste[0]

    if (!chaine) {
      return json({ ok: false, error: "Cette chaine n'est plus accessible" }, 400)
    }

    const expiry = jetons.expiresIn
      ? new Date(Date.now() + jetons.expiresIn * 1000).toISOString()
      : null

    const db = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const valeurs = {
      platform: 'youtube',
      brand,
      account_name: chaine.titre,
      external_account_id: chaine.id,
      access_token: jetons.accessToken,
      refresh_token: jetons.refreshToken,
      token_expiry: expiry,
      scope: jetons.scope,
      status: 'active',
    }

    const { data: existant } = await db
      .from('accounts')
      .select('id')
      .eq('platform', 'youtube')
      .eq('external_account_id', chaine.id)
      .maybeSingle()

    if (existant?.id) {
      const { error } = await db.from('accounts').update(valeurs).eq('id', existant.id)
      if (error) throw new YouTubeError(error.message, 'db')
    } else {
      const { error } = await db.from('accounts').insert(valeurs)
      if (error) throw new YouTubeError(error.message, 'db')
    }

    return json({
      ok: true,
      account_name: chaine.titre,
      message: existant?.id
        ? `La chaine ${chaine.titre} a ete reconnectee.`
        : `La chaine ${chaine.titre} a ete ajoutee et elle est active.`,
    })
  } catch (err) {
    const e = err instanceof YouTubeError ? err : null
    console.error('Connexion YouTube en echec', e?.code, e?.message)
    return json(
      {
        ok: false,
        error: e ? explain(e.code, e.message) : String(err),
        technical: e ? `${e.code}: ${e.message}` : undefined,
      },
      e?.code === 'missing_secrets' ? 500 : 400,
    )
  }
})
