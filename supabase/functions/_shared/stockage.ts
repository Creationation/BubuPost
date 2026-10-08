// Le stockage ne garde que ce qui sert encore.
//
// Pourquoi ce fichier existe : le 6 octobre 2026, le projet a depasse son
// quota (1 Go offert, 3,9 Go occupes) et Supabase a tout coupe. Il a fallu
// quatorze heures pour s'en apercevoir. La cause etait double : un ancien
// defaut du watcher qui renvoyait chaque video a chaque passage, corrige le
// 14 septembre, et surtout le fait que RIEN n'etait jamais supprime.
//
// Une video publiee n'a plus besoin de son fichier : la plateforme en a fait
// sa propre copie, et l'original reste sur le disque de Diego. Le garder ne
// sert a rien et finit par tout bloquer. On l'efface donc des que plus aucune
// publication a venir n'en a besoin.
//
// Ce qu'on ne peut pas faire, et pourquoi : Instagram et Facebook ne recoivent
// pas les octets de la video, ils vont la CHERCHER a une adresse publique.
// Le fichier doit donc etre en ligne au moment de la publication. Il ne peut
// pas rester uniquement sur le PC, qui est souvent eteint. Le mieux possible
// est donc de l'y mettre le temps qu'il faut, puis de l'enlever.
//
// Depuis le 8 octobre 2026 (nouveau projet Supabase), c'est exactement ce qui
// se passe : le watcher n'envoie la video que dans les HORIZON_ENVOI_H heures
// qui precedent sa premiere publication (action a-envoyer), a l'adresse
// reservee lors de l'ingestion. Si elle manque a l'heure dite (PC eteint), le
// scheduler repousse au lieu d'echouer.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

/** Le chemin dans le bucket, depuis une adresse publique complete. */
export function cheminDe(url: string | null | undefined): string | null {
  if (!url) return null
  const m = url.match(/\/videos\/(.+)$/)
  return m ? m[1] : null
}

/**
 * Les statuts d'une publication qui a encore besoin de son fichier.
 * Une publication partie, annulee ou definitivement en echec n'en a plus.
 */
export const A_VENIR = ['pending', 'a_valider', 'processing']

/** Combien d'heures avant sa premiere publication une video est envoyee. */
export const HORIZON_ENVOI_H = 24

/** Le fichier est-il deja dans le bucket ? (lecture du catalogue, sans telecharger) */
export async function dansLeStockage(db: SupabaseClient, chemin: string): Promise<boolean> {
  const coupe = chemin.lastIndexOf('/')
  const dossier = coupe > 0 ? chemin.slice(0, coupe) : ''
  const nom = chemin.slice(coupe + 1)
  const { data, error } = await db.storage.from('videos').list(dossier, { search: nom, limit: 10 })
  if (error) return false
  return (data ?? []).some((o) => o.name === nom)
}

/**
 * La video est-elle telechargeable a son adresse publique ?
 *
 * Une panne reseau ne doit pas bloquer une publication : dans le doute on
 * repond oui, et c'est la plateforme qui dira si le fichier manque.
 */
export async function videoEnLigne(url: string | null | undefined): Promise<boolean> {
  if (!url) return false
  try {
    const r = await fetch(url, { method: 'HEAD' })
    if (r.status === 404 || r.status === 400) return false
    return true
  } catch {
    return true
  }
}

/**
 * Efface du stockage ce dont plus personne n'a besoin.
 *
 * Un fichier est garde si une publication a venir le reclame, ou si une
 * entree de la reserve attend encore son tour. Tout le reste part.
 *
 * `limite` borne le travail d'un passage : cette fonction est appelee depuis
 * le moteur, qui a son propre budget de temps.
 */
export async function menagerStockage(
  db: SupabaseClient,
  limite = 200,
): Promise<{ effaces: number; octets: number }> {
  const { data, error } = await db.rpc('fichiers_inutiles', { p_limite: limite })
  if (error || !Array.isArray(data) || data.length === 0) return { effaces: 0, octets: 0 }

  const chemins = (data as Array<{ chemin: string; taille: number }>).map((f) => f.chemin)
  const octets = (data as Array<{ chemin: string; taille: number }>).reduce(
    (n, f) => n + Number(f.taille || 0),
    0,
  )

  const { error: souci } = await db.storage.from('videos').remove(chemins)
  if (souci) {
    console.error('menage du stockage impossible', souci.message)
    return { effaces: 0, octets: 0 }
  }

  return { effaces: chemins.length, octets }
}

/**
 * Apres une publication reussie : le fichier sert-il encore ?
 *
 * On ne supprime que si plus aucune publication a venir ne pointe sur cette
 * adresse, et que la reserve ne l'attend plus. Deux comptes publient la meme
 * video a quinze minutes d'ecart : effacer apres le premier casserait le
 * second.
 */
export async function effacerSiFini(db: SupabaseClient, videoUrl: string | null): Promise<boolean> {
  const chemin = cheminDe(videoUrl)
  if (!chemin || !videoUrl) return false

  const { count: attendent } = await db
    .from('posts')
    .select('id', { count: 'exact', head: true })
    .eq('video_url', videoUrl)
    .in('status', A_VENIR)
  if ((attendent ?? 0) > 0) return false

  const { count: enReserve } = await db
    .from('bibliotheque')
    .select('id', { count: 'exact', head: true })
    .eq('video_url', videoUrl)
    .in('statut', ['en_file', 'en_pause'])
  if ((enReserve ?? 0) > 0) return false

  const { error } = await db.storage.from('videos').remove([chemin])
  if (error) {
    console.error(`fichier ${chemin} non efface : ${error.message}`)
    return false
  }
  return true
}
