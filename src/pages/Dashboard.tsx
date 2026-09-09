import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  apercuCadence,
  dernierSigneDeVie,
  listAccounts,
  listerDossiers,
  listPosts,
  lireConfigAuto,
  type EtatReserve,
  type SignesDeVie,
} from '../lib/api'
import { friendlyError } from '../lib/errors'
import { PLATFORM_ICON, type Account, type PostWithAccount } from '../lib/types'
import { formatDateTime, formatDay, dayKey } from '../lib/format'
import { Alert, EmptyState, Loading, PageHeader } from '../components/ui'
import { BadgeStatut, LigneAttente, ProchainePublication } from '../components/Attente'
import { useLiveStatuses } from '../lib/useLiveStatuses'
import { useScheduler } from '../lib/scheduler'
import { QuotaYoutube } from '../components/QuotaYoutube'
import { ListeAttention, pointsDAttention } from '../components/Attention'
import { normaliserConfig, type ConfigAuto } from '../lib/automatisation'

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
  const [config, setConfig] = useState<ConfigAuto | null>(null)
  const [reserve, setReserve] = useState<EtatReserve[]>([])
  const [ping, setPing] = useState<SignesDeVie | null>(null)
  const [dossiers, setDossiers] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { intervalleMinutes } = useScheduler()

  useEffect(() => {
    // Les publications et les comptes d'abord : sans eux la page n'a rien a
    // montrer. Le reste enrichit l'ecran et ne doit pas l'empecher de
    // s'afficher s'il echoue.
    Promise.all([listPosts(), listAccounts()])
      .then(([p, a]) => {
        setPosts(p)
        setAccounts(a)
      })
      .catch((err) => setError(friendlyError(err)))
      .finally(() => setLoading(false))

    void (async () => {
      try {
        const [c, d, sv] = await Promise.all([
          lireConfigAuto(),
          listerDossiers(),
          dernierSigneDeVie(),
        ])
        setConfig(normaliserConfig(c))
        setDossiers(d.filter((x) => x.actif).length)
        setPing(sv)
      } catch {
        // L'automatisation n'est peut-etre pas encore en place.
      }
      try {
        setReserve((await apercuCadence()).reserve)
      } catch {
        // L'apercu appelle une fonction : son echec ne doit rien casser ici.
      }
    })()
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

  /**
   * Ce qui demande une action, tout de suite.
   *
   * Compter ne dit pas quoi faire : neuf comptes actifs et zero en attente
   * peut vouloir dire que tout va bien, ou que la chaine est arretee depuis
   * trois jours. Cette liste-la tranche, et porte le lien qui traite chaque
   * point.
   */
  const attention = useMemo(
    () => pointsDAttention({ comptes: accounts, posts, config, reserve, ping, dossiers }),
    [accounts, posts, config, reserve, ping, dossiers],
  )

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
        subtitle={`Le scheduler tourne tout seul, toutes les ${intervalleMinutes} minutes`}
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

      {/*
        Ce qui demande une action passe avant tout le reste. Les compteurs
        decrivent, cette liste-la agit.
      */}
      <div className="mb-6">
        <ListeAttention points={attention} />
      </div>

      <ProchainePublication posts={posts} />

      {/* Affiche seulement si une chaine YouTube existe : sinon c'est du bruit. */}
      <QuotaYoutube actif={accounts.some((a) => a.platform === 'youtube')} />

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
