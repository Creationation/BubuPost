// Diagnostic Meta : interroge tout ce qui peut expliquer une liste de Pages
// vide, et range le resultat brut la ou je peux le relire.
//
// Les jetons sont systematiquement caviardes avant d'etre ecrits : un
// diagnostic ne doit jamais devenir une fuite.

const GRAPH = 'https://graph.facebook.com/v21.0'

/** Remplace toute valeur ressemblant a un jeton par sa longueur. */
export function caviarder(valeur: unknown): unknown {
  if (typeof valeur === 'string') {
    // Les jetons Meta sont longs et sans espace.
    if (valeur.length > 40 && !valeur.includes(' ')) {
      return `[jeton caviarde, ${valeur.length} caracteres]`
    }
    return valeur
  }
  if (Array.isArray(valeur)) return valeur.map(caviarder)
  if (valeur && typeof valeur === 'object') {
    const sortie: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(valeur)) {
      sortie[k] = k.toLowerCase().includes('token') ? '[jeton caviarde]' : caviarder(v)
    }
    return sortie
  }
  return valeur
}

async function sonder(nom: string, url: string) {
  try {
    const res = await fetch(url)
    const texte = await res.text()
    let corps: unknown
    try {
      corps = JSON.parse(texte)
    } catch {
      corps = texte.slice(0, 500)
    }
    return { appel: nom, http: res.status, corps: caviarder(corps) }
  } catch (err) {
    return { appel: nom, http: 0, erreur: String(err) }
  }
}

/**
 * Tout ce dont j'ai besoin pour comprendre pourquoi la liste est vide :
 * qui est le porteur du jeton, quelles permissions ont ete reellement
 * accordees, et ce que renvoient les differents chemins vers les Pages.
 */
export async function diagnostiquer(userToken: string) {
  const t = encodeURIComponent(userToken)

  const appels = await Promise.all([
    sonder('me', `${GRAPH}/me?fields=id,name&access_token=${t}`),

    // La question centrale : quelles permissions Meta a-t-il vraiment accordees.
    sonder('me/permissions', `${GRAPH}/me/permissions?access_token=${t}`),

    // Ce que l'application demande aujourd'hui.
    sonder(
      'me/accounts (avec instagram_business_account)',
      `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100&access_token=${t}`,
    ),

    // Les Pages sans filtre : si celle-ci est pleine et la precedente vide,
    // le probleme vient du champ Instagram, pas des Pages.
    sonder('me/accounts (champs minimaux)', `${GRAPH}/me/accounts?fields=id,name&limit=100&access_token=${t}`),

    // Le nouveau parcours Instagram passe parfois par un autre chemin.
    sonder(
      'me/businesses',
      `${GRAPH}/me/businesses?fields=id,name&limit=50&access_token=${t}`,
    ),

    // Jeton Instagram plutot que Facebook : dans ce cas, celui-ci repond.
    sonder(
      'me (Instagram)',
      `https://graph.instagram.com/v21.0/me?fields=id,username&access_token=${t}`,
    ),

    // Nature du jeton : a qui il appartient, et pour quelle application.
    sonder('debug_token', `${GRAPH}/debug_token?input_token=${t}&access_token=${t}`),
  ])

  return {
    date: new Date().toISOString(),
    longueur_jeton: userToken.length,
    appels,
  }
}
