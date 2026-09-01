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
  })
})
