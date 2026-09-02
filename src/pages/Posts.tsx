import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  cancelPost,
  deletePost,
  deplacerPosts,
  listAccounts,
  listPosts,
  retryPost,
  validerPost,
} from '../lib/api'
import { friendlyError } from '../lib/errors'
import { PLATFORMS, POST_STATUS_LABEL, type Account, type PostWithAccount } from '../lib/types'
import { formatDay, dayKey, toLocalInput } from '../lib/format'
import { deplacable } from '../lib/calendrier'
import { useLiveStatuses } from '../lib/useLiveStatuses'
import { Alert, ConfirmModal, EmptyState, Loading, Modal, PageHeader } from '../components/ui'
import PostComposer from '../components/PostComposer'
import { PostEditor, PostLogs, PostRow } from '../components/PostRow'
import { LigneCampagne, useCampagnesOuvertes } from '../components/Campagne'
import Calendrier, { type DemandeDeplacement } from '../components/Calendrier'
import { QuotaYoutube } from '../components/QuotaYoutube'

const STATUS_FILTERS = [
  'a_valider',
  'pending',
  'processing',
  'published',
  'failed',
  'cancelled',
] as const

const MEMOIRE_VUE = 'bubupost.vue-publications'

type Entree = { cle: string; campagne: boolean; posts: PostWithAccount[] }

/**
 * Regroupe les publications d'une meme campagne, en conservant l'ordre.
 *
 * Une campagne d'un seul compte s'affiche comme une publication simple : la
 * replier n'apporterait rien et ajouterait un clic. Les anciennes publications,
 * sans campaign_id, passent aussi par ce chemin.
 */
function regrouper(posts: PostWithAccount[]): Entree[] {
  const entrees: Entree[] = []
  const index = new Map<string, Entree>()

  for (const post of posts) {
    const id = post.campaign_id
    if (!id) {
      entrees.push({ cle: post.id, campagne: false, posts: [post] })
      continue
    }
    const existante = index.get(id)
    if (existante) {
      existante.posts.push(post)
      continue
    }
    const entree: Entree = { cle: id, campagne: true, posts: [post] }
    index.set(id, entree)
    entrees.push(entree)
  }

  // Une campagne restee a un seul compte redevient une ligne simple.
  return entrees.map((e) => (e.posts.length > 1 ? e : { ...e, campagne: false }))
}

/** « avancee de 2 h », « reportee de 3 jours ». */
function decrireEcart(deltaMs: number): string {
  const sens = deltaMs < 0 ? 'avancee' : 'reportee'
  const abs = Math.abs(deltaMs)

  const minutes = Math.round(abs / 60_000)
  if (minutes < 60) return `${sens} de ${minutes} min`

  const heures = Math.round(minutes / 60)
  if (heures < 48) return `${sens} de ${heures} h`

  return `${sens} de ${Math.round(heures / 24)} jours`
}

export default function Posts() {
  const [posts, setPosts] = useState<PostWithAccount[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [composing, setComposing] = useState(false)
  const [depart, setDepart] = useState<string | null>(null)
  const [editing, setEditing] = useState<PostWithAccount | null>(null)
  const [showingLogs, setShowingLogs] = useState<PostWithAccount | null>(null)
  const [toDelete, setToDelete] = useState<PostWithAccount | null>(null)
  const [deplacement, setDeplacement] = useState<DemandeDeplacement | null>(null)

  const { ouvertes, basculer } = useCampagnesOuvertes()

  // La vue choisie survit au rechargement : revenir a la liste a chaque visite
  // serait vite fatigant pour qui travaille au calendrier.
  const [vue, setVue] = useState<'liste' | 'calendrier'>(() =>
    localStorage.getItem(MEMOIRE_VUE) === 'calendrier' ? 'calendrier' : 'liste',
  )
  useEffect(() => {
    localStorage.setItem(MEMOIRE_VUE, vue)
  }, [vue])

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

  // Les publications imminentes se mettent a jour toutes seules, sans que
  // Diego ait a recharger la page pour voir si c'est parti.
  useLiveStatuses(posts, (maj) => {
    setPosts((actuels) =>
      actuels.map((p) => {
        const ligne = maj.find((m) => m.id === p.id)
        return ligne ? { ...p, ...ligne } : p
      }),
    )
  })

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

  /** Les memes actions, qu'une publication soit seule ou dans une campagne. */
  function actions(post: PostWithAccount) {
    return {
      onEdit: () => setEditing(post),
      onLogs: () => setShowingLogs(post),
      onCancel: () => void act(() => cancelPost(post.id), 'Publication annulee'),
      onValider: () => void act(() => validerPost(post.id), 'Publication validee, elle partira a son heure'),
      onRetry: () => void act(() => retryPost(post.id), 'Publication reprogrammee'),
      onDelete: () => setToDelete(post),
    }
  }

  /** Toute la campagne de la publication en cours de modification. */
  const campagneEditee = useMemo(() => {
    const id = editing?.campaign_id
    if (!id) return []
    return posts.filter((p) => p.campaign_id === id)
  }, [editing, posts])

  /** Les autres publications de la campagne, celle qu'on deplace exclue. */
  const soeurs = useMemo(() => {
    const id = deplacement?.post.campaign_id
    if (!id) return []
    return posts.filter((p) => p.campaign_id === id && p.id !== deplacement?.post.id)
  }, [deplacement, posts])

  /**
   * Applique le deplacement, seul ou pour toute la campagne.
   *
   * Decaler la campagne conserve les ecarts : c'est justement l'etalement qui
   * evite que neuf comptes publient a la meme seconde. On applique donc le meme
   * delta partout, sans recalculer les horaires un par un.
   */
  async function appliquerDeplacement(toutLaCampagne: boolean) {
    if (!deplacement) return
    const { post, cible } = deplacement
    const delta = cible.getTime() - new Date(post.scheduled_at).getTime()

    const maj = [{ id: post.id, scheduled_at: cible.toISOString() }]
    let figees = 0

    if (toutLaCampagne) {
      for (const s of soeurs) {
        if (!deplacable(s.status)) {
          figees++
          continue
        }
        maj.push({
          id: s.id,
          scheduled_at: new Date(new Date(s.scheduled_at).getTime() + delta).toISOString(),
        })
      }
    }

    setDeplacement(null)

    const resume =
      maj.length === 1 ? 'Publication reprogrammee' : `${maj.length} publications reprogrammees`
    const reste =
      figees > 0
        ? `, ${figees} deja partie${figees > 1 ? 's' : ''} laissee${figees > 1 ? 's' : ''} en place`
        : ''

    await act(async () => {
      await deplacerPosts(maj)
    }, resume + reste)
  }

  function ouvrirComposeur(quand?: Date) {
    setDepart(quand ? toLocalInput(quand.toISOString()) : null)
    setComposing(true)
  }

  const hasFilter = brand || platform || accountId || status

  return (
    <div>
      <PageHeader
        title="Publications"
        subtitle={`${filtered.length} publication${filtered.length > 1 ? 's' : ''}${hasFilter ? ' apres filtre' : ''}`}
        action={
          <button className="btn btn-primary" onClick={() => ouvrirComposeur()}>
            Nouvelle publication
          </button>
        }
      />

      <div className="mb-5 flex flex-wrap items-start gap-3">
        <div className="flex gap-1 rounded-xl border border-ink-700 bg-ink-850 p-1">
          {(['liste', 'calendrier'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setVue(v)}
              aria-pressed={vue === v}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                vue === v ? 'bg-brand-500 text-white' : 'text-mist-500 hover:text-mist-100'
              }`}
            >
              {v === 'liste' ? '▤ Liste' : '▦ Calendrier'}
            </button>
          ))}
        </div>

        <div className="panel flex flex-1 flex-wrap gap-3 p-3">
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
      ) : vue === 'calendrier' ? (
        <>
          <QuotaYoutube actif={accounts.some((a) => a.platform === 'youtube')} />
          <Calendrier
            posts={filtered}
            tousPosts={posts}
            onCreer={(quand) => ouvrirComposeur(quand)}
            onOuvrir={(post) => setEditing(post)}
            onDeplacer={(demande) => setDeplacement(demande)}
            onRefus={(message) => setError(message)}
          />
        </>
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
                {regrouper(list).map((entree) =>
                  entree.campagne ? (
                    <LigneCampagne
                      key={entree.cle}
                      posts={entree.posts}
                      ouvert={ouvertes.has(entree.cle)}
                      onToggle={() => basculer(entree.cle)}
                    >
                      {entree.posts.map((post) => (
                        <PostRow key={post.id} post={post} {...actions(post)} />
                      ))}
                    </LigneCampagne>
                  ) : (
                    <PostRow
                      key={entree.posts[0].id}
                      post={entree.posts[0]}
                      {...actions(entree.posts[0])}
                    />
                  ),
                )}
              </div>
            </section>
          ))}
        </div>
      )}

      <PostComposer
        open={composing}
        accounts={accounts}
        depart={depart}
        onClose={() => setComposing(false)}
        onCreated={(count) => {
          setComposing(false)
          setNotice(`${count} publication${count > 1 ? 's' : ''} programmee${count > 1 ? 's' : ''}`)
          void reload()
        }}
      />

      <PostEditor
        post={editing}
        campagne={campagneEditee}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          setNotice('Publication mise a jour')
          void reload()
        }}
      />

      <PostLogs post={showingLogs} onClose={() => setShowingLogs(null)} />

      <ConfirmDeplacement
        demande={deplacement}
        soeurs={soeurs}
        onClose={() => setDeplacement(null)}
        onConfirmer={(tout) => void appliquerDeplacement(tout)}
      />

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

/**
 * Confirmation d'un glisser-deposer.
 *
 * Une publication seule ne pose qu'une question. Une publication de campagne en
 * pose deux, et il n'y a pas de bonne reponse par defaut : deplacer la seule
 * casse l'etalement, deplacer tout le monde touche neuf comptes. On demande.
 */
function ConfirmDeplacement({
  demande,
  soeurs,
  onClose,
  onConfirmer,
}: {
  demande: DemandeDeplacement | null
  soeurs: PostWithAccount[]
  onClose: () => void
  onConfirmer: (toutLaCampagne: boolean) => void
}) {
  if (!demande) return null

  const { post, cible } = demande
  const delta = cible.getTime() - new Date(post.scheduled_at).getTime()
  const mobiles = soeurs.filter((s) => deplacable(s.status))
  const figees = soeurs.length - mobiles.length
  const passe = cible.getTime() < Date.now()

  const quand = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(cible)

  return (
    <Modal open title="Reprogrammer" onClose={onClose}>
      <p className="text-sm text-mist-300">
        <span className="font-medium text-mist-100">
          {post.accounts?.account_name ?? 'Cette publication'}
        </span>{' '}
        partirait le <span className="font-medium text-mist-100">{quand}</span>, soit{' '}
        {decrireEcart(delta)}.
      </p>

      {passe && (
        <div className="mt-3">
          <Alert kind="error">
            Ce creneau est deja passe. La publication partira au prochain passage du planificateur,
            dans les deux minutes.
          </Alert>
        </div>
      )}

      {mobiles.length > 0 && (
        <p className="mt-4 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-sm text-mist-500">
          Elle fait partie d une campagne de {soeurs.length + 1} publications. Decaler toute la
          campagne appliquerait le meme ecart aux {mobiles.length} autre
          {mobiles.length > 1 ? 's' : ''} encore en attente, en conservant l espacement entre elles.
          {figees > 0 && (
            <>
              {' '}
              {figees} publication{figees > 1 ? 's' : ''} deja partie{figees > 1 ? 's' : ''}{' '}
              rester{figees > 1 ? 'ont' : 'a'} en place.
            </>
          )}
        </p>
      )}

      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <button className="btn btn-ghost" onClick={onClose}>
          Annuler
        </button>
        <button className="btn btn-ghost" onClick={() => onConfirmer(false)}>
          {mobiles.length > 0 ? 'Deplacer seulement celle-ci' : 'Deplacer'}
        </button>
        {mobiles.length > 0 && (
          <button className="btn btn-primary" onClick={() => onConfirmer(true)}>
            Decaler toute la campagne
          </button>
        )}
      </div>
    </Modal>
  )
}
