import { useEffect, useMemo, useState } from 'react'
import { Modal } from './ui'
import { formatDateTime, toLocalInput, fromLocalInput } from '../lib/format'
import {
  decrireMode,
  planifier,
  type ModeReprise,
  type Reprise,
} from '../lib/reprogrammer'
import { PLATFORM_ICON, type PostWithAccount } from '../lib/types'

const MODES: { cle: ModeReprise; label: string }[] = [
  { cle: 'maintenant', label: 'Tout de suite' },
  { cle: 'dans30', label: 'Dans 30 minutes' },
  { cle: 'dans2h', label: 'Dans 2 heures' },
  { cle: 'demain', label: 'Demain a 9 h' },
  { cle: 'choisi', label: 'A l heure que je choisis' },
  { cle: 'hasard', label: 'Au hasard, etalees' },
]

const FENETRES = [2, 3, 6, 12]

/**
 * Choisir quand repartent des publications qui ne sont pas passees.
 *
 * Le bouton Reprogrammer les relancait au prochain passage, toutes ensemble :
 * la meme video repartait sur trois comptes a la meme minute, ce qui est
 * exactement ce qu'une plateforme regarde de travers. On choisit donc l'heure,
 * et on voit le resultat avant de valider.
 */
export default function Reprogrammer({
  posts,
  onClose,
  onConfirm,
}: {
  posts: PostWithAccount[]
  onClose: () => void
  onConfirm: (reprises: Reprise[]) => void
}) {
  const [mode, setMode] = useState<ModeReprise>('dans30')
  const [choisi, setChoisi] = useState('')
  const [fenetre, setFenetre] = useState(3)
  // Un tirage au sort ne doit pas changer a chaque rendu : ce qui est montre
  // est ce qui sera ecrit.
  const [tirage, setTirage] = useState(0)

  const ids = useMemo(() => posts.map((p) => p.id), [posts])

  useEffect(() => {
    if (posts.length === 0) return
    const d = new Date()
    d.setMinutes(d.getMinutes() + 30, 0, 0)
    setChoisi(toLocalInput(d.toISOString()))
    setMode('dans30')
    setTirage((t) => t + 1)
  }, [posts])

  const plan = useMemo(
    () => planifier(ids, mode, { choisi: choisi ? fromLocalInput(choisi) : undefined, fenetreHeures: fenetre }),
    // tirage force un nouveau tirage au sort sans changer les autres entrees.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ids, mode, choisi, fenetre, tirage],
  )

  const parId = useMemo(() => new Map(plan.map((r) => [r.id, r.quand])), [plan])
  const passe = plan.some((r) => r.quand.getTime() < Date.now() - 60_000)

  if (posts.length === 0) return null

  return (
    <Modal open title={`Reprogrammer ${posts.length} publication${posts.length > 1 ? 's' : ''}`} onClose={onClose} wide>
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <p className="label mb-2">Quand</p>
          <div className="space-y-1.5">
            {MODES.map((m) => (
              <label
                key={m.cle}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${
                  mode === m.cle
                    ? 'border-brand-500/60 bg-brand-500/10'
                    : 'border-ink-700 hover:bg-ink-800/40'
                }`}
              >
                <input
                  type="radio"
                  name="mode-reprise"
                  checked={mode === m.cle}
                  onChange={() => setMode(m.cle)}
                />
                <span className="text-sm">{m.label}</span>
              </label>
            ))}
          </div>

          {mode === 'choisi' && (
            <label className="mt-3 block">
              <span className="label">Date et heure</span>
              <input
                type="datetime-local"
                className="field"
                value={choisi}
                onChange={(e) => setChoisi(e.target.value)}
              />
            </label>
          )}

          {mode === 'hasard' && (
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="min-w-0 flex-1">
                <span className="label">Sur les prochaines</span>
                <select
                  className="field"
                  value={fenetre}
                  onChange={(e) => setFenetre(Number(e.target.value))}
                >
                  {FENETRES.map((h) => (
                    <option key={h} value={h}>
                      {h} heures
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn btn-ghost" onClick={() => setTirage((t) => t + 1)}>
                Retirer au sort
              </button>
            </div>
          )}

          <p className="mt-3 text-xs text-mist-500">{decrireMode(mode, posts.length, fenetre)}</p>
        </div>

        <div className="min-w-0">
          <p className="label mb-2">Ce qui partira</p>
          <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {posts.map((p) => {
              const quand = parId.get(p.id)
              return (
                <li
                  key={p.id}
                  className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-xs"
                >
                  <span className="shrink-0 opacity-70" aria-hidden="true">
                    {PLATFORM_ICON[p.accounts?.platform ?? ''] ?? '•'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-mist-300">
                    {p.accounts?.account_name ?? 'compte supprime'}
                  </span>
                  <span className="shrink-0 tabular-nums text-mist-100">
                    {quand ? formatDateTime(quand.toISOString()) : 'heure a preciser'}
                  </span>
                </li>
              )
            })}
          </ul>

          {passe && (
            <p className="mt-2 text-xs text-warn-400">
              Une heure choisie est deja passee : ces publications partiront au prochain passage,
              dans les deux minutes.
            </p>
          )}
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button className="btn btn-ghost" onClick={onClose}>
          Annuler
        </button>
        <button
          className="btn btn-primary"
          disabled={plan.length === 0}
          onClick={() => onConfirm(plan)}
        >
          Reprogrammer
        </button>
      </div>
    </Modal>
  )
}
