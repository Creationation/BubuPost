import type { PostWithAccount } from './types'

export type Vue = 'mois' | 'semaine' | 'jour'

/** Cle d'un jour en heure locale. Jamais toISOString, qui decale en UTC. */
export function cleJour(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  const p = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
}

export function memeJour(a: Date, b: Date): boolean {
  return cleJour(a) === cleJour(b)
}

export function debutDeJour(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

/** Lundi de la semaine contenant d. */
export function debutDeSemaine(d: Date): Date {
  const x = debutDeJour(d)
  // getDay() renvoie 0 pour dimanche : on ramene la semaine au lundi.
  const decalage = (x.getDay() + 6) % 7
  x.setDate(x.getDate() - decalage)
  return x
}

export function ajouterJours(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

export function ajouterMois(d: Date, n: number): Date {
  const x = new Date(d)
  // On se place au 1er avant de decaler : sinon le 31 janvier plus un mois
  // donnerait le 3 mars, Fevrier n'ayant pas de 31.
  x.setDate(1)
  x.setMonth(x.getMonth() + n)
  return x
}

/**
 * Les six semaines affichees pour un mois.
 * Toujours 42 cases : une hauteur de grille qui change d'un mois a l'autre
 * fait sauter toute la page a chaque navigation.
 */
export function grilleDuMois(reference: Date): Date[] {
  const premier = new Date(reference.getFullYear(), reference.getMonth(), 1)
  const depart = debutDeSemaine(premier)
  return Array.from({ length: 42 }, (_, i) => ajouterJours(depart, i))
}

export function grilleDeSemaine(reference: Date): Date[] {
  const depart = debutDeSemaine(reference)
  return Array.from({ length: 7 }, (_, i) => ajouterJours(depart, i))
}

const MOIS = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' })
const JOUR_LONG = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})
const JOUR_COURT = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric' })
const HEURE = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })

export const formatMois = (d: Date) => MOIS.format(d)
export const formatJourLong = (d: Date) => JOUR_LONG.format(d)
export const formatJourCourt = (d: Date) => JOUR_COURT.format(d)
export const formatHeure = (d: Date | string) =>
  HEURE.format(typeof d === 'string' ? new Date(d) : d)

export const JOURS_SEMAINE = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim']

/** Regroupe les publications par jour, une seule passe. */
export function parJour(posts: PostWithAccount[]): Map<string, PostWithAccount[]> {
  const map = new Map<string, PostWithAccount[]>()
  for (const post of posts) {
    const cle = cleJour(post.scheduled_at)
    const liste = map.get(cle)
    if (liste) liste.push(post)
    else map.set(cle, [post])
  }
  for (const liste of map.values()) {
    liste.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
  }
  return map
}

/**
 * Une couleur stable par campagne.
 *
 * Neuf publications d'une meme video doivent se reconnaitre d'un coup d'oeil
 * au milieu de trente-trois. La couleur vient de l'identifiant, donc elle ne
 * change pas d'un rendu a l'autre ni d'un jour a l'autre.
 */
export type Teinte = { bord: string; texte: string }

// Le marqueur double la couleur : sur un ecran mal regle, ou pour un oeil qui
// distingue mal le violet du bleu, la bordure seule ne suffit pas.
const TEINTES: Teinte[] = [
  { bord: 'border-l-brand-400', texte: 'text-brand-400' },
  { bord: 'border-l-ok-400', texte: 'text-ok-400' },
  { bord: 'border-l-warn-400', texte: 'text-warn-400' },
  { bord: 'border-l-idle-400', texte: 'text-idle-400' },
  { bord: 'border-l-bad-400', texte: 'text-bad-400' },
  { bord: 'border-l-mist-300', texte: 'text-mist-300' },
]

const SANS_CAMPAGNE: Teinte = { bord: 'border-l-ink-600', texte: 'text-mist-600' }

export function couleurCampagne(campaignId: string | null): Teinte {
  if (!campaignId) return SANS_CAMPAGNE
  let somme = 0
  for (let i = 0; i < campaignId.length; i++) somme = (somme * 31 + campaignId.charCodeAt(i)) >>> 0
  return TEINTES[somme % TEINTES.length]
}

/** Limites par plateforme sur 24 h, pour signaler un jour trop charge. */
export type Limites = Record<string, number>

export const LIMITES_DEFAUT: Limites = {
  instagram: 25,
  facebook: 25,
  threads: 250,
  youtube: 6,
  tiktok: 15,
}

export type Depassement = { platform: string; prevues: number; limite: number }

/**
 * Les plateformes dont le jour depasse leur limite.
 *
 * YouTube compte a part : sa limite est un quota d'API partage par TOUTES les
 * chaines, pas une limite par compte. Trente-trois publications reparties sur
 * onze comptes peuvent donc passer partout sauf la.
 */
export function depassements(
  postsDuJour: PostWithAccount[],
  limites: Limites = LIMITES_DEFAUT,
): Depassement[] {
  const parPlateforme = new Map<string, number>()
  const parCompte = new Map<string, { platform: string; n: number }>()

  for (const post of postsDuJour) {
    if (post.status === 'cancelled' || post.status === 'failed') continue
    const platform = post.accounts?.platform
    if (!platform) continue

    parPlateforme.set(platform, (parPlateforme.get(platform) ?? 0) + 1)

    const cle = post.account_id
    const actuel = parCompte.get(cle)
    if (actuel) actuel.n += 1
    else parCompte.set(cle, { platform, n: 1 })
  }

  const sortie: Depassement[] = []

  // YouTube : quota global, toutes chaines confondues.
  const yt = parPlateforme.get('youtube') ?? 0
  if (yt > (limites.youtube ?? 6)) {
    sortie.push({ platform: 'youtube', prevues: yt, limite: limites.youtube ?? 6 })
  }

  // Les autres : la limite s'applique par compte.
  for (const { platform, n } of parCompte.values()) {
    if (platform === 'youtube') continue
    const limite = limites[platform]
    if (limite && n > limite) {
      const deja = sortie.find((d) => d.platform === platform)
      if (deja) deja.prevues = Math.max(deja.prevues, n)
      else sortie.push({ platform, prevues: n, limite })
    }
  }

  return sortie
}

/** Position verticale d'une heure, en pourcentage de la journee. */
export function positionDansJour(iso: string): number {
  const d = new Date(iso)
  return ((d.getHours() * 60 + d.getMinutes()) / 1440) * 100
}

/** Un post est deplacable tant qu'il n'est pas parti. */
export function deplacable(status: string): boolean {
  return status === 'pending' || status === 'failed' || status === 'cancelled'
}

/** Pourquoi un post ne peut pas etre deplace, en clair. */
export function raisonNonDeplacable(status: string): string {
  if (status === 'published') return 'Deja publiee, elle ne peut plus etre deplacee.'
  if (status === 'processing') return "Envoi en cours vers la plateforme, trop tard pour la deplacer."
  return 'Cette publication ne peut pas etre deplacee.'
}
