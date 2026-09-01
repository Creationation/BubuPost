import { decrireAttente, useSeconde } from '../lib/countdown'
import { POST_STATUS_CLASS, POST_STATUS_ICON, POST_STATUS_LABEL } from '../lib/types'
import { Chip } from './ui'

/**
 * Pastille de statut, animee quand la publication est sur le point de partir.
 *
 * Un post en attente reste sinon parfaitement immobile pendant des heures, et
 * on ne sait pas si le systeme tourne encore ou s'il est plante.
 */
export function BadgeStatut({
  status,
  scheduledAt,
}: {
  status: string
  scheduledAt: string
}) {
  const seconde = useSeconde()
  const etat = decrireAttente(scheduledAt, status, seconde * 1000)
  const classe = POST_STATUS_CLASS[status]

  if (status === 'processing') {
    return (
      <Chip className={classe}>
        <span className="anneau" aria-hidden="true" />
        En cours
      </Chip>
    )
  }

  if (etat.vivant) {
    return (
      <Chip className={classe}>
        <span className="balise" aria-hidden="true" />
        <span className="respire">
          {etat.phase === 'file' ? "File d'attente" : 'Imminent'}
        </span>
      </Chip>
    )
  }

  return (
    <Chip className={classe}>
      {POST_STATUS_ICON[status]} {POST_STATUS_LABEL[status] ?? status}
    </Chip>
  )
}

/** Ligne de compte a rebours, sous une publication en attente. */
export function LigneAttente({
  status,
  scheduledAt,
  className = '',
}: {
  status: string
  scheduledAt: string
  className?: string
}) {
  const seconde = useSeconde()
  const etat = decrireAttente(scheduledAt, status, seconde * 1000)

  if (etat.phase === 'aucune') return null

  const couleur =
    etat.phase === 'traitement'
      ? 'text-idle-400'
      : etat.vivant
        ? 'text-warn-400'
        : 'text-mist-500'

  return (
    <p className={`flex items-center gap-2 text-xs tabular-nums ${couleur} ${className}`}>
      {etat.phase === 'traitement' ? (
        <span className="anneau" aria-hidden="true" />
      ) : etat.vivant ? (
        <span className="balise" aria-hidden="true" />
      ) : (
        <span aria-hidden="true" className="opacity-70">
          ⏱
        </span>
      )}
      <span className={etat.vivant ? 'respire' : undefined}>{etat.label}</span>
    </p>
  )
}

/**
 * Bandeau du dashboard : la prochaine publication a partir, toutes marques
 * confondues. Donne en un coup d'oeil la preuve que le systeme est vivant.
 */
export function ProchainePublication({
  posts,
}: {
  posts: Array<{ id: string; status: string; scheduled_at: string; accounts: { account_name: string } | null }>
}) {
  const seconde = useSeconde()
  const maintenant = seconde * 1000

  const suivante = posts
    .filter((p) => p.status === 'pending' || p.status === 'processing')
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))[0]

  if (!suivante) return null

  const etat = decrireAttente(suivante.scheduled_at, suivante.status, maintenant)
  if (etat.phase === 'aucune') return null

  return (
    <div
      className={`mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-4 py-3 text-sm ${
        etat.vivant
          ? 'border-warn-400/30 bg-warn-400/5 text-warn-400'
          : 'border-ink-700 bg-ink-850/40 text-mist-300'
      }`}
    >
      {etat.phase === 'traitement' ? (
        <span className="anneau" aria-hidden="true" />
      ) : etat.vivant ? (
        <span className="balise" aria-hidden="true" />
      ) : (
        <span aria-hidden="true" className="opacity-70">
          ⏱
        </span>
      )}

      <span className={`font-medium tabular-nums ${etat.vivant ? 'respire' : ''}`}>
        {etat.phase === 'lointain'
          ? `Prochaine publication dans ${etat.label.replace('Publication dans ', '')}`
          : etat.label}
      </span>

      <span className="text-xs opacity-70">
        sur {suivante.accounts?.account_name ?? 'compte supprime'}
      </span>
    </div>
  )
}
