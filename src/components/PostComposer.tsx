import { useEffect, useMemo, useState } from 'react'
import { createPostGroup, generateCaption, uploadVideo, type TargetInput } from '../lib/api'
import { friendlyError } from '../lib/errors'
import { PLATFORM_ICON, PLATFORM_LABEL, type Account } from '../lib/types'
import { fromLocalInput, toLocalInput } from '../lib/format'
import { Alert, Modal } from './ui'

/** Ce qu'on retient pour chaque compte coche, avant enregistrement. */
type Target = {
  accountId: string
  scheduledLocal: string
  caption: string
  hashtags: string
  generating: boolean
}

/** Dans une heure, arrondi aux 5 minutes superieures. */
function defaultSchedule(): string {
  const d = new Date(Date.now() + 3600_000)
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0)
  return toLocalInput(d.toISOString())
}

function parseHashtags(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((t) => t.replace(/^#/, '').trim())
    .filter(Boolean)
}

export default function PostComposer({
  open,
  accounts,
  onClose,
  onCreated,
}: {
  open: boolean
  accounts: Account[]
  onClose: () => void
  onCreated: (count: number) => void
}) {
  const [videoUrl, setVideoUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [subject, setSubject] = useState('')
  const [targets, setTargets] = useState<Record<string, Target>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generatingAll, setGeneratingAll] = useState(false)

  useEffect(() => {
    if (!open) return
    setVideoUrl('')
    setSubject('')
    setTargets({})
    setError(null)
    setBusy(false)
  }, [open])

  const usable = useMemo(() => accounts.filter((a) => a.status === 'active'), [accounts])

  const byBrand = useMemo(
    () =>
      usable.reduce<Record<string, Account[]>>((acc, a) => {
        ;(acc[a.brand] ??= []).push(a)
        return acc
      }, {}),
    [usable],
  )

  const selected = Object.keys(targets)
  const accountById = useMemo(
    () => Object.fromEntries(accounts.map((a) => [a.id, a])),
    [accounts],
  )

  function toggle(account: Account) {
    setTargets((prev) => {
      const next = { ...prev }
      if (next[account.id]) {
        delete next[account.id]
        return next
      }
      // On reprend l'horaire de la premiere cible deja cochee, pour ne pas
      // avoir a ressaisir la meme heure cinq fois.
      const first = Object.values(prev)[0]
      next[account.id] = {
        accountId: account.id,
        scheduledLocal: first?.scheduledLocal ?? defaultSchedule(),
        caption: '',
        hashtags: '',
        generating: false,
      }
      return next
    })
  }

  function patch(accountId: string, changes: Partial<Target>) {
    setTargets((prev) => ({ ...prev, [accountId]: { ...prev[accountId], ...changes } }))
  }

  /** Applique l'horaire de la premiere cible a toutes les autres. */
  function syncTimes() {
    const first = Object.values(targets)[0]
    if (!first) return
    setTargets((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([id, t]) => [id, { ...t, scheduledLocal: first.scheduledLocal }]),
      ),
    )
  }

  async function generateFor(accountId: string) {
    const account = accountById[accountId]
    if (!account || !subject.trim()) {
      setError('Renseigne le sujet du jour avant de generer une legende')
      return
    }
    patch(accountId, { generating: true })
    setError(null)
    try {
      const result = await generateCaption({
        subject: subject.trim(),
        platform: account.platform,
        brand: account.brand,
      })
      patch(accountId, {
        caption: result.caption,
        hashtags: result.hashtags.join(' '),
        generating: false,
      })
    } catch (err) {
      patch(accountId, { generating: false })
      setError(friendlyError(err))
    }
  }

  async function generateAll() {
    if (!subject.trim()) {
      setError('Renseigne le sujet du jour avant de generer les legendes')
      return
    }
    setGeneratingAll(true)
    // En serie plutot qu'en parallele : cinq appels simultanes a l'API n'apportent
    // rien ici et rendent les erreurs illisibles.
    for (const id of selected) {
      await generateFor(id)
    }
    setGeneratingAll(false)
  }

  async function onUpload(file: File) {
    setUploading(true)
    setError(null)
    try {
      setVideoUrl(await uploadVideo(file))
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setUploading(false)
    }
  }

  async function onSubmit() {
    if (!videoUrl.trim()) {
      setError('Il faut une video : depose un fichier ou colle une URL')
      return
    }
    if (selected.length === 0) {
      setError('Choisis au moins un compte de destination')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const list: TargetInput[] = selected.map((id) => ({
        account_id: id,
        scheduled_at: fromLocalInput(targets[id].scheduledLocal),
        caption: targets[id].caption.trim(),
        hashtags: parseHashtags(targets[id].hashtags),
      }))
      const count = await createPostGroup(videoUrl.trim(), list)
      onCreated(count)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} title="Nouvelle publication" onClose={onClose} wide>
      <div className="space-y-6">
        {/* 1. La video */}
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-mist-500">
            1. La video
          </h3>
          <div className="space-y-3">
            <label className="flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-ink-700 px-4 py-6 text-sm text-mist-500 transition-colors hover:border-brand-500/50 hover:text-mist-300">
              <input
                type="file"
                accept="video/mp4,video/quicktime"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void onUpload(file)
                }}
              />
              {uploading ? 'Envoi en cours...' : 'Deposer un fichier video (MP4, 500 Mo max)'}
            </label>

            <div>
              <label className="label" htmlFor="video_url">
                Ou une URL deja publique
              </label>
              <input
                id="video_url"
                className="field font-mono text-xs"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="https://..."
              />
              <p className="mt-1 text-xs text-mist-600">
                L'URL doit etre accessible sans authentification : ce sont les serveurs des
                plateformes qui viennent telecharger la video.
              </p>
            </div>
          </div>
        </section>

        {/* 2. Les comptes */}
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-mist-500">
            2. Les comptes de destination
          </h3>

          {usable.length === 0 ? (
            <Alert kind="info">
              Aucun compte actif. Ajoute un compte, ou repasse un compte en pause sur actif.
            </Alert>
          ) : (
            <div className="space-y-4">
              {Object.entries(byBrand).map(([brand, list]) => (
                <div key={brand}>
                  <p className="mb-2 text-xs font-medium text-mist-600">{brand}</p>
                  <div className="flex flex-wrap gap-2">
                    {list.map((account) => {
                      const on = Boolean(targets[account.id])
                      return (
                        <button
                          key={account.id}
                          type="button"
                          onClick={() => toggle(account)}
                          className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${
                            on
                              ? 'border-brand-500/50 bg-brand-500/15 text-mist-100'
                              : 'border-ink-700 text-mist-500 hover:border-ink-600 hover:text-mist-300'
                          }`}
                        >
                          <span className="opacity-70">{PLATFORM_ICON[account.platform]}</span>
                          {account.account_name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 3. Sujet et legendes */}
        {selected.length > 0 && (
          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-mist-500">
                3. Horaire et legende, compte par compte
              </h3>
              <div className="flex gap-2">
                <button type="button" className="btn btn-ghost !py-1 !text-xs" onClick={syncTimes}>
                  Meme heure partout
                </button>
                <button
                  type="button"
                  className="btn btn-ghost !py-1 !text-xs"
                  onClick={() => void generateAll()}
                  disabled={generatingAll}
                >
                  {generatingAll ? 'Generation...' : 'Generer toutes les legendes'}
                </button>
              </div>
            </div>

            <div className="mb-4">
              <label className="label" htmlFor="subject">
                Sujet du jour
              </label>
              <input
                id="subject"
                className="field"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Les trois erreurs qui ruinent un backtest"
              />
              <p className="mt-1 text-xs text-mist-600">
                Sert de base a la generation des legendes par Claude, une legende adaptee par
                plateforme.
              </p>
            </div>

            <div className="space-y-3">
              {selected.map((id) => {
                const account = accountById[id]
                const target = targets[id]
                if (!account || !target) return null
                return (
                  <div key={id} className="rounded-xl border border-ink-700 bg-ink-850/50 p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold">
                        <span className="mr-2 opacity-70">{PLATFORM_ICON[account.platform]}</span>
                        {account.account_name}
                        <span className="ml-2 text-xs font-normal text-mist-600">
                          {PLATFORM_LABEL[account.platform]}
                        </span>
                      </p>
                      <button
                        type="button"
                        className="btn btn-ghost !py-1 !text-xs"
                        onClick={() => void generateFor(id)}
                        disabled={target.generating}
                      >
                        {target.generating ? 'Generation...' : 'Generer la legende'}
                      </button>
                    </div>

                    <div className="grid gap-3 lg:grid-cols-[220px_1fr]">
                      <div>
                        <label className="label" htmlFor={`when-${id}`}>
                          Date et heure
                        </label>
                        <input
                          id={`when-${id}`}
                          type="datetime-local"
                          className="field"
                          value={target.scheduledLocal}
                          onChange={(e) => patch(id, { scheduledLocal: e.target.value })}
                        />
                      </div>

                      <div className="space-y-3">
                        <div>
                          <label className="label" htmlFor={`caption-${id}`}>
                            Legende
                          </label>
                          <textarea
                            id={`caption-${id}`}
                            className="field"
                            rows={3}
                            value={target.caption}
                            onChange={(e) => patch(id, { caption: e.target.value })}
                            placeholder="Le texte publie sous la video"
                          />
                        </div>
                        <div>
                          <label className="label" htmlFor={`tags-${id}`}>
                            Hashtags
                          </label>
                          <input
                            id={`tags-${id}`}
                            className="field"
                            value={target.hashtags}
                            onChange={(e) => patch(id, { hashtags: e.target.value })}
                            placeholder="trading forex xauusd"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {error && <Alert kind="error">{error}</Alert>}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-800 pt-4">
          <p className="text-xs text-mist-600">
            {selected.length === 0
              ? 'Aucun compte selectionne'
              : `${selected.length} publication${selected.length > 1 ? 's' : ''} sera cree${selected.length > 1 ? 'e' : ''}`}
          </p>
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Annuler
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void onSubmit()}
              disabled={busy || uploading}
            >
              {busy ? 'Enregistrement...' : 'Programmer'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
