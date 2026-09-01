// Generation de legende par l'API Claude, a partir du sujet du jour.
// Une legende par plateforme : le ton et la longueur ne se ressemblent pas
// entre un Reel Instagram, un Short YouTube et un TikTok.
import Anthropic from 'npm:@anthropic-ai/sdk@0.122.0'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-opus-5'

const PLATFORM_BRIEF: Record<string, string> = {
  instagram:
    "Instagram Reels. Deux a quatre lignes, une accroche forte des le premier mot, un appel a l'action discret. 5 a 8 hashtags pertinents.",
  facebook:
    'Facebook Reels. Ton un peu plus explicatif et posé qu\'Instagram, deux a quatre lignes. 3 a 5 hashtags.',
  threads:
    'Threads. Ton conversationnel, comme un message a des gens qui suivent deja. Court, une a trois lignes, 0 a 2 hashtags.',
  youtube:
    'YouTube Shorts. La premiere ligne sert de titre et doit faire moins de 100 caracteres. Ensuite deux a quatre lignes de description. 3 a 5 hashtags.',
  tiktok:
    'TikTok. Tres court, une a deux lignes, ton direct et natif de la plateforme. 3 a 5 hashtags.',
}

const SYSTEM = `Tu ecris des legendes pour des videos courtes publiees sur les reseaux sociaux.

Regles absolues :
- Ecris dans la langue demandee, jamais une autre.
- N'utilise JAMAIS de tiret cadratin (—) ni de tiret demi-cadratin (–). Utilise une virgule, un point, deux points ou des parentheses.
- Pas de guillemets autour de la legende, pas de preambule, pas de commentaire sur ton travail.
- Les hashtags sont renvoyes a part, jamais dans le texte de la legende.
- Reste concret et specifique au sujet fourni. Pas de formule creuse ni de promesse vague.

Tu reponds uniquement par un objet JSON valide, sans bloc de code autour, de la forme :
{"caption": "le texte de la legende", "hashtags": ["motcle", "autremotcle"]}
Les hashtags sont donnes sans le caractere #.`

type Body = {
  subject?: string
  platform?: string
  brand?: string
  language?: string
  tone?: string
}

/** Recupere le premier objet JSON du texte, meme s'il est entoure de bruit. */
function extractJson(text: string): { caption: string; hashtags: string[] } {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1))
      return {
        caption: String(parsed.caption ?? '').trim(),
        hashtags: Array.isArray(parsed.hashtags)
          ? parsed.hashtags.map((h: unknown) => String(h).replace(/^#/, '').trim()).filter(Boolean)
          : [],
      }
    } catch {
      // On retombe sur le texte brut juste en dessous.
    }
  }
  return { caption: text.trim(), hashtags: [] }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // L'autorisation d'abord : un appelant anonyme n'a pas a apprendre quelles
  // cles sont configurees ici, et c'est un appel payant.
  const bearer = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
  const check = createClient(SUPABASE_URL, ANON_KEY)
  const { data: userData, error: userErr } = await check.auth.getUser(bearer)
  if (userErr || !userData.user) return json({ error: 'Non autorise' }, 401)

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'Secret ANTHROPIC_API_KEY absent de la fonction' }, 500)

  let body: Body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Corps de requete illisible' }, 400)
  }

  const subject = (body.subject ?? '').trim()
  if (!subject) return json({ error: 'Le sujet est obligatoire' }, 400)

  const platform = (body.platform ?? 'instagram').toLowerCase()
  const brief = PLATFORM_BRIEF[platform] ?? PLATFORM_BRIEF.instagram
  const language = body.language ?? 'francais'
  const brand = body.brand ?? ''
  const tone = body.tone ?? 'direct et concret'

  const prompt = [
    `Sujet de la video : ${subject}`,
    brand ? `Marque : ${brand}` : '',
    `Plateforme : ${brief}`,
    `Langue : ${language}`,
    `Ton : ${tone}`,
  ]
    .filter(Boolean)
    .join('\n')

  const client = new Anthropic({ apiKey })

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 2000,
      // Tache courte : l'effort bas suffit et garde le cout au minimum.
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    })

    if (response.stop_reason === 'refusal') {
      return json({ error: 'La generation a ete refusee pour ce sujet' }, 422)
    }

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { text: string }).text)
      .join('\n')

    const result = extractJson(text)
    if (!result.caption) return json({ error: 'Legende vide, reessaie' }, 502)

    return json({
      ...result,
      // Ceinture et bretelles : Diego ne veut aucun tiret cadratin.
      caption: result.caption.replace(/[—–]/g, ','),
      model: response.model,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Generation de legende impossible', message)
    return json({ error: message }, 502)
  }
})
