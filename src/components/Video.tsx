import { useEffect, useRef, useState } from 'react'
import { listerVideos, uploadVideo, type VideoStockee } from '../lib/api'
import { friendlyError } from '../lib/errors'
import { PLATFORM_LABEL } from '../lib/types'
import { Alert, Modal } from './ui'

/** Ce que le navigateur sait dire d'une video, une fois ses metadonnees lues. */
export type InfosVideo = {
  duree: number
  largeur: number
  hauteur: number
  /** En octets, quand le serveur veut bien le dire. */
  poids: number | null
}

function formatDuree(secondes: number): string {
  if (!Number.isFinite(secondes)) return '?'
  const m = Math.floor(secondes / 60)
  const s = Math.round(secondes % 60)
  return m > 0 ? `${m} min ${String(s).padStart(2, '0')} s` : `${s} s`
}

function formatPoids(octets: number | null): string | null {
  if (octets == null) return null
  const mo = octets / 1_048_576
  return mo >= 1 ? `${mo.toFixed(1)} Mo` : `${Math.round(octets / 1024)} Ko`
}

// ---------------------------------------------------------------------------
// Ce qui ne va pas
// ---------------------------------------------------------------------------

export type Avertissement = { gravite: 'bloquant' | 'attention'; message: string }

/**
 * Duree maximale d'un format vertical court, par plateforme, en secondes.
 * Ce sont les limites publiees par les plateformes, pas des preferences.
 */
const DUREE_MAX: Record<string, number> = {
  instagram: 90,
  facebook: 90,
  tiktok: 600,
  threads: 300,
}

/** Duree maximale d'un Short YouTube. Au-dela, la video devient une video classique. */
const DUREE_SHORT = 180

/**
 * Ce qui cloche entre cette video et la cible.
 *
 * Verifier ici evite de decouvrir le probleme au moment ou la plateforme
 * refuse l'envoi, c'est-a-dire apres le creneau prevu.
 */
export function verifierFormat(
  infos: InfosVideo | null,
  platform: string | null | undefined,
  youtubeType?: string | null,
): Avertissement[] {
  if (!infos || !platform) return []

  const sortie: Avertissement[] = []
  const vertical = infos.hauteur >= infos.largeur
  const ratio = infos.largeur / infos.hauteur

  const courtEtVertical =
    platform === 'tiktok' ||
    platform === 'instagram' ||
    platform === 'facebook' ||
    (platform === 'youtube' && youtubeType !== 'video')

  if (courtEtVertical && !vertical) {
    sortie.push({
      gravite: 'bloquant',
      message: `Video horizontale (${infos.largeur} sur ${infos.hauteur}) pour ${PLATFORM_LABEL[platform] ?? platform}, qui attend du vertical. Elle sera recadree ou refusee.`,
    })
  }

  // Le 9:16 exact vaut 0,5625. On tolere le carre et un peu au-dela, mais un
  // format nettement plus large laisse des bandes noires.
  if (courtEtVertical && vertical && ratio > 1.02) {
    sortie.push({
      gravite: 'attention',
      message: 'Format plus large que le 9:16 habituel, des bandes noires sont probables.',
    })
  }

  if (platform === 'youtube' && youtubeType !== 'video' && infos.duree > DUREE_SHORT) {
    sortie.push({
      gravite: 'bloquant',
      message: `${formatDuree(infos.duree)} pour un Short, qui est limite a 3 minutes. YouTube la publiera en video classique.`,
    })
  }

  const max = DUREE_MAX[platform]
  if (max && infos.duree > max) {
    sortie.push({
      gravite: 'bloquant',
      message: `${formatDuree(infos.duree)} pour ${PLATFORM_LABEL[platform] ?? platform}, qui accepte ${formatDuree(max)} au maximum.`,
    })
  }

  if (infos.hauteur < 720) {
    sortie.push({
      gravite: 'attention',
      message: `Definition faible (${infos.largeur} sur ${infos.hauteur}). Le rendu sera flou en plein ecran.`,
    })
  }

  return sortie
}

// ---------------------------------------------------------------------------
// Lecteur
// ---------------------------------------------------------------------------

/**
 * Le lecteur, ses metadonnees et ce qui cloche pour la cible.
 *
 * L'ecran de modification n'affichait qu'une URL. Verifier qu'il s'agit bien
 * de la bonne video demandait d'ouvrir un onglet, et rien ne signalait qu'une
 * video horizontale partait sur TikTok.
 */
export function LecteurVideo({
  url,
  platform,
  youtubeType,
  compact,
}: {
  url: string
  platform?: string | null
  youtubeType?: string | null
  compact?: boolean
}) {
  const video = useRef<HTMLVideoElement | null>(null)
  const [infos, setInfos] = useState<InfosVideo | null>(null)
  const [echec, setEchec] = useState(false)

  useEffect(() => {
    setInfos(null)
    setEchec(false)
  }, [url])

  useEffect(() => {
    if (!url) return
    let vivant = true

    // Le poids ne se lit pas dans la balise video : il faut demander l'entete
    // au serveur. Un echec ici n'est pas grave, on affiche le reste.
    fetch(url, { method: 'HEAD' })
      .then((r) => {
        const taille = r.headers.get('content-length')
        if (vivant && taille) {
          setInfos((actuel) => (actuel ? { ...actuel, poids: Number(taille) } : actuel))
        }
      })
      .catch(() => {})

    return () => {
      vivant = false
    }
  }, [url, infos !== null])

  const avertissements = verifierFormat(infos, platform, youtubeType)
  const poids = formatPoids(infos?.poids ?? null)

  if (!url) {
    return (
      <div className="rounded-xl border border-dashed border-ink-700 px-4 py-8 text-center text-sm text-mist-600">
        Aucune video.
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-wrap gap-4">
        <div
          className={`shrink-0 overflow-hidden rounded-xl border border-ink-700 bg-ink-950 ${
            compact ? 'w-32' : 'w-44'
          }`}
        >
          {echec ? (
            <div className="flex aspect-[9/16] items-center justify-center px-3 text-center text-xs text-bad-400">
              La video ne se charge pas depuis cette adresse.
            </div>
          ) : (
            <video
              ref={video}
              src={url}
              controls
              preload="metadata"
              playsInline
              className="block max-h-72 w-full bg-black"
              onLoadedMetadata={(e) => {
                const el = e.currentTarget
                setInfos((actuel) => ({
                  duree: el.duration,
                  largeur: el.videoWidth,
                  hauteur: el.videoHeight,
                  poids: actuel?.poids ?? null,
                }))
              }}
              onError={() => setEchec(true)}
            />
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          {infos ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <div>
                <dt className="text-mist-600">Duree</dt>
                <dd className="tabular-nums text-mist-300">{formatDuree(infos.duree)}</dd>
              </div>
              <div>
                <dt className="text-mist-600">Dimensions</dt>
                <dd className="tabular-nums text-mist-300">
                  {infos.largeur} x {infos.hauteur}
                  <span className="ml-1 text-mist-600">
                    {infos.hauteur >= infos.largeur ? 'vertical' : 'horizontal'}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-mist-600">Poids</dt>
                <dd className="tabular-nums text-mist-300">{poids ?? 'inconnu'}</dd>
              </div>
              <div>
                <dt className="text-mist-600">Fichier</dt>
                <dd className="truncate text-mist-300" title={url}>
                  {url.split('/').pop()}
                </dd>
              </div>
            </dl>
          ) : (
            !echec && <p className="text-xs text-mist-600">Lecture des informations...</p>
          )}

          {avertissements.map((a, i) => (
            <p
              key={i}
              className={`rounded-lg border px-2.5 py-1.5 text-xs ${
                a.gravite === 'bloquant'
                  ? 'border-bad-600/40 bg-bad-600/10 text-bad-400'
                  : 'border-warn-600/40 bg-warn-600/10 text-warn-400'
              }`}
            >
              {a.gravite === 'bloquant' ? '✕ ' : '⚠ '}
              {a.message}
            </p>
          ))}

          {infos && avertissements.length === 0 && platform && (
            <p className="text-xs text-ok-400">
              Le format convient a {PLATFORM_LABEL[platform] ?? platform}.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Choisir une autre video
// ---------------------------------------------------------------------------

/**
 * Les trois facons de remplacer une video : deposer un fichier, reprendre une
 * video deja envoyee, ou coller une adresse.
 *
 * La bibliotheque compte le plus : une meme video part souvent sur plusieurs
 * comptes, et la retrouver ne devrait pas demander de la renvoyer.
 */
export function ChoixVideo({
  open,
  urlActuelle,
  onChoisi,
  onClose,
}: {
  open: boolean
  urlActuelle: string
  onChoisi: (url: string) => void
  onClose: () => void
}) {
  const [onglet, setOnglet] = useState<'fichier' | 'bibliotheque' | 'adresse'>('fichier')
  const [videos, setVideos] = useState<VideoStockee[] | null>(null)
  const [envoi, setEnvoi] = useState(false)
  const [progression, setProgression] = useState(0)
  const [adresse, setAdresse] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setOnglet('fichier')
    setAdresse('')
    setErreur(null)
    setEnvoi(false)
  }, [open])

  useEffect(() => {
    if (!open || onglet !== 'bibliotheque' || videos) return
    listerVideos()
      .then(setVideos)
      .catch((err) => setErreur(friendlyError(err)))
  }, [open, onglet, videos])

  async function deposer(file: File) {
    setEnvoi(true)
    setProgression(0)
    setErreur(null)
    try {
      const url = await uploadVideo(file, setProgression)
      // La bibliotheque doit se recharger : elle vient de changer.
      setVideos(null)
      onChoisi(url)
    } catch (err) {
      setErreur(friendlyError(err))
    } finally {
      setEnvoi(false)
    }
  }

  const onglets = [
    { cle: 'fichier' as const, label: 'Deposer un fichier' },
    { cle: 'bibliotheque' as const, label: 'Videos deja envoyees' },
    { cle: 'adresse' as const, label: 'Coller une adresse' },
  ]

  return (
    <Modal open={open} title="Choisir une video" onClose={onClose} wide>
      <div className="mb-4 flex gap-1 rounded-xl border border-ink-700 bg-ink-850 p-1">
        {onglets.map((o) => (
          <button
            key={o.cle}
            onClick={() => setOnglet(o.cle)}
            aria-pressed={onglet === o.cle}
            className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              onglet === o.cle ? 'bg-brand-500 text-white' : 'text-mist-500 hover:text-mist-100'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {erreur && (
        <div className="mb-3">
          <Alert kind="error">{erreur}</Alert>
        </div>
      )}

      {onglet === 'fichier' && (
        <div>
          <label className="flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-ink-700 px-4 py-10 text-sm text-mist-500 transition-colors hover:border-brand-500/50 hover:text-mist-300">
            <input
              type="file"
              accept="video/mp4,video/quicktime"
              className="hidden"
              disabled={envoi}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void deposer(file)
              }}
            />
            {envoi ? `Envoi en cours, ${progression} %...` : 'Deposer un fichier video (MP4, 500 Mo max)'}
          </label>
          {envoi && (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-800">
              <div
                className="h-full rounded-full bg-brand-500 transition-[width]"
                style={{ width: `${progression}%` }}
              />
            </div>
          )}
        </div>
      )}

      {onglet === 'bibliotheque' && (
        <div>
          {!videos ? (
            <p className="py-8 text-center text-sm text-mist-500">Chargement...</p>
          ) : videos.length === 0 ? (
            <p className="py-8 text-center text-sm text-mist-500">
              Aucune video dans le stockage pour l instant.
            </p>
          ) : (
            <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {videos.map((v) => (
                <li key={v.url}>
                  <button
                    onClick={() => onChoisi(v.url)}
                    className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                      v.url === urlActuelle
                        ? 'border-brand-500/50 bg-brand-500/10'
                        : 'border-ink-700 hover:border-ink-600 hover:bg-ink-800'
                    }`}
                  >
                    <span className="shrink-0 text-xs opacity-70">▷</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-mist-100">{v.nom}</span>
                      <span className="block text-xs tabular-nums text-mist-600">
                        {v.jour}
                        {v.taille != null && ` · ${formatPoids(v.taille)}`}
                        {v.url === urlActuelle && ' · video actuelle'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {onglet === 'adresse' && (
        <div className="space-y-3">
          <label className="block">
            <span className="label">Adresse de la video</span>
            <input
              className="field font-mono text-xs"
              value={adresse}
              onChange={(e) => setAdresse(e.target.value)}
              placeholder="https://..."
            />
            <span className="mt-1 block text-xs text-mist-600">
              L adresse doit etre accessible sans authentification : ce sont les serveurs des
              plateformes qui viennent telecharger le fichier.
            </span>
          </label>
          <div className="flex justify-end">
            <button
              className="btn btn-primary"
              disabled={!adresse.trim().startsWith('http')}
              onClick={() => onChoisi(adresse.trim())}
            >
              Utiliser cette adresse
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
