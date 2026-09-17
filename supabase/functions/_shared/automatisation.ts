// La logique commune a l'ingestion, au moteur de cadence et a l'apercu.
//
// L'apercu doit montrer EXACTEMENT ce que le moteur fera. Deux calculs de
// creneau finiraient par diverger, et l'apercu mentirait au moment precis ou
// on compte dessus. Il n'y a donc qu'une implementation, ici.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { decrireMetriques, type Metriques } from './metriques.ts'

export const JOURS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam']

/** Cout d'un envoi YouTube en unites de quota, et le plafond quotidien. */
export const COUT_YOUTUBE = 1600
export const QUOTA_YOUTUBE = 10_000

export type Profil = { nom: string; plateformes?: string[]; comptes?: string[] }

export type Config = {
  actif: boolean
  nommage: {
    separateur: string
    ordre: string[]
    surNonConforme: 'rejeter' | 'defauts'
    defauts: { marque: string; langue: string }
    /** Codes acceptes dans un nom de fichier. Le reste est mis de cote. */
    languesReconnues?: string[]
  }
  profils: Profil[]
  cadence: {
    parMarque: Record<string, Record<string, number>>
    defaut: Record<string, number>
    plage: { debut: string; fin: string }
    ecartMinutes: number
    afflux: 'etaler' | 'auPlusTot'
  }
  quotas: { surDepassement: 'reporter' | 'ignorer' }
  validation: { parDefaut: boolean; parMarque: Record<string, boolean> }
  contenu: {
    cta: Record<string, Record<string, string[]>>
    liens: Record<string, Record<string, string>>
    position: 'debut' | 'fin'
  }
  moteur: { actif: boolean; horizonJours: number }
  reserve: { seuilParDefaut: number; seuilParMarque: Record<string, number> }
  alerteSilenceHeures: number
}

export type Compte = {
  id: string
  platform: string
  brand: string
  account_name: string
  language: string | null
  status: string
}

export type EntreeBibliotheque = {
  id: string
  video_url: string
  fichier: string
  marque: string
  sujet: string
  langue: string | null
  profil: string | null
  rang: number
  prioritaire: boolean
  statut: string
  /** Ce qui a ete lu sur la derniere image de la video, si on l a. */
  metriques?: Metriques | null
}

// ---------------------------------------------------------------------------
// Lecture du nom de fichier
// ---------------------------------------------------------------------------

export type Lecture = {
  marque: string
  sujet: string
  langue: string
  variante: string
  conforme: boolean
  manquants: string[]
}

/** Les creneaux reconnus dans un nom de sous-dossier, et leur libelle. */
const CRENEAUX: Record<string, string> = {
  matin: 'du matin',
  apres_midi: "de l'apres-midi",
  midi: 'du midi',
  soir: 'du soir',
  nuit: 'de la nuit',
}

const MOIS = [
  'janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre',
]

export type LectureChemin = {
  date: string | null
  /** Cle brute du creneau : matin, apres_midi, soir... */
  creneau: string | null
  /** Rang du creneau dans la journee, tire du prefixe numerique. */
  rang: number
  dateLisible: string
  creneauLisible: string
}

/**
 * Ce qu'on tire d'un chemin du type DDMMYYYY/N_creneau/fichier.mp4
 *
 * C'est la forme produite par TradeReels : un dossier par jour, trois
 * sous-dossiers par moment de la journee, et un nom de fichier qui ne fait que
 * repeter les deux. L'information est donc dans le chemin, pas dans le nom.
 *
 * Le prefixe numerique du creneau (1_, 2_, 3_) donne l'ordre de la journee,
 * ce qui evite de le deviner a partir du libelle.
 */
export function lireChemin(cheminRelatif: string): LectureChemin {
  const parties = cheminRelatif.split(/[\\/]+/).filter(Boolean)

  let date: string | null = null
  let creneau: string | null = null
  let rang = 0

  for (const partie of parties) {
    // DDMMYYYY, huit chiffres. On refuse une date impossible plutot que de la
    // corriger en silence : un dossier mal nomme doit se voir.
    const jour = partie.match(/^(\d{2})(\d{2})(\d{4})$/)
    if (jour && !date) {
      const [, d, m, a] = jour
      const nd = Number(d)
      const nm = Number(m)
      if (nd >= 1 && nd <= 31 && nm >= 1 && nm <= 12) date = `${a}-${m}-${d}`
      continue
    }

    const moment = partie.match(/^(\d+)[_-](.+)$/)
    if (moment && !creneau) {
      rang = Number(moment[1])
      creneau = moment[2].toLowerCase()
    }
  }

  const dateLisible = date
    ? (() => {
        const [a, m, d] = date.split('-')
        return `${Number(d)} ${MOIS[Number(m) - 1]} ${a}`
      })()
    : ''

  return {
    date,
    creneau,
    rang,
    dateLisible,
    creneauLisible: creneau ? (CRENEAUX[creneau] ?? creneau.replace(/_/g, ' ')) : '',
  }
}

/**
 * Ce chemin precede-t-il le point de depart ?
 *
 * Inclusif : la journee designee est traitee, celles d'avant sont ignorees.
 * Un chemin sans date lisible n'est jamais ignore : mieux vaut le voir arriver
 * et le refuser franchement que le faire disparaitre en silence.
 */
export function avantLeDepart(cheminRelatif: string, depuis: string | null): boolean {
  if (!depuis) return false
  const lu = lireChemin(cheminRelatif)
  if (!lu.date) return false
  return lu.date < depuis
}

/**
 * Le rang d'une video dont le chemin porte une date.
 *
 * Sans lui, la file suivrait l'ordre de ramassage du disque, qui est
 * alphabetique : JJMMAAAA place « 01072026 » (1er juillet) avant « 26062026 »
 * (26 juin). On publierait donc juillet avant juin, ce qui n'a aucun sens sur
 * un rattrapage d'archive.
 *
 * Le rang vaut le jour depuis 1970, multiplie par dix pour laisser la place
 * aux creneaux de la journee. Il est donc chronologique par construction,
 * quel que soit l'ordre dans lequel les fichiers sont vus.
 */
export function rangChronologique(lu: LectureChemin): number | null {
  if (!lu.date) return null
  const jours = Math.floor(new Date(`${lu.date}T00:00:00Z`).getTime() / 86_400_000)
  return jours * 10 + (lu.rang || 0)
}

/**
 * Le sujet, a partir d'un modele et de ce que le chemin a livre.
 *
 * Le modele appartient au dossier surveille : c'est lui qui sait de quoi
 * parlent ses videos. Le chemin ne fournit qu'une date et un moment.
 */
export function sujetDepuisChemin(modele: string, lu: LectureChemin): string {
  return (modele || 'Seance du {date}, {creneau}')
    .replace(/\{date\}/g, lu.dateLisible || 'ce jour')
    .replace(/\{creneau\}/g, lu.creneauLisible || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .trim()
}

/**
 * Ramene une marque lue dans un nom de fichier a sa forme exacte.
 *
 * Les comptes portent « EdgeSyncFX ». Un fichier nomme « edgesyncfx_... » doit
 * marcher : personne ne respecte la casse en nommant un fichier a la volee, et
 * une comparaison stricte donnerait « aucun compte actif pour edgesyncfx »,
 * message d'autant plus deroutant que la marque a l'air correcte.
 *
 * Renvoie null si aucune marque connue ne correspond.
 */
export function marqueCanonique(lue: string, connues: string[]): string | null {
  const cible = lue.trim().toLowerCase()
  if (!cible) return null
  return connues.find((m) => m.toLowerCase() === cible) ?? null
}

/**
 * Ce qu'on tire d'un nom de fichier.
 *
 * Le sujet remplace les tirets par des espaces : « stop-loss-trop-serre » se
 * lit « stop loss trop serre », donc utilisable tel quel par la generation.
 */
export function lireNom(nom: string, nommage: Config['nommage']): Lecture {
  const sansExtension = nom.replace(/\.[^.]+$/, '')
  const sep = nommage.separateur || '_'
  const morceaux = sansExtension.split(sep).map((m) => m.trim()).filter(Boolean)

  const lu: Record<string, string> = {}
  nommage.ordre.forEach((champ, i) => {
    if (morceaux[i]) lu[champ] = morceaux[i]
  })

  const manquants = nommage.ordre.filter((champ) => !lu[champ])

  return {
    marque: lu.marque ?? '',
    sujet: (lu.sujet ?? '').replace(/[-+]/g, ' ').trim(),
    langue: (lu.langue ?? '').toLowerCase(),
    variante: lu.variante ?? '',
    conforme: manquants.length === 0,
    manquants,
  }
}

// ---------------------------------------------------------------------------
// Ciblage
// ---------------------------------------------------------------------------

/**
 * Les comptes vises pour une marque, selon le profil demande.
 *
 * Un profil sans plateforme ni compte precis vaut « tous les comptes de la
 * marque ». Les comptes nommes l'emportent sur le filtre de plateforme : c'est
 * ce qui permet un profil « test sur un seul compte ».
 */
export function ciblesPour(comptes: Compte[], marque: string, profil: Profil | null): Compte[] {
  // Comparaison insensible a la casse : la marque a normalement deja ete
  // ramenee a sa forme exacte, mais une entree de bibliotheque corrigee a la
  // main peut encore porter une casse differente.
  const cible = marque.toLowerCase()
  const actifs = comptes.filter((c) => c.brand.toLowerCase() === cible && c.status === 'active')
  if (!profil) return actifs

  if (profil.comptes && profil.comptes.length > 0) {
    return actifs.filter((c) => profil.comptes!.includes(c.id))
  }
  if (profil.plateformes && profil.plateformes.length > 0) {
    return actifs.filter((c) => profil.plateformes!.includes(c.platform))
  }
  return actifs
}

// ---------------------------------------------------------------------------
// Creneaux
// ---------------------------------------------------------------------------

/**
 * Le fuseau dans lequel la cadence se pense.
 *
 * Le serveur tourne en UTC. Sans cette conversion, « de 9h a 21h » voulait
 * dire 11h a 23h en France, et un dimanche commencait a 2h du matin. Les
 * heures saisies dans l'application sont celles de Diego, pas du serveur.
 */
export const FUSEAU = 'Europe/Paris'

type Civil = { annee: number; mois: number; jour: number; heure: number; minute: number; jourSemaine: number }

const FORMAT_CIVIL = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSEAU,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
})

const INDEX_JOUR: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** Un instant, lu comme une date et une heure civiles de Paris. */
export function civil(d: Date): Civil {
  const parts: Record<string, string> = {}
  for (const p of FORMAT_CIVIL.formatToParts(d)) parts[p.type] = p.value
  return {
    annee: Number(parts.year),
    mois: Number(parts.month),
    jour: Number(parts.day),
    heure: Number(parts.hour),
    minute: Number(parts.minute),
    jourSemaine: INDEX_JOUR[parts.weekday] ?? 0,
  }
}

/**
 * L'instant correspondant a une date et une heure civiles de Paris.
 *
 * On part de la meme heure en UTC, on mesure de combien Paris s'en ecarte a
 * cet instant, et on corrige. Une seconde passe rattrape le cas ou la
 * correction traverse un changement d'heure.
 */
export function instant(annee: number, mois: number, jour: number, heure: number, minute: number): Date {
  let devine = Date.UTC(annee, mois - 1, jour, heure, minute)
  for (let i = 0; i < 2; i++) {
    const c = civil(new Date(devine))
    const vu = Date.UTC(c.annee, c.mois - 1, c.jour, c.heure, c.minute)
    const voulu = Date.UTC(annee, mois - 1, jour, heure, minute)
    if (vu === voulu) break
    devine += voulu - vu
  }
  return new Date(devine)
}

/** Le jour civil de Paris, au format AAAA-MM-JJ. */
export function cleJour(d: Date): string {
  const c = civil(d)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${c.annee}-${p(c.mois)}-${p(c.jour)}`
}

function minutesDepuisMinuit(hhmm: string): number {
  const [h, m] = (hhmm ?? '').split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export type Creneau = { quand: Date; jour: string }

/** Par jour civil de Paris, les instants (ms) ou une campagne commence deja. */
export type Occupation = Record<string, number[]>

/**
 * Deux campagnes sont « au meme creneau » si elles commencent a moins d une
 * demi-heure l une de l autre. Une campagne posee a la main a 9h10 occupe
 * le creneau de 9h, elle ne s y ajoute pas.
 */
const MEME_CRENEAU_MS = 30 * 60_000

/**
 * Les prochains creneaux libres d'une marque, dans l'ordre.
 *
 * Un jour porte au maximum la cadence prevue pour ce jour de la semaine, et
 * chaque creneau a une HEURE : 9h, 13h, 17h pour trois par jour. Un creneau
 * est libre si son heure n est pas passee, si rien n y commence deja, et si
 * le jour n a pas atteint son plafond, campagnes parties comprises.
 *
 * Compter au lieu de nommer les heures a fait publier trois videos a 17h :
 * la campagne de 9h, partie, ne comptait plus, et celle de 17h comptait pour
 * la place de 13h. Voir le 15 septembre 2026.
 *
 * `combien` creneaux sont rendus, ou moins si l'horizon est atteint. Rendre
 * moins que demande est une information : cela veut dire que la cadence ne
 * laisse pas de place, pas que le calcul a echoue.
 */
export function creneauxLibres(
  cadence: Config['cadence'],
  deja: Occupation,
  marque: string,
  depuis: Date,
  combien: number,
  horizonJours: number,
): Creneau[] {
  const sortie: Creneau[] = []
  if (combien <= 0) return sortie

  const parMarque = cadence.parMarque?.[marque] ?? cadence.defaut ?? {}
  const debut = minutesDepuisMinuit(cadence.plage?.debut ?? '09:00')
  const fin = minutesDepuisMinuit(cadence.plage?.fin ?? '21:00')

  // Copie locale : on ne modifie pas l occupation de l'appelant, qui peut
  // vouloir rejouer le calcul pour une autre marque.
  const occupe: Occupation = {}
  for (const [jour, instants] of Object.entries(deja)) occupe[jour] = [...instants]

  // Le point de depart, en date civile de Paris. Les jours suivants
  // s'obtiennent en avancant cette date, pas l'instant : un jour civil ne
  // fait pas toujours vingt-quatre heures.
  const origine = civil(depuis)

  for (let i = 0; i <= horizonJours && sortie.length < combien; i++) {
    const minuit = instant(origine.annee, origine.mois, origine.jour + i, 0, 0)
    const cible = civil(minuit)

    const cle = cleJour(minuit)
    const plafond = parMarque[JOURS[cible.jourSemaine]] ?? 0
    if (plafond <= 0) continue

    const pris = occupe[cle] ?? (occupe[cle] = [])
    // Les publications du jour se repartissent dans la plage autorisee.
    const pas = plafond > 1 ? (fin - debut) / plafond : 0

    for (let rang = 0; rang < plafond && sortie.length < combien; rang++) {
      if (pris.length >= plafond) break

      const minute = Math.round(debut + pas * rang)
      const quand = instant(cible.annee, cible.mois, cible.jour, Math.floor(minute / 60), minute % 60)

      // Un creneau passe ne sert a rien : on ne programme pas dans le passe.
      if (quand.getTime() <= depuis.getTime()) continue
      // Une campagne y commence deja, partie ou non : il est pris.
      if (pris.some((t) => Math.abs(t - quand.getTime()) < MEME_CRENEAU_MS)) continue

      sortie.push({ quand, jour: cle })
      pris.push(quand.getTime())
    }
  }

  return sortie
}

/**
 * Ce qui occupe deja les jours a venir, pour une marque : par jour civil, les
 * instants ou une campagne commence.
 *
 * Tous les statuts comptent sauf annule. Une campagne PARTIE occupe toujours
 * son creneau : ne compter que ce qui reste a venir faisait croire, a 9h30,
 * que le jour n avait plus qu une campagne. Et on part du debut de la
 * journee, pas de maintenant, pour la meme raison.
 */
export async function dejaProgramme(
  db: SupabaseClient,
  marque: string,
): Promise<Occupation> {
  const c = civil(new Date())
  const debutDuJour = instant(c.annee, c.mois, c.jour, 0, 0)

  const { data } = await db
    .from('posts')
    .select('campaign_id, scheduled_at, accounts!inner(brand)')
    .neq('status', 'cancelled')
    .gte('scheduled_at', debutDuJour.toISOString())

  // On compte les CAMPAGNES, pas les publications : la cadence se pense en
  // videos par jour, pas en lignes dans posts. Le debut d une campagne est
  // sa premiere publication.
  const campagnes = new Map<string, number>()
  for (const p of (data ?? []) as unknown as Array<{
    campaign_id: string | null
    scheduled_at: string
    accounts: { brand: string }
  }>) {
    if (p.accounts?.brand !== marque) continue
    const cle = p.campaign_id ?? p.scheduled_at
    const t = new Date(p.scheduled_at).getTime()
    const actuel = campagnes.get(cle)
    if (actuel === undefined || t < actuel) campagnes.set(cle, t)
  }

  const parJour: Occupation = {}
  for (const t of campagnes.values()) {
    const jour = cleJour(new Date(t))
    ;(parJour[jour] ?? (parJour[jour] = [])).push(t)
  }
  return parJour
}

// ---------------------------------------------------------------------------
// Contenu
// ---------------------------------------------------------------------------

/**
 * L'appel a l'action a employer, en alternant entre les variantes.
 *
 * L'alternance suit un rang croissant : deux campagnes de suite ne se
 * terminent donc pas par la meme phrase, ce qui se verrait.
 */
export function choisirCta(
  contenu: Config['contenu'],
  marque: string,
  platform: string,
  rang: number,
): string {
  const variantes = contenu?.cta?.[marque]?.[platform] ?? []
  if (variantes.length === 0) return ''
  return variantes[rang % variantes.length]
}

/** Assemble le texte final : legende, appel a l'action, lien. */
export function assembler(
  caption: string,
  cta: string,
  lien: string,
  position: 'debut' | 'fin',
): string {
  // Le lien ne s'ajoute que s'il apporte quelque chose. Beaucoup d'appels a
  // l'action le portent deja (« link in bio », « edgesyncfx.app ») : le
  // repeter donnait « Link in bio Link in bio » en fin de texte.
  const nu = lienNu(lien)
  const dejaLa = (x: string) => nu !== '' && x.toLowerCase().includes(nu)
  const lienUtile =
    nu && !dejaLa(cta) && !dejaLa(caption) && !memeIdee(cta, lien) ? lien : ''

  // Chacun sur sa ligne : colles par une espace, « Comment GO and I'll send
  // you access Link in bio » se lisait comme une seule phrase bancale.
  const bloc = [cta, lienUtile].filter((x) => x && x.trim()).join('\n')
  if (!bloc) return caption
  return position === 'debut' ? `${bloc}\n\n${caption}` : `${caption}\n\n${bloc}`
}

/**
 * Un lien qui n'est pas une adresse (« Link in bio ») dit ou aller. Si
 * l'appel a l'action parle deja de cet endroit (« the system I use is in
 * the bio »), le repeter n'ajoute rien. On regarde le dernier mot du lien.
 */
function memeIdee(cta: string, lien: string): boolean {
  if (/\./.test(lien)) return false
  const mots = lien.trim().toLowerCase().split(/\s+/)
  const dernier = mots[mots.length - 1]
  if (!dernier || dernier.length < 3) return false
  return new RegExp(`\\b${dernier}\\b`, 'i').test(cta)
}

/** Un lien tel qu'on le reconnait dans un texte : sans protocole ni casse. */
function lienNu(lien: string): string {
  return (lien ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
}

// ---------------------------------------------------------------------------
// Quotas
// ---------------------------------------------------------------------------

/**
 * Ce qui reste possible aujourd'hui sur une plateforme.
 *
 * YouTube compte a part : son quota est celui du projet Google, partage par
 * toutes les chaines. Les autres se comptent par compte sur 24 h glissantes.
 */
export async function placeRestante(
  db: SupabaseClient,
  platform: string,
  accountId: string,
  limites: Record<string, number>,
): Promise<number> {
  if (platform === 'youtube') {
    const { data } = await db.rpc('quota_du_jour', { p_platform: 'youtube' })
    return Math.floor((QUOTA_YOUTUBE - Number(data ?? 0)) / COUT_YOUTUBE)
  }

  const depuis = new Date(Date.now() - 86_400_000).toISOString()
  const { count } = await db
    .from('posts')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .in('status', ['pending', 'processing', 'published'])
    .gte('scheduled_at', depuis)

  return (limites[platform] ?? 25) - (count ?? 0)
}

// ---------------------------------------------------------------------------
// Creation d'une campagne depuis une entree de bibliotheque
// ---------------------------------------------------------------------------

export type Resultat = {
  ok: boolean
  campaign_id?: string
  publications?: number
  premiere?: string
  a_valider?: boolean
  avertissements?: string[]
  erreur?: string
}

/**
 * Ecrit la campagne d'une video, a un creneau donne.
 *
 * Le creneau est fourni par l'appelant : c'est le moteur qui decide QUAND,
 * cette fonction decide seulement COMMENT.
 */
export type TexteGenere = { id: string; caption: string; hashtags: string[]; title?: string }

/**
 * Les textes d une video pour un jeu de comptes, en UN appel.
 *
 * Les chiffres lus en fin de video partent avec le sujet : c est ce qui
 * permet au texte de citer un profit ou un drawdown vrai au lieu d une
 * formule.
 */
export async function genererTextes(
  supabaseUrl: string,
  serviceKey: string,
  entree: EntreeBibliotheque,
  cibles: Compte[],
): Promise<{ ok: true; parId: Map<string, TexteGenere> } | { ok: false; erreur: string }> {
  const langueDe = (c: Compte) => entree.langue || c.language || 'fr'

  const generation = await fetch(`${supabaseUrl}/functions/v1/generate-caption`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject: entree.sujet,
      donnees: decrireMetriques(entree.metriques),
      targets: cibles.map((c) => ({
        id: c.id,
        platform: c.platform,
        brand: c.brand,
        account_name: c.account_name,
        language: langueDe(c),
        youtube_type: c.platform === 'youtube' ? 'short' : undefined,
      })),
    }),
  })

  const textes = await generation.json().catch(() => ({}))
  if (!generation.ok || !Array.isArray(textes.results)) {
    return { ok: false, erreur: `Generation impossible : ${textes.error ?? generation.status}` }
  }

  return {
    ok: true,
    parId: new Map((textes.results as TexteGenere[]).map((r) => [r.id, r])),
  }
}

export async function creerCampagne(
  db: SupabaseClient,
  supabaseUrl: string,
  serviceKey: string,
  entree: EntreeBibliotheque,
  config: Config,
  depart: Date,
): Promise<Resultat> {
  const { data: comptes } = await db
    .from('accounts')
    .select('id, platform, brand, account_name, language, status')

  const profil = config.profils?.find((p) => p.nom === entree.profil) ?? null
  let cibles = ciblesPour((comptes ?? []) as Compte[], entree.marque, profil)

  if (cibles.length === 0) {
    return { ok: false, erreur: `Aucun compte actif pour ${entree.marque}` }
  }

  const { data: reglages } = await db
    .from('app_settings')
    .select('value')
    .eq('key', 'limits')
    .single()
  const limites = (reglages?.value ?? {}) as Record<string, number>

  const avertissements: string[] = []
  const retenues: Compte[] = []

  for (const c of cibles) {
    if ((await placeRestante(db, c.platform, c.id, limites)) > 0) {
      retenues.push(c)
      continue
    }
    if (config.quotas?.surDepassement === 'ignorer') {
      avertissements.push(`${c.account_name} (${c.platform}) ecarte, quota atteint`)
    } else {
      retenues.push(c)
      avertissements.push(`${c.account_name} (${c.platform}) au quota, reporte`)
    }
  }
  cibles = retenues

  if (cibles.length === 0) {
    return { ok: false, erreur: 'Toutes les plateformes sont au quota' }
  }

  const langueDe = (c: Compte) => entree.langue || c.language || 'fr'

  const generes = await genererTextes(supabaseUrl, serviceKey, entree, cibles)
  if (!generes.ok) return { ok: false, erreur: generes.erreur }
  const parId = generes.parId

  const { count: rang } = await db
    .from('posts')
    .select('id', { count: 'exact', head: true })
    .not('campaign_id', 'is', null)

  const validation =
    config.validation?.parMarque?.[entree.marque] ?? config.validation?.parDefaut ?? true

  const campaignId = crypto.randomUUID()
  const ecart = config.cadence?.ecartMinutes ?? 15

  const lignes = cibles.map((c, i) => {
    const texte = parId.get(c.id)
    const cta = choisirCta(config.contenu, entree.marque, c.platform, (rang ?? 0) + i)
    const lien = config.contenu?.liens?.[entree.marque]?.[c.platform] ?? ''

    return {
      campaign_id: campaignId,
      account_id: c.id,
      video_url: entree.video_url,
      caption: assembler(texte?.caption ?? '', cta, lien, config.contenu?.position ?? 'fin'),
      hashtags: texte?.hashtags?.length ? texte.hashtags : null,
      title: c.platform === 'youtube' ? (texte?.title ?? null) : null,
      youtube_type: c.platform === 'youtube' ? 'short' : null,
      language: langueDe(c),
      scheduled_at: new Date(depart.getTime() + i * ecart * 60_000).toISOString(),
      status: validation ? 'a_valider' : 'pending',
    }
  })

  const { data: crees, error } = await db.from('posts').insert(lignes).select('id')
  if (error) return { ok: false, erreur: error.message }

  return {
    ok: true,
    campaign_id: campaignId,
    publications: crees?.length ?? 0,
    premiere: depart.toISOString(),
    a_valider: validation,
    avertissements,
  }
}
