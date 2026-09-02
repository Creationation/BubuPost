// Generation de legendes par l'API Claude, a partir du sujet du jour.
//
// Deux modes. Un compte : une legende. Plusieurs comptes : toutes les
// variantes en UN SEUL appel. C'est a la fois moins cher en tokens et
// meilleur, parce que le modele voit les autres textes pendant qu'il ecrit et
// peut vraiment les differencier, au lieu de produire n fois la meme idee.
//
// Les consignes ne sont plus dans ce fichier : elles viennent de la table
// consignes, une ligne par plateforme et une par marque, editables depuis
// l'application.
import Anthropic from 'npm:@anthropic-ai/sdk@0.122.0'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import {
  ARBITRAGE,
  blocPour,
  doublons,
  LANGUE_DEFAUT,
  nomLangue,
  ressembleAJson,
  texteBloc,
  texteMarque,
  verifier,
  type Bloc,
  type ConsigneMarque,
  type ConsignePlateforme,
  type Probleme,
} from '../_shared/consignes.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-opus-5'

const REGLES_FIXES = `Regles absolues, quelles que soient les consignes :
- Chaque texte est ECRIT dans la langue indiquee pour sa cible, jamais traduit depuis une autre. Emploie les tournures, les images et les references naturelles de cette langue. Un texte en anglais ne doit pas se lire comme du francais traduit, et inversement.
- Les hashtags suivent la langue de leur texte : un texte anglais porte des hashtags anglais, un texte francais des hashtags francais. Ce ne sont pas les memes mots et ils ne touchent pas le meme public. Seuls les noms propres et les termes que la marque impose restent tels quels.
- Un titre suit lui aussi la langue de sa cible.
- Pas de guillemets autour du texte, pas de preambule, pas de commentaire sur ton travail.
- Reste concret et specifique au sujet fourni. Pas de formule creuse ni de promesse vague.`

const FORMAT_SIMPLE = `Tu reponds uniquement par un objet JSON valide, sans bloc de code autour, de la forme :
{"caption": "le texte", "hashtags": ["motcle"], "title": "titre ou chaine vide"}

Le champ title n'est rempli QUE pour une video YouTube classique. Dans ce cas il porte le titre
optimise pour la recherche, et caption ne contient QUE la description, sans repeter le titre.
Partout ailleurs, title vaut une chaine vide.

Les hashtags sont donnes sans le caractere #.`

const FORMAT_LOT = `Tu reponds uniquement par un tableau JSON valide, sans bloc de code autour, de la forme :
[{"id": "identifiant fourni", "caption": "le texte", "hashtags": ["motcle"], "title": "titre ou chaine vide"}]
Le champ title n'est rempli QUE pour une video YouTube classique, ou caption ne contient alors
que la description, sans repeter le titre. Vide partout ailleurs.
Un objet par cible demandee, dans le meme ordre, avec l'identifiant exactement tel qu'il est
fourni. Les hashtags sont donnes sans le caractere #.`

const DIFFERENCIATION = `EXIGENCE CENTRALE : les textes doivent etre REELLEMENT DIFFERENTS les uns des autres.
Pas des reformulations, pas des synonymes echanges, pas la meme phrase avec un mot en plus.
Chaque texte doit prendre un ANGLE different sur le meme sujet : l'un pose une question, l'autre
raconte une situation, l'autre donne un chiffre, l'autre s'adresse directement au lecteur, l'autre
part d'une erreur courante. Change aussi la structure : longueur, rythme, presence ou non d'un
appel a l'action. Deux textes qui se ressemblent seraient reperes comme du contenu duplique, ce
qui est exactement ce qu'on veut eviter.

Varie egalement les hashtags d'un texte a l'autre, tout en restant pertinent.

Si deux cibles n'ont pas la meme langue, ce ne sont pas deux versions d'un meme texte : chacune est ecrite pour son public, avec son propre angle. La difference de langue ne dispense pas de la difference de fond.`

type Cible = {
  id: string
  platform: string
  brand?: string
  account_name?: string
  youtube_type?: 'short' | 'video'
  /** Code ISO de la langue de sortie. Absent vaut francais. */
  language?: string
  /**
   * Texte deja en place, quand on reecrit une publication existante.
   * Evite de redemander le sujet de la video : le texte actuel le porte deja.
   */
  existant?: string
}

type Body = {
  subject?: string
  platform?: string
  brand?: string
  language?: string
  tone?: string
  youtube_type?: 'short' | 'video'
  language?: string
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

function nettoyer(texte: string): string {
  return String(texte ?? '').trim()
}

function normaliserHashtags(valeur: unknown): string[] {
  if (!Array.isArray(valeur)) return []
  return valeur.map((h) => String(h).replace(/^#/, '').trim()).filter(Boolean)
}

// ---------------------------------------------------------------------------
// Lecture des consignes
// ---------------------------------------------------------------------------

type Consignes = {
  plateformes: Map<string, ConsignePlateforme>
  marques: Map<string, ConsigneMarque>
}

async function lireConsignes(): Promise<Consignes> {
  const db = createClient(SUPABASE_URL, SERVICE_KEY)
  const { data, error } = await db.from('consignes').select('portee, cle, reglages')

  const plateformes = new Map<string, ConsignePlateforme>()
  const marques = new Map<string, ConsigneMarque>()

  if (error) {
    // Une consigne absente degrade la qualite du texte, elle ne doit pas
    // empecher de generer : on repart sur les regles fixes seules.
    console.error('Consignes illisibles, generation sans elles', error.message)
    return { plateformes, marques }
  }

  for (const ligne of data ?? []) {
    if (ligne.portee === 'plateforme') {
      plateformes.set(ligne.cle, ligne.reglages as ConsignePlateforme)
    } else if (ligne.portee === 'marque') {
      marques.set(ligne.cle, ligne.reglages as ConsigneMarque)
    }
  }

  return { plateformes, marques }
}

/** Quel jeu de regles YouTube s'applique : titre ou description, Short ou long. */
function varianteYoutube(
  platform: string,
  youtubeType: string | undefined,
  champ: 'titre' | 'description',
): string | undefined {
  if (platform !== 'youtube') return undefined
  return `${youtubeType === 'video' ? 'video' : 'short'}_${champ}`
}

/** Le bloc qui gouverne le texte principal d'une cible. */
function blocTexte(consignes: Consignes, platform: string, youtubeType?: string): Bloc | null {
  const p = consignes.plateformes.get(platform) ?? null
  return blocPour(p, varianteYoutube(platform, youtubeType, 'description'))
}

/** Le bloc du titre, qui n'existe que pour une video YouTube classique. */
function blocTitre(consignes: Consignes, platform: string, youtubeType?: string): Bloc | null {
  if (platform !== 'youtube' || youtubeType !== 'video') return null
  const p = consignes.plateformes.get(platform) ?? null
  return blocPour(p, varianteYoutube(platform, youtubeType, 'titre'))
}

/**
 * Une cible, dans le prompt.
 *
 * Les regles de plateforme et de marque sont enoncees une seule fois chacune,
 * en tete, et chaque cible s'y refere par son nom. Avec onze comptes sur trois
 * marques et cinq plateformes, tout repeter multiplierait le prompt sans rien
 * apporter au modele.
 */
function referenceCible(c: Cible, i: number): string {
  const nom = c.account_name ? ` (compte ${c.account_name})` : ''
  const marque = c.brand ? `, marque ${c.brand}` : ''
  const existant = c.existant?.trim()
    ? `
   Texte actuel a reecrire : ${c.existant.trim().replace(/\s+/g, ' ').slice(0, 400)}`
    : ''
  const variante =
    c.platform === 'youtube'
      ? c.youtube_type === 'video'
        ? ' en video classique, avec un titre distinct de la description'
        : ' en Short'
      : ''
  const langue = ` A ECRIRE EN ${nomLangue(c.language ?? LANGUE_DEFAUT).toUpperCase()}.`
  return `${i + 1}. id="${c.id}"${nom} : plateforme ${c.platform}${variante}${marque}.${langue}${existant}`
}

type Variante = {
  id: string
  caption: string
  hashtags: string[]
  title: string | null
  problemes: Probleme[]
}

/** Passe chaque variante aux controles, y compris ceux du titre YouTube. */
function controler(variantes: Variante[], cibles: Cible[], consignes: Consignes): Variante[] {
  const parId = new Map(cibles.map((c) => [c.id, c]))

  const controlees = variantes.map((v) => {
    const cible = parId.get(v.id)
    const marque = cible?.brand ? (consignes.marques.get(cible.brand) ?? null) : null
    const bloc = cible ? blocTexte(consignes, cible.platform, cible.youtube_type) : null

    const langueCible = cible?.language ?? LANGUE_DEFAUT
    const problemes = verifier(v.caption, v.hashtags, bloc, marque, { langue: langueCible })

    // Le titre d'une video YouTube longue a ses propres regles, notamment une
    // fourchette de longueur etroite pour ne pas etre tronque en resultat.
    const titre = cible ? blocTitre(consignes, cible.platform, cible.youtube_type) : null
    if (titre) {
      if (!v.title) {
        problemes.push({ code: 'titre-manquant', message: 'le titre de la video est absent' })
      } else {
        for (const p of verifier(v.title, [], titre, marque, {
          mentionObligatoire: false,
          langue: langueCible,
        })) {
          problemes.push({ code: `titre-${p.code}`, message: `titre : ${p.message}` })
        }
      }
    }

    return { ...v, problemes }
  })

  // La similarite ne se compare qu'a langue egale. Deux textes de langues
  // differentes ne partagent pas assez de caracteres pour se ressembler au
  // sens de la mesure, et un doublon francais ne se cache pas dans un texte
  // anglais : les comparer ne ferait que du bruit.
  const parLangue = new Map<string, Array<{ id: string; caption: string }>>()
  for (const v of controlees) {
    const code = parId.get(v.id)?.language ?? LANGUE_DEFAUT
    const liste = parLangue.get(code)
    if (liste) liste.push({ id: v.id, caption: v.caption })
    else parLangue.set(code, [{ id: v.id, caption: v.caption }])
  }

  for (const paire of [...parLangue.values()].flatMap((liste) => doublons(liste))) {
    for (const id of [paire.a, paire.b]) {
      const v = controlees.find((x) => x.id === id)
      const autre = id === paire.a ? paire.b : paire.a
      const nom = parId.get(autre)?.account_name ?? autre
      v?.problemes.push({
        code: 'trop-semblable',
        message: `trop proche du texte de ${nom} (${Math.round(paire.score * 100)} % de tournures communes)`,
      })
    }
  }

  return controlees
}

// ---------------------------------------------------------------------------

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

  const tone = body.tone ?? ''
  const brandGlobale = body.brand ?? ''

  const cibles = Array.isArray(body.targets) ? body.targets.filter((t) => t?.id) : []
  const enLot = cibles.length > 0

  if (cibles.length > 20) {
    return json({ error: 'Trop de comptes en une fois, 20 au maximum' }, 400)
  }

  // Le mode simple est ramene a une cible unique : un seul chemin de code pour
  // les consignes, les controles et la relance.
  const toutes: Cible[] = enLot
    ? cibles.map((c) => ({
        ...c,
        brand: c.brand || brandGlobale,
        language: c.language || body.language || LANGUE_DEFAUT,
      }))
    : [
        {
          id: 'unique',
          platform: body.platform ?? 'instagram',
          brand: brandGlobale,
          youtube_type: body.youtube_type,
          language: body.language || LANGUE_DEFAUT,
        },
      ]

  // Reecriture : au moins une cible arrive avec son texte actuel.
  const reecriture = toutes.some((c) => (c.existant ?? '').trim().length > 0)

  const consignes = await lireConsignes()

  // Chaque plateforme et chaque marque enoncee une fois, pas une fois par cible.
  const plateformesUtiles = [...new Set(toutes.map((c) => c.platform))]
  const marquesUtiles = [...new Set(toutes.map((c) => c.brand).filter(Boolean))] as string[]

  const blocsPlateforme: string[] = []
  for (const p of plateformesUtiles) {
    const consigne = consignes.plateformes.get(p)
    if (!consigne) continue

    if (p === 'youtube') {
      const types = [...new Set(toutes.filter((c) => c.platform === p).map((c) => c.youtube_type ?? 'short'))]
      for (const type of types) {
        const nom = type === 'video' ? 'youtube video classique' : 'youtube short'
        const description = blocPour(consigne, `${type}_description`)
        if (description) blocsPlateforme.push(texteBloc(description, `Plateforme ${nom}, texte`))
        if (type === 'video') {
          const titre = blocPour(consigne, 'video_titre')
          if (titre) blocsPlateforme.push(texteBloc(titre, `Plateforme ${nom}, titre`))
        }
      }
    } else {
      blocsPlateforme.push(texteBloc(consigne, `Plateforme ${p}`))
    }
  }

  const languesUtilisees = [...new Set(toutes.map((c) => c.language ?? LANGUE_DEFAUT))]

  const blocsMarque: string[] = []
  for (const m of marquesUtiles) {
    const consigne = consignes.marques.get(m)
    if (!consigne) continue
    // On ne passe que les langues reellement employees : inutile de faire lire
    // au modele l'avertissement neerlandais pour une campagne francophone.
    const langues = [
      ...new Set(
        toutes.filter((c) => c.brand === m).map((c) => c.language ?? LANGUE_DEFAUT),
      ),
    ]
    const texte = texteMarque(m, consigne, langues)
    if (texte) blocsMarque.push(texte)
  }

  if (!subject && !reecriture) {
    return json({ error: 'Le sujet est obligatoire' }, 400)
  }

  const contexte = [
    subject ? `Sujet de la video : ${subject}` : '',
    tone ? `Ton demande pour cette video en particulier : ${tone}` : '',
  ].filter(Boolean)

  const consignesTexte = [
    blocsMarque.length > 0 ? blocsMarque.join('\n\n') : '',
    blocsPlateforme.length > 0 ? blocsPlateforme.join('\n\n') : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const system = [
    enLot
      ? 'Tu ecris des legendes pour une meme video, publiee sur plusieurs comptes de reseaux sociaux.'
      : 'Tu ecris des legendes pour des videos courtes publiees sur les reseaux sociaux.',
    '',
    REGLES_FIXES,
    '',
    ARBITRAGE,
    ...(enLot ? ['', DIFFERENCIATION] : []),
    '',
    enLot ? FORMAT_LOT : FORMAT_SIMPLE,
  ].join('\n')

  function construirePrompt(correction?: string): string {
    const lignes = [
      ...contexte,
      '',
      consignesTexte ? `CONSIGNES\n\n${consignesTexte}\n` : '',
      reecriture
        ? `Reecris les ${toutes.length} texte(s) ci-dessous pour qu'ils respectent les consignes. Garde le sujet et le fond de chaque texte actuel, change la forme autant qu'il le faut.`
        : enLot
          ? `Ecris ${toutes.length} textes differents, un par cible ci-dessous. Applique a chacune les consignes de sa marque et de sa plateforme.`
          : 'Ecris un texte pour la cible ci-dessous.',
      ...toutes.map(referenceCible),
    ]
    if (correction) lignes.push('', correction)
    return lignes.filter((l) => l !== '').join('\n')
  }

  const client = new Anthropic({ apiKey })

  type Tirage =
    | { variantes: Variante[]; usage: { input_tokens: number; output_tokens: number }; model: string }
    | { erreur: string; statut: number }

  async function appeler(prompt: string): Promise<Tirage> {
    const response = await client.beta.messages.create({
      model: MODEL,
      // Le mode lot ecrit plusieurs textes : il lui faut de la place.
      max_tokens: enLot ? Math.min(8000, 800 + toutes.length * 400) : 2000,
      // Differencier reellement des textes demande un peu plus de reflexion
      // que d'en ecrire un seul.
      output_config: { effort: enLot ? 'medium' : 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      messages: [{ role: 'user', content: prompt }],
    })

    if (response.stop_reason === 'refusal') {
      return { erreur: 'La generation a ete refusee pour ce sujet', statut: 422 }
    }

    const texte = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { text: string }).text)
      .join('\n')

    const usage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    }

    if (enLot) {
      const liste = extraireJson(texte, 'tableau')
      const parId = new Map<string, { caption: string; hashtags: string[]; title: string | null }>()

      for (const item of (Array.isArray(liste) ? liste : []) as Array<Record<string, unknown>>) {
        const id = String(item?.id ?? '')
        if (!id) continue
        parId.set(id, {
          caption: nettoyer(item.caption as string),
          hashtags: normaliserHashtags(item.hashtags),
          title: nettoyer(item.title as string) || null,
        })
      }

      // Une entree par cible demandee, meme si le modele en a oublie une : le
      // frontend saura laquelle est vide, plutot que de decaler les textes.
      return {
        variantes: toutes.map((c) => ({
          id: c.id,
          caption: parId.get(c.id)?.caption ?? '',
          hashtags: parId.get(c.id)?.hashtags ?? [],
          title: parId.get(c.id)?.title ?? null,
          problemes: [],
        })),
        usage,
        model: response.model,
      }
    }

    const objet = (extraireJson(texte, 'objet') ?? {}) as Record<string, unknown>
    // Repli sur le texte brut seulement s'il ne ressemble pas a du JSON :
    // c'est exactement par la que le JSON entier se retrouvait en legende.
    const brut = nettoyer(texte)
    const caption = nettoyer(objet.caption as string) || (ressembleAJson(brut) ? '' : brut)

    return {
      variantes: [
        {
          id: 'unique',
          caption,
          hashtags: normaliserHashtags(objet.hashtags),
          title: nettoyer(objet.title as string) || null,
          problemes: [],
        },
      ],
      usage,
      model: response.model,
    }
  }

  /** Ce qu'on redemande au modele quand un controle a echoue. */
  function messageCorrection(mauvaises: Variante[]): string {
    const details = mauvaises.map((v) => {
      const cible = toutes.find((c) => c.id === v.id)
      const nom = cible?.account_name ?? v.id
      return `- id="${v.id}" (${nom}) : ${v.problemes.map((p) => p.message).join(' ; ')}`
    })
    return [
      'Ta reponse precedente ne respectait pas les consignes sur les points suivants :',
      ...details,
      '',
      "Reecris TOUS les textes demandes en corrigeant ces points. Respecte scrupuleusement les fourchettes de longueur et le nombre de hashtags. Si un texte etait juge trop proche d'un autre, change son angle, pas seulement quelques mots.",
    ].join('\n')
  }

  try {
    const premier = await appeler(construirePrompt())
    if ('erreur' in premier) return json({ error: premier.erreur }, premier.statut)

    let variantes = controler(premier.variantes, toutes, consignes)
    let relance = false
    const usages = [premier.usage]

    // Un reglage inconciliable ne se corrige pas en reecrivant : relancer sur
    // ce motif ferait payer un second appel pour le meme resultat.
    const corrigeable = (v: Variante) =>
      v.problemes.some((p) => p.code !== 'conflit-consignes')

    // Une seule relance. Deux appels payants valent mieux qu'un texte non
    // conforme enregistre, mais boucler couterait plus cher que le probleme.
    if (variantes.some(corrigeable)) {
      relance = true
      const mauvaises = variantes.filter(corrigeable)
      console.warn(
        'Relance apres controle',
        mauvaises.map((v) => `${v.id}: ${v.problemes.map((p) => p.code).join(',')}`).join(' | '),
      )

      const seconde = await appeler(construirePrompt(messageCorrection(mauvaises)))
      if (!('erreur' in seconde)) {
        const apres = controler(seconde.variantes, toutes, consignes)
        usages.push(seconde.usage)

        // On garde, cible par cible, la meilleure des deux tentatives : une
        // relance qui corrige huit textes sur neuf ne doit pas faire perdre le
        // neuvieme s'il etait bon du premier coup.
        variantes = variantes.map((avant) => {
          if (!corrigeable(avant)) return avant
          const apresV = apres.find((x) => x.id === avant.id)
          if (!apresV?.caption) return avant
          return apresV.problemes.length <= avant.problemes.length ? apresV : avant
        })
      }
    }

    if (variantes.every((v) => !v.caption)) {
      return json({ error: 'Aucune legende exploitable, reessaie' }, 502)
    }

    const usage = usages.reduce(
      (acc, u) => ({
        input_tokens: acc.input_tokens + (u?.input_tokens ?? 0),
        output_tokens: acc.output_tokens + (u?.output_tokens ?? 0),
      }),
      { input_tokens: 0, output_tokens: 0 },
    )

    if (enLot) {
      return json({
        results: variantes.map((v) => ({
          id: v.id,
          caption: v.caption,
          hashtags: v.hashtags,
          title: v.title,
          problemes: v.problemes,
        })),
        manquants: variantes.filter((v) => !v.caption).length,
        relance,
        model: premier.model,
        usage,
      })
    }

    const seule = variantes[0]
    if (!seule.caption) return json({ error: 'Legende vide, reessaie' }, 502)
    if (ressembleAJson(seule.caption)) {
      console.error('Legende rejetee, elle ressemble a du JSON', seule.caption.slice(0, 150))
      return json({ error: 'La reponse du modele etait mal formee, relance la generation' }, 502)
    }

    return json({
      caption: seule.caption,
      hashtags: seule.hashtags,
      title: seule.title,
      problemes: seule.problemes,
      relance,
      model: premier.model,
      usage,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Generation de legende impossible', message)
    return json({ error: message }, 502)
  }
})
