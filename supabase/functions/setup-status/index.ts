// Dit a l'application quelles cles sont configurees cote serveur.
//
// Ne renvoie que des booleens, jamais la moindre valeur : le but est d'afficher
// une liste de controle dans l'app, pas d'exposer des secrets au navigateur.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const has = (name: string) => Boolean(Deno.env.get(name)?.trim())

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const bearer = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
  const auth = createClient(SUPABASE_URL, ANON_KEY)
  const { data, error } = await auth.auth.getUser(bearer)
  if (error || !data.user) return json({ error: 'Non autorise' }, 401)

  return json({
    anthropic: has('ANTHROPIC_API_KEY'),
    telegram: has('TELEGRAM_BOT_TOKEN') && has('TELEGRAM_CHAT_ID'),
    google: has('GOOGLE_CLIENT_ID') && has('GOOGLE_CLIENT_SECRET'),
    tiktok: has('TIKTOK_CLIENT_KEY') && has('TIKTOK_CLIENT_SECRET'),

    // La client_key TikTok est publique par construction : elle apparait en
    // clair dans l'URL d'autorisation que voit l'utilisateur. La servir ici
    // evite d'avoir a la dupliquer dans les variables Vercel, donc une source
    // de verite en moins a maintenir. Le client_secret, lui, ne sort jamais.
    tiktok_client_key: Deno.env.get('TIKTOK_CLIENT_KEY')?.trim() ?? null,
    meta: has('META_APP_ID') && has('META_APP_SECRET'),

    // L'App ID Meta est public : il apparait en clair dans l'URL
    // d'autorisation. Le secret, lui, ne sort jamais d'ici.
    meta_app_id: Deno.env.get('META_APP_ID')?.trim() ?? null,
    meta_redirect_uri:
      Deno.env.get('META_REDIRECT_URI') ?? 'https://bubu-post.vercel.app/auth/meta/callback',

    tiktok_redirect_uri:
      Deno.env.get('TIKTOK_REDIRECT_URI') ?? 'https://bubu-post.vercel.app/auth/tiktok/callback',
  })
})
