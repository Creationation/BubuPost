import { useCallback, useEffect, useMemo, useState } from 'react'
import { generateCaptionBatch, listPosts, updatePost } from '../lib/api'
import { friendlyError } from '../lib/errors'
import { PLATFORM_ICON, type PostWithAccount } from '../lib/types'
import type { Probleme } from '../lib/consignes'
import { langueDe } from '../lib/langues'
import { formatDateTime } from '../lib/format'
import { Alert, Loading, Modal } from './ui'

/**
 * Le maximum de cibles par appel.
 *
 * La fonction en refuse plus de vingt. On reste en dessous : au-dela, la place
 * laissee a chaque texte se reduit et les derniers arrivent tronques.
 */
const PAR_APPEL = 10

type Proposition = {
  post: PostWithAccount
  ancien: string
  nouveau: string
  hashtags: string[]
  titre: string | null
  problemes: Probleme[]
  retenu: boolean
}

/** Une campagne, ou une publication isolee, forme un lot de generation. */
type Lot = { cle: string; posts: PostWithAccount[] }

function faireLots(posts: PostWithAccount[]): Lot[] {
  const campagnes = new Map<string, PostWithAccount[]>()
  const isoles: PostWithAccount[] = []

  for (const p of posts) {
    if (p.campaign_id) {
      const l = campagnes.get(p.campaign_id)
      if (l) l.push(p)
      else campagnes.set(p.campaign_id, [p])
    } else {
      isoles.push(p)
    }
  }

  const lots: Lot[] = []

  // Une campagne part entiere : c'est en voyant les autres textes de la meme
  // video que le modele peut vraiment les differencier.
  for (const [cle, liste] of campagnes) {
    for (let i = 0; i < liste.length; i += PAR_APPEL) {
      lots.push({ cle: `${cle}-${i}`, posts: liste.slice(i, i + PAR_APPEL) })
    }
  }

  // Les publications isolees se regroupent pour economiser des appels : leurs
  // sujets different deja, il n'y a rien a differencier entre elles.
  for (let i = 0; i < isoles.length; i += PAR_APPEL) {
    lots.push({ cle: `isoles-${i}`, posts: isoles.slice(i, i + PAR_APPEL) })
  }

  return lots
}

/**
 * Regenere les textes des publications encore en attente.
 *
 * Utile apres avoir change les consignes : les publications deja programmees
 * portent l'ancien ton, et les reprendre une par une a trente-trois par jour
 * n'est pas tenable. Rien n'est ecrit sans validation.
 */
export default function RevisionTextes({
  open,
  onClose,
  onApplique,
}: {
  open: boolean
  onClose: () => void
  onApplique: (n: number) => void
}) {
  const [attente, setAttente] = useState<PostWithAccount[]>([])
  const [chargement, setChargement] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  const [propositions, setPropositions] = useState<Proposition[] | null>(null)
  const [progression, setProgression] = useState<{ fait: number; total: number } | null>(null)
  const [application, setApplication] = useState(false)

  const charger = useCallback(async () => {
    setChargement(true)
    setErreur(null)
    try {
      const tous = await listPosts()
      setAttente(tous.filter((p) => p.status === 'pending'))
    } catch (err) {
      setErreur(friendlyError(err))
    } finally {
      setChargement(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setPropositions(null)
    setProgression(null)
    void charger()
  }, [open, charger])

  const lots = useMemo(() => faireLots(attente), [attente])

  async function generer() {
    setProgression({ fait: 0, total: lots.length })
    setErreur(null)
    const sortie: Proposition[] = []
    const echecs: string[] = []

    for (const [i, lot] of lots.entries()) {
      try {
        const { results } = await generateCaptionBatch({
          targets: lot.posts.map((p) => ({
            id: p.id,
            platform: p.accounts?.platform ?? 'instagram',
            brand: p.accounts?.brand,
            account_name: p.accounts?.account_name,
            youtube_type: (p.youtube_type as 'short' | 'video' | null) ?? undefined,
            // La reecriture garde la langue de la publication : changer les
            // consignes de ton ne doit pas faire basculer un compte anglophone
            // en francais sans qu'on l'ait demande.
            language: langueDe(p, p.accounts),
            existant: [p.caption ?? '', (p.hashtags ?? []).map((h) => `#${h}`).join(' ')]
              .filter(Boolean)
              .join('\n'),
          })),
        })

        for (const p of lot.posts) {
          const r = results.find((x) => x.id === p.id)
          if (!r?.caption) continue
          sortie.push({
            post: p,
            ancien: p.caption ?? '',
            nouveau: r.caption,
            hashtags: r.hashtags,
            titre: r.title ?? null,
            problemes: r.problemes ?? [],
            // Coche par defaut seulement si les controles passent : un texte
            // signale merite un regard avant d'ecraser celui qui est en place.
            retenu: (r.problemes ?? []).length === 0,
          })
        }
      } catch (err) {
        echecs.push(friendlyError(err))
      }
      setProgression({ fait: i + 1, total: lots.length })
    }

    setPropositions(sortie)
    if (echecs.length > 0) {
      setErreur(
        `${echecs.length} lot(s) n ont pas abouti : ${echecs[0]}. Les autres textes sont proposes ci-dessous.`,
      )
    }
  }

  async function appliquer() {
    if (!propositions) return
    const retenues = propositions.filter((p) => p.retenu && p.nouveau.trim())
    if (retenues.length === 0) return

    setApplication(true)
    setErreur(null)
    try {
      // En serie : une erreur au milieu doit laisser un etat lisible, pas un
      // melange d'anciens et de nouveaux textes impossible a demeler.
      for (const p of retenues) {
        await updatePost(p.post.id, {
          caption: p.nouveau.trim(),
          hashtags: p.hashtags,
          ...(p.titre ? { title: p.titre } : {}),
        })
      }
      onApplique(retenues.length)
    } catch (err) {
      setErreur(friendlyError(err))
    } finally {
      setApplication(false)
    }
  }

  function modifier(id: string, changes: Partial<Proposition>) {
    setPropositions((prev) =>
      prev ? prev.map((p) => (p.post.id === id ? { ...p, ...changes } : p)) : prev,
    )
  }

  const retenues = propositions?.filter((p) => p.retenu).length ?? 0
  const signalees = propositions?.filter((p) => p.problemes.length > 0).length ?? 0

  return (
    <Modal open={open} title="Regenerer les textes en attente" onClose={onClose} wide>
      {chargement ? (
        <Loading />
      ) : erreur && !propositions ? (
        <Alert kind="error">{erreur}</Alert>
      ) : attente.length === 0 ? (
        <Alert kind="info">
          Aucune publication en attente. Seules les publications encore a partir peuvent etre
          reecrites.
        </Alert>
      ) : !propositions ? (
        <div>
          <p className="text-sm text-mist-300">
            {attente.length} publication{attente.length > 1 ? 's' : ''} en attente, reparties en{' '}
            {lots.length} lot{lots.length > 1 ? 's' : ''}. Chaque lot est un appel au modele.
          </p>
          <p className="mt-2 text-sm text-mist-500">
            Les textes actuels servent de point de depart : le sujet de chaque video est conserve,
            seule la forme est reprise selon les consignes en vigueur. Rien n est ecrit avant que tu
            valides.
          </p>

          {progression ? (
            <div className="mt-5">
              <div className="h-1.5 overflow-hidden rounded-full bg-ink-800">
                <div
                  className="h-full rounded-full bg-brand-500 transition-[width]"
                  style={{ width: `${(progression.fait / progression.total) * 100}%` }}
                />
              </div>
              <p className="mt-2 text-xs tabular-nums text-mist-500">
                Lot {progression.fait} sur {progression.total}...
              </p>
            </div>
          ) : (
            <div className="mt-6 flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={onClose}>
                Annuler
              </button>
              <button className="btn btn-primary" onClick={() => void generer()}>
                Generer les {attente.length} textes
              </button>
            </div>
          )}
        </div>
      ) : propositions.length === 0 ? (
        <Alert kind="error">
          Aucun texte n a pu etre genere. {erreur ?? 'Reessaie dans un instant.'}
        </Alert>
      ) : (
        <div>
          {erreur && (
            <div className="mb-4">
              <Alert kind="error">{erreur}</Alert>
            </div>
          )}

          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-mist-500">
              {propositions.length} texte{propositions.length > 1 ? 's' : ''} propose
              {propositions.length > 1 ? 's' : ''}, {retenues} coche{retenues > 1 ? 's' : ''}.
              {signalees > 0 && (
                <span className="text-warn-400">
                  {' '}
                  {signalees} n a pas passe tous les controles apres relance, decoche par defaut.
                </span>
              )}
            </p>
            <button
              className="text-xs text-brand-400 hover:underline"
              onClick={() =>
                setPropositions((prev) =>
                  prev ? prev.map((p) => ({ ...p, retenu: retenues !== prev.length })) : prev,
                )
              }
            >
              {retenues === propositions.length ? 'Tout decocher' : 'Tout cocher'}
            </button>
          </div>

          <div className="max-h-[26rem] space-y-3 overflow-y-auto pr-1">
            {propositions.map((p) => (
              <div
                key={p.post.id}
                className={`rounded-xl border p-3 transition-colors ${
                  p.retenu ? 'border-brand-500/40 bg-brand-500/5' : 'border-ink-700'
                }`}
              >
                <div className="mb-2 flex items-start gap-2">
                  <button
                    type="button"
                    aria-pressed={p.retenu}
                    onClick={() => modifier(p.post.id, { retenu: !p.retenu })}
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[11px] ${
                      p.retenu
                        ? 'border-brand-400 bg-brand-500 text-white'
                        : 'border-ink-600 bg-ink-850'
                    }`}
                  >
                    {p.retenu ? '✓' : ''}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      <span className="mr-1.5 opacity-70">
                        {PLATFORM_ICON[p.post.accounts?.platform ?? ''] ?? '•'}
                      </span>
                      {p.post.accounts?.account_name ?? 'compte supprime'}
                    </p>
                    <p className="text-xs text-mist-600">
                      {p.post.accounts?.brand} · {formatDateTime(p.post.scheduled_at)}
                    </p>
                  </div>
                </div>

                <details className="mb-2">
                  <summary className="cursor-pointer text-xs text-mist-600 hover:text-mist-300">
                    Voir le texte actuel
                  </summary>
                  <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-ink-950/50 p-2 text-xs text-mist-600">
                    {p.ancien || 'Aucun texte.'}
                  </p>
                </details>

                {p.titre && (
                  <input
                    className="field mb-2 text-sm font-medium"
                    value={p.titre}
                    onChange={(e) => modifier(p.post.id, { titre: e.target.value })}
                  />
                )}

                <textarea
                  className="field resize-y text-sm"
                  rows={4}
                  value={p.nouveau}
                  onChange={(e) => modifier(p.post.id, { nouveau: e.target.value })}
                />

                <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-xs text-brand-400">
                    {p.hashtags.map((h) => `#${h}`).join(' ')}
                  </p>
                  <p className="text-xs tabular-nums text-mist-600">{p.nouveau.length} caracteres</p>
                </div>

                {p.problemes.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {p.problemes.map((pb, i) => (
                      <li key={`${pb.code}-${i}`} className="text-xs text-warn-400">
                        {pb.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button className="btn btn-ghost" onClick={onClose}>
              Annuler
            </button>
            <button
              className="btn btn-primary"
              disabled={application || retenues === 0}
              onClick={() => void appliquer()}
            >
              {application
                ? 'Enregistrement...'
                : retenues === 0
                  ? 'Coche au moins un texte'
                  : `Remplacer ${retenues} texte${retenues > 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
