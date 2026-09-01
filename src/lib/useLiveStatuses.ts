import { useEffect, useRef } from 'react'
import { refreshPostStatuses } from './api'
import { estImminente } from './countdown'
import type { PostWithAccount } from './types'

/** Assez frequent pour ne pas rester fige, assez rare pour ne rien couter. */
const PERIODE_MS = 18_000

/**
 * Rafraichit le statut des publications sur le point de partir.
 *
 * Sans ca, il faut recharger la page a la main pour voir qu'une publication est
 * passee. On ne sonde que les lignes concernees, et seulement quand l'onglet
 * est visible : inutile d'interroger la base pendant que Diego fait autre chose.
 */
export function useLiveStatuses(
  posts: PostWithAccount[],
  onChange: (maj: Array<Partial<PostWithAccount> & { id: string }>) => void,
) {
  // Une reference plutot qu'une dependance : la fonction change a chaque rendu
  // du parent, et la mettre en dependance relancerait le minuteur sans cesse.
  const rappel = useRef(onChange)
  rappel.current = onChange

  const surveilles = posts
    .filter((p) => estImminente(p, Date.now()))
    .map((p) => p.id)
    .sort()
    .join(',')

  useEffect(() => {
    if (!surveilles) return

    let vivant = true

    async function sonder() {
      if (document.hidden) return
      try {
        const lignes = await refreshPostStatuses(surveilles.split(','))
        if (vivant && lignes.length > 0) {
          rappel.current(lignes as Array<Partial<PostWithAccount> & { id: string }>)
        }
      } catch {
        // Une sonde ratee n'a pas a remonter a l'ecran : la suivante reessaiera.
      }
    }

    const minuteur = setInterval(sonder, PERIODE_MS)

    // Au retour sur l'onglet, on rattrape tout de suite ce qui s'est passe.
    const auRetour = () => {
      if (!document.hidden) void sonder()
    }
    document.addEventListener('visibilitychange', auRetour)

    return () => {
      vivant = false
      clearInterval(minuteur)
      document.removeEventListener('visibilitychange', auRetour)
    }
  }, [surveilles])
}
