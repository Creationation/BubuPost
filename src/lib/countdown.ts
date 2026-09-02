import { useSyncExternalStore } from 'react'

/**
 * Une seule horloge pour toute l'application.
 *
 * Avec un minuteur par publication, une page de trente posts en ferait tourner
 * trente. Ici tous les composants s'abonnent au meme battement, qui s'arrete
 * de lui-meme des que plus personne ne l'ecoute.
 */
let seconde = Math.floor(Date.now() / 1000)
const abonnes = new Set<() => void>()
let minuteur: ReturnType<typeof setInterval> | null = null

function battre() {
  seconde = Math.floor(Date.now() / 1000)
  abonnes.forEach((prevenir) => prevenir())
}

function abonner(prevenir: () => void): () => void {
  abonnes.add(prevenir)
  if (!minuteur) minuteur = setInterval(battre, 1000)
  return () => {
    abonnes.delete(prevenir)
    if (abonnes.size === 0 && minuteur) {
      clearInterval(minuteur)
      minuteur = null
    }
  }
}

const lire = () => seconde

/** L'heure courante, arrondie a la seconde. Provoque un rendu par seconde. */
export function useSeconde(): number {
  return useSyncExternalStore(abonner, lire, lire)
}

/** « 2 min 34 s », « 1 h 05 », « 12 s ». */
export function formatDuree(secondes: number): string {
  const s = Math.max(0, Math.round(secondes))
  if (s < 60) return `${s} s`

  const minutes = Math.floor(s / 60)
  if (minutes < 60) {
    const reste = s % 60
    return reste === 0 ? `${minutes} min` : `${minutes} min ${String(reste).padStart(2, '0')} s`
  }

  const heures = Math.floor(minutes / 60)
  const resteMin = minutes % 60
  if (heures < 24) {
    return resteMin === 0 ? `${heures} h` : `${heures} h ${String(resteMin).padStart(2, '0')}`
  }

  const jours = Math.floor(heures / 24)
  return `${jours} j ${heures % 24} h`
}

/** Cadence de repli, si le serveur n'a pas encore repondu. */
const CYCLE_DEFAUT_S = 300

/**
 * Secondes avant le prochain passage du scheduler, a partir du dernier passage
 * reellement enregistre en base.
 *
 * On ne suppose plus un alignement sur les minutes multiples de 5 : pg_cron
 * declenche a la minute, puis l'appel HTTP et le demarrage de la fonction
 * ajoutent leur delai. Le compte a rebours theorique affichait donc des valeurs
 * decalees, du genre 4 min 30 la ou on attendait 5 min.
 *
 * Renvoie null tant que le dernier passage est inconnu : mieux vaut ne pas
 * afficher de chiffre que d'en afficher un faux.
 */
export function secondesAvantPassage(
  maintenantMs: number,
  dernierPassageMs: number | null,
  cycleSecondes: number = CYCLE_DEFAUT_S,
): number | null {
  if (!dernierPassageMs) return null

  const cycle = cycleSecondes > 0 ? cycleSecondes : CYCLE_DEFAUT_S
  const ecoule = (maintenantMs - dernierPassageMs) / 1000

  // Passage manque ou horloges decalees : on ne bricole pas un chiffre.
  if (ecoule < 0 || ecoule > cycle * 3) return null

  return Math.max(0, Math.round(cycle - ecoule))
}

export type PhaseAttente = 'lointain' | 'proche' | 'file' | 'traitement' | 'aucune'

export type EtatAttente = {
  phase: PhaseAttente
  /** Texte pret a afficher. */
  label: string
  /** Le systeme est sur le point d'agir : merite une animation. */
  vivant: boolean
  /** Secondes avant l'heure prevue, negatif si depassee. */
  restant: number
}

/** En dessous, on considere que ca va se jouer maintenant. */
const SEUIL_PROCHE = 60

/**
 * Ce qu'il faut afficher pour une publication qui n'est pas encore partie.
 * Rend le systeme lisible : on sait toujours ce qu'il attend, et quand.
 */
export function decrireAttente(
  scheduledAt: string,
  status: string,
  maintenantMs: number,
  dernierPassageMs: number | null = null,
  cycleSecondes: number = CYCLE_DEFAUT_S,
): EtatAttente {
  // Le scheduler a pris la publication en charge : plus aucun compte a
  // rebours, le travail a commence.
  if (status === 'processing') {
    return {
      phase: 'traitement',
      label: 'Publication en cours...',
      vivant: true,
      restant: 0,
    }
  }

  if (status !== 'pending') {
    return { phase: 'aucune', label: '', vivant: false, restant: 0 }
  }

  const restant = (new Date(scheduledAt).getTime() - maintenantMs) / 1000

  if (restant > SEUIL_PROCHE) {
    return {
      phase: 'lointain',
      label: `Publication dans ${formatDuree(restant)}`,
      vivant: false,
      restant,
    }
  }

  if (restant > 0) {
    return {
      phase: 'proche',
      label: `Publication dans ${formatDuree(restant)}`,
      vivant: true,
      restant,
    }
  }

  // L'heure est passee, le scheduler n'est pas encore venu : on annonce son
  // prochain passage reel, ou rien du tout si on ne le connait pas.
  const avant = secondesAvantPassage(maintenantMs, dernierPassageMs, cycleSecondes)

  if (avant === null) {
    return {
      phase: 'file',
      label: 'En attente du prochain passage du scheduler',
      vivant: true,
      restant,
    }
  }

  return {
    phase: 'file',
    label:
      avant <= 15
        ? 'En attente du prochain passage, imminent...'
        : `En attente du prochain passage, dans ${formatDuree(avant)}`,
    vivant: true,
    restant,
  }
}

/** Une publication qui bouge bientot merite qu'on surveille son statut. */
export function estImminente(post: { status: string; scheduled_at: string }, maintenantMs: number) {
  if (post.status === 'processing') return true
  if (post.status !== 'pending') return false
  return new Date(post.scheduled_at).getTime() - maintenantMs <= SEUIL_PROCHE * 1000
}
