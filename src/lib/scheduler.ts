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
let charge = false
const abonnes = new Set<() => void>()
let minuteur: ReturnType<typeof setInterval> | null = null

async function relire() {
  if (document.hidden) return
  try {
    const { data } = await supabase
      .from('scheduler_runs')
      .select('started_at')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const valeur = data?.started_at ? new Date(data.started_at).getTime() : null
    charge = true
    if (valeur !== dernierPassage) {
      dernierPassage = valeur
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

const lire = () => dernierPassage

export function useDernierPassage(): number | null {
  return useSyncExternalStore(abonner, lire, lire)
}

/** Vrai tant qu'on n'a pas encore recu de reponse du serveur. */
export function passageInconnu(): boolean {
  return !charge
}

/** Force une relecture, apres un declenchement manuel du scheduler. */
export function rafraichirPassage(): void {
  void relire()
}
