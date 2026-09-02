/**
 * Le role porte par un JWT Supabase.
 *
 * La passerelle a deja verifie la signature avant que la requete arrive dans
 * la fonction : on peut lire la charge utile sans la revalider. Comparer le
 * bearer a SUPABASE_SERVICE_ROLE_KEY ne suffit pas, la valeur injectee dans
 * l'environnement ne correspond pas toujours au JWT historique.
 */
export function jwtRole(token: string): string | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const pad = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(pad.padEnd(Math.ceil(pad.length / 4) * 4, '=')))
    return typeof payload.role === 'string' ? payload.role : null
  } catch {
    return null
  }
}

/**
 * Comparaison a duree constante.
 *
 * Le jeton du watcher ouvre une fonction accessible sans JWT : une comparaison
 * naive laisse mesurer, caractere par caractere, combien de tete le jeton
 * fourni a en commun avec le vrai.
 */
export function memeSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
