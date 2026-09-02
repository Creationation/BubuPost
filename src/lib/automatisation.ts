/**
 * Les reglages de l'automatisation, cote application.
 *
 * Le watcher local ne connait aucune de ces regles : il les demande a chaque
 * passage. C'est ce qui permet de tout changer ici sans jamais rouvrir le
 * script, et c'est aussi pourquoi la lecture d'un nom de fichier se teste en
 * appelant le serveur plutot qu'en reimplementant la regle ici. Deux analyseurs
 * finiraient par diverger, et le testeur mentirait.
 */
import type { Tables } from './database.types'

export type Dossier = Tables<'watch_folders'>
export type Import = Tables<'imports'>

export type Profil = {
  nom: string
  plateformes: string[]
  comptes: string[]
}

export type Nommage = {
  separateur: string
  ordre: string[]
  surNonConforme: 'rejeter' | 'defauts'
  defauts: { marque: string; langue: string }
}

export type Cadence = {
  parMarque: Record<string, Record<string, number>>
  defaut: Record<string, number>
  plage: { debut: string; fin: string }
  ecartMinutes: number
  afflux: 'etaler' | 'auPlusTot'
}

export type Contenu = {
  /** Variantes d'appel a l'action, par marque puis par plateforme. */
  cta: Record<string, Record<string, string[]>>
  /** Lien de redirection, par marque puis par plateforme. */
  liens: Record<string, Record<string, string>>
  position: 'debut' | 'fin'
}

export type ConfigAuto = {
  actif: boolean
  nommage: Nommage
  profils: Profil[]
  cadence: Cadence
  quotas: { surDepassement: 'reporter' | 'ignorer' }
  validation: { parDefaut: boolean; parMarque: Record<string, boolean> }
  contenu: Contenu
  alerteSilenceHeures: number
}

/** Les champs qu'un nom de fichier peut porter. */
export const CHAMPS_NOM: { cle: string; label: string; aide: string }[] = [
  { cle: 'marque', label: 'Marque', aide: 'EdgeSyncFX, BigBossGrowth, CosmicSucces' },
  { cle: 'sujet', label: 'Sujet', aide: 'Les tirets deviennent des espaces' },
  { cle: 'langue', label: 'Langue', aide: 'fr, en, es...' },
  { cle: 'variante', label: 'Variante', aide: 'Libre, sert a distinguer deux versions' },
]

export const JOURS_CADENCE: { cle: string; label: string }[] = [
  { cle: 'lun', label: 'Lundi' },
  { cle: 'mar', label: 'Mardi' },
  { cle: 'mer', label: 'Mercredi' },
  { cle: 'jeu', label: 'Jeudi' },
  { cle: 'ven', label: 'Vendredi' },
  { cle: 'sam', label: 'Samedi' },
  { cle: 'dim', label: 'Dimanche' },
]

export function configVide(): ConfigAuto {
  return {
    actif: false,
    nommage: {
      separateur: '_',
      ordre: ['marque', 'sujet', 'langue'],
      surNonConforme: 'rejeter',
      defauts: { marque: '', langue: 'fr' },
    },
    profils: [{ nom: 'Tous les comptes', plateformes: [], comptes: [] }],
    cadence: {
      parMarque: {},
      defaut: { lun: 3, mar: 3, mer: 3, jeu: 3, ven: 3, sam: 1, dim: 1 },
      plage: { debut: '09:00', fin: '21:00' },
      ecartMinutes: 15,
      afflux: 'etaler',
    },
    quotas: { surDepassement: 'reporter' },
    validation: { parDefaut: true, parMarque: {} },
    contenu: { cta: {}, liens: {}, position: 'fin' },
    alerteSilenceHeures: 26,
  }
}

/** Complete un enregistrement partiel : aucun champ ne doit rester indefini. */
export function normaliserConfig(brut: unknown): ConfigAuto {
  const v = configVide()
  const c = (brut ?? {}) as Partial<ConfigAuto>

  return {
    actif: c.actif === true,
    nommage: {
      separateur: c.nommage?.separateur || v.nommage.separateur,
      ordre: Array.isArray(c.nommage?.ordre) && c.nommage.ordre.length > 0
        ? c.nommage.ordre
        : v.nommage.ordre,
      surNonConforme: c.nommage?.surNonConforme === 'defauts' ? 'defauts' : 'rejeter',
      defauts: {
        marque: c.nommage?.defauts?.marque ?? '',
        langue: c.nommage?.defauts?.langue || 'fr',
      },
    },
    profils: Array.isArray(c.profils) && c.profils.length > 0
      ? c.profils.map((p) => ({
          nom: String(p.nom ?? ''),
          plateformes: Array.isArray(p.plateformes) ? p.plateformes.map(String) : [],
          comptes: Array.isArray(p.comptes) ? p.comptes.map(String) : [],
        }))
      : v.profils,
    cadence: {
      parMarque: c.cadence?.parMarque ?? {},
      defaut: { ...v.cadence.defaut, ...(c.cadence?.defaut ?? {}) },
      plage: {
        debut: c.cadence?.plage?.debut || v.cadence.plage.debut,
        fin: c.cadence?.plage?.fin || v.cadence.plage.fin,
      },
      ecartMinutes: Number(c.cadence?.ecartMinutes ?? v.cadence.ecartMinutes),
      afflux: c.cadence?.afflux === 'auPlusTot' ? 'auPlusTot' : 'etaler',
    },
    quotas: { surDepassement: c.quotas?.surDepassement === 'ignorer' ? 'ignorer' : 'reporter' },
    validation: {
      parDefaut: c.validation?.parDefaut !== false,
      parMarque: c.validation?.parMarque ?? {},
    },
    contenu: {
      cta: c.contenu?.cta ?? {},
      liens: c.contenu?.liens ?? {},
      position: c.contenu?.position === 'debut' ? 'debut' : 'fin',
    },
    alerteSilenceHeures: Number(c.alerteSilenceHeures ?? v.alerteSilenceHeures),
  }
}

/** Un exemple de nom, construit depuis la regle en cours. */
export function exempleNom(nommage: Nommage): string {
  const exemples: Record<string, string> = {
    marque: 'EdgeSyncFX',
    sujet: 'stop-loss-trop-serre',
    langue: 'fr',
    variante: 'v2',
  }
  return nommage.ordre.map((c) => exemples[c] ?? c).join(nommage.separateur || '_') + '.mp4'
}

/** Depuis combien de temps le watcher n'a pas donne signe de vie. */
export function silenceDepuis(vuA: string | null): { heures: number; texte: string } | null {
  if (!vuA) return null
  const ms = Date.now() - new Date(vuA).getTime()
  const heures = ms / 3_600_000

  if (heures < 1) return { heures, texte: `il y a ${Math.max(1, Math.round(ms / 60_000))} min` }
  if (heures < 48) return { heures, texte: `il y a ${Math.round(heures)} h` }
  return { heures, texte: `il y a ${Math.round(heures / 24)} jours` }
}
