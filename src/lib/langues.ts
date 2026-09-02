/**
 * Les langues de publication.
 *
 * Le code ISO 639-1 est ce qui est stocke. Le nom natif sert au prompt : dire
 * au modele « ecris en English » plutot que « ecris en anglais » evite qu'il
 * traite la consigne comme une traduction depuis le francais.
 */
export type Langue = {
  code: string
  /** Comme on la nomme dans l'interface, en francais. */
  label: string
  /** Comme elle se nomme elle-meme. C'est ce qui part dans le prompt. */
  natif: string
  /** Deux lettres, pour la pastille compacte du calendrier. */
  badge: string
}

export const LANGUES: Langue[] = [
  { code: 'fr', label: 'Francais', natif: 'francais', badge: 'FR' },
  { code: 'en', label: 'Anglais', natif: 'English', badge: 'EN' },
  { code: 'es', label: 'Espagnol', natif: 'espanol', badge: 'ES' },
  { code: 'de', label: 'Allemand', natif: 'Deutsch', badge: 'DE' },
  { code: 'it', label: 'Italien', natif: 'italiano', badge: 'IT' },
  { code: 'pt', label: 'Portugais', natif: 'portugues', badge: 'PT' },
  { code: 'nl', label: 'Neerlandais', natif: 'Nederlands', badge: 'NL' },
]

/**
 * La langue par defaut.
 *
 * Une publication creee avant l'ajout des langues n'en porte aucune. Elle etait
 * ecrite en francais, elle le reste.
 */
export const LANGUE_DEFAUT = 'fr'

const PAR_CODE = new Map(LANGUES.map((l) => [l.code, l]))

export function langue(code: string | null | undefined): Langue {
  return PAR_CODE.get(code ?? '') ?? PAR_CODE.get(LANGUE_DEFAUT)!
}

/** Le code retenu pour une publication : sa surcharge, sinon celle du compte. */
export function langueDe(
  post: { language?: string | null },
  compte?: { language?: string | null } | null,
): string {
  return post.language ?? compte?.language ?? LANGUE_DEFAUT
}

/** Classes de la pastille, une teinte par langue pour les distinguer de loin. */
const TEINTES: Record<string, string> = {
  fr: 'border-brand-400/30 bg-brand-400/10 text-brand-400',
  en: 'border-ok-400/30 bg-ok-400/10 text-ok-400',
  es: 'border-warn-400/30 bg-warn-400/10 text-warn-400',
  de: 'border-idle-400/30 bg-idle-400/10 text-idle-400',
  it: 'border-bad-400/30 bg-bad-400/10 text-bad-400',
  pt: 'border-mist-300/30 bg-mist-300/10 text-mist-300',
  nl: 'border-mist-500/30 bg-mist-500/10 text-mist-500',
}

export function teinteLangue(code: string): string {
  return TEINTES[code] ?? TEINTES.fr
}

// ---------------------------------------------------------------------------
// Mentions legales par langue
// ---------------------------------------------------------------------------

/**
 * Les mentions legales d'une marque, une par langue.
 *
 * Avant, c'etait une seule chaine. Coller un avertissement francais sous un
 * texte anglais se voit, et le controle qui verifie sa presence echouait des
 * que le modele le traduisait de lui-meme.
 */
export type MentionsParLangue = Record<string, string>

/** Accepte l'ancienne forme, une simple chaine, et la range en francais. */
export function normaliserMentions(brut: unknown): MentionsParLangue {
  if (typeof brut === 'string') {
    return brut.trim() ? { [LANGUE_DEFAUT]: brut } : {}
  }
  if (brut && typeof brut === 'object') {
    const sortie: MentionsParLangue = {}
    for (const [code, valeur] of Object.entries(brut as Record<string, unknown>)) {
      const texte = String(valeur ?? '')
      if (texte.trim()) sortie[code] = texte
    }
    return sortie
  }
  return {}
}

export type HashtagsParLangue = Record<string, string[]>

/** Accepte l'ancienne forme, un simple tableau, et la range en francais. */
export function normaliserHashtagsMarque(brut: unknown): HashtagsParLangue {
  if (Array.isArray(brut)) {
    const liste = brut.map(String).filter(Boolean)
    return liste.length > 0 ? { [LANGUE_DEFAUT]: liste } : {}
  }
  if (brut && typeof brut === 'object') {
    const sortie: HashtagsParLangue = {}
    for (const [code, valeur] of Object.entries(brut as Record<string, unknown>)) {
      if (!Array.isArray(valeur)) continue
      const liste = valeur.map(String).filter(Boolean)
      if (liste.length > 0) sortie[code] = liste
    }
    return sortie
  }
  return {}
}

/**
 * La mention a employer pour une langue donnee.
 *
 * Si elle manque dans cette langue, on retombe sur le francais plutot que sur
 * rien : un avertissement de risque dans la mauvaise langue vaut mieux qu'un
 * avertissement absent.
 */
export function mentionPour(mentions: MentionsParLangue, code: string): string {
  return mentions[code] ?? mentions[LANGUE_DEFAUT] ?? ''
}
