import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { listAccounts, listPosts } from '../lib/api'
import { friendlyError } from '../lib/errors'
import {
  PLATFORM_ICON,
  daysUntilExpiry,
  type Account,
  type PostWithAccount,
} from '../lib/types'
import { formatDateTime, formatDay, dayKey } from '../lib/format'
import { Alert, EmptyState, Loading, PageHeader } from '../components/ui'
import { BadgeStatut, LigneAttente, ProchainePublication } from '../components/Attente'
import { useLiveStatuses } from '../lib/useLiveStatuses'

function Stat({
  label,
  value,
  tone = 'text-mist-100',
}: {
  label: string
  value: number | string
  tone?: string
}) {
  return (
    <div className="panel p-4">
      <p className="text-xs uppercase tracking-wider text-mist-500">{label}</p>
      <p className={`mt-1.5 text-2xl font-bold tabular-nums ${tone}`}>{value}</p>
    </div>
  )
}

export default function Dashboard() {
  const [posts, setPosts] = useState<PostWithAccount[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([listPosts(), listAccounts()])
      .then(([p, a]) => {
        setPosts(p)
        setAccounts(a)
      })
      .catch((err) => setError(friendlyError(err)))
      .finally(() => setLoading(false))
  }, [])

  useLiveStatuses(posts, (maj) => {
    setPosts((actuels) =>
      actuels.map((p) => {
        const ligne = maj.find((m) => m.id === p.id)
        return ligne ? { ...p, ...ligne } : p
      }),
    )
  })

  const stats = useMemo(() => {
    const now = Date.now()
    return {
      activeAccounts: accounts.filter((a) => a.status === 'active').length,
      pending: posts.filter((p) => p.status === 'pending' || p.status === 'processing').length,
      failed: posts.filter((p) => p.status === 'failed').length,
      published7d: posts.filter(
        (p) =>
          p.status === 'published' &&
          p.published_at &&
          now - new Date(p.published_at).getTime() < 7 * 86_400_000,
      ).length,
    }
  }, [posts, accounts])

  /** Ce qui demande une action : token bientot mort, ou compte en erreur. */
  const alerts = useMemo(() => {
    const out: { text: string; bad: boolean }[] = []
    for (const a of accounts) {
      if (a.status === 'error') out.push({ text: `${a.account_name} est en erreur`, bad: true })
      else if (a.status === 'expired')
        out.push({ text: `${a.account_name} : token expire`, bad: true })
      else if (a.status === 'active' && !a.access_token)
        out.push({ text: `${a.account_name} n'a aucun token enregistre`, bad: true })

      const days = daysUntilExpiry(a.token_expiry)
      if (a.status === 'active' && days !== null && days >= 0 && days <= 10) {
        out.push({ text: `${a.account_name} : token expire dans ${days} j`, bad: days <= 3 })
      }
    }
    return out
  }, [accounts])

  const failed = useMemo(
    () => posts.filter((p) => p.status === 'failed').slice(0, 5),
    [posts],
  )

  /** Les prochaines publications, groupees par jour. */
  const upcoming = useMemo(() => {
    const list = posts
      .filter((p) => p.status === 'pending' || p.status === 'processing')
      .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
      .slice(0, 25)

    const map = new Map<string, PostWithAccount[]>()
    for (const post of list) {
      const key = dayKey(post.scheduled_at)
      map.set(key, [...(map.get(key) ?? []), post])
    }
    return [...map.entries()]
  }, [posts])

  if (loading) return <Loading />

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Le scheduler tourne tout seul, toutes les 5 minutes"
        action={
          <Link to="/posts" className="btn btn-primary">
            Nouvelle publication
          </Link>
        }
      />

      {error && (
        <div className="mb-4">
          <Alert kind="error">{error}</Alert>
        </div>
      )}

      <ProchainePublication posts={posts} />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Comptes actifs"
          value={stats.activeAccounts}
          tone={stats.activeAccounts > 0 ? 'text-mist-100' : 'text-warn-400'}
        />
        <Stat label="En attente" value={stats.pending} tone="text-warn-400" />
        <Stat label="Publiees cette semaine" value={stats.published7d} tone="text-ok-400" />
        <Stat
          label="En erreur"
          value={stats.failed}
          tone={stats.failed > 0 ? 'text-bad-400' : 'text-mist-100'}
        />
      </div>

      {alerts.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-mist-500">
            A surveiller
          </h2>
          <div className="space-y-2">
            {alerts.map((a, i) => (
              <div
                key={i}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  a.bad
                    ? 'border-bad-600/40 bg-bad-600/10 text-bad-400'
                    : 'border-warn-600/40 bg-warn-600/10 text-warn-400'
                }`}
              >
                {a.text}
              </div>
            ))}
          </div>
        </section>
      )}

      {failed.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-mist-500">
            Publications en erreur
          </h2>
          <div className="space-y-2">
            {failed.map((post) => (
              <div key={post.id} className="panel p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    <span className="mr-1.5 opacity-70">
                      {post.accounts ? PLATFORM_ICON[post.accounts.platform] : '?'}
                    </span>
                    {post.accounts?.account_name ?? 'compte supprime'}
                  </span>
                  <span className="text-xs text-mist-600">
                    {formatDateTime(post.scheduled_at)}
                  </span>
                </div>
                {post.error_message && (
                  <p className="mt-1.5 text-xs text-bad-400">{post.error_message}</p>
                )}
              </div>
            ))}
          </div>
          <Link
            to="/posts"
            className="mt-3 inline-block text-xs text-brand-400 hover:underline"
          >
            Voir toutes les publications
          </Link>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-mist-500">
          Prochaines publications
        </h2>

        {upcoming.length === 0 ? (
          <EmptyState
            icon="⏳"
            title="Rien de programme"
            hint="Cree une publication pour remplir le calendrier."
          />
        ) : (
          <div className="space-y-6">
            {upcoming.map(([key, list]) => (
              <div key={key}>
                <p className="mb-2 text-sm font-medium text-mist-300">
                  {formatDay(list[0].scheduled_at)}
                </p>
                <div className="space-y-2">
                  {list.map((post) => (
                    <div key={post.id} className="panel flex flex-wrap items-center gap-3 p-3">
                      <BadgeStatut status={post.status} scheduledAt={post.scheduled_at} />
                      <span className="text-sm font-medium">
                        <span className="mr-1.5 opacity-70">
                          {post.accounts ? PLATFORM_ICON[post.accounts.platform] : '?'}
                        </span>
                        {post.accounts?.account_name ?? 'compte supprime'}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-mist-500">
                        {post.caption || 'aucune legende'}
                      </span>
                      <LigneAttente status={post.status} scheduledAt={post.scheduled_at} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
