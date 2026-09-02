/**
 * Consignes de generation, cote application.
 *
 * L'autorite sur la facon dont ces reglages deviennent un prompt et sur les
 * controles qui s'appliquent est dans supabase/functions/_shared/consignes.ts.
 * Ici on ne fait que les afficher et les enregistrer : ce fichier ne doit
 * jamais reimplementer une verification, sous peine de dire au bureau l'inverse
 * de ce que le serveur applique.
 */

export type Bloc = {
  longueurMin: number
  longueurMax: number
  hashtagsMin: number
  hashtagsMax: number
  placementHashtags: 'fin' | 'texte'
  ton: string
  structure: string
  interdits: string[]
  interditsLibres: string
}

export type ConsignePlateforme = Bloc & {
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

export type LigneConsigne = {
  portee: 'plateforme' | 'marque'
  cle: string
  reglages: Record<string, unknown>
  updated_at: string
}

/**
 * Les interdits proposes sous forme de cases a cocher.
 *
 * Les codes doivent correspondre a ceux du catalogue serveur : c'est lui qui
 * verifie. Un code inconnu enregistre par ailleurs n'est pas perdu, la page le
 * conserve tel quel plutot que de l'effacer au premier enregistrement.
 */
export const INTERDITS: { code: string; label: string }[] = [
  { code: 'emoji', label: 'Emojis' },
  { code: 'tiret-cadratin', label: 'Tirets cadratins et demi-cadratins' },
  { code: 'question', label: 'Questions' },
  { code: 'exclamation', label: "Points d'exclamation" },
  { code: 'majuscules', label: 'Mots ecrits tout en majuscules' },
  { code: 'hashtag-dans-texte', label: 'Hashtags dans le corps du texte' },
  { code: 'lien', label: 'Liens' },
  { code: 'premiere-personne', label: 'Premiere personne du singulier' },
]

/** Les quatre jeux de regles propres a YouTube. */
export const VARIANTES_YOUTUBE: { cle: string; label: string; aide: string }[] = [
  { cle: 'short_titre', label: 'Short, titre', aide: 'Sert de premiere ligne du Short.' },
  { cle: 'short_description', label: 'Short, description', aide: 'Le texte sous la video.' },
  {
    cle: 'video_titre',
    label: 'Video classique, titre',
    aide: 'Optimise pour la recherche YouTube. Au-dela de 70 caracteres il est tronque.',
  },
  {
    cle: 'video_description',
    label: 'Video classique, description',
    aide: 'Les premieres lignes decident du clic.',
  },
]

/** Un bloc vierge, pour une plateforme qui n'aurait pas encore de consignes. */
export function blocVide(): Bloc {
  return {
    longueurMin: 80,
    longueurMax: 300,
    hashtagsMin: 0,
    hashtagsMax: 5,
    placementHashtags: 'fin',
    ton: '',
    structure: '',
    interdits: ['tiret-cadratin'],
    interditsLibres: '',
  }
}

export function marqueVide(): ConsigneMarque {
  return {
    niche: '',
    audience: '',
    ton: '',
    vocabulairePrefere: '',
    vocabulaireEvite: '',
    appelAction: '',
    hashtags: [],
    mentionsLegales: '',
  }
}

/** Complete un enregistrement partiel, pour ne jamais rendre un champ undefined. */
export function normaliserBloc(brut: unknown): Bloc {
  const b = (brut ?? {}) as Partial<Bloc>
  const vide = blocVide()
  return {
    longueurMin: Number(b.longueurMin ?? vide.longueurMin),
    longueurMax: Number(b.longueurMax ?? vide.longueurMax),
    hashtagsMin: Number(b.hashtagsMin ?? vide.hashtagsMin),
    hashtagsMax: Number(b.hashtagsMax ?? vide.hashtagsMax),
    placementHashtags: b.placementHashtags === 'texte' ? 'texte' : 'fin',
    ton: String(b.ton ?? ''),
    structure: String(b.structure ?? ''),
    interdits: Array.isArray(b.interdits) ? b.interdits.map(String) : [],
    interditsLibres: String(b.interditsLibres ?? ''),
  }
}

export function normaliserPlateforme(brut: unknown): ConsignePlateforme {
  const base = normaliserBloc(brut)
  const variantes = (brut as { variantes?: Record<string, unknown> })?.variantes
  if (!variantes) return base
  return {
    ...base,
    variantes: Object.fromEntries(
      Object.entries(variantes).map(([cle, v]) => [cle, normaliserBloc(v)]),
    ),
  }
}

export function normaliserMarque(brut: unknown): ConsigneMarque {
  const m = (brut ?? {}) as Partial<ConsigneMarque>
  return {
    niche: String(m.niche ?? ''),
    audience: String(m.audience ?? ''),
    ton: String(m.ton ?? ''),
    vocabulairePrefere: String(m.vocabulairePrefere ?? ''),
    vocabulaireEvite: String(m.vocabulaireEvite ?? ''),
    appelAction: String(m.appelAction ?? ''),
    hashtags: Array.isArray(m.hashtags) ? m.hashtags.map(String) : [],
    mentionsLegales: String(m.mentionsLegales ?? ''),
  }
}

/** Une marque sans consignes laisse la generation aux seules regles de plateforme. */
export function marqueVierge(m: ConsigneMarque): boolean {
  return (
    !m.niche.trim() &&
    !m.audience.trim() &&
    !m.ton.trim() &&
    !m.vocabulairePrefere.trim() &&
    !m.vocabulaireEvite.trim() &&
    !m.mentionsLegales.trim()
  )
}

/** Un probleme signale par le serveur apres controle d'un texte genere. */
export type Probleme = { code: string; message: string }

/**
 * De quoi ecrire une phrase en plus de la mention obligatoire.
 * Doit rester aligne sur MARGE_MENTION dans
 * supabase/functions/_shared/consignes.ts, qui fait foi a la generation.
 */
const MARGE_MENTION = 40

/**
 * Les plateformes dont la longueur maximale ne peut pas accueillir la mention
 * legale d'une marque.
 *
 * Le signaler ici evite de le decouvrir a la generation, quand l'appel est deja
 * paye et que le texte est deja hors limites.
 */
export function plateformesTropCourtes(
  mention: string,
  plateformes: Record<string, ConsignePlateforme>,
): { plateforme: string; max: number }[] {
  const taille = mention.trim().length
  if (taille === 0) return []

  const sortie: { plateforme: string; max: number }[] = []
  for (const [nom, consigne] of Object.entries(plateformes)) {
    // YouTube porte ses limites dans ses variantes, on prend la description.
    const blocs = consigne.variantes
      ? Object.entries(consigne.variantes)
          .filter(([cle]) => cle.endsWith('_description'))
          .map(([, b]) => b)
      : [consigne]

    const max = Math.max(...blocs.map((b) => b.longueurMax))
    if (taille + MARGE_MENTION > max) sortie.push({ plateforme: nom, max })
  }
  return sortie.sort((a, b) => a.max - b.max)
}
