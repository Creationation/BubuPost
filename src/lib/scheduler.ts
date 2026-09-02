import { useSyncExternalStore } from 'react'
import { supabase } from './supabase'

/**
 * Dernier passage reel du scheduler, partage par toute l'application.
 *
 * Une seule requete pour tous les composants qui en ont besoin, rafraichie
 * doucement : cette valeur ne bouge qu'une fois toutes les 5 minutes, la
 * sonder plus souvent ne sert a rien.
 */
const PERIODE_MS = 30_000

let dernierPassage: number | null = null

/**
 * Cadence du scheduler, en minutes, telle qu'elle est reellement configuree.
 * Ecrire 5 en dur ici a deja donne un compte a rebours faux le jour ou le cron
 * a change : la valeur vient donc du serveur, comme le cron lui-meme.
 */
let intervalleMinutes = 5
let charge = false
const abonnes = new Set<() => void>()
let minuteur: ReturnType<typeof setInterval> | null = null

async function relire() {
  if (document.hidden) return
  try {
    const [passage, reglage] = await Promise.all([
      supabase
        .from('scheduler_runs')
        .select('started_at')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from('app_settings').select('value').eq('key', 'scheduler').maybeSingle(),
    ])

    const valeur = passage.data?.started_at
      ? new Date(passage.data.started_at).getTime()
      : null

    const minutes = (reglage.data?.value as { interval_minutes?: number } | null)
      ?.interval_minutes
    const nouvelIntervalle =
      typeof minutes === 'number' && minutes > 0 ? minutes : intervalleMinutes

    charge = true
    if (valeur !== dernierPassage || nouvelIntervalle !== intervalleMinutes) {
      dernierPassage = valeur
      intervalleMinutes = nouvelIntervalle
      abonnes.forEach((prevenir) => prevenir())
    }
  } catch {
    // On garde la derniere valeur connue : mieux vaut un compte a rebours un
    // peu vieux qu'un affichage qui disparait.
    charge = true
  }
}

function abonner(prevenir: () => void): () => void {
  abonnes.add(prevenir)
  if (!minuteur) {
    void relire()
    minuteur = setInterval(relire, PERIODE_MS)
  }
  return () => {
    abonnes.delete(prevenir)
    if (abonnes.size === 0 && minuteur) {
      clearInterval(minuteur)
      minuteur = null
    }
  }
}

/**
 * Un seul instantane pour les deux valeurs : deux abonnements separes
 * declencheraient deux rendus par rafraichissement, et il faudrait garder la
 * meme reference d'objet entre les appels pour ne pas boucler.
 */
let instantane = { dernierPassage: null as number | null, intervalleMinutes: 5 }

function lire() {
  if (
    instantane.dernierPassage !== dernierPassage ||
    instantane.intervalleMinutes !== intervalleMinutes
  ) {
    instantane = { dernierPassage, intervalleMinutes }
  }
  return instantane
}

export function useScheduler(): { dernierPassage: number | null; intervalleMinutes: number } {
  return useSyncExternalStore(abonner, lire, lire)
}

export function useDernierPassage(): number | null {
  return useScheduler().dernierPassage
}

/** Vrai tant qu'on n'a pas encore recu de reponse du serveur. */
export function passageInconnu(): boolean {
  return !charge
}

/** Force une relecture, apres un declenchement manuel du scheduler. */
export function rafraichirPassage(): void {
  void relire()
}
