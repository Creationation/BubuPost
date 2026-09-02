import { useEffect, useState } from 'react'
import { quotaYoutube, type QuotaYoutube as Quota } from '../lib/api'

/**
 * Etat du quota YouTube, visible en permanence.
 *
 * Six publications par jour consomment 9600 unites sur 10 000. La marge est de
 * 400, soit moins que le cout d'une seule relance : ce chiffre doit rester
 * sous les yeux, pas dormir dans un journal qu'on ne consulte qu'apres coup.
 */
export function QuotaYoutube({ actif }: { actif: boolean }) {
  const [quota, setQuota] = useState<Quota | null>(null)

  useEffect(() => {
    if (!actif) return
    let vivant = true
    quotaYoutube()
      .then((q) => {
        if (vivant) setQuota(q)
      })
      .catch(() => {
        // Le quota est une information de confort : s'il manque, le reste du
        // dashboard doit s'afficher quand meme.
      })
    return () => {
      vivant = false
    }
  }, [actif])

  if (!actif || !quota) return null

  const pourcent = Math.min(100, Math.round((quota.utilise / quota.total) * 100))

  // Le seuil qui compte n'est pas 100 %, c'est le moment ou il ne reste plus
  // de quoi publier une video entiere.
  const ton =
    quota.videosRestantes === 0
      ? { texte: 'text-bad-400', barre: 'bg-bad-400', bord: 'border-bad-600/40 bg-bad-600/5' }
      : quota.videosRestantes <= 1
        ? { texte: 'text-warn-400', barre: 'bg-warn-400', bord: 'border-warn-600/40 bg-warn-600/5' }
        : { texte: 'text-mist-300', barre: 'bg-ok-400', bord: 'border-ink-700 bg-ink-850/40' }

  return (
    <div className={`mb-5 rounded-xl border px-4 py-3 ${ton.bord}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-medium text-mist-100">Quota YouTube du jour</span>
        <span className={`text-sm tabular-nums ${ton.texte}`}>
          {quota.videosRestantes === 0
            ? 'plus de video possible aujourd hui'
            : `${quota.videosRestantes} video${quota.videosRestantes > 1 ? 's' : ''} encore possible${quota.videosRestantes > 1 ? 's' : ''}`}
        </span>
      </div>

      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-800">
        <div className={`h-full rounded-full ${ton.barre}`} style={{ width: `${pourcent}%` }} />
      </div>

      <p className="mt-2 text-xs tabular-nums text-mist-500">
        {quota.utilise} unites sur {quota.total}, il en reste {quota.restant}.
        {quota.restant < quota.coutEnvoi && quota.restant > 0 && (
          <span className="text-warn-400">
            {' '}
            Pas assez pour un envoi, qui en coute {quota.coutEnvoi}.
          </span>
        )}
      </p>

      <p className="mt-1 text-xs text-mist-600">
        Remise a zero a minuit heure du Pacifique, soit 9 h en France. Le quota est partage par
        toutes tes chaines.
      </p>
    </div>
  )
}
