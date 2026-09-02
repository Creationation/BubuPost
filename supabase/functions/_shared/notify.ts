// Alertes Telegram.
//
// Choisi plutot que l'email : un bot BotFather et un chat_id suffisent, pas de
// domaine a verifier ni de service tiers a creer.
//
// Regle de fond : une alerte qui echoue ne doit JAMAIS faire tomber ce qui
// l'a declenchee. Une publication ratee est ennuyeuse, un scheduler qui
// s'arrete parce que Telegram ne repond pas l'est beaucoup plus.
import { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

const TELEGRAM_API = 'https://api.telegram.org'
const LIEN_POSTS = 'https://bubu-post.vercel.app/posts'

/** Un meme message ne part pas deux fois dans l'heure. */
const FENETRE_MS = 3600_000
const CLE_HISTORIQUE = 'telegram_envois'

/** Echappe ce que le parse_mode HTML de Telegram interpreterait. */
export function echapper(texte: string): string {
  return String(texte ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Le nom du fichier, plus lisible qu'une URL de trente lignes. */
export function nomFichier(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() || url)
  } catch {
    return url.split('/').pop() || url
  }
}

const HEURE = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Paris',
})

export function heureLisible(iso: string | null): string {
  if (!iso) return 'non planifiee'
  try {
    return HEURE.format(new Date(iso))
  } catch {
    return iso
  }
}

/** Envoi brut, sans jamais lever d'exception. */
async function envoyer(texte: string): Promise<boolean> {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
  const chatId = Deno.env.get('TELEGRAM_CHAT_ID')

  if (!token || !chatId) {
    console.warn('Telegram non configure, alerte ignoree')
    return false
  }

  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: texte,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    })
    if (!res.ok) {
      console.error('Telegram a repondu', res.status, (await res.text()).slice(0, 200))
      return false
    }
    return true
  } catch (err) {
    console.error('Envoi Telegram impossible', String(err))
    return false
  }
}

/** Empreinte stable d'un message, pour reperer les doublons. */
async function empreinte(texte: string): Promise<string> {
  const octets = new TextEncoder().encode(texte)
  const hache = await crypto.subtle.digest('SHA-256', octets)
  return Array.from(new Uint8Array(hache).slice(0, 8))
    .map((o) => o.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Envoi avec garde anti-doublon.
 *
 * Un token expire fait echouer toutes les publications de la journee : sans
 * cette garde, le meme message partirait des dizaines de fois et on finirait
 * par ne plus les lire.
 */
export async function notifyTelegram(
  texte: string,
  db?: SupabaseClient,
): Promise<boolean> {
  if (!db) return envoyer(texte)

  try {
    const cle = await empreinte(texte)
    const maintenant = Date.now()

    const { data } = await db
      .from('app_settings')
      .select('value')
      .eq('key', CLE_HISTORIQUE)
      .maybeSingle()

    const historique = (data?.value ?? {}) as Record<string, number>

    if (historique[cle] && maintenant - historique[cle] < FENETRE_MS) {
      const minutes = Math.round((maintenant - historique[cle]) / 60_000)
      console.log(`Alerte identique deja envoyee il y a ${minutes} min, ignoree`)
      return false
    }

    const envoye = await envoyer(texte)
    if (!envoye) return false

    // On purge en ecrivant, sinon l'historique grossit indefiniment.
    const propre: Record<string, number> = { [cle]: maintenant }
    for (const [k, t] of Object.entries(historique)) {
      if (maintenant - t < FENETRE_MS) propre[k] = t
    }

    await db
      .from('app_settings')
      .upsert(
        { key: CLE_HISTORIQUE, value: propre as never, updated_at: new Date().toISOString() },
        { onConflict: 'key' },
      )

    return true
  } catch (err) {
    // La garde anti-doublon ne doit pas empecher l'alerte : en cas de pepin
    // on envoie quand meme, quitte a faire un doublon.
    console.error('Garde anti-doublon indisponible', String(err))
    return envoyer(texte)
  }
}

// ---------------------------------------------------------------------------
// Mise en forme
// ---------------------------------------------------------------------------

export type EchecPublication = {
  platform: string
  accountName: string
  brand: string
  videoUrl: string
  scheduledAt: string | null
  reason: string
  definitif: boolean
}

/**
 * Un seul message pour tous les echecs d'un passage.
 *
 * Neuf publications qui tombent parce qu'un token a expire, ce n'est pas neuf
 * problemes : c'est un seul. Neuf notifications noieraient l'information.
 */
export function messageEchecs(echecs: EchecPublication[]): string {
  if (echecs.length === 1) {
    const e = echecs[0]
    return [
      e.definitif ? '❌ <b>Publication abandonnee</b>' : '⚠️ <b>Publication en echec</b>',
      '',
      `${echapper(e.accountName)} · ${echapper(e.platform)} · ${echapper(e.brand)}`,
      `Video : ${echapper(nomFichier(e.videoUrl))}`,
      `Prevue : ${echapper(heureLisible(e.scheduledAt))}`,
      '',
      echapper(e.reason),
      '',
      e.definitif
        ? 'Aucune nouvelle tentative, il faut intervenir.'
        : 'Une nouvelle tentative est programmee.',
      LIEN_POSTS,
    ].join('\n')
  }

  // Plusieurs echecs : on met en avant ce qui leur est commun.
  const raisons = [...new Set(echecs.map((e) => e.reason))]
  const comptes = [...new Set(echecs.map((e) => e.accountName))]
  const definitifs = echecs.filter((e) => e.definitif).length

  const lignes = [
    `❌ <b>${echecs.length} publications en echec</b>`,
    '',
    `Comptes : ${echapper(comptes.join(', '))}`,
    `Video : ${echapper(nomFichier(echecs[0].videoUrl))}`,
    '',
  ]

  if (raisons.length === 1) {
    lignes.push('Meme cause pour toutes :', echapper(raisons[0]))
  } else {
    lignes.push('Causes :')
    for (const r of raisons.slice(0, 4)) lignes.push(`· ${echapper(r)}`)
    if (raisons.length > 4) lignes.push(`· et ${raisons.length - 4} autre(s)`)
  }

  lignes.push(
    '',
    definitifs === echecs.length
      ? 'Aucune nouvelle tentative, il faut intervenir.'
      : `${definitifs} abandonnee(s), ${echecs.length - definitifs} seront reessayees.`,
    LIEN_POSTS,
  )

  return lignes.join('\n')
}

/** Quota atteint : ce n'est pas une panne, la publication est juste repoussee. */
export function messageQuota(opts: {
  platform: string
  accountName: string
  used: number
  limit: number
  videoUrl: string
}): string {
  return [
    '⏸ <b>Quota atteint</b>',
    '',
    `${echapper(opts.accountName)} · ${echapper(opts.platform)}`,
    `${opts.used} publications sur ${opts.limit} autorisees en 24 h.`,
    `Video : ${echapper(nomFichier(opts.videoUrl))}`,
    '',
    "La publication est repoussee d'une heure, elle partira toute seule des que le quota se libere.",
    LIEN_POSTS,
  ].join('\n')
}

/** Renouvellement de token impossible : le compte ne publiera plus. */
export function messageTokenExpire(opts: {
  platform: string
  accountName: string
  brand: string
  reason: string
}): string {
  return [
    '🔑 <b>Reconnexion necessaire</b>',
    '',
    `${echapper(opts.accountName)} · ${echapper(opts.platform)} · ${echapper(opts.brand)}`,
    '',
    echapper(opts.reason),
    '',
    "Le compte est passe en expire et ne publiera plus. Reconnecte-le depuis l'onglet Comptes.",
    'https://bubu-post.vercel.app/accounts',
  ].join('\n')
}
