// Ce que la fin d'une video dit de la session.
//
// Chaque Reel se termine sur le tableau de bord de l'EA : balance, profit du
// jour, profit total, drawdown flottant, spread, positions ouvertes. Un texte
// qui cite deux de ces chiffres, exacts, vaut plus que dix adjectifs. On lit
// l'image UNE fois par video, on garde le resultat, et chaque generation s'en
// sert.
import Anthropic from 'npm:@anthropic-ai/sdk@0.122.0'

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-opus-5'

export type Metriques = {
  instrument: string | null
  devise: string | null
  balance: number | null
  equity: number | null
  floating_pl: number | null
  spread_pts: number | null
  positions_ouvertes: number | null
  profit_jour: number | null
  profit_total: number | null
  dd_max_jour: number | null
  dd_max_semaine: number | null
  dd_max_mois: number | null
  date_session: string | null
}

const CLES: (keyof Metriques)[] = [
  'instrument',
  'devise',
  'balance',
  'equity',
  'floating_pl',
  'spread_pts',
  'positions_ouvertes',
  'profit_jour',
  'profit_total',
  'dd_max_jour',
  'dd_max_semaine',
  'dd_max_mois',
  'date_session',
]

const CONSIGNE = `Cette image est la derniere seconde d'une video de session de trading sur MetaTrader 5. Un panneau a gauche affiche les chiffres du compte et de l'EA.

Lis EXACTEMENT ce qui est ecrit. N'invente rien, n'arrondis rien, ne deduis rien. Si une valeur n'est pas visible ou pas lisible, mets null.

Reponds uniquement par un objet JSON, sans bloc de code, de la forme :
{
  "instrument": "XAUUSD" (le symbole du graphique, ou null),
  "devise": "USD" (la devise du compte, ou null),
  "balance": nombre ou null,
  "equity": nombre ou null,
  "floating_pl": nombre signe ou null (Floating P/L),
  "spread_pts": nombre ou null (Spread, en points),
  "positions_ouvertes": entier ou null (Open Positions),
  "profit_jour": nombre signe ou null (Day Profit, dans CLOSED PROFITS),
  "profit_total": nombre signe ou null (All Time, dans CLOSED PROFITS),
  "dd_max_jour": nombre signe ou null (MAX FLOATING DD, ligne Today),
  "dd_max_semaine": nombre signe ou null (MAX FLOATING DD, ligne This Week),
  "dd_max_mois": nombre signe ou null (MAX FLOATING DD, ligne This Month),
  "date_session": "AAAA-MM-JJ" lue sur l'axe du temps du graphique, ou null
}

Les nombres sont des nombres JSON : +6,476.51 USD s'ecrit 6476.51, -374.62 USD s'ecrit -374.62.`

/** Lit le tableau de bord sur l'image. Null si l'image ne se lit pas. */
export async function lireMetriques(apiKey: string, imageUrl: string): Promise<Metriques | null> {
  const client = new Anthropic({ apiKey })

  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 600,
    // Lire un panneau n'exige pas de reflexion, seulement de l'attention.
    output_config: { effort: 'low' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: imageUrl } },
          { type: 'text', text: CONSIGNE },
        ],
      },
    ],
  })

  if (response.stop_reason === 'refusal') return null

  const texte = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('\n')

  const debut = texte.indexOf('{')
  const fin = texte.lastIndexOf('}')
  if (debut === -1 || fin <= debut) return null

  let brut: Record<string, unknown>
  try {
    brut = JSON.parse(texte.slice(debut, fin + 1))
  } catch {
    return null
  }

  const m = {} as Metriques
  for (const cle of CLES) {
    const v = brut[cle]
    if (cle === 'instrument' || cle === 'devise' || cle === 'date_session') {
      ;(m as Record<string, unknown>)[cle] = typeof v === 'string' && v.trim() ? v.trim() : null
    } else {
      const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[^\d.-]/g, '')) : NaN
      ;(m as Record<string, unknown>)[cle] = Number.isFinite(n) ? n : null
    }
  }
  return m
}

/** « +263 USD », « -374,62 USD » : un montant lisible, signe visible. */
function montant(n: number, devise: string | null): string {
  const signe = n > 0 ? '+' : n < 0 ? '-' : ''
  const abs = Math.abs(n)
  const texte = abs >= 1000 ? abs.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(abs)
  return `${signe}${texte}${devise ? ' ' + devise : ''}`
}

/**
 * Les chiffres sous forme de phrase pour le modele, dans la langue du prompt
 * (le francais : les consignes sont en francais, le modele ecrit ensuite dans
 * la langue de chaque cible).
 *
 * Renvoie une chaine vide s'il n'y a rien d'exploitable.
 */
export function decrireMetriques(m: Metriques | null | undefined): string {
  if (!m) return ''
  const d = m.devise
  const parts: string[] = []
  if (m.instrument) parts.push(`instrument ${m.instrument}`)
  if (m.profit_jour !== null) parts.push(`profit du jour ${montant(m.profit_jour, d)}`)
  if (m.profit_total !== null) parts.push(`profit total depuis le debut ${montant(m.profit_total, d)}`)
  if (m.floating_pl !== null) parts.push(`floating P/L au moment de l'arret ${montant(m.floating_pl, d)}`)
  if (m.dd_max_jour !== null) parts.push(`drawdown flottant maximal du jour ${montant(m.dd_max_jour, d)}`)
  if (m.dd_max_semaine !== null) parts.push(`drawdown flottant maximal de la semaine ${montant(m.dd_max_semaine, d)}`)
  if (m.dd_max_mois !== null) parts.push(`drawdown flottant maximal du mois ${montant(m.dd_max_mois, d)}`)
  if (m.spread_pts !== null) parts.push(`spread ${m.spread_pts} points`)
  if (m.positions_ouvertes !== null) parts.push(`${m.positions_ouvertes} position(s) ouverte(s)`)
  if (m.balance !== null) parts.push(`balance ${montant(m.balance, d).replace(/^\+/, '')}`)
  if (parts.length === 0) return ''
  return parts.join(', ')
}
