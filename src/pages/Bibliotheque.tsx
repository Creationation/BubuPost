import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  apercuCadence,
  deplacerVideo,
  lancerMoteur,
  listAccounts,
  listerBibliotheque,
  lireConfigAuto,
  majVideo,
  programmerVideo,
  supprimerVideo,
  type EtatReserve,
  type Prevision,
} from '../lib/api'
import { friendlyError } from '../lib/errors'
import { normaliserConfig, type ConfigAuto, type Video } from '../lib/automatisation'
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
      const [v, c, comptes] = await Promise.all([
        listerBibliotheque(),
        lireConfigAuto(),
        listAccounts(),
      ])
      setVideos(v)
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
        (v) => v.statut !== 'programmee' && (!filtreMarque || v.marque === filtreMarque),
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
          <Alert kind={seuilBas.some((r) => r.reste === 0) ? 'error' : 'info'}>
            {seuilBas.map((r) => (
              <span key={r.marque} className="block">
                {r.reste === 0
                  ? `${r.marque} n a plus aucune video en reserve${
                      r.creneauSaute
                        ? `, le creneau du ${formatDateTime(r.creneauSaute)} sera saute.`
                        : '.'
                    }`
                  : `${r.marque} : ${r.reste} video${r.reste > 1 ? 's' : ''} en reserve, seuil a ${r.seuil}.`}
              </span>
            ))}
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

      {programmees.length > 0 && (
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
        message="Elle disparait de la bibliotheque et ne sera jamais programmee. Le fichier reste dans le stockage et sur ton disque."
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
