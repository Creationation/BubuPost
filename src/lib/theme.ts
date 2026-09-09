import { useSyncExternalStore } from 'react'

/**
 * Le theme de l'application.
 *
 * Trois etats, pas deux. « Systeme » est le defaut et il compte : un ecran qui
 * ignore le reglage du systeme se fait remarquer, et quelqu'un qui bascule son
 * PC en mode clair le soir s'attend a ce que l'app suive.
 */
export type Theme = 'systeme' | 'clair' | 'sombre'

const CLE = 'bubupost.theme'

export const THEMES: { valeur: Theme; label: string; icone: string }[] = [
  { valeur: 'clair', label: 'Clair', icone: '☀' },
  { valeur: 'sombre', label: 'Sombre', icone: '☾' },
  { valeur: 'systeme', label: 'Systeme', icone: '◐' },
]

function lireChoix(): Theme {
  try {
    const v = localStorage.getItem(CLE)
    if (v === 'clair' || v === 'sombre' || v === 'systeme') return v
  } catch {
    // Navigation privee, stockage refuse : le defaut fera l'affaire.
  }
  return 'systeme'
}

const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: light)') : null

/** Le theme reellement applique, une fois « systeme » resolu. */
export function themeEffectif(choix: Theme): 'clair' | 'sombre' {
  if (choix !== 'systeme') return choix
  return media?.matches ? 'clair' : 'sombre'
}

/**
 * Pose le theme sur la racine du document.
 *
 * L'attribut ne vaut que pour le mode clair : le sombre est le defaut des
 * variables, donc l'absence d'attribut suffit et evite un etat intermediaire
 * ou les deux se disputeraient la priorite.
 */
function appliquer(choix: Theme) {
  const racine = document.documentElement
  if (themeEffectif(choix) === 'clair') racine.setAttribute('data-theme', 'clair')
  else racine.removeAttribute('data-theme')
}

let choixCourant: Theme = typeof window === 'undefined' ? 'sombre' : lireChoix()
const abonnes = new Set<() => void>()

function prevenir() {
  for (const a of abonnes) a()
}

export function definirTheme(theme: Theme) {
  choixCourant = theme
  try {
    localStorage.setItem(CLE, theme)
  } catch {
    // Le choix ne survivra pas au rechargement, l'ecran est bon pour autant.
  }
  appliquer(theme)
  prevenir()
}

/**
 * A appeler une fois au demarrage, avant le premier rendu.
 *
 * Sans cela l'application s'affiche en sombre le temps d'un rendu, puis
 * bascule : le clignotement se voit, et il fait mauvais effet.
 */
export function initialiserTheme() {
  appliquer(choixCourant)
  // Suivre le systeme en direct : basculer son PC en mode clair doit suffire.
  media?.addEventListener('change', () => {
    if (choixCourant === 'systeme') {
      appliquer(choixCourant)
      prevenir()
    }
  })
}

export function useTheme(): { choix: Theme; effectif: 'clair' | 'sombre' } {
  const choix = useSyncExternalStore(
    (ecouter) => {
      abonnes.add(ecouter)
      return () => abonnes.delete(ecouter)
    },
    () => choixCourant,
    () => 'sombre' as Theme,
  )
  return { choix, effectif: themeEffectif(choix) }
}
