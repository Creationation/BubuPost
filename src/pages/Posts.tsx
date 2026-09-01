import { useCallback, useEffect, useMemo, useState } from 'react'
import { cancelPost, deletePost, listAccounts, listPosts, retryPost } from '../lib/api'
import { friendlyError } from '../lib/errors'
import { PLATFORMS, POST_STATUS_LABEL, type Account, type PostWithAccount } from '../lib/types'
import { formatDay, dayKey } from '../lib/format'
import { Alert, ConfirmModal, EmptyState, Loading, PageHeader } from '../components/ui'
import PostComposer from '../components/PostComposer'
import { PostEditor, PostLogs, PostRow } from '../components/PostRow'

const STATUS_FILTERS = ['pending', 'processing', 'published', 'failed', 'cancelled'] as const

export default function Posts() {
  const [posts, setPosts] = useState<PostWithAccount[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [composing, setComposing] = useState(false)
  const [editing, setEditing] = useState<PostWithAccount | null>(null)
  const [showingLogs, setShowingLogs] = useState<PostWithAccount | null>(null)
  const [toDelete, setToDelete] = useState<PostWithAccount | null>(null)

  const [brand, setBrand] = useState('')
  const [platform, setPlatform] = useState('')
  const [accountId, setAccountId] = useState('')
  const [status, setStatus] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [p, a] = await Promise.all([listPosts(), listAccounts()])
      setPosts(p)
      setAccounts(a)
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

  async function act(fn: () => Promise<void>, message: string) {
    try {
      await fn()
      setNotice(message)
      await reload()
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  const brands = useMemo(
    () => [...new Set(accounts.map((a) => a.brand))].sort(),
    [accounts],
  )

  const filtered = useMemo(
    () =>
      posts.filter((p) => {
        if (brand && p.accounts?.brand !== brand) return false
        if (platform && p.accounts?.platform !== platform) return false
        if (accountId && p.account_id !== accountId) return false
        if (status && p.status !== status) return false
        return true
      }),
    [posts, brand, platform, accountId, status],
  )

  /** Groupe par jour prevu, du plus proche au plus lointain. */
  const grouped = useMemo(() => {
    const map = new Map<string, PostWithAccount[]>()
    for (const post of filtered) {
      const key = dayKey(post.scheduled_at)
      const list = map.get(key) ?? []
      list.push(post)
      map.set(key, list)
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [filtered])

  const hasFilter = brand || platform || accountId || status

  return (
    <div>
      <PageHeader
        title="Publications"
        subtitle={`${filtered.length} publication${filtered.length > 1 ? 's' : ''}${hasFilter ? ' apres filtre' : ''}`}
        action={
          <button className="btn btn-primary" onClick={() => setComposing(true)}>
            Nouvelle publication
          </button>
        }
      />

      <div className="panel mb-5 flex flex-wrap gap-3 p-3">
        <select className="field !w-auto" value={brand} onChange={(e) => setBrand(e.target.value)}>
          <option value="">Toutes les marques</option>
          {brands.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>

        <select
          className="field !w-auto"
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
        >
          <option value="">Toutes les plateformes</option>
          {PLATFORMS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>

        <select
          className="field !w-auto"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          <option value="">Tous les comptes</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.account_name}
            </option>
          ))}
        </select>

        <select
          className="field !w-auto"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Tous les statuts</option>
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {POST_STATUS_LABEL[s]}
            </option>
          ))}
        </select>

        {hasFilter && (
          <button
            className="btn btn-ghost"
            onClick={() => {
              setBrand('')
              setPlatform('')
              setAccountId('')
              setStatus('')
            }}
          >
            Reinitialiser
          </button>
        )}
      </div>

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

      {loading ? (
        <Loading />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="▤"
          title={hasFilter ? 'Rien ne correspond a ce filtre' : 'Aucune publication'}
          hint={
            hasFilter
              ? 'Elargis les filtres pour voir le reste.'
              : 'Cree une publication : une video, les comptes vises, et pour chacun son heure et sa legende.'
          }
        />
      ) : (
        <div className="space-y-7">
          {grouped.map(([key, list]) => (
            <section key={key}>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-mist-500">
                {formatDay(list[0].scheduled_at)}
                <span className="ml-2 font-normal normal-case text-mist-600">
                  {list.length} publication{list.length > 1 ? 's' : ''}
                </span>
              </h2>
              <div className="space-y-3">
                {list.map((post) => (
                  <PostRow
                    key={post.id}
                    post={post}
                    onEdit={() => setEditing(post)}
                    onLogs={() => setShowingLogs(post)}
                    onCancel={() => void act(() => cancelPost(post.id), 'Publication annulee')}
                    onRetry={() => void act(() => retryPost(post.id), 'Publication reprogrammee')}
                    onDelete={() => setToDelete(post)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <PostComposer
        open={composing}
        accounts={accounts}
        onClose={() => setComposing(false)}
        onCreated={(count) => {
          setComposing(false)
          setNotice(`${count} publication${count > 1 ? 's' : ''} programmee${count > 1 ? 's' : ''}`)
          void reload()
        }}
      />

      <PostEditor
        post={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          setNotice('Publication mise a jour')
          void reload()
        }}
      />

      <PostLogs post={showingLogs} onClose={() => setShowingLogs(null)} />

      <ConfirmModal
        open={toDelete !== null}
        title="Supprimer cette publication"
        message="La publication et son journal seront supprimes. Si elle est deja publiee sur la plateforme, le post en ligne n'est pas retire."
        confirmLabel="Supprimer"
        danger
        onConfirm={() => {
          if (toDelete) void act(() => deletePost(toDelete.id), 'Publication supprimee')
        }}
        onClose={() => setToDelete(null)}
      />
    </div>
  )
}
