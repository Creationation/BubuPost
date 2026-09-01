// Les erreurs supabase-js ne sont pas des instances d'Error : String(err) donne
// "[object Object]". Tout message affiche a l'ecran passe par ici.
export function errorMessage(err: unknown): string {
  if (!err) return 'Erreur inconnue'
  if (typeof err === 'string') return err
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'object') {
    const o = err as Record<string, unknown>
    for (const key of ['message', 'error_description', 'error', 'details', 'hint']) {
      const v = o[key]
      if (typeof v === 'string' && v.trim()) return v
    }
    try {
      return JSON.stringify(err)
    } catch {
      return 'Erreur inconnue'
    }
  }
  return String(err)
}

const FRIENDLY: Record<string, string> = {
  'Invalid login credentials': 'Email ou mot de passe incorrect.',
  'Email not confirmed': "Cet email n'a pas encore ete confirme.",
  'User already registered': 'Un compte existe deja avec cet email.',
  'Password should be at least 6 characters': 'Le mot de passe doit faire au moins 6 caracteres.',
  'Failed to fetch': 'Impossible de joindre le serveur. Verifie ta connexion.',
}

export function friendlyError(err: unknown): string {
  const raw = errorMessage(err)
  return FRIENDLY[raw] ?? raw
}
