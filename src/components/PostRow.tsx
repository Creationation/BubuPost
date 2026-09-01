import { useEffect, useState } from 'react'
import { listLogs, updatePost } from '../lib/api'
import { friendlyError } from '../lib/errors'
import {
  PLATFORM_ICON,
  POST_STATUS_CLASS,
  POST_STATUS_ICON,
  POST_STATUS_LABEL,
  isEditable,
  type PostWithAccount,
  type PublishLog,
} from '../lib/types'
import { formatDateTime, fromLocalInput, relative, toLocalInput } from '../lib/format'
import { Alert, Chip, Loading, Modal } from './ui'

export function PostRow({
  post,
  onEdit,
  onLogs,
  onCancel,
  onRetry,
  onDelete,
}: {
  post: PostWithAccount
  onEdit: () => void
  onLogs: () => void
  onCancel: () => void
  onRetry: () => void
  onDelete: () => void
}) {
  const account = post.accounts
  const editable = isEditable(post.status)

  return (
    <article className="panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Chip className={POST_STATUS_CLASS[post.status]}>
              {POST_STATUS_ICON[post.status]} {POST_STATUS_LABEL[post.status] ?? post.status}
            </Chip>
            <span className="text-sm font-semibold">
              <span className="mr-1.5 opacity-70">
                {account ? PLATFORM_ICON[account.platform] : '?'}
              </span>
              {account?.account_name ?? 'compte supprime'}
            </span>
            {account && <span className="text-xs text-mist-600">{account.brand}</span>}
          </div>

          <p className="mt-2 line-clamp-2 text-sm text-mist-300">
            {post.caption || <span className="text-mist-600">Aucune legende</span>}
          </p>

          {post.hashtags && post.hashtags.length > 0 && (
            <p className="mt-1 text-xs text-brand-400">
              {post.hashtags.map((t) => `#${t}`).join(' ')}
            </p>
          )}

          <p className="mt-2 text-xs text-mist-500">
            {post.status === 'published' && post.published_at
              ? `Publie ${relative(post.published_at)}, le ${formatDateTime(post.published_at)}`
              : `Prevu le ${formatDateTime(post.scheduled_at)}, ${relative(post.scheduled_at)}`}
            {post.attempts > 0 && ` · ${post.attempts} tentative${post.attempts > 1 ? 's' : ''}`}
          </p>

          {post.error_message && (
            <p className="mt-2 rounded-lg border border-bad-600/40 bg-bad-600/10 px-2.5 py-1.5 text-xs text-bad-400">
              {post.error_message}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {editable && (
            <button className="btn btn-ghost !py-1 !text-xs" onClick={onEdit}>
              Modifier
            </button>
          )}
          <button className="btn btn-ghost !py-1 !text-xs" onClick={onLogs}>
            Journal
          </button>
          {post.status === 'pending' || post.status === 'processing' ? (
            <button className="btn btn-ghost !py-1 !text-xs" onClick={onCancel}>
              Annuler
            </button>
          ) : null}
          {(post.status === 'failed' || post.status === 'cancelled') && (
            <button className="btn btn-ghost !py-1 !text-xs" onClick={onRetry}>
              Reprogrammer
            </button>
          )}
          <button className="btn btn-danger !py-1 !text-xs" onClick={onDelete}>
            Supprimer
          </button>
        </div>
      </div>
    </article>
  )
}

export function PostEditor({
  post,
  onClose,
  onSaved,
}: {
  post: PostWithAccount | null
  onClose: () => void
  onSaved: () => void
}) {
  const [caption, setCaption] = useState('')
  const [hashtags, setHashtags] = useState('')
  const [when, setWhen] = useState('')
  const [videoUrl, setVideoUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!post) return
    setCaption(post.caption ?? '')
    setHashtags((post.hashtags ?? []).join(' '))
    setWhen(toLocalInput(post.scheduled_at))
    setVideoUrl(post.video_url)
    setError(null)
  }, [post])

  async function save() {
    if (!post) return
    setBusy(true)
    setError(null)
    try {
      await updatePost(post.id, {
        caption: caption.trim() || null,
        hashtags: hashtags
          .split(/[\s,]+/)
          .map((t) => t.replace(/^#/, '').trim())
          .filter(Boolean),
        scheduled_at: fromLocalInput(when),
        video_url: videoUrl.trim(),
      })
      onSaved()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={post !== null}
      title={`Modifier : ${post?.accounts?.account_name ?? ''}`}
      onClose={onClose}
    >
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="edit-when">
            Date et heure
          </label>
          <input
            id="edit-when"
            type="datetime-local"
            className="field"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
        </div>

        <div>
          <label className="label" htmlFor="edit-caption">
            Legende
          </label>
          <textarea
            id="edit-caption"
            className="field"
            rows={4}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
          />
        </div>

        <div>
          <label className="label" htmlFor="edit-tags">
            Hashtags
          </label>
          <input
            id="edit-tags"
            className="field"
            value={hashtags}
            onChange={(e) => setHashtags(e.target.value)}
          />
        </div>

        <div>
          <label className="label" htmlFor="edit-video">
            URL de la video
          </label>
          <input
            id="edit-video"
            className="field font-mono text-xs"
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
          />
        </div>

        {error && <Alert kind="error">{error}</Alert>}

        <div className="flex justify-end gap-2 pt-2">
          <button className="btn btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export function PostLogs({ post, onClose }: { post: PostWithAccount | null; onClose: () => void }) {
  const [logs, setLogs] = useState<PublishLog[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!post) return
    setLoading(true)
    listLogs(post.id)
      .then(setLogs)
      .finally(() => setLoading(false))
  }, [post])

  return (
    <Modal open={post !== null} title="Journal de publication" onClose={onClose} wide>
      {loading ? (
        <Loading />
      ) : logs.length === 0 ? (
        <p className="py-8 text-center text-sm text-mist-500">
          Aucun evenement. Le scheduler n'a pas encore traite cette publication.
        </p>
      ) : (
        <ol className="space-y-3">
          {logs.map((log) => (
            <li key={log.id} className="rounded-lg border border-ink-700 bg-ink-850/50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs font-semibold text-mist-100">{log.event}</span>
                <span className="text-xs text-mist-600">{formatDateTime(log.created_at)}</span>
              </div>
              {log.detail != null && (
                <pre className="mt-2 overflow-x-auto rounded bg-ink-950/60 p-2 font-mono text-[11px] leading-relaxed text-mist-500">
                  {JSON.stringify(log.detail, null, 2)}
                </pre>
              )}
            </li>
          ))}
        </ol>
      )}
    </Modal>
  )
}
