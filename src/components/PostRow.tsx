import { useEffect, useMemo, useState } from 'react'
import { listLogs, remplacerVideo, updatePost } from '../lib/api'
import { friendlyError } from '../lib/errors'
import {
  PLATFORM_ICON,
  isEditable,
  type PostWithAccount,
  type PublishLog,
} from '../lib/types'
import { LANGUES, langueDe, teinteLangue, langue as trouverLangue } from '../lib/langues'
import { deplacable } from '../lib/calendrier'
import { formatDateTime, fromLocalInput, relative, toLocalInput } from '../lib/format'
import { Alert, Loading, Modal } from './ui'
import { BadgeStatut, LigneAttente } from './Attente'
import { ChoixVideo, LecteurVideo } from './Video'

/** La langue d'une publication, en deux lettres. */
export function BadgeLangue({
  code,
  className = '',
}: {
  code: string
  className?: string
}) {
  const l = trouverLangue(code)
  return (
    <span
      className={`chip ${teinteLangue(code)} ${className}`}
      title={`Texte ecrit en ${l.label.toLowerCase()}`}
    >
      {l.badge}
    </span>
  )
}

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
            <BadgeStatut status={post.status} scheduledAt={post.scheduled_at} />
            <span className="text-sm font-semibold">
              <span className="mr-1.5 opacity-70">
                {account ? PLATFORM_ICON[account.platform] : '?'}
              </span>
              {account?.account_name ?? 'compte supprime'}
            </span>
            {account && <span className="text-xs text-mist-600">{account.brand}</span>}
            <BadgeLangue code={langueDe(post, account)} />
            {post.youtube_type && (
              <span
                className={`chip ${
                  post.youtube_type === 'short'
                    ? 'border-brand-400/30 bg-brand-400/10 text-brand-400'
                    : 'border-mist-500/30 bg-mist-500/10 text-mist-300'
                }`}
                title={
                  post.youtube_type === 'short'
                    ? 'Publie en Short, format vertical'
                    : 'Publie en video classique'
                }
              >
                {post.youtube_type === 'short' ? '▮ Short' : '▭ Video'}
              </span>
            )}
          </div>

          {post.title && (
            <p className="mt-2 truncate text-sm font-medium text-mist-100" title={post.title}>
              {post.title}
            </p>
          )}

          <p className="mt-2 line-clamp-2 text-sm text-mist-300">
            {post.caption || <span className="text-mist-600">Aucune legende</span>}
          </p>

          {post.hashtags && post.hashtags.length > 0 && (
            <p className="mt-1 text-xs text-brand-400">
              {post.hashtags.map((t) => `#${t}`).join(' ')}
            </p>
          )}

          <p className="mt-2 text-xs">
            <a
              href={post.video_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-mist-500 hover:text-brand-400"
              title={post.video_url}
            >
              <span className="opacity-70">▷</span>
              <span className="max-w-[22rem] truncate align-middle">
                {post.video_url.split('/').pop() || post.video_url}
              </span>
            </a>
          </p>

          <p className="mt-2 text-xs text-mist-500">
            {post.status === 'published' && post.published_at
              ? `Publie ${relative(post.published_at)}, le ${formatDateTime(post.published_at)}`
              : `Prevu le ${formatDateTime(post.scheduled_at)}`}
            {post.attempts > 0 && ` · ${post.attempts} tentative${post.attempts > 1 ? 's' : ''}`}
          </p>

          <LigneAttente
            status={post.status}
            scheduledAt={post.scheduled_at}
            className="mt-1.5"
          />

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
  campagne = [],
  onClose,
  onSaved,
}: {
  post: PostWithAccount | null
  /** Toutes les publications de la campagne, celle-ci comprise. */
  campagne?: PostWithAccount[]
  onClose: () => void
  onSaved: () => void
}) {
  const [caption, setCaption] = useState('')
  const [hashtags, setHashtags] = useState('')
  const [when, setWhen] = useState('')
  const [videoUrl, setVideoUrl] = useState('')
  const [langue, setLangue] = useState('fr')
  const [titre, setTitre] = useState('')

  const [choixOuvert, setChoixOuvert] = useState(false)
  const [porteeVideo, setPorteeVideo] = useState<'seule' | 'campagne'>('campagne')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!post) return
    setCaption(post.caption ?? '')
    setHashtags((post.hashtags ?? []).join(' '))
    setWhen(toLocalInput(post.scheduled_at))
    setVideoUrl(post.video_url)
    setTitre(post.title ?? '')
    setLangue(langueDe(post, post.accounts))
    setPorteeVideo('campagne')
    setChoixOuvert(false)
    setError(null)
  }, [post])

  // Les autres publications de la campagne qu'on peut encore modifier. Une
  // publication deja partie garde la video avec laquelle elle est partie.
  const soeurs = useMemo(
    () => campagne.filter((p) => p.id !== post?.id && deplacable(p.status)),
    [campagne, post],
  )

  const videoChangee = post != null && videoUrl.trim() !== post.video_url
  const estYoutube = post?.accounts?.platform === 'youtube'

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
        language: langue,
        ...(estYoutube ? { title: titre.trim() || null } : {}),
      })

      // La campagne suit seulement si on l'a demande, et seulement pour ce qui
      // n'est pas encore parti.
      if (videoChangee && porteeVideo === 'campagne' && soeurs.length > 0) {
        await remplacerVideo(
          soeurs.map((p) => p.id),
          videoUrl.trim(),
        )
      }

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
      wide
    >
      <div className="space-y-5">
        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="label !mb-0">Video</span>
            <button className="btn btn-ghost !py-1 !text-xs" onClick={() => setChoixOuvert(true)}>
              Remplacer la video
            </button>
          </div>

          <LecteurVideo
            url={videoUrl}
            platform={post?.accounts?.platform}
            youtubeType={post?.youtube_type}
          />

          {videoChangee && (
            <div className="mt-3 rounded-xl border border-brand-500/40 bg-brand-500/5 p-3">
              <p className="text-xs font-medium text-mist-100">
                Nouvelle video, pas encore enregistree.
              </p>

              {soeurs.length > 0 ? (
                <div className="mt-2 space-y-1.5">
                  <p className="text-xs text-mist-500">
                    Cette publication fait partie d une campagne. Appliquer le changement a :
                  </p>
                  {(
                    [
                      {
                        v: 'campagne' as const,
                        label: `les ${soeurs.length + 1} publications de la campagne`,
                        aide: 'Une campagne, c est une meme video sur plusieurs comptes.',
                      },
                      {
                        v: 'seule' as const,
                        label: 'cette publication seulement',
                        aide: 'Les autres comptes garderont l ancienne video.',
                      },
                    ]
                  ).map((o) => (
                    <label
                      key={o.v}
                      className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-xs transition-colors ${
                        porteeVideo === o.v
                          ? 'border-brand-500/50 bg-brand-500/10'
                          : 'border-ink-700 hover:border-ink-600'
                      }`}
                    >
                      <input
                        type="radio"
                        name="portee-video"
                        className="mt-0.5"
                        checked={porteeVideo === o.v}
                        onChange={() => setPorteeVideo(o.v)}
                      />
                      <span>
                        <span className="block text-mist-100">{o.label}</span>
                        <span className="block text-mist-600">{o.aide}</span>
                      </span>
                    </label>
                  ))}

                  {campagne.length - 1 > soeurs.length && (
                    <p className="text-xs text-mist-600">
                      {campagne.length - 1 - soeurs.length} publication
                      {campagne.length - 1 - soeurs.length > 1 ? 's' : ''} de la campagne{' '}
                      {campagne.length - 1 - soeurs.length > 1 ? 'sont' : 'est'} deja partie
                      {campagne.length - 1 - soeurs.length > 1 ? 's' : ''} et garde
                      {campagne.length - 1 - soeurs.length > 1 ? 'nt' : ''} l ancienne video.
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-1 text-xs text-mist-500">
                  Le changement ne concerne que cette publication.
                </p>
              )}
            </div>
          )}
        </section>

        <div className="grid gap-4 sm:grid-cols-2">
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
            <label className="label" htmlFor="edit-langue">
              Langue du texte
            </label>
            <select
              id="edit-langue"
              className="field"
              value={langue}
              onChange={(e) => setLangue(e.target.value)}
            >
              {LANGUES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                  {l.code === post?.accounts?.language ? ' (langue du compte)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {estYoutube && (
          <div>
            <label className="label" htmlFor="edit-titre">
              Titre {post?.youtube_type === 'video' ? 'de la video' : 'du Short'}
            </label>
            <input
              id="edit-titre"
              className="field"
              value={titre}
              onChange={(e) => setTitre(e.target.value)}
            />
          </div>
        )}

        <div>
          <label className="label" htmlFor="edit-caption">
            {estYoutube && post?.youtube_type === 'video' ? 'Description' : 'Legende'}
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

        <details className="rounded-xl border border-ink-700 px-3 py-2">
          <summary className="cursor-pointer text-xs text-mist-600 hover:text-mist-300">
            Adresse de la video
          </summary>
          <input
            id="edit-video"
            className="field mt-2 font-mono text-xs"
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
          />
        </details>

        {error && <Alert kind="error">{error}</Alert>}

        <div className="flex justify-end gap-2 pt-1">
          <button className="btn btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </div>

      <ChoixVideo
        open={choixOuvert}
        urlActuelle={videoUrl}
        onClose={() => setChoixOuvert(false)}
        onChoisi={(url) => {
          setVideoUrl(url)
          setChoixOuvert(false)
        }}
      />
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
