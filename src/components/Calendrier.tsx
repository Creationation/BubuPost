import { useMemo, useRef, useState } from 'react'
import {
  PLATFORM_ICON,
  PLATFORM_LABEL,
  POST_STATUS_LABEL,
  type PostWithAccount,
} from '../lib/types'
import {
  ajouterJours,
  ajouterMois,
  cleJour,
  couleurCampagne,
  debutDeJour,
  debutDeSemaine,
  depassements,
  deplacable,
  formatHeure,
  formatJourCourt,
  formatJourLong,
  formatMois,
  grilleDeSemaine,
  grilleDuMois,
  JOURS_SEMAINE,
  parJour,
  raisonNonDeplacable,
  type Vue,
} from '../lib/calendrier'
import { useSeconde } from '../lib/countdown'
import { langue as trouverLangue, langueDe, teinteLangue } from '../lib/langues'

/** Pastille de statut : une couleur, pas de texte, la place est comptee. */
const PASTILLE: Record<string, string> = {
  pending: 'bg-warn-400',
  processing: 'bg-idle-400',
  published: 'bg-ok-400',
  failed: 'bg-bad-400',
  cancelled: 'bg-mist-600',
}

/** Combien de publications on montre avant de replier le reste. */
const APERCU_MOIS = 3

export type DemandeDeplacement = { post: PostWithAccount; cible: Date }

type Props = {
  /** Ce qui s'affiche : deja passe par les filtres. */
  posts: PostWithAccount[]
  /**
   * Tout, filtres compris. Sert uniquement aux alertes de limite : masquer
   * EdgeSyncFX ne fait pas disparaitre les six envois YouTube du jour.
   */
  tousPosts: PostWithAccount[]
  onCreer: (quand: Date) => void
  onOuvrir: (post: PostWithAccount) => void
  onDeplacer: (demande: DemandeDeplacement) => void
  onRefus: (message: string) => void
}

export default function Calendrier({
  posts,
  tousPosts,
  onCreer,
  onOuvrir,
  onDeplacer,
  onRefus,
}: Props) {
  const [vue, setVue] = useState<Vue>('mois')
  const [ancre, setAncre] = useState<Date>(() => debutDeJour(new Date()))
  const [depliees, setDepliees] = useState<Set<string>>(new Set())

  // Le post en cours de glissement. Une ref plutot qu'un etat : le navigateur
  // ne rend pas le texte du dataTransfer lisible pendant le survol, et rien
  // ici n'a besoin d'un rendu a chaque deplacement de souris.
  const glisse = useRef<PostWithAccount | null>(null)
  const [survole, setSurvole] = useState<string | null>(null)

  const seconde = useSeconde()
  const maintenant = useMemo(() => new Date(), [seconde])

  const affiches = useMemo(() => parJour(posts), [posts])
  const complets = useMemo(() => parJour(tousPosts), [tousPosts])

  const jours = useMemo(() => {
    if (vue === 'mois') return grilleDuMois(ancre)
    if (vue === 'semaine') return grilleDeSemaine(ancre)
    return [debutDeJour(ancre)]
  }, [vue, ancre])

  function naviguer(sens: -1 | 1) {
    if (vue === 'mois') setAncre((d) => ajouterMois(d, sens))
    else if (vue === 'semaine') setAncre((d) => ajouterJours(d, sens * 7))
    else setAncre((d) => ajouterJours(d, sens))
  }

  const titre =
    vue === 'mois'
      ? formatMois(ancre)
      : vue === 'jour'
        ? formatJourLong(ancre)
        : `Semaine du ${formatJourCourt(debutDeSemaine(ancre))} au ${formatJourCourt(ajouterJours(debutDeSemaine(ancre), 6))}`

  // ---- glisser-deposer -----------------------------------------------------

  function debutGlisse(post: PostWithAccount, e: React.DragEvent) {
    if (!deplacable(post.status)) {
      e.preventDefault()
      onRefus(raisonNonDeplacable(post.status))
      return
    }
    glisse.current = post
    e.dataTransfer.effectAllowed = 'move'
    // Certains navigateurs annulent le glissement si rien n'est transporte.
    e.dataTransfer.setData('text/plain', post.id)
  }

  /**
   * Ou tombe la publication.
   *
   * En vue mois on ne connait que le jour : l'heure d'origine est conservee,
   * sinon deplacer une publication du 3 au 4 la ferait aussi changer d'heure
   * sans qu'on l'ait demande.
   */
  function deposer(jour: Date, heure: number | null) {
    const post = glisse.current
    glisse.current = null
    setSurvole(null)
    if (!post) return

    const origine = new Date(post.scheduled_at)
    const cible = new Date(jour)
    cible.setHours(
      heure === null ? origine.getHours() : heure,
      origine.getMinutes(),
      0,
      0,
    )

    if (cible.getTime() === origine.getTime()) return
    onDeplacer({ post, cible })
  }

  function zoneDepot(cle: string, jour: Date, heure: number | null) {
    return {
      onDragOver: (e: React.DragEvent) => {
        if (!glisse.current) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (survole !== cle) setSurvole(cle)
      },
      onDragLeave: () => setSurvole((s) => (s === cle ? null : s)),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault()
        deposer(jour, heure)
      },
    }
  }

  return (
    <div>
      <BarreNavigation
        titre={titre}
        vue={vue}
        setVue={setVue}
        naviguer={naviguer}
        aujourdhui={() => setAncre(debutDeJour(new Date()))}
      />

      {vue === 'mois' ? (
        <GrilleMois
          jours={jours}
          affiches={affiches}
          complets={complets}
          maintenant={maintenant}
          depliees={depliees}
          basculer={(cle) =>
            setDepliees((prev) => {
              const next = new Set(prev)
              if (next.has(cle)) next.delete(cle)
              else next.add(cle)
              return next
            })
          }
          survole={survole}
          zoneDepot={zoneDepot}
          onCreer={onCreer}
          onOuvrir={onOuvrir}
          debutGlisse={debutGlisse}
        />
      ) : (
        <GrilleHeures
          jours={jours}
          affiches={affiches}
          complets={complets}
          maintenant={maintenant}
          survole={survole}
          zoneDepot={zoneDepot}
          onCreer={onCreer}
          onOuvrir={onOuvrir}
          debutGlisse={debutGlisse}
        />
      )}

      <Legende />
    </div>
  )
}

// ---------------------------------------------------------------------------

function BarreNavigation({
  titre,
  vue,
  setVue,
  naviguer,
  aujourdhui,
}: {
  titre: string
  vue: Vue
  setVue: (v: Vue) => void
  naviguer: (sens: -1 | 1) => void
  aujourdhui: () => void
}) {
  const vues: { cle: Vue; label: string }[] = [
    { cle: 'mois', label: 'Mois' },
    { cle: 'semaine', label: 'Semaine' },
    { cle: 'jour', label: 'Jour' },
  ]

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <button className="btn btn-ghost !px-2.5" onClick={() => naviguer(-1)} aria-label="Precedent">
          ‹
        </button>
        <button className="btn btn-ghost" onClick={aujourdhui}>
          Aujourd hui
        </button>
        <button className="btn btn-ghost !px-2.5" onClick={() => naviguer(1)} aria-label="Suivant">
          ›
        </button>
        <span className="ml-1 text-sm font-semibold capitalize">{titre}</span>
      </div>

      <div className="flex gap-1 rounded-xl border border-ink-700 bg-ink-850 p-1">
        {vues.map((v) => (
          <button
            key={v.cle}
            onClick={() => setVue(v.cle)}
            aria-pressed={vue === v.cle}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              vue === v.cle ? 'bg-brand-500 text-white' : 'text-mist-500 hover:text-mist-100'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

type CommunProps = {
  jours: Date[]
  affiches: Map<string, PostWithAccount[]>
  complets: Map<string, PostWithAccount[]>
  maintenant: Date
  survole: string | null
  zoneDepot: (cle: string, jour: Date, heure: number | null) => Record<string, unknown>
  onCreer: (quand: Date) => void
  onOuvrir: (post: PostWithAccount) => void
  debutGlisse: (post: PostWithAccount, e: React.DragEvent) => void
}

function GrilleMois({
  jours,
  affiches,
  complets,
  maintenant,
  depliees,
  basculer,
  survole,
  zoneDepot,
  onCreer,
  onOuvrir,
  debutGlisse,
}: CommunProps & { depliees: Set<string>; basculer: (cle: string) => void }) {
  const moisAffiche = jours[15].getMonth()
  const cleAujourdhui = cleJour(maintenant)

  return (
    <div className="panel overflow-hidden">
      <div className="grid grid-cols-7 border-b border-ink-800">
        {JOURS_SEMAINE.map((j) => (
          <div
            key={j}
            className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-mist-600"
          >
            {j}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {jours.map((jour) => {
          const cle = cleJour(jour)
          const liste = affiches.get(cle) ?? []
          const horsMois = jour.getMonth() !== moisAffiche
          const estAujourdhui = cle === cleAujourdhui
          const deplie = depliees.has(cle)
          const visibles = deplie ? liste : liste.slice(0, APERCU_MOIS)
          const restants = liste.length - visibles.length

          return (
            <div
              key={cle}
              {...zoneDepot(cle, jour, null)}
              className={`min-h-[7.5rem] border-b border-r border-ink-800 p-1.5 transition-colors ${
                horsMois ? 'bg-ink-950/40' : ''
              } ${survole === cle ? 'bg-brand-500/10 ring-1 ring-inset ring-brand-500/40' : ''}`}
            >
              <div className="mb-1 flex items-center justify-between gap-1">
                <button
                  onClick={() => onCreer(creneauParDefaut(jour))}
                  title="Programmer une publication ce jour"
                  className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs tabular-nums transition-colors hover:bg-ink-700 ${
                    estAujourdhui
                      ? 'bg-brand-500 font-bold text-white hover:bg-brand-400'
                      : horsMois
                        ? 'text-mist-600'
                        : 'text-mist-300'
                  }`}
                >
                  {jour.getDate()}
                </button>
                <Alertes posts={complets.get(cle) ?? []} compact />
              </div>

              <div className="space-y-1">
                {visibles.map((post) => (
                  <Pastille
                    key={post.id}
                    post={post}
                    onOuvrir={onOuvrir}
                    debutGlisse={debutGlisse}
                  />
                ))}
              </div>

              {restants > 0 && (
                <button
                  onClick={() => basculer(cle)}
                  className="mt-1 w-full rounded px-1 py-0.5 text-left text-[11px] font-medium text-mist-500 hover:bg-ink-800 hover:text-mist-100"
                >
                  + {restants} autre{restants > 1 ? 's' : ''}
                </button>
              )}
              {deplie && liste.length > APERCU_MOIS && (
                <button
                  onClick={() => basculer(cle)}
                  className="mt-1 w-full rounded px-1 py-0.5 text-left text-[11px] font-medium text-mist-600 hover:bg-ink-800 hover:text-mist-100"
                >
                  Replier
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

const HEURES = Array.from({ length: 24 }, (_, i) => i)

function GrilleHeures({
  jours,
  affiches,
  complets,
  maintenant,
  survole,
  zoneDepot,
  onCreer,
  onOuvrir,
  debutGlisse,
}: CommunProps) {
  const cleAujourdhui = cleJour(maintenant)
  const heureCourante = maintenant.getHours()
  const positionDansHeure = (maintenant.getMinutes() / 60) * 100

  // Une journee de 24 lignes est trop haute pour un ecran : on ouvre sur la
  // plage utile et on laisse defiler pour le reste.
  const conteneur = useRef<HTMLDivElement | null>(null)

  return (
    <div className="panel overflow-hidden">
      <div className="flex border-b border-ink-800 pr-2">
        <div className="w-14 shrink-0" />
        {jours.map((jour) => {
          const cle = cleJour(jour)
          const estAujourdhui = cle === cleAujourdhui
          return (
            <div key={cle} className="min-w-0 flex-1 px-2 py-2 text-center">
              <div
                className={`text-xs font-semibold capitalize ${estAujourdhui ? 'text-brand-400' : 'text-mist-500'}`}
              >
                {jours.length === 1 ? formatJourLong(jour) : formatJourCourt(jour)}
              </div>
              <div className="mt-1 flex justify-center">
                <Alertes posts={complets.get(cle) ?? []} />
              </div>
            </div>
          )
        })}
      </div>

      <div ref={conteneur} className="max-h-[34rem] overflow-y-auto">
        {HEURES.map((h) => {
          const marqueur = jours.some((j) => cleJour(j) === cleAujourdhui) && h === heureCourante
          return (
            <div key={h} className="relative flex min-h-[3rem] border-b border-ink-800/70">
              <div className="w-14 shrink-0 border-r border-ink-800/70 px-2 pt-1 text-right text-[11px] tabular-nums text-mist-600">
                {String(h).padStart(2, '0')}:00
              </div>

              {jours.map((jour) => {
                const cle = `${cleJour(jour)}#${h}`
                const liste = (affiches.get(cleJour(jour)) ?? []).filter(
                  (p) => new Date(p.scheduled_at).getHours() === h,
                )
                return (
                  <button
                    key={cle}
                    type="button"
                    {...zoneDepot(cle, jour, h)}
                    onClick={() => onCreer(creneauExact(jour, h))}
                    title={`Programmer a ${String(h).padStart(2, '0')}:00`}
                    className={`min-w-0 flex-1 space-y-1 border-r border-ink-800/40 p-1 text-left transition-colors hover:bg-ink-800/30 ${
                      survole === cle ? 'bg-brand-500/10 ring-1 ring-inset ring-brand-500/40' : ''
                    }`}
                  >
                    {liste.map((post) => (
                      <Pastille
                        key={post.id}
                        post={post}
                        detaille={jours.length === 1}
                        onOuvrir={onOuvrir}
                        debutGlisse={debutGlisse}
                      />
                    ))}
                  </button>
                )
              })}

              {marqueur && (
                <div
                  className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
                  style={{ top: `${positionDansHeure}%` }}
                  aria-hidden="true"
                >
                  <span className="ml-11 h-2 w-2 shrink-0 rounded-full bg-bad-400" />
                  <span className="h-px flex-1 bg-bad-400/70" />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

/** Une publication, en une ligne compacte. */
function Pastille({
  post,
  detaille,
  onOuvrir,
  debutGlisse,
}: {
  post: PostWithAccount
  detaille?: boolean
  onOuvrir: (post: PostWithAccount) => void
  debutGlisse: (post: PostWithAccount, e: React.DragEvent) => void
}) {
  const teinte = couleurCampagne(post.campaign_id)
  const bougeable = deplacable(post.status)
  const plateforme = post.accounts?.platform ?? ''

  const codeLangue = langueDe(post, post.accounts)

  const titre = [
    formatHeure(post.scheduled_at),
    PLATFORM_LABEL[plateforme] ?? plateforme,
    post.accounts?.account_name ?? 'compte supprime',
    `texte en ${trouverLangue(codeLangue).label.toLowerCase()}`,
    POST_STATUS_LABEL[post.status],
    post.campaign_id ? 'Fait partie d une campagne' : null,
    bougeable ? null : raisonNonDeplacable(post.status),
  ]
    .filter(Boolean)
    .join(' - ')

  return (
    <div
      role="button"
      tabIndex={0}
      draggable={bougeable}
      onDragStart={(e) => debutGlisse(post, e)}
      onClick={(e) => {
        e.stopPropagation()
        onOuvrir(post)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          e.stopPropagation()
          onOuvrir(post)
        }
      }}
      title={titre}
      className={`flex w-full items-center gap-1 rounded border-l-[3px] bg-ink-800/80 px-1.5 py-1 text-left text-[11px] transition-colors hover:bg-ink-700 ${teinte.bord} ${
        bougeable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
      } ${post.status === 'cancelled' ? 'opacity-50' : ''}`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${PASTILLE[post.status] ?? 'bg-mist-600'}`}
        aria-hidden="true"
      />
      <span className="shrink-0 tabular-nums text-mist-500">{formatHeure(post.scheduled_at)}</span>
      <span className="shrink-0 opacity-80" aria-hidden="true">
        {PLATFORM_ICON[plateforme] ?? '•'}
      </span>
      <span className="min-w-0 flex-1 truncate text-mist-300">
        {post.accounts?.account_name ?? 'compte supprime'}
      </span>
      <span
        className={`shrink-0 rounded px-1 text-[9px] font-semibold leading-4 ${teinteLangue(codeLangue)}`}
      >
        {trouverLangue(codeLangue).badge}
      </span>
      {post.campaign_id && (
        <span className={`shrink-0 text-[9px] ${teinte.texte}`} aria-hidden="true">
          ◆
        </span>
      )}
      {detaille && post.accounts?.brand && (
        <span className="hidden shrink-0 text-mist-600 sm:inline">{post.accounts.brand}</span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

/**
 * Ce que le jour depasse, et ce que YouTube a deja consomme.
 *
 * Un jour a sept envois YouTube part sans probleme apparent puis echoue au
 * septieme, quota epuise. Le signaler la veille coute une icone.
 */
function Alertes({ posts, compact }: { posts: PostWithAccount[]; compact?: boolean }) {
  const soucis = depassements(posts)

  const youtube = posts.filter(
    (p) => p.accounts?.platform === 'youtube' && p.status !== 'cancelled' && p.status !== 'failed',
  ).length

  if (soucis.length === 0 && youtube === 0) return null

  const trop = soucis.length > 0
  const detail = soucis
    .map((d) => `${PLATFORM_LABEL[d.platform] ?? d.platform} : ${d.prevues} prevues pour ${d.limite} au maximum`)
    .join('. ')

  return (
    <span className="flex items-center gap-1">
      {youtube > 0 && (
        <span
          title={`${youtube} envoi(s) YouTube ce jour, sur 6 possibles. Le quota est partage par toutes tes chaines.`}
          className={`inline-flex items-center gap-0.5 rounded px-1 py-px text-[10px] font-semibold tabular-nums ${
            youtube > 6
              ? 'bg-bad-400/15 text-bad-400'
              : youtube === 6
                ? 'bg-warn-400/15 text-warn-400'
                : 'bg-ink-800 text-mist-500'
          }`}
        >
          ▶ {youtube}/6
        </span>
      )}
      {trop && (
        <span
          title={`Limite de plateforme depassee. ${detail}`}
          className="inline-flex items-center rounded bg-bad-400/15 px-1 py-px text-[10px] font-semibold text-bad-400"
        >
          ⚠{compact ? '' : ' limite'}
        </span>
      )}
    </span>
  )
}

function Legende() {
  return (
    <p className="mt-3 text-xs text-mist-600">
      Clique un jour ou un creneau pour programmer, une publication pour l ouvrir. Glisse une
      publication en attente vers un autre creneau pour la reprogrammer. Le losange ◆ colore signale
      les publications d une meme campagne, et les deux lettres colorees donnent la langue du
      texte.
    </p>
  )
}

// ---------------------------------------------------------------------------

/** Heure proposee quand on clique un jour sans preciser l heure. */
function creneauParDefaut(jour: Date): Date {
  const d = new Date(jour)
  // Neuf heures : une heure de publication plausible, jamais minuit, qui
  // ferait croire a une erreur de saisie.
  d.setHours(9, 0, 0, 0)
  return d
}

function creneauExact(jour: Date, heure: number): Date {
  const d = new Date(jour)
  d.setHours(heure, 0, 0, 0)
  return d
}
