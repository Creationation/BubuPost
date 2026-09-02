// Envoie un message de test sur Telegram.
//
// Sans ca, la seule facon de savoir si les alertes fonctionnent serait
// d'attendre une vraie panne. C'est precisement le moment ou l'on ne veut pas
// decouvrir que la configuration est mauvaise.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const HEURE = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'full',
  timeStyle: 'short',
  timeZone: 'Europe/Paris',
})

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const bearer = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
  const auth = createClient(SUPABASE_URL, ANON_KEY)
  const { data, error } = await auth.auth.getUser(bearer)
  if (error || !data.user) return json({ ok: false, error: 'Non autorise' }, 401)

  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
  const chatId = Deno.env.get('TELEGRAM_CHAT_ID')

  if (!token || !chatId) {
    return json({
      ok: false,
      error:
        "Les identifiants Telegram ne sont pas configures sur le serveur. Previens-moi, je les pose.",
    })
  }

  const texte = [
    '✅ <b>Test des alertes BubuPost</b>',
    '',
    `Envoye le ${HEURE.format(new Date())}.`,
    '',
    "Si tu lis ce message, les alertes fonctionnent : tu seras prevenu quand une publication echoue definitivement, quand un token ne peut plus etre renouvele, ou quand un quota est atteint.",
    '',
    'https://bubu-post.vercel.app/posts',
  ].join('\n')

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: texte,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    })

    const corps = await res.json()

    if (!res.ok || corps.ok === false) {
      // Telegram explique precisement ce qui cloche, autant le traduire.
      const description = String(corps.description ?? `HTTP ${res.status}`)
      let conseil = description

      if (description.includes('chat not found')) {
        conseil =
          "Telegram ne trouve pas la conversation. Le chat_id est peut-etre faux, ou tu n'as jamais ecrit au bot : envoie-lui un premier message, il n'a pas le droit de parler en premier."
      } else if (description.includes('bot was blocked')) {
        conseil = 'Tu as bloque le bot dans Telegram. Debloque-le et reessaie.'
      } else if (description.includes('Unauthorized')) {
        conseil = "Le token du bot est refuse par Telegram. Verifie-le aupres de BotFather."
      }

      console.error('Test Telegram en echec', description)
      return json({ ok: false, error: conseil, technical: description })
    }

    return json({
      ok: true,
      message: 'Message envoye. Regarde ton Telegram, il devrait y etre.',
    })
  } catch (err) {
    console.error('Test Telegram impossible', String(err))
    return json({
      ok: false,
      error: "Telegram est injoignable pour le moment. Reessaie dans quelques minutes.",
    })
  }
})
