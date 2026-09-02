import { useState } from 'react'
import {
  PLATFORM_ICON,
  POST_STATUS_CLASS,
  POST_STATUS_ICON,
  POST_STATUS_LABEL,
  type PostWithAccount,
} from '../lib/types'
import { formatDateTime } from '../lib/format'
import { Chip } from './ui'

/** Compte les publications par statut, pour le resume replie. */
function agreger(posts: PostWithAccount[]): Array<[string, number]> {
  const par = new Map<string, number>()
  for (const p of posts) par.set(p.status, (par.get(p.status) ?? 0) + 1)
  // Ordre de lecture : ce qui inquiete d'abord, ce qui est fait ensuite.
  const ordre = ['failed', 'processing', 'pending', 'published', 'cancelled']
  return [...par.entries()].sort((a, b) => ordre.indexOf(a[0]) - ordre.indexOf(b[0]))
}

/**
 * Une campagne repliee : une video, ses comptes, ses statuts agreges.
 *
 * Neuf publications d'une meme video prenaient neuf grandes cartes, et il
 * fallait faire defiler pour verifier qu'elles etaient toutes parties. Repliees,
 * elles tiennent sur une ligne qui dit l'essentiel.
 */
export function LigneCampagne({
  posts,
  ouvert,
  onToggle,
  children,
}: {
  posts: PostWithAccount[]
  ouvert: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  const premier = posts[0]
  const statuts = agreger(posts)

  // Les plateformes concernees, sans doublon, dans l'ordre d'apparition.
  const plateformes = [...new Set(posts.map((p) => p.accounts?.platform).filter(Boolean))]

  const prochaine = posts
    .filter((p) => p.status === 'pending' || p.status === 'processing')
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))[0]

  const fichier = premier.video_url.split('/').pop() || premier.video_url

  return (
    <div className="panel overflow-hidden">
      <button
        className="flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left hover:bg-ink-800/40"
        onClick={onToggle}
        aria-expanded={ouvert}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-mist-600">{ouvert ? '▼' : '▶'}</span>
            <span className="text-sm font-semibold">
              Campagne, {posts.length} comptes
            </span>
            <span className="flex gap-1 text-xs opacity-70">
              {plateformes.map((p) => (
                <span key={p} title={p ?? ''}>
                  {PLATFORM_ICON[p ?? '']}
                </span>
              ))}
            </span>
          </div>

          <p className="mt-1.5 truncate text-xs text-mist-500" title={premier.video_url}>
            <span className="mr-1 opacity-70">▷</span>
            {fichier}
          </p>

          {prochaine && (
            <p className="mt-1 text-xs text-mist-600">
              Prochaine le {formatDateTime(prochaine.scheduled_at)}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {statuts.map(([statut, n]) => (
            <Chip key={statut} className={POST_STATUS_CLASS[statut]}>
              {POST_STATUS_ICON[statut]} {n}
              <span className="ml-0.5 hidden sm:inline">{POST_STATUS_LABEL[statut]}</span>
            </Chip>
          ))}
        </div>
      </button>

      {ouvert && <div className="space-y-3 border-t border-ink-800 bg-ink-950/30 p-3">{children}</div>}
    </div>
  )
}

/** Memorise quelles campagnes sont depliees. */
export function useCampagnesOuvertes() {
  const [ouvertes, setOuvertes] = useState<Set<string>>(new Set())
  const basculer = (id: string) =>
    setOuvertes((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  return { ouvertes, basculer }
}
