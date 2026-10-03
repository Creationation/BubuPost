/**
 * Quand repartent les publications qui ne sont pas passees.
 *
 * Une publication en echec garde son ancienne heure, deja passee : la relancer
 * telle quelle la fait partir dans les deux minutes, toutes en meme temps.
 * Ce module calcule les nouvelles heures, et il le fait a part de l'ecran pour
 * que les cas limites se testent sans navigateur.
 */

export type ModeReprise =
  | 'maintenant'
  | 'dans30'
  | 'dans2h'
  | 'demain'
  | 'choisi'
  | 'hasard'

export type Reprise = { id: string; quand: Date }

/**
 * Deux publications ne partent jamais a la seconde pres.
 *
 * Le scheduler en prend trois par passage, toutes les deux minutes : les
 * espacer d'autant colle a ce qu'il fait vraiment, et evite qu'une plateforme
 * voie une rafale.
 */
export const ECART_MINUTES = 2

/** L'heure de reference d'un mode fixe, avant l'espacement. */
function depart(mode: ModeReprise, maintenant: Date, choisi?: string): Date | null {
  switch (mode) {
    case 'maintenant':
      return new Date(maintenant)
    case 'dans30':
      return new Date(maintenant.getTime() + 30 * 60_000)
    case 'dans2h':
      return new Date(maintenant.getTime() + 2 * 3_600_000)
    case 'demain': {
      const d = new Date(maintenant)
      d.setDate(d.getDate() + 1)
      d.setHours(9, 0, 0, 0)
      return d
    }
    case 'choisi': {
      if (!choisi) return null
      const d = new Date(choisi)
      return Number.isNaN(d.getTime()) ? null : d
    }
    default:
      return null
  }
}

/**
 * Des moments distincts, tires au hasard, repartis sur une fenetre.
 *
 * Un tirage uniforme peut poser trois publications dans la meme minute, ce qui
 * rate le but. On decoupe donc la fenetre en autant de tranches que de
 * publications, on tire dans chaque tranche, puis on melange l'attribution :
 * l'ecart est garanti, l'ordre reste imprevisible.
 */
function auHasard(combien: number, maintenant: Date, fenetreHeures: number): Date[] {
  if (combien === 0) return []

  // On commence cinq minutes plus tard : le temps de voir ce qui est propose
  // et de refuser, sans qu'une publication soit deja partie.
  const debut = maintenant.getTime() + 5 * 60_000
  const duree = Math.max(fenetreHeures, 0.25) * 3_600_000
  const tranche = duree / combien

  const moments = Array.from({ length: combien }, (_, i) => {
    const t = debut + i * tranche + Math.random() * tranche
    // A la minute : une seconde pres n'a aucun sens ici, et une heure ronde se
    // lit mieux dans le calendrier.
    return new Date(Math.round(t / 60_000) * 60_000)
  })

  return moments
}

/** Melange une copie, sans toucher a l'original. */
function melanger<T>(liste: T[]): T[] {
  const copie = [...liste]
  for (let i = copie.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copie[i], copie[j]] = [copie[j], copie[i]]
  }
  return copie
}

/**
 * Les nouvelles heures, une par publication.
 *
 * Renvoie une liste vide quand le mode ne permet pas de conclure (une heure
 * choisie illisible, par exemple) : l'appelant n'ecrit alors rien.
 */
export function planifier(
  ids: string[],
  mode: ModeReprise,
  options: { choisi?: string; fenetreHeures?: number; maintenant?: Date } = {},
): Reprise[] {
  if (ids.length === 0) return []
  const maintenant = options.maintenant ?? new Date()

  if (mode === 'hasard') {
    const moments = melanger(auHasard(ids.length, maintenant, options.fenetreHeures ?? 3))
    return ids.map((id, i) => ({ id, quand: moments[i] }))
  }

  const base = depart(mode, maintenant, options.choisi)
  if (!base) return []

  return ids.map((id, i) => ({
    id,
    quand: new Date(base.getTime() + i * ECART_MINUTES * 60_000),
  }))
}

/** Ce que le mode fait, en une phrase, pour l'ecran. */
export function decrireMode(mode: ModeReprise, combien: number, fenetreHeures = 3): string {
  const plusieurs = combien > 1
  switch (mode) {
    case 'maintenant':
      return plusieurs
        ? `Elles repartent tout de suite, espacees de ${ECART_MINUTES} minutes.`
        : 'Elle repart au prochain passage, dans les deux minutes.'
    case 'dans30':
      return plusieurs
        ? `Dans 30 minutes, espacees de ${ECART_MINUTES} minutes.`
        : 'Dans 30 minutes.'
    case 'dans2h':
      return plusieurs ? `Dans 2 heures, espacees de ${ECART_MINUTES} minutes.` : 'Dans 2 heures.'
    case 'demain':
      return plusieurs
        ? `Demain a 9 h, espacees de ${ECART_MINUTES} minutes.`
        : 'Demain a 9 h.'
    case 'choisi':
      return plusieurs
        ? `A l heure que tu choisis, espacees de ${ECART_MINUTES} minutes.`
        : 'A l heure que tu choisis.'
    case 'hasard':
      return plusieurs
        ? `Chacune a un moment different, tire au hasard dans les ${fenetreHeures} prochaines heures.`
        : `A un moment tire au hasard dans les ${fenetreHeures} prochaines heures.`
  }
}
