import { useCallback, useEffect, useState } from 'react'
import {
  listAccounts,
  listPosts,
  listProfiles,
  listSettings,
  runSchedulerNow,
  saveSetting,
  setProfileRole,
} from '../lib/api'
import { friendlyError } from '../lib/errors'
import { useAuth } from '../context/AuthContext'
import {
  PLATFORMS,
  PLATFORM_LABEL,
  type Account,
  type PostWithAccount,
  type Profile,
} from '../lib/types'
import { formatDateTime } from '../lib/format'
import { rafraichirPassage } from '../lib/scheduler'
import { Alert, Loading, PageHeader } from '../components/ui'

const DAYS = [
  { key: 'mon', label: 'Lundi' },
  { key: 'tue', label: 'Mardi' },
  { key: 'wed', label: 'Mercredi' },
  { key: 'thu', label: 'Jeudi' },
  { key: 'fri', label: 'Vendredi' },
  { key: 'sat', label: 'Samedi' },
  { key: 'sun', label: 'Dimanche' },
]

type Cadence = Record<string, number>
type Limits = Record<string, number>
type Notify = { telegram_enabled: boolean; notify_on_success: boolean }
type Retry = { max_attempts: number; backoff_minutes: number[] }

function Card({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="panel p-5">
      <h2 className="font-semibold">{title}</h2>
      {hint && <p className="mt-1 text-xs text-mist-500">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

export default function Admin() {
  const { user } = useAuth()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [posts, setPosts] = useState<PostWithAccount[]>([])
  const [cadence, setCadence] = useState<Cadence>({})
  const [limits, setLimits] = useState<Limits>({})
  const [notify, setNotify] = useState<Notify>({
    telegram_enabled: true,
    notify_on_success: false,
  })
  const [retry, setRetry] = useState<Retry>({ max_attempts: 3, backoff_minutes: [5, 20, 60] })

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [p, a, po, settings] = await Promise.all([
        listProfiles(),
        listAccounts(),
        listPosts(),
        listSettings(),
      ])
      setProfiles(p)
      setAccounts(a)
      setPosts(po)
      if (settings.cadence) setCadence(settings.cadence as Cadence)
      if (settings.limits) setLimits(settings.limits as Limits)
      if (settings.notify) setNotify(settings.notify as Notify)
      if (settings.retry) setRetry(settings.retry as Retry)
      setError(null)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  async function save(key: string, value: unknown) {
    try {
      await saveSetting(key, value)
      setNotice('Reglages enregistres')
      setError(null)
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  async function triggerScheduler() {
    setRunning(true)
    setError(null)
    try {
      const result = (await runSchedulerNow()) as { processed?: number }
      // Le compte a rebours des publications se recale sur ce passage.
      rafraichirPassage()
      setNotice(`Scheduler lance, ${result?.processed ?? 0} publication(s) traitee(s)`)
      await reload()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setRunning(false)
    }
  }

  /** Publications reussies par compte sur les 24 dernieres heures. */
  function usage(accountId: string): number {
    const since = Date.now() - 86_400_000
    return posts.filter(
      (p) =>
        p.account_id === accountId &&
        p.status === 'published' &&
        p.published_at &&
        new Date(p.published_at).getTime() > since,
    ).length
  }

  if (loading) return <Loading />

  const isAdmin = profiles.find((p) => p.id === user?.id)?.role === 'admin'

  return (
    <div>
      <PageHeader
        title="Admin center"
        subtitle="Reglages du scheduler, quotas, utilisateurs"
        action={
          <button className="btn btn-primary" onClick={() => void triggerScheduler()} disabled={running}>
            {running ? 'Passage en cours...' : 'Lancer le scheduler maintenant'}
          </button>
        }
      />

      {error && (
        <div className="mb-4">
          <Alert kind="error">{error}</Alert>
        </div>
      )}
      {notice && (
        <div className="mb-4">
          <Alert kind="ok">{notice}</Alert>
        </div>
      )}
      {!isAdmin && (
        <div className="mb-4">
          <Alert kind="info">
            Ton compte n'a pas le role admin. Les reglages sont visibles mais l'enregistrement sera
            refuse par la base.
          </Alert>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <Card
          title="Cadence visee"
          hint="Nombre de videos par jour. C'est un repere affiche, le scheduler publie ce que tu programmes."
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {DAYS.map((d) => (
              <div key={d.key}>
                <label className="label" htmlFor={`cad-${d.key}`}>
                  {d.label}
                </label>
                <input
                  id={`cad-${d.key}`}
                  type="number"
                  min={0}
                  max={20}
                  className="field"
                  value={cadence[d.key] ?? 0}
                  onChange={(e) =>
                    setCadence({ ...cadence, [d.key]: Number(e.target.value) || 0 })
                  }
                />
              </div>
            ))}
          </div>
          <button className="btn btn-ghost mt-4" onClick={() => void save('cadence', cadence)}>
            Enregistrer la cadence
          </button>
        </Card>

        <Card
          title="Quotas par plateforme"
          hint="Publications maximum par compte sur 24 h. Au-dela, le scheduler repousse d'une heure au lieu d'echouer."
        >
          <div className="space-y-3">
            {PLATFORMS.map((p) => (
              <div key={p.value} className="flex items-center gap-3">
                <span className="w-36 text-sm text-mist-300">{p.label}</span>
                <input
                  type="number"
                  min={1}
                  max={500}
                  className="field !w-28"
                  value={limits[p.value] ?? 25}
                  onChange={(e) => setLimits({ ...limits, [p.value]: Number(e.target.value) || 1 })}
                />
              </div>
            ))}
          </div>
          <button className="btn btn-ghost mt-4" onClick={() => void save('limits', limits)}>
            Enregistrer les quotas
          </button>
        </Card>

        <Card title="Nouvelles tentatives" hint="Ce que fait le scheduler quand une publication echoue.">
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="max-attempts">
                Tentatives maximum
              </label>
              <input
                id="max-attempts"
                type="number"
                min={1}
                max={5}
                className="field !w-28"
                value={retry.max_attempts}
                onChange={(e) =>
                  setRetry({ ...retry, max_attempts: Number(e.target.value) || 1 })
                }
              />
            </div>
            <div>
              <label className="label" htmlFor="backoff">
                Attente entre deux tentatives, en minutes
              </label>
              <input
                id="backoff"
                className="field"
                value={retry.backoff_minutes.join(', ')}
                onChange={(e) =>
                  setRetry({
                    ...retry,
                    backoff_minutes: e.target.value
                      .split(',')
                      .map((v) => Number(v.trim()))
                      .filter((v) => Number.isFinite(v) && v > 0),
                  })
                }
              />
            </div>
          </div>
          <button className="btn btn-ghost mt-4" onClick={() => void save('retry', retry)}>
            Enregistrer
          </button>
        </Card>

        <Card title="Notifications Telegram" hint="Le bot previent quand une publication echoue.">
          <div className="space-y-3">
            <label className="flex items-center gap-3 text-sm text-mist-300">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--color-brand-500)]"
                checked={notify.telegram_enabled}
                onChange={(e) => setNotify({ ...notify, telegram_enabled: e.target.checked })}
              />
              Prevenir en cas d'echec
            </label>
            <label className="flex items-center gap-3 text-sm text-mist-300">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--color-brand-500)]"
                checked={notify.notify_on_success}
                onChange={(e) => setNotify({ ...notify, notify_on_success: e.target.checked })}
              />
              Prevenir aussi a chaque publication reussie
            </label>
          </div>
          <button className="btn btn-ghost mt-4" onClick={() => void save('notify', notify)}>
            Enregistrer
          </button>
        </Card>

        <Card title="Consommation des quotas" hint="Publications reussies sur les 24 dernieres heures.">
          {accounts.length === 0 ? (
            <p className="text-sm text-mist-500">Aucun compte enregistre.</p>
          ) : (
            <div className="space-y-3">
              {accounts.map((a) => {
                const used = usage(a.id)
                const max = limits[a.platform] ?? 25
                const pct = Math.min(100, Math.round((used / max) * 100))
                return (
                  <div key={a.id}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-mist-300">
                        {a.account_name}
                        <span className="ml-2 text-mist-600">{PLATFORM_LABEL[a.platform]}</span>
                      </span>
                      <span className="tabular-nums text-mist-500">
                        {used} / {max}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-ink-800">
                      <div
                        className={`h-full rounded-full ${pct >= 90 ? 'bg-bad-400' : pct >= 60 ? 'bg-warn-400' : 'bg-ok-400'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        <Card title="Utilisateurs" hint="Seuls les admins peuvent modifier les reglages de cette page.">
          <div className="space-y-2">
            {profiles.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-700 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">{p.email}</p>
                  <p className="text-xs text-mist-600">Cree le {formatDateTime(p.created_at)}</p>
                </div>
                <select
                  className="field !w-auto"
                  value={p.role}
                  disabled={!isAdmin}
                  onChange={(e) => {
                    void setProfileRole(p.id, e.target.value)
                      .then(() => reload())
                      .catch((err) => setError(friendlyError(err)))
                  }}
                >
                  <option value="admin">Admin</option>
                  <option value="user">Utilisateur</option>
                </select>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
