// Notification d'echec par Telegram.
// Choisi plutot que l'email : un bot BotFather et un chat_id suffisent, pas de
// domaine a verifier ni de service tiers a creer.

const TELEGRAM_API = 'https://api.telegram.org'

/** Echappe ce que le parse_mode HTML de Telegram interpreterait. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function notifyTelegram(message: string): Promise<void> {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
  const chatId = Deno.env.get('TELEGRAM_CHAT_ID')

  if (!token || !chatId) {
    console.warn('Telegram non configure, notification ignoree')
    return
  }

  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    })
    if (!res.ok) {
      console.error('Telegram a repondu', res.status, (await res.text()).slice(0, 200))
    }
  } catch (err) {
    // Une notification qui echoue ne doit jamais faire tomber le scheduler.
    console.error('Envoi Telegram impossible', String(err))
  }
}

export function failureMessage(opts: {
  platform: string
  accountName: string
  brand: string
  reason: string
  attempts: number
  maxAttempts: number
  postId: string
}): string {
  const final = opts.attempts >= opts.maxAttempts
  const head = final ? '❌ Publication abandonnee' : '⚠️ Publication en echec'
  return [
    `<b>${head}</b>`,
    `Compte : ${escapeHtml(opts.accountName)} (${escapeHtml(opts.platform)})`,
    `Marque : ${escapeHtml(opts.brand)}`,
    `Tentative ${opts.attempts} sur ${opts.maxAttempts}`,
    '',
    `Raison : ${escapeHtml(opts.reason)}`,
    '',
    final ? 'Aucune nouvelle tentative, il faut intervenir.' : 'Nouvelle tentative programmee.',
    `Post : <code>${opts.postId}</code>`,
  ].join('\n')
}
