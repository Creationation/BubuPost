// La logique commune a l'ingestion, au moteur de cadence et a l'apercu.
//
// L'apercu doit montrer EXACTEMENT ce que le moteur fera. Deux calculs de
// creneau finiraient par diverger, et l'apercu mentirait au moment precis ou
// on compte dessus. Il n'y a donc qu'une implementation, ici.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

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

export function cleJour(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function minutesDepuisMinuit(hhmm: string): number {
  const [h, m] = (hhmm ?? '').split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export type Creneau = { quand: Date; jour: string }

/**
 * Les prochains creneaux libres d'une marque, dans l'ordre.
 *
 * Un jour porte au maximum la cadence prevue pour ce jour de la semaine. Les
 * publications deja programmees comptent : c'est ce qui evite de remplir deux
 * fois le meme jour a deux passages du moteur.
 *
 * `combien` creneaux sont rendus, ou moins si l'horizon est atteint. Rendre
 * moins que demande est une information : cela veut dire que la cadence ne
 * laisse pas de place, pas que le calcul a echoue.
 */
export function creneauxLibres(
  cadence: Config['cadence'],
  dejaParJour: Record<string, number>,
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

  // Copie locale : on ne modifie pas le compteur de l'appelant, qui peut
  // vouloir rejouer le calcul pour une autre marque.
  const occupe = { ...dejaParJour }

  const jour = new Date(depuis)
  jour.setSeconds(0, 0)

  for (let i = 0; i <= horizonJours && sortie.length < combien; i++) {
    const cible = new Date(jour)
    cible.setDate(cible.getDate() + i)
    if (i > 0) cible.setHours(0, 0, 0, 0)

    const cle = cleJour(cible)
    const plafond = parMarque[JOURS[cible.getDay()]] ?? 0

    while (sortie.length < combien && (occupe[cle] ?? 0) < plafond) {
      const rang = occupe[cle] ?? 0
      // Les publications du jour se repartissent dans la plage autorisee.
      const pas = plafond > 1 ? (fin - debut) / plafond : 0
      const minute = Math.round(debut + pas * rang)

      const quand = new Date(cible)
      quand.setHours(Math.floor(minute / 60), minute % 60, 0, 0)

      // Un creneau deja passe ne sert a rien : on le compte comme occupe et on
      // continue, plutot que de programmer dans le passe.
      if (quand.getTime() <= depuis.getTime()) {
        occupe[cle] = rang + 1
        continue
      }

      sortie.push({ quand, jour: cle })
      occupe[cle] = rang + 1
    }
  }

  return sortie
}

/** Ce qui est deja programme, par jour, pour une marque. */
export async function dejaProgramme(
  db: SupabaseClient,
  marque: string,
): Promise<Record<string, number>> {
  const { data } = await db
    .from('posts')
    .select('campaign_id, scheduled_at, accounts!inner(brand)')
    .in('status', ['a_valider', 'pending', 'processing'])
    .gte('scheduled_at', new Date().toISOString())

  // On compte les CAMPAGNES, pas les publications : la cadence se pense en
  // videos par jour, pas en lignes dans posts.
  const campagnes = new Map<string, string>()
  for (const p of (data ?? []) as Array<{
    campaign_id: string | null
    scheduled_at: string
    accounts: { brand: string }
  }>) {
    if (p.accounts?.brand !== marque) continue
    const cle = p.campaign_id ?? p.scheduled_at
    if (!campagnes.has(cle)) campagnes.set(cle, cleJour(new Date(p.scheduled_at)))
  }

  const parJour: Record<string, number> = {}
  for (const jour of campagnes.values()) parJour[jour] = (parJour[jour] ?? 0) + 1
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
  const bloc = [cta, lien].filter((x) => x && x.trim()).join(' ')
  if (!bloc) return caption
  return position === 'debut' ? `${bloc}\n\n${caption}` : `${caption}\n\n${bloc}`
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

  const generation = await fetch(`${supabaseUrl}/functions/v1/generate-caption`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject: entree.sujet,
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

  const parId = new Map(
    (textes.results as Array<{ id: string; caption: string; hashtags: string[]; title?: string }>)
      .map((r) => [r.id, r]),
  )

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
