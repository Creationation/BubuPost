import { Link } from 'react-router-dom'
import type { ConfigAuto } from '../lib/automatisation'
import { silenceDepuis } from '../lib/automatisation'
import type { Account, PostWithAccount } from '../lib/types'
import { decrireToken } from '../lib/types'
import type { EtatReserve, SignesDeVie } from '../lib/api'

/**
 * Une chose a faire, ou un etat a connaitre.
 *
 * `action` porte le lien qui la traite : une alerte sans porte de sortie
 * oblige a chercher ou aller, ce qui est exactement le travail qu'on veut
 * eviter.
 */
export type Point = {
  cle: string
  gravite: 'bloquant' | 'attention' | 'info'
  texte: string
  action?: { label: string; vers: string }
}

/**
 * Ce qui demande une action, tout de suite.
 *
 * L'ecran d'accueil comptait des publications. Compter ne dit pas quoi faire :
 * neuf comptes actifs et zero en attente peut vouloir dire que tout va bien,
 * ou que la chaine est arretee depuis trois jours. On liste donc ce qui bloque
 * la chaine, dans l'ordre ou ca la bloque.
 */
export function pointsDAttention({
  comptes,
  posts,
  config,
  reserve,
  ping,
  dossiers,
}: {
  comptes: Account[]
  posts: PostWithAccount[]
  config: ConfigAuto | null
  reserve: EtatReserve[]
  ping: SignesDeVie | null
  dossiers: number
}): Point[] {
  const points: Point[] = []

  // 1. Ce qui empeche toute publication. Rien d'autre ne compte tant que
  //    l'un de ces points tient.
  const enErreur = comptes.filter((c) => c.status === 'error' || c.status === 'expired')
  if (enErreur.length > 0) {
    points.push({
      cle: 'comptes-erreur',
      gravite: 'bloquant',
      texte:
        enErreur.length === 1
          ? `${enErreur[0].account_name} ne peut plus publier`
          : `${enErreur.length} comptes ne peuvent plus publier`,
      action: { label: 'Voir les comptes', vers: '/accounts' },
    })
  }

  const echecs = posts.filter((p) => p.status === 'failed')
  if (echecs.length > 0) {
    points.push({
      cle: 'echecs',
      gravite: 'bloquant',
      texte: `${echecs.length} publication${echecs.length > 1 ? 's' : ''} en echec`,
      action: { label: 'Voir le detail', vers: '/posts' },
    })
  }

  // 2. Ce qui attend une decision.
  const aValider = posts.filter((p) => p.status === 'a_valider')
  if (aValider.length > 0) {
    const campagnes = new Set(aValider.map((p) => p.campaign_id ?? p.id)).size
    points.push({
      cle: 'a-valider',
      gravite: 'attention',
      texte: `${campagnes} campagne${campagnes > 1 ? 's' : ''} attend${campagnes > 1 ? 'ent' : ''} ta validation`,
      action: { label: 'Relire et valider', vers: '/automatisation' },
    })
  }

  // 3. Ce qui va manquer.
  const aSec = reserve.filter((r) => r.reste === 0)
  const basse = reserve.filter((r) => r.reste > 0 && r.reste <= r.seuil)

  if (aSec.length > 0) {
    points.push({
      cle: 'reserve-vide',
      gravite: 'bloquant',
      texte:
        aSec.length === reserve.length
          ? 'Plus aucune video en reserve, les prochains creneaux seront sautes'
          : `${aSec.map((r) => r.marque).join(', ')} n a plus de video en reserve`,
      action: { label: 'Voir la reserve', vers: '/bibliotheque' },
    })
  }
  if (basse.length > 0) {
    points.push({
      cle: 'reserve-basse',
      gravite: 'attention',
      texte: `Reserve basse : ${basse.map((r) => `${r.marque} (${r.reste})`).join(', ')}`,
      action: { label: 'Voir la reserve', vers: '/bibliotheque' },
    })
  }

  // 4. L'automatisation, seulement si elle a ete mise en place. Reprocher a
  //    quelqu'un de ne pas avoir active ce qu'il n'a pas installe serait du
  //    bruit, pas une alerte.
  if (dossiers > 0) {
    if (config && !config.actif) {
      points.push({
        cle: 'auto-suspendue',
        gravite: 'attention',
        texte: 'L automatisation est suspendue, aucune video n est ramassee',
        action: { label: 'Reactiver', vers: '/automatisation' },
      })
    } else if (config && !config.moteur.actif) {
      points.push({
        cle: 'moteur-arrete',
        gravite: 'attention',
        texte: 'Le moteur est arrete : les videos s accumulent sans etre programmees',
        action: { label: 'Le demarrer', vers: '/automatisation' },
      })
    }

    const silence = silenceDepuis(ping?.vu_a ?? null)
    const limite = config?.alerteSilenceHeures || 26
    if (!ping?.vu_a) {
      points.push({
        cle: 'watcher-jamais',
        gravite: 'attention',
        texte: 'Le watcher ne s est jamais manifeste',
        action: { label: 'Comment l installer', vers: '/guide' },
      })
    } else if (silence && silence.heures > limite) {
      points.push({
        cle: 'watcher-muet',
        gravite: 'bloquant',
        texte: `Le watcher n a rien dit depuis ${silence.texte}, PC eteint ou script arrete`,
        action: { label: 'Voir le suivi', vers: '/automatisation' },
      })
    }
  }

  // 5. Les jetons qui demandent une reconnexion a la main. Ceux qui se
  //    renouvellent seuls n'ont rien a faire ici.
  for (const c of comptes) {
    const etat = decrireToken(c)
    if (!etat || etat.ton !== 'bad') continue
    if (enErreur.some((e) => e.id === c.id)) continue
    points.push({
      cle: `token-${c.id}`,
      gravite: 'attention',
      texte: `${c.account_name} : ${etat.texte.toLowerCase()}`,
      action: { label: 'Reconnecter', vers: '/accounts' },
    })
  }

  return points
}

const TONS: Record<Point['gravite'], { bord: string; texte: string; icone: string }> = {
  bloquant: { bord: 'border-bad-600/50 bg-bad-600/10', texte: 'text-bad-400', icone: '✕' },
  attention: { bord: 'border-warn-600/50 bg-warn-600/10', texte: 'text-warn-400', icone: '!' },
  info: { bord: 'border-ink-700 bg-ink-850', texte: 'text-mist-500', icone: '·' },
}

export function ListeAttention({ points, pret = true }: { points: Point[]; pret?: boolean }) {
  // Dire « tout va bien » avant d'avoir regarde serait un mensonge de
  // quelques secondes : on se tait tant que la reserve n'a pas repondu.
  if (points.length === 0 && !pret) return null

  if (points.length === 0) {
    return (
      <div className="panel flex items-center gap-3 p-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-ok-400/40 bg-ok-400/10 text-ok-400">
          ✓
        </span>
        <div>
          <p className="text-sm font-medium">Rien ne demande ton attention</p>
          <p className="text-xs text-mist-500">
            La chaine tourne. Depose des videos, le reste se fait tout seul.
          </p>
        </div>
      </div>
    )
  }

  return (
    <ul className="space-y-2">
      {points.map((p) => {
        const ton = TONS[p.gravite]
        return (
          <li
            key={p.cle}
            className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${ton.bord}`}
          >
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${ton.texte}`}
              aria-hidden="true"
            >
              {ton.icone}
            </span>
            <span className="min-w-0 flex-1 text-sm text-mist-100">{p.texte}</span>
            {p.action && (
              <Link to={p.action.vers} className="btn btn-ghost !py-1 !text-xs">
                {p.action.label}
              </Link>
            )}
          </li>
        )
      })}
    </ul>
  )
}
