// Generation de legendes par l'API Claude, a partir du sujet du jour.
//
// Deux modes. Un compte : une legende. Plusieurs comptes : toutes les
// variantes en UN SEUL appel. C'est a la fois moins cher en tokens et
// meilleur, parce que le modele voit les autres textes pendant qu'il ecrit et
// peut vraiment les differencier, au lieu de produire n fois la meme idee.
import Anthropic from 'npm:@anthropic-ai/sdk@0.122.0'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-opus-5'

const PLATFORM_BRIEF: Record<string, string> = {
  instagram:
    "Instagram Reels. Ton visuel, on decrit ce qu'on voit autant que ce qu'on dit. Deux a quatre lignes, une accroche forte des le premier mot. 5 a 8 hashtags.",
  facebook:
    'Facebook Reels. Plus narratif, on raconte, on prend le temps de poser le contexte. Trois a cinq lignes, phrases completes. 0 a 3 hashtags seulement.',
  threads:
    'Threads. Ton conversationnel, comme un message a des gens qui suivent deja. Une a trois lignes, 0 a 2 hashtags.',
  youtube:
    'YouTube Shorts. La premiere ligne sert de titre et doit faire moins de 100 caracteres. Ensuite deux a quatre lignes de description. 3 a 5 hashtags.',
  youtube_video:
    "YouTube, video classique au format long. Exercice different d'une legende : le titre doit etre optimise pour la RECHERCHE YouTube, donc contenir les mots que les gens tapent reellement, sans point d'exclamation ni majuscules inutiles, 60 a 70 caracteres pour ne pas etre tronque. La description est structuree : deux ou trois phrases qui donnent envie et reprennent les mots-cles des les premieres lignes, puis un court sommaire de ce que la video couvre. 5 a 8 tags.",
  tiktok:
    'TikTok. Tres court, une a deux lignes, accrocheur des le premier mot, ton natif de la plateforme. 3 a 5 hashtags courts.',
}

const REGLES = `Regles absolues :
- Ecris dans la langue demandee, jamais une autre.
- N'utilise JAMAIS de tiret cadratin (—) ni de tiret demi-cadratin (–). Utilise une virgule, un point, deux points ou des parentheses.
- Pas de guillemets autour de la legende, pas de preambule, pas de commentaire sur ton travail.
- Les hashtags sont renvoyes a part, jamais dans le texte de la legende.
- Reste concret et specifique au sujet fourni. Pas de formule creuse ni de promesse vague.`

const SYSTEM_SIMPLE = `Tu ecris des legendes pour des videos courtes publiees sur les reseaux sociaux.

${REGLES}

Tu reponds uniquement par un objet JSON valide, sans bloc de code autour, de la forme :
{"caption": "le texte", "hashtags": ["motcle"], "title": "titre ou chaine vide"}

Le champ title n'est rempli QUE pour une video YouTube classique. Dans ce cas il porte le titre
optimise pour la recherche, et caption ne contient QUE la description, sans repeter le titre.
Partout ailleurs, title vaut une chaine vide.

Les hashtags sont donnes sans le caractere #.`

const SYSTEM_LOT = `Tu ecris des legendes pour une meme video, publiee sur plusieurs comptes de reseaux sociaux.

${REGLES}

EXIGENCE CENTRALE : les textes doivent etre REELLEMENT DIFFERENTS les uns des autres.
Pas des reformulations, pas des synonymes echanges, pas la meme phrase avec un mot en plus.
Chaque texte doit prendre un ANGLE different sur le meme sujet : l'un pose une question, l'autre
raconte une situation, l'autre donne un chiffre, l'autre s'adresse directement au lecteur, l'autre
part d'une erreur courante. Change aussi la structure : longueur, rythme, presence ou non d'un
appel a l'action. Deux textes qui se ressemblent seraient reperes comme du contenu duplique, ce
qui est exactement ce qu'on veut eviter.

Varie egalement les hashtags d'un texte a l'autre, tout en restant pertinent.

Tu reponds uniquement par un tableau JSON valide, sans bloc de code autour, de la forme :
[{"id": "identifiant fourni", "caption": "le texte", "hashtags": ["motcle"], "title": "titre ou chaine vide"}]
Le champ title n'est rempli QUE pour une video YouTube classique, ou caption ne contient alors
que la description, sans repeter le titre. Vide partout ailleurs.
Un objet par cible demandee, dans le meme ordre, avec l'identifiant exactement tel qu'il est
fourni. Les hashtags sont donnes sans le caractere #.`

type Cible = {
  id: string
  platform: string
  account_name?: string
  youtube_type?: 'short' | 'video'
}

type Body = {
  subject?: string
  platform?: string
  brand?: string
  language?: string
  tone?: string
  youtube_type?: 'short' | 'video'
  /** Mode lot : une variante distincte par cible. */
  targets?: Cible[]
}

/**
 * Extrait le JSON du texte, en sachant quelle forme on attend.
 *
 * Chercher « le premier crochet » etait un piege : dans
 * {"caption": "...", "hashtags": ["a"]}, le premier crochet est celui des
 * hashtags. On en tirait le tableau ["a"], donc un objet sans champ caption,
 * et le repli renvoyait le JSON entier comme legende.
 */
/** Le brief a suivre : un Short et une video longue n ont rien a voir. */
function brief(platform: string, youtubeType?: string): string {
  const p = (platform ?? '').toLowerCase()
  if (p === 'youtube' && youtubeType === 'video') return PLATFORM_BRIEF.youtube_video
  return PLATFORM_BRIEF[p] ?? PLATFORM_BRIEF.instagram
}

function extraireJson(texte: string, forme: 'objet' | 'tableau'): unknown {
  const [ouvre, ferme] = forme === 'tableau' ? ['[', ']'] : ['{', '}']

  const debut = texte.indexOf(ouvre)
  const fin = texte.lastIndexOf(ferme)
  if (debut === -1 || fin <= debut) return null

  try {
    return JSON.parse(texte.slice(debut, fin + 1))
  } catch {
    return null
  }
}

/**
 * Une legende ne doit jamais ressembler a du JSON.
 * Mieux vaut ne rien renvoyer que publier une structure technique sur le
 * compte de quelqu'un.
 */
function ressembleAJson(texte: string): boolean {
  const t = texte.trim()
  return (
    t.startsWith('{') ||
    t.startsWith('[') ||
    t.includes('"caption"') ||
    t.includes('"hashtags"')
  )
}

/** Diego ne veut aucun tiret cadratin : ceinture et bretelles apres le modele. */
function nettoyer(texte: string): string {
  return String(texte ?? '').replace(/[—–]/g, ',').trim()
}

function normaliserHashtags(valeur: unknown): string[] {
  if (!Array.isArray(valeur)) return []
  return valeur.map((h) => String(h).replace(/^#/, '').trim()).filter(Boolean)
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

  const language = body.language ?? 'francais'
  const brand = body.brand ?? ''
  const tone = body.tone ?? 'direct et concret'
  const cibles = Array.isArray(body.targets) ? body.targets.filter((t) => t?.id) : []
  const enLot = cibles.length > 0

  if (cibles.length > 20) {
    return json({ error: 'Trop de comptes en une fois, 20 au maximum' }, 400)
  }

  const contexte = [
    `Sujet de la video : ${subject}`,
    brand ? `Marque : ${brand}` : '',
    `Langue : ${language}`,
    `Ton general : ${tone}`,
  ].filter(Boolean)

  const prompt = enLot
    ? [
        ...contexte,
        '',
        `Ecris ${cibles.length} textes differents, un par cible ci-dessous :`,
        ...cibles.map((c, i) => {
          const nom = c.account_name ? ` (compte ${c.account_name})` : ''
          return `${i + 1}. id="${c.id}"${nom} : ${brief(c.platform, c.youtube_type)}`
        }),
      ].join('\n')
    : [
        ...contexte,
        `Plateforme : ${brief(body.platform ?? 'instagram', body.youtube_type)}`,
      ].join('\n')

  const client = new Anthropic({ apiKey })

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      // Le mode lot ecrit plusieurs textes : il lui faut de la place.
      max_tokens: enLot ? Math.min(8000, 800 + cibles.length * 400) : 2000,
      // Differencier reellement des textes demande un peu plus de reflexion
      // que d'en ecrire un seul.
      output_config: { effort: enLot ? 'medium' : 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: enLot ? SYSTEM_LOT : SYSTEM_SIMPLE,
      messages: [{ role: 'user', content: prompt }],
    })

    if (response.stop_reason === 'refusal') {
      return json({ error: 'La generation a ete refusee pour ce sujet' }, 422)
    }

    const texte = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { text: string }).text)
      .join('\n')

    const parse = extraireJson(texte, enLot ? 'tableau' : 'objet')
    const usage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    }

    if (enLot) {
      const liste = Array.isArray(parse) ? parse : []
      const parId = new Map<
        string,
        { caption: string; hashtags: string[]; title: string | null }
      >()

      for (const item of liste as Array<Record<string, unknown>>) {
        const id = String(item?.id ?? '')
        if (!id) continue
        const caption = nettoyer(item.caption as string)
        if (ressembleAJson(caption)) {
          console.error('Legende rejetee, elle ressemble a du JSON', id, caption.slice(0, 120))
          continue
        }
        parId.set(id, {
          caption,
          hashtags: normaliserHashtags(item.hashtags),
          title: nettoyer(item.title as string) || null,
        })
      }

      // On renvoie une entree par cible demandee, meme si le modele en a
      // oublie une : le frontend saura laquelle est vide et la proposera a
      // regenerer, plutot que de decaler silencieusement les textes.
      const resultats = cibles.map((c) => ({
        id: c.id,
        caption: parId.get(c.id)?.caption ?? '',
        hashtags: parId.get(c.id)?.hashtags ?? [],
        title: parId.get(c.id)?.title ?? null,
      }))

      const manquants = resultats.filter((r) => !r.caption).length
      if (manquants === resultats.length) {
        return json({ error: 'Aucune legende exploitable, reessaie' }, 502)
      }

      return json({ results: resultats, manquants, model: response.model, usage })
    }

    const objet = (parse ?? {}) as Record<string, unknown>
    // Repli sur le texte brut seulement s'il ne ressemble pas a du JSON :
    // c'est exactement par la que le JSON entier se retrouvait en legende.
    const brut = nettoyer(texte)
    const caption = nettoyer(objet.caption as string) || (ressembleAJson(brut) ? '' : brut)

    if (!caption) return json({ error: 'Legende vide, reessaie' }, 502)
    if (ressembleAJson(caption)) {
      console.error('Legende rejetee, elle ressemble a du JSON', caption.slice(0, 150))
      return json({ error: 'La reponse du modele etait mal formee, relance la generation' }, 502)
    }

    return json({
      caption,
      hashtags: normaliserHashtags(objet.hashtags),
      title: nettoyer(objet.title as string) || null,
      model: response.model,
      usage,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Generation de legende impossible', message)
    return json({ error: message }, 502)
  }
})
