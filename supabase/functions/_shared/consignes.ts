// Consignes de generation : lecture, assemblage du prompt, controles.
//
// Le prompt etait une constante dans generate-caption. Il se construit
// desormais a partir de la table consignes : une ligne par plateforme, une
// par marque. Ce fichier est la seule autorite sur la facon dont les deux se
// combinent et sur ce qui est verifie avant enregistrement.

export type Bloc = {
  longueurMin: number
  longueurMax: number
  hashtagsMin: number
  hashtagsMax: number
  placementHashtags: 'fin' | 'texte'
  ton: string
  structure: string
  /** Codes du catalogue ci-dessous, verifies mecaniquement. */
  interdits: string[]
  /** Le reste, en clair, transmis au modele sans etre verifiable. */
  interditsLibres: string
}

export type ConsignePlateforme = Bloc & {
  /** YouTube seulement : titre et description, en Short et en video longue. */
  variantes?: Record<string, Bloc>
}

export type ConsigneMarque = {
  niche: string
  audience: string
  ton: string
  vocabulairePrefere: string
  vocabulaireEvite: string
  appelAction: string
  hashtags: string[]
  mentionsLegales: string
}

// ---------------------------------------------------------------------------
// Interdits verifiables
//
// Chaque code a deux faces : une phrase pour le modele, et un detecteur qui
// verifie apres coup. Demander sans verifier, c'est ce qu'on faisait avant, et
// les tirets cadratins passaient quand meme.
// ---------------------------------------------------------------------------

export type Interdit = {
  code: string
  label: string
  consigne: string
  detecte: (texte: string) => boolean
  plainte: string
}

export const INTERDITS: Interdit[] = [
  {
    code: 'emoji',
    label: 'Emojis',
    consigne: "N'utilise aucun emoji.",
    detecte: (t) => /\p{Extended_Pictographic}/u.test(t),
    plainte: 'contient un emoji',
  },
  {
    code: 'tiret-cadratin',
    label: 'Tirets cadratins et demi-cadratins',
    consigne:
      "N'utilise jamais de tiret cadratin (—) ni demi-cadratin (–). Utilise une virgule, un point, deux points ou des parentheses.",
    detecte: (t) => /[—–]/.test(t),
    plainte: 'contient un tiret cadratin',
  },
  {
    code: 'question',
    label: 'Questions',
    consigne: "N'ecris aucune question, ni rhetorique ni directe.",
    detecte: (t) => /\?/.test(t),
    plainte: 'contient une question',
  },
  {
    code: 'exclamation',
    label: "Points d'exclamation",
    consigne: "N'utilise aucun point d'exclamation.",
    detecte: (t) => /!/.test(t),
    plainte: "contient un point d'exclamation",
  },
  {
    code: 'majuscules',
    label: 'Mots ecrits tout en majuscules',
    consigne: "N'ecris aucun mot entierement en majuscules.",
    // Quatre lettres au minimum : sigles courants comme MT5, RSI ou FX restent
    // legitimes dans le vocabulaire de trading.
    detecte: (t) => /\b\p{Lu}{4,}\b/u.test(t),
    plainte: 'contient un mot tout en majuscules',
  },
  {
    code: 'hashtag-dans-texte',
    label: 'Hashtags dans le corps du texte',
    consigne: 'Ne place aucun hashtag dans le texte, ils sont renvoyes a part.',
    detecte: (t) => /#\p{L}/u.test(t),
    plainte: 'place un hashtag dans le texte',
  },
  {
    code: 'lien',
    label: 'Liens',
    consigne: "N'inclus aucun lien ni adresse de site.",
    detecte: (t) => /https?:\/\/|\bwww\./i.test(t),
    plainte: 'contient un lien',
  },
  {
    code: 'premiere-personne',
    label: 'Premiere personne du singulier',
    consigne: "N'ecris pas a la premiere personne du singulier.",
    detecte: (t) => /\b(je|j'|mon|ma|mes)\b/i.test(t),
    plainte: 'parle a la premiere personne du singulier',
  },
]

const PAR_CODE = new Map(INTERDITS.map((i) => [i.code, i]))

// ---------------------------------------------------------------------------
// Assemblage du prompt
// ---------------------------------------------------------------------------

/** Le bloc de regles qui s'applique a une cible donnee. */
export function blocPour(
  plateforme: ConsignePlateforme | null,
  variante?: string,
): Bloc | null {
  if (!plateforme) return null
  if (variante && plateforme.variantes?.[variante]) return plateforme.variantes[variante]
  return plateforme
}

function listeInterdits(bloc: Bloc): string[] {
  const lignes = bloc.interdits
    .map((code) => PAR_CODE.get(code)?.consigne)
    .filter((c): c is string => Boolean(c))
  if (bloc.interditsLibres.trim()) lignes.push(bloc.interditsLibres.trim())
  return lignes
}

/** Les regles d'une plateforme, en clair, pour le prompt. */
export function texteBloc(bloc: Bloc, titre: string): string {
  const lignes = [`[${titre}]`]

  lignes.push(`- Longueur du texte : entre ${bloc.longueurMin} et ${bloc.longueurMax} caracteres.`)

  if (bloc.hashtagsMax > 0) {
    lignes.push(
      `- Hashtags : ${bloc.hashtagsMin} a ${bloc.hashtagsMax}, renvoyes a part, sans le caractere #.`,
    )
  } else {
    lignes.push('- Aucun hashtag.')
  }

  if (bloc.ton.trim()) lignes.push(`- Ton : ${bloc.ton.trim()}`)
  if (bloc.structure.trim()) lignes.push(`- Structure : ${bloc.structure.trim()}`)

  const interdits = listeInterdits(bloc)
  if (interdits.length > 0) {
    lignes.push('- Interdits :')
    for (const i of interdits) lignes.push(`  . ${i}`)
  }

  return lignes.join('\n')
}

/** Les regles d'une marque, en clair, pour le prompt. */
export function texteMarque(nom: string, m: ConsigneMarque): string {
  const lignes = [`[Marque ${nom}]`]

  if (m.niche.trim()) lignes.push(`- Sujet et niche : ${m.niche.trim()}`)
  if (m.audience.trim()) lignes.push(`- Public vise : ${m.audience.trim()}`)
  if (m.ton.trim()) lignes.push(`- Ton de la marque : ${m.ton.trim()}`)
  if (m.vocabulairePrefere.trim())
    lignes.push(`- Vocabulaire a privilegier : ${m.vocabulairePrefere.trim()}`)
  if (m.vocabulaireEvite.trim())
    lignes.push(`- A ne jamais employer : ${m.vocabulaireEvite.trim()}`)
  if (m.appelAction.trim()) lignes.push(`- Appel a l'action habituel : ${m.appelAction.trim()}`)
  if (m.hashtags.length > 0)
    lignes.push(`- Hashtags recurrents de la marque : ${m.hashtags.join(', ')}`)
  if (m.mentionsLegales.trim())
    lignes.push(
      `- A inclure systematiquement dans le TEXTE, sans le reformuler : ${m.mentionsLegales.trim()}`,
      `  Cette mention fait ${m.mentionsLegales.trim().length} caracteres, qui comptent dans la longueur maximale : prevois la place. Elle ne va jamais dans un titre.`,
    )

  return lignes.length > 1 ? lignes.join('\n') : ''
}

/**
 * La regle d'arbitrage, dite au modele une fois pour toutes.
 *
 * Sans elle, une marque qui demande un ton long et une plateforme qui impose
 * 150 caracteres laissent le modele choisir au hasard.
 */
export const ARBITRAGE = `En cas de contradiction entre les consignes de la marque et celles de la plateforme :
- Les contraintes techniques de la plateforme l'emportent TOUJOURS : longueur maximale, nombre de hashtags, interdits mecaniques. Elles ne se negocient pas.
- Sur tout le reste, ton, vocabulaire, angle, sujet, ce sont les consignes de la MARQUE qui l'emportent.
- Une seule exception aux contraintes techniques : la mention legale obligatoire d'une marque ne se coupe jamais et ne se reformule pas. Si elle ne tient pas dans la longueur maximale, garde-la entiere et reste au plus pres de la limite.`

// ---------------------------------------------------------------------------
// Controles avant enregistrement
// ---------------------------------------------------------------------------

export type Probleme = { code: string; message: string }

/**
 * De quoi ecrire une phrase en plus de la mention obligatoire.
 *
 * Une mention seule n'est pas une legende : si la limite ne laisse pas au moins
 * cette marge, les deux consignes sont inconciliables.
 */
const MARGE_MENTION = 40

/**
 * Le cas ou la mention legale d'une marque ne peut pas tenir dans la longueur
 * imposee par la plateforme.
 *
 * Il n'y a pas de bonne sortie : couper un avertissement de risque n'est pas
 * une option, depasser la limite non plus. On garde la mention et on signale la
 * contradiction plutot que de payer une relance qui echouera pareil.
 */
export function conflitMention(bloc: Bloc | null, marque: ConsigneMarque | null): string | null {
  const mention = marque?.mentionsLegales?.trim()
  if (!bloc || !mention) return null
  if (mention.length + MARGE_MENTION <= bloc.longueurMax) return null
  return `la mention obligatoire fait a elle seule ${mention.length} caracteres, pour une longueur maximale de ${bloc.longueurMax} : les deux consignes sont inconciliables`
}

/** Une legende ne doit jamais ressembler a du JSON mal parse. */
export function ressembleAJson(texte: string): boolean {
  const t = texte.trim()
  return (
    t.startsWith('{') || t.startsWith('[') || t.includes('"caption"') || t.includes('"hashtags"')
  )
}

// La plage des diacritiques combinants, ecrite en echappements : ces
// caracteres sont invisibles dans un editeur et se perdent au copier-coller.
const DIACRITIQUES = new RegExp('[\u0300-\u036f]', 'g')

function sansAccent(t: string): string {
  return t.normalize('NFD').replace(DIACRITIQUES, '')
}

/** Les termes que la marque interdit, tels qu'ils sont saisis, virgule comprise. */
function termesInterdits(brut: string): string[] {
  return brut
    .split(/[,;\n]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3)
}

/**
 * Tout ce qui cloche dans un texte genere.
 * Une liste vide veut dire qu'il peut etre enregistre.
 */
export function verifier(
  texte: string,
  hashtags: string[],
  bloc: Bloc | null,
  marque: ConsigneMarque | null,
  /**
   * Un titre n'a pas a porter l'avertissement legal.
   * L'exiger le faisait deborder de sa fourchette, et l'avertissement
   * n'aurait de toute facon ete lu par personne a cet endroit.
   */
  options: { mentionObligatoire?: boolean } = {},
): Probleme[] {
  const problemes: Probleme[] = []
  const t = (texte ?? '').trim()

  if (!t) {
    return [{ code: 'vide', message: 'le texte est vide' }]
  }

  if (ressembleAJson(t)) {
    return [{ code: 'json', message: 'le texte ressemble a du JSON mal interprete' }]
  }

  const conflit = conflitMention(bloc, marque)

  if (bloc) {
    if (t.length < bloc.longueurMin) {
      problemes.push({
        code: 'trop-court',
        message: `${t.length} caracteres, le minimum est ${bloc.longueurMin}`,
      })
    }
    if (t.length > bloc.longueurMax) {
      // Relancer ne servirait a rien : c'est le reglage qui est impossible.
      problemes.push(
        conflit
          ? { code: 'conflit-consignes', message: conflit }
          : {
              code: 'trop-long',
              message: `${t.length} caracteres, le maximum est ${bloc.longueurMax}`,
            },
      )
    }

    const n = hashtags.length
    if (n < bloc.hashtagsMin) {
      problemes.push({
        code: 'pas-assez-hashtags',
        message: `${n} hashtag(s), le minimum est ${bloc.hashtagsMin}`,
      })
    }
    if (n > bloc.hashtagsMax) {
      problemes.push({
        code: 'trop-hashtags',
        message: `${n} hashtag(s), le maximum est ${bloc.hashtagsMax}`,
      })
    }

    for (const code of bloc.interdits) {
      const regle = PAR_CODE.get(code)
      if (regle?.detecte(t)) {
        problemes.push({ code, message: regle.plainte })
      }
    }
  }

  if (marque?.vocabulaireEvite) {
    const normalise = sansAccent(t.toLowerCase())
    for (const terme of termesInterdits(marque.vocabulaireEvite)) {
      if (normalise.includes(sansAccent(terme.toLowerCase()))) {
        problemes.push({
          code: 'vocabulaire-evite',
          message: `emploie « ${terme} », que la marque interdit`,
        })
      }
    }
  }

  if (options.mentionObligatoire !== false && marque?.mentionsLegales?.trim()) {
    // On ne compare pas mot a mot : le modele reformule parfois la ponctuation.
    // On verifie que les mots porteurs de la mention sont bien la.
    const normalise = sansAccent(t.toLowerCase())
    const mots = sansAccent(marque.mentionsLegales.toLowerCase())
      .split(/[^a-z0-9]+/)
      .filter((m) => m.length >= 5)
    const presents = mots.filter((m) => normalise.includes(m)).length
    if (mots.length > 0 && presents / mots.length < 0.6) {
      problemes.push({
        code: 'mention-manquante',
        message: "l'avertissement obligatoire de la marque n'apparait pas",
      })
    }
  }

  return problemes
}

// ---------------------------------------------------------------------------
// Similarite entre variantes
// ---------------------------------------------------------------------------

function grammes(texte: string, taille = 4): Set<string> {
  const t = sansAccent(texte.toLowerCase())
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  const set = new Set<string>()
  for (let i = 0; i + taille <= t.length; i++) set.add(t.slice(i, i + taille))
  return set
}

/**
 * Proximite entre deux textes, de 0 a 1.
 *
 * Jaccard sur des sequences de quatre caracteres : insensible a l'ordre des
 * phrases, mais tres sensible aux tournures reprises telles quelles. C'est
 * exactement ce qu'on cherche, deux textes qui disent la meme chose avec les
 * memes mots.
 */
export function similarite(a: string, b: string): number {
  const ga = grammes(a)
  const gb = grammes(b)
  if (ga.size === 0 || gb.size === 0) return 0

  let communs = 0
  for (const g of ga) if (gb.has(g)) communs++

  return communs / (ga.size + gb.size - communs)
}

/**
 * Au-dela de ce seuil, deux textes sont trop proches pour etre publies sur
 * deux comptes differents.
 *
 * Cale a 0,55 : deux textes sur le meme sujet partagent forcement du
 * vocabulaire, et descendre plus bas signalait des variantes reellement
 * distinctes.
 */
export const SEUIL_SIMILARITE = 0.55

export type Doublon = { a: string; b: string; score: number }

/** Les paires trop proches parmi les variantes d'une meme campagne. */
export function doublons(
  textes: Array<{ id: string; caption: string }>,
  seuil = SEUIL_SIMILARITE,
): Doublon[] {
  const trouves: Doublon[] = []
  for (let i = 0; i < textes.length; i++) {
    for (let j = i + 1; j < textes.length; j++) {
      if (!textes[i].caption || !textes[j].caption) continue
      const score = similarite(textes[i].caption, textes[j].caption)
      if (score >= seuil) {
        trouves.push({ a: textes[i].id, b: textes[j].id, score: Math.round(score * 100) / 100 })
      }
    }
  }
  return trouves
}
