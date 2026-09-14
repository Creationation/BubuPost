import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  apercuCadence,
  deplacerVideo,
  lancerMoteur,
  listAccounts,
  listerBibliotheque,
  listerDossiers,
  listerSources,
  lireConfigAuto,
  majVideo,
  programmerVideo,
  remettreVideo,
  supprimerVideo,
  type EtatMarque,
  type EtatReserve,
  type Prevision,
  type Source,
} from '../lib/api'
import { friendlyError } from '../lib/errors'
import {
  dateLisible,
  journeesVues,
  normaliserConfig,
  type ConfigAuto,
  type Dossier,
  type Video,
} from '../lib/automatisation'
import { LANGUES, teinteLangue, langue as trouverLangue } from '../lib/langues'
import { formatDateTime, toLocalInput, fromLocalInput } from '../lib/format'
import { Alert, ConfirmModal, EmptyState, Loading, Modal, PageHeader } from '../components/ui'
import { LecteurVideo } from '../components/Video'

export default function Bibliotheque() {
  const [videos, setVideos] = useState<Video[]>([])
  const [previsions, setPrevisions] = useState<Prevision[]>([])
  const [reserve, setReserve] = useState<EtatReserve[]>([])
  const [config, setConfig] = useState<ConfigAuto | null>(null)
  const [marques, setMarques] = useState<string[]>([])

  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [filtreMarque, setFiltreMarque] = useState('')
  const [vue, setVue] = useState<'file' | 'sources'>('file')
  const [sources, setSources] = useState<Source[]>([])
  const [dossiers, setDossiers] = useState<Dossier[]>([])
  const [enEdition, setEnEdition] = useState<Video | null>(null)
  const [aProgrammer, setAProgrammer] = useState<Video | null>(null)
  const [aSupprimer, setASupprimer] = useState<Video | null>(null)

  // La video en cours de glissement. Une ref plutot qu'un etat : rien ici n'a
  // besoin d'un rendu a chaque mouvement de souris.
  const glisse = useRef<Video | null>(null)
  const [survole, setSurvole] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [v, c, comptes, src, d] = await Promise.all([
        listerBibliotheque(),
        lireConfigAuto(),
        listAccounts(),
        listerSources(),
        listerDossiers(),
      ])
      setVideos(v)
      setSources(src)
      setDossiers(d)
      setConfig(normaliserConfig(c))
      setMarques([...new Set(comptes.map((a) => a.brand))].filter(Boolean).sort())
      setError(null)

      // L'apercu appelle le moteur : s'il echoue, la liste doit rester lisible.
      try {
        const a = await apercuCadence()
        setPrevisions(a.previsions)
        setReserve(a.reserve)
      } catch {
        setPrevisions([])
      }
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  async function agir(fn: () => Promise<void>, message: string) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      setNotice(message)
      await reload()
    } catch (err) {
      setError(friendlyError(err))
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const enFile = useMemo(
    () =>
      videos.filter(
        (v) =>
          v.statut !== 'programmee' &&
          v.statut !== 'retiree' &&
          (!filtreMarque || v.marque === filtreMarque),
      ),
    [videos, filtreMarque],
  )

  const programmees = useMemo(
    () =>
      videos.filter(
        (v) => v.statut === 'programmee' && (!filtreMarque || v.marque === filtreMarque),
      ),
    [videos, filtreMarque],
  )

  const parId = useMemo(() => new Map(previsions.map((p) => [p.id, p])), [previsions])

  // ---- glisser-deposer ----------------------------------------------------

  async function deposer(cible: Video) {
    const source = glisse.current
    glisse.current = null
    setSurvole(null)
    if (!source || source.id === cible.id) return

    if (source.marque !== cible.marque) {
      setError(
        "On ne reordonne qu'a l'interieur d'une marque : chaque marque a sa propre file et sa propre cadence.",
      )
      return
    }

    // On se place JUSTE AVANT la cible : c'est ce qu'on attend en lachant sur
    // une ligne. Le rang devient la moyenne entre elle et celle d'au-dessus.
    const memeMarque = enFile.filter((v) => v.marque === cible.marque)
    const index = memeMarque.findIndex((v) => v.id === cible.id)
    const precedente = memeMarque[index - 1]

    await agir(
      () =>
        deplacerVideo(
          source.id,
          source.marque,
          precedente ? precedente.rang : null,
          cible.rang,
        ),
      'File reordonnee',
    )
  }

  const seuilBas = reserve.filter((r) => r.reste <= r.seuil)

  return (
    <div>
      <PageHeader
        title="Bibliotheque"
        subtitle="Les videos deposees, dans l ordre ou elles partiront. Le watcher remplit, tu ordonnes, le moteur vide."
        action={
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() =>
              void agir(async () => {
                const r = await lancerMoteur()
                if (r.ignore) throw new Error(`Le moteur n a rien fait : ${r.ignore}`)
              }, 'Passage du moteur effectue')
            }
          >
            Lancer le moteur maintenant
          </button>
        }
      />

      {config && !config.moteur.actif && (
        <div className="mb-4">
          <Alert kind="info">
            Le moteur de cadence est arrete : les videos s accumulent sans etre programmees. Tu
            peux l allumer dans Automatisation, ou lancer un passage a la main ci-dessus.
          </Alert>
        </div>
      )}

      {seuilBas.length > 0 && (
        <div className="mb-4">
          {/*
            Une seule phrase, meme pour trois marques. Trois lignes qui disent
            la meme chose mot pour mot se lisent comme du bruit, et le creneau
            saute, qui est l'information utile, s'y perd.
          */}
          <Alert kind={seuilBas.some((r) => r.reste === 0) ? 'error' : 'info'}>
            {(() => {
              const vides = seuilBas.filter((r) => r.reste === 0)
              const basses = seuilBas.filter((r) => r.reste > 0)
              const creneau = vides.find((r) => r.creneauSaute)?.creneauSaute
              const phrases: string[] = []

              if (vides.length > 0) {
                phrases.push(
                  vides.length === reserve.length
                    ? 'Aucune video en reserve, aucune marque'
                    : `Aucune video en reserve pour ${vides.map((r) => r.marque).join(', ')}`,
                )
                if (creneau) {
                  phrases[phrases.length - 1] +=
                    `. Le creneau du ${formatDateTime(creneau)} sera saute`
                }
              }
              if (basses.length > 0) {
                phrases.push(
                  `Reserve basse : ${basses.map((r) => `${r.marque} (${r.reste})`).join(', ')}`,
                )
              }
              return phrases.join('. ') + '.'
            })()}
          </Alert>
        </div>
      )}

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

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-xl border border-ink-700 bg-ink-850 p-1">
          {(
            [
              { cle: 'file' as const, label: 'File d attente' },
              { cle: 'sources' as const, label: 'Ou j en suis' },
            ]
          ).map((o) => (
            <button
              key={o.cle}
              onClick={() => setVue(o.cle)}
              aria-pressed={vue === o.cle}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                vue === o.cle ? 'bg-brand-500 text-white' : 'text-mist-500 hover:text-mist-100'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        <select
          className="field !w-auto"
          value={filtreMarque}
          onChange={(e) => setFiltreMarque(e.target.value)}
        >
          <option value="">Toutes les marques</option>
          {marques.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <span className="text-sm text-mist-500">
          {enFile.length} en file, {programmees.length} deja programmee
          {programmees.length > 1 ? 's' : ''}
        </span>
      </div>

      {loading ? (
        <Loading />
      ) : vue === 'sources' ? (
        <VueSources
          sources={sources}
          filtreMarque={filtreMarque}
          dossiers={dossiers}
          onRemettre={(id) => void agir(() => remettreVideo(id), 'Video remise en file')}
        />
      ) : enFile.length === 0 ? (
        <EmptyState
          icon="▽"
          title="Aucune video en reserve"
          hint="Depose des videos dans un dossier surveille : le watcher les ajoutera ici, et tu decideras de leur ordre."
        />
      ) : (
        <ul className="space-y-3">
          {enFile.map((v) => {
            const prevision = parId.get(v.id)
            const enPause = v.statut === 'en_pause'
            return (
              <li
                key={v.id}
                draggable
                onDragStart={() => {
                  glisse.current = v
                }}
                onDragOver={(e) => {
                  if (!glisse.current) return
                  e.preventDefault()
                  if (survole !== v.id) setSurvole(v.id)
                }}
                onDragLeave={() => setSurvole((s) => (s === v.id ? null : s))}
                onDrop={(e) => {
                  e.preventDefault()
                  void deposer(v)
                }}
                className={`panel cursor-grab p-4 transition-colors active:cursor-grabbing ${
                  survole === v.id ? 'ring-1 ring-brand-500/50' : ''
                } ${enPause ? 'opacity-60' : ''} ${
                  v.prioritaire ? 'border-l-4 border-l-warn-400' : ''
                }`}
              >
                <div className="flex flex-wrap gap-4">
                  <div className="w-32 shrink-0">
                    <LecteurVideo url={v.video_url} compact />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-mist-600">⠿</span>
                      <span className="text-sm font-semibold">{v.marque}</span>
                      <span className={`chip ${teinteLangue(v.langue ?? 'fr')}`}>
                        {trouverLangue(v.langue).badge}
                      </span>
                      {v.prioritaire && (
                        <span className="chip border-warn-400/30 bg-warn-400/10 text-warn-400">
                          ★ prioritaire
                        </span>
                      )}
                      {enPause && (
                        <span className="chip border-mist-500/30 bg-mist-500/10 text-mist-500">
                          en pause
                        </span>
                      )}
                      {v.profil && <span className="text-xs text-mist-600">{v.profil}</span>}
                    </div>

                    <p className="mt-1.5 text-sm text-mist-100">{v.sujet}</p>
                    <p className="mt-0.5 truncate text-xs text-mist-600" title={v.fichier}>
                      {v.fichier} · ajoutee le {formatDateTime(v.created_at)}
                    </p>

                    <p className="mt-2 text-xs">
                      {enPause ? (
                        <span className="text-mist-600">
                          En reserve, le moteur ne la piochera pas.
                        </span>
                      ) : prevision?.creneau ? (
                        <span className="text-ok-400">
                          Prevue le {formatDateTime(prevision.creneau)}
                        </span>
                      ) : (
                        <span className="text-warn-400">
                          Pas de creneau libre en vue : la cadence est pleine pour les jours a
                          venir.
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-col gap-1.5">
                    <button
                      className="btn btn-ghost !py-1 !text-xs"
                      onClick={() =>
                        void agir(
                          () => majVideo(v.id, { prioritaire: !v.prioritaire }),
                          v.prioritaire ? 'Priorite retiree' : 'Video passee prioritaire',
                        )
                      }
                    >
                      {v.prioritaire ? 'Retirer la priorite' : 'Prioritaire'}
                    </button>
                    <button
                      className="btn btn-ghost !py-1 !text-xs"
                      onClick={() =>
                        void agir(
                          () => majVideo(v.id, { statut: enPause ? 'en_file' : 'en_pause' }),
                          enPause ? 'Video remise en file' : 'Video mise en reserve',
                        )
                      }
                    >
                      {enPause ? 'Remettre en file' : 'Mettre en pause'}
                    </button>
                    <button
                      className="btn btn-ghost !py-1 !text-xs"
                      onClick={() => setEnEdition(v)}
                    >
                      Modifier
                    </button>
                    <button
                      className="btn btn-ghost !py-1 !text-xs"
                      onClick={() => setAProgrammer(v)}
                    >
                      Programmer
                    </button>
                    <button
                      className="btn btn-danger !py-1 !text-xs"
                      onClick={() => setASupprimer(v)}
                    >
                      Retirer
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {vue === 'file' && programmees.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-mist-500">
            Deja programmees
          </h2>
          <ul className="space-y-2">
            {programmees.map((v) => (
              <li key={v.id} className="panel flex flex-wrap items-center gap-3 p-3">
                <span className="text-xs text-ok-400">✓</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{v.sujet}</span>
                  <span className="block text-xs text-mist-600">
                    {v.marque} ·{' '}
                    {v.programmee_pour
                      ? `programmee le ${formatDateTime(v.programmee_pour)}`
                      : 'campagne creee'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <EditerVideo
        video={enEdition}
        marques={marques}
        profils={config?.profils.map((p) => p.nom) ?? []}
        onClose={() => setEnEdition(null)}
        onEnregistrer={(id, input) => {
          setEnEdition(null)
          void agir(() => majVideo(id, input), 'Video mise a jour')
        }}
      />

      <ProgrammerVideo
        video={aProgrammer}
        onClose={() => setAProgrammer(null)}
        onProgrammer={(id, quand) => {
          setAProgrammer(null)
          void agir(async () => {
            await programmerVideo(id, quand)
          }, 'Campagne creee a la date choisie')
        }}
      />

      <ConfirmModal
        open={aSupprimer !== null}
        title="Retirer cette video de la file"
        message="Elle sort de la file et ne sera pas programmee. Elle reste visible dans « Ou j en suis », marquee retiree, d ou tu peux la remettre en file."
        confirmLabel="Retirer"
        danger
        onConfirm={() => {
          if (aSupprimer) void agir(() => supprimerVideo(aSupprimer.id), 'Video retiree')
        }}
        onClose={() => setASupprimer(null)}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------

/**
 * Ou j'en suis, fichier par fichier.
 *
 * La file repond a « qu est-ce qui part ensuite ». Cette vue-la repond a
 * « est-ce que celle-la est deja passee, et sur quelles marques ». Sur un
 * dossier de soixante-dix videos et trois marques, c'est la question qu'on se
 * pose vraiment avant de produire la suivante.
 */
/** Ce qu une marque a fait d une video, en un mot et une couleur. */
function etatMarque(e: EtatMarque): { libelle: string; teinte: string; detail: string } {
  if (e.statut === 'retiree') {
    return { libelle: 'retiree', teinte: 'border-ink-700 bg-ink-850 text-mist-600', detail: 'ecartee a la main, ne partira pas' }
  }
  if (e.statut === 'en_pause') {
    return { libelle: 'en pause', teinte: 'border-mist-500/30 bg-mist-500/10 text-mist-500', detail: 'mise de cote' }
  }
  if (e.statut === 'en_file') {
    return { libelle: 'en file', teinte: 'border-warn-400/30 bg-warn-400/10 text-warn-400', detail: 'attend son creneau' }
  }
  // Programmee : ce que la campagne est devenue.
  if (e.total > 0 && e.publiees === e.total) {
    return { libelle: 'publiee', teinte: 'border-ok-400/30 bg-ok-400/10 text-ok-400', detail: `${e.publiees} publication(s) parties` }
  }
  if (e.echecs > 0 && e.en_attente === 0) {
    return { libelle: 'echec', teinte: 'border-bad-400/30 bg-bad-400/10 text-bad-400', detail: `${e.echecs} en echec, ${e.publiees} parties` }
  }
  if (e.publiees > 0) {
    return { libelle: 'en cours', teinte: 'border-brand-400/30 bg-brand-400/10 text-brand-400', detail: `${e.publiees} sur ${e.total} parties` }
  }
  return {
    libelle: 'programmee',
    teinte: 'border-brand-400/30 bg-brand-400/10 text-brand-400',
    detail: e.programmee_pour ? `le ${formatDateTime(e.programmee_pour)}` : 'campagne creee',
  }
}

/** « 28/07/2026, matin » depuis une cle 28072026/1_matin/... */
function lireCle(cle: string): { date: string; creneau: string } {
  const parties = cle.split(/[\\/]+/)
  const m = parties[0]?.match(/^(\d{2})(\d{2})(\d{4})$/)
  const date = m ? `${m[1]}/${m[2]}/${m[3]}` : parties[0] ?? cle
  const c = (parties[1] ?? '').replace(/^\d+_/, '').replace(/_/g, ' ')
  const creneau = c === 'apres midi' ? 'apres-midi' : c
  return { date, creneau }
}

/**
 * Ou j en suis, fichier par fichier, dans l ordre du tournage.
 *
 * Trois zones : ce qui precede le point de depart (publie a la main, avant
 * l application, on ne le relit pas), ce qui est entre et ce qu il en est
 * advenu marque par marque, et les totaux au-dessus pour ne pas avoir a
 * compter.
 */
function VueSources({
  sources,
  filtreMarque,
  dossiers,
  onRemettre,
}: {
  sources: Source[]
  filtreMarque: string
  dossiers: Dossier[]
  onRemettre: (id: string) => void
}) {
  const [recherche, setRecherche] = useState('')
  const [voirAvant, setVoirAvant] = useState(false)

  // Le point de depart et l inventaire viennent du dossier source. S il y en
  // a plusieurs, on prend le plus ancien point de depart : c est la borne
  // la plus prudente pour dire « avant ca, rien n est a nous ».
  const depart = useMemo(() => {
    const dates = dossiers.map((d) => d.depuis_date).filter((x): x is string => Boolean(x))
    return dates.length ? dates.sort()[0] : null
  }, [dossiers])

  const avant = useMemo(() => {
    if (!depart) return []
    return dossiers
      .flatMap((d) => journeesVues(d.inventaire))
      .filter((j) => j.date < depart)
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [dossiers, depart])
  const videosAvant = avant.reduce((n, j) => n + j.videos, 0)

  const visibles = useMemo(() => {
    const q = recherche.trim().toLowerCase()
    return sources.filter((s) => {
      if (filtreMarque && !s.marques.includes(filtreMarque)) return false
      if (q && !s.source_cle.toLowerCase().includes(q)) return false
      return true
    })
  }, [sources, filtreMarque, recherche])

  // Totaux sur ce qui est entre, marque par marque confondues.
  const totaux = useMemo(() => {
    const t = { publiees: 0, programmees: 0, enFile: 0, enPause: 0, echecs: 0, retirees: 0 }
    for (const s of sources) {
      for (const e of s.etats) {
        if (filtreMarque && e.marque !== filtreMarque) continue
        const l = etatMarque(e).libelle
        if (l === 'publiee') t.publiees++
        else if (l === 'en file') t.enFile++
        else if (l === 'en pause') t.enPause++
        else if (l === 'retiree') t.retirees++
        else if (l === 'echec') t.echecs++
        else t.programmees++
      }
    }
    return t
  }, [sources, filtreMarque])

  if (sources.length === 0 && videosAvant === 0) {
    return (
      <EmptyState
        icon="▤"
        title="Aucun fichier source ingere"
        hint="Les videos venant d un dossier surveille en mode arborescence apparaissent ici, avec l etat de chaque marque."
      />
    )
  }

  return (
    <div>
      <div className="panel mb-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-mist-300">
            <p>
              <span className="font-semibold text-mist-100">{sources.length}</span> video
              {sources.length > 1 ? 's' : ''} depuis le point de depart
              {depart && <> ({dateLisible(depart)})</>}.
            </p>
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
              <span className="text-ok-400">{totaux.publiees} publiee(s)</span>
              <span className="text-brand-400">{totaux.programmees} programmee(s)</span>
              <span className="text-warn-400">{totaux.enFile} en file</span>
              {totaux.enPause > 0 && <span className="text-mist-500">{totaux.enPause} en pause</span>}
              {totaux.retirees > 0 && <span className="text-mist-600">{totaux.retirees} retiree(s)</span>}
              {totaux.echecs > 0 && <span className="text-bad-400">{totaux.echecs} en echec</span>}
              <span className="text-mist-600">(une video compte une fois par marque)</span>
            </p>
          </div>
          <input
            className="field !w-auto font-mono text-xs"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="chercher une date, ex. 0708"
          />
        </div>
      </div>

      {videosAvant > 0 && depart && (
        <div className="panel mb-4 p-3">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 text-left"
            onClick={() => setVoirAvant((v) => !v)}
            aria-expanded={voirAvant}
          >
            <span className="text-sm text-mist-300">
              <span className="font-semibold text-mist-100">{videosAvant}</span> video
              {videosAvant > 1 ? 's' : ''} avant le {dateLisible(depart)}, publiee
              {videosAvant > 1 ? 's' : ''} a la main avant l application. Elles ne seront jamais
              relues.
            </span>
            <span className="text-xs text-mist-500">{voirAvant ? 'replier' : 'voir les journees'}</span>
          </button>
          {voirAvant && (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {avant.map((j) => (
                <li key={j.dossier} className="chip border-ink-700 bg-ink-850 text-mist-500" title={dateLisible(j.date)}>
                  {j.dossier} · {j.videos}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-mist-600">
            Pour en reprendre certaines : Auto, onglet Dossiers, recule le point de depart.
          </p>
        </div>
      )}

      <ul className="space-y-2">
        {visibles.map((s) => {
          const lu = lireCle(s.source_cle)
          return (
            <li key={s.source_cle} className="panel p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-mist-100">
                    {lu.date}
                    {lu.creneau && <span className="text-mist-400"> · {lu.creneau}</span>}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-mist-600" title={s.source_cle}>
                    {s.source_cle}
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap gap-1.5">
                  {s.etats
                    .filter((e) => !filtreMarque || e.marque === filtreMarque)
                    .map((e) => {
                      const etat = etatMarque(e)
                      if (e.statut === 'retiree') {
                        return (
                          <button
                            key={e.marque}
                            type="button"
                            className={`chip ${etat.teinte} hover:text-mist-300`}
                            title={`${e.marque} : ${etat.detail}. Cliquer pour la remettre en file.`}
                            onClick={() => onRemettre(e.id)}
                          >
                            {e.marque} · retiree, remettre ?
                          </button>
                        )
                      }
                      return (
                        <span
                          key={e.marque}
                          className={`chip ${etat.teinte}`}
                          title={`${e.marque} : ${etat.libelle}, ${etat.detail}`}
                        >
                          {e.marque} · {etat.libelle}
                        </span>
                      )
                    })}
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      {visibles.length === 0 && sources.length > 0 && (
        <p className="py-8 text-center text-sm text-mist-500">
          Rien ne correspond a cette recherche.
        </p>
      )}
    </div>
  )
}

/**
 * Corriger ce que le nom du fichier disait mal.
 *
 * Un nom mal forme ne doit pas condamner une video : on la garde, et on
 * rectifie ici.
 */
function EditerVideo({
  video,
  marques,
  profils,
  onClose,
  onEnregistrer,
}: {
  video: Video | null
  marques: string[]
  profils: string[]
  onClose: () => void
  onEnregistrer: (
    id: string,
    input: { marque: string; sujet: string; langue: string; profil: string | null },
  ) => void
}) {
  const [marque, setMarque] = useState('')
  const [sujet, setSujet] = useState('')
  const [langue, setLangue] = useState('fr')
  const [profil, setProfil] = useState('')

  useEffect(() => {
    if (!video) return
    setMarque(video.marque)
    setSujet(video.sujet)
    setLangue(video.langue ?? 'fr')
    setProfil(video.profil ?? '')
  }, [video])

  if (!video) return null

  return (
    <Modal open title="Modifier cette video" onClose={onClose} wide>
      <div className="space-y-4">
        <LecteurVideo url={video.video_url} />

        <p className="text-xs text-mist-600">
          Lu dans le nom du fichier <span className="font-mono">{video.fichier}</span>. Corrige ce
          qui est faux : c est le sujet ci-dessous qui sert a ecrire les textes.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Marque</span>
            <select className="field" value={marque} onChange={(e) => setMarque(e.target.value)}>
              {!marques.includes(marque) && <option value={marque}>{marque}</option>}
              {marques.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-mist-600">
              Changer de marque replace la video en fin de file de sa nouvelle marque.
            </span>
          </label>

          <label className="block">
            <span className="label">Langue</span>
            <select className="field" value={langue} onChange={(e) => setLangue(e.target.value)}>
              {LANGUES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block">
          <span className="label">Sujet</span>
          <textarea
            className="field resize-y"
            rows={2}
            value={sujet}
            onChange={(e) => setSujet(e.target.value)}
          />
          <span className="mt-1 block text-xs text-mist-600">
            C est ce que le modele recevra pour ecrire les textes. Une phrase claire vaut mieux
            qu une suite de mots-cles.
          </span>
        </label>

        <label className="block">
          <span className="label">Profil de ciblage</span>
          <select className="field" value={profil} onChange={(e) => setProfil(e.target.value)}>
            <option value="">Celui du dossier</option>
            {profils.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <button className="btn btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button
            className="btn btn-primary"
            disabled={!sujet.trim() || !marque.trim()}
            onClick={() =>
              onEnregistrer(video.id, {
                marque: marque.trim(),
                sujet: sujet.trim(),
                langue,
                profil: profil || null,
              })
            }
          >
            Enregistrer
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------

/** Sortir une video de la file pour la placer a une date precise. */
function ProgrammerVideo({
  video,
  onClose,
  onProgrammer,
}: {
  video: Video | null
  onClose: () => void
  onProgrammer: (id: string, quand: string) => void
}) {
  const [quand, setQuand] = useState('')

  useEffect(() => {
    if (!video) return
    // Demain a neuf heures : une proposition plausible, jamais maintenant, qui
    // ferait partir la campagne avant qu'on ait pu la relire.
    const d = new Date()
    d.setDate(d.getDate() + 1)
    d.setHours(9, 0, 0, 0)
    setQuand(toLocalInput(d.toISOString()))
  }, [video])

  if (!video) return null

  const passe = quand && new Date(quand).getTime() < Date.now()

  return (
    <Modal open title="Programmer cette video" onClose={onClose}>
      <p className="text-sm text-mist-300">
        <span className="font-medium text-mist-100">{video.sujet}</span>
      </p>
      <p className="mt-1 text-sm text-mist-500">
        La campagne est creee tout de suite, a la date que tu choisis. La video sort de la file
        automatique : le moteur ne la piochera plus.
      </p>

      <label className="mt-4 block">
        <span className="label">Date et heure de la premiere publication</span>
        <input
          type="datetime-local"
          className="field"
          value={quand}
          onChange={(e) => setQuand(e.target.value)}
        />
        <span className="mt-1 block text-xs text-mist-600">
          Les autres comptes suivront, espaces selon le reglage de cadence.
        </span>
      </label>

      {passe && (
        <div className="mt-3">
          <Alert kind="error">
            Cette date est deja passee. La campagne partirait au prochain passage du planificateur.
          </Alert>
        </div>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <button className="btn btn-ghost" onClick={onClose}>
          Annuler
        </button>
        <button
          className="btn btn-primary"
          disabled={!quand}
          onClick={() => onProgrammer(video.id, fromLocalInput(quand))}
        >
          Creer la campagne
        </button>
      </div>
    </Modal>
  )
}
