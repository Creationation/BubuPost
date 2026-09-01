import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  clearMetaFlow,
  finaliserMeta,
  lireFragment,
  readMetaFlow,
  type CompteMeta,
} from '../lib/meta'
import { friendlyError } from '../lib/errors'

type Etat =
  | { phase: 'travail' }
  | { phase: 'choix'; comptes: CompteMeta[] }
  | { phase: 'succes'; message: string }
  | { phase: 'erreur'; message: string }

export default function MetaCallback() {
  const navigate = useNavigate()
  const [etat, setEtat] = useState<Etat>({ phase: 'travail' })

  // Le jeton ne quitte pas ce composant : il sert a finaliser, et disparait
  // avec la page. Il n'est jamais range dans un stockage du navigateur.
  const jeton = useRef<{ token: string; brand: string; expiresIn: number | null; dae: number | null } | null>(null)
  const lance = useRef(false)

  useEffect(() => {
    if (lance.current) return
    lance.current = true

    // Le fragment n'arrive jamais jusqu'au serveur : c'est ici, et nulle part
    // ailleurs, qu'on peut le lire.
    const frag = lireFragment(window.location.hash, window.location.search)

    // On efface le fragment de la barre d'adresse tout de suite : un jeton n'a
    // rien a faire dans l'historique du navigateur.
    if (window.location.hash) {
      window.history.replaceState({}, '', window.location.pathname)
    }

    if (frag.error) {
      clearMetaFlow()
      const annule = /denied|cancel|user_denied/i.test(
        `${frag.error} ${frag.errorDescription ?? ''}`,
      )
      setEtat({
        phase: 'erreur',
        message: annule
          ? "Tu as annule la connexion sur Facebook, ou refuse une autorisation. Rien n'a ete enregistre."
          : `Facebook a refuse la connexion : ${frag.errorDescription || frag.error}`,
      })
      return
    }

    const token = frag.longLivedToken ?? frag.token
    if (!token) {
      setEtat({
        phase: 'erreur',
        message:
          "Cette page attend un retour de Facebook et n'a recu aucun jeton. Relance la connexion depuis l'onglet Comptes.",
      })
      return
    }

    const flow = readMetaFlow()
    if (!flow || !frag.state || flow.state !== frag.state) {
      clearMetaFlow()
      setEtat({
        phase: 'erreur',
        message:
          "Le jeton de securite ne correspond pas. Cela arrive si la connexion a ete lancee depuis un autre onglet, ou si elle a trop attendu. Relance-la depuis l'onglet Comptes.",
      })
      return
    }

    jeton.current = {
      token,
      brand: flow.brand,
      expiresIn: frag.expiresIn,
      dae: frag.dataAccessExpiration,
    }

    finaliserMeta({
      token,
      brand: flow.brand,
      expires_in: frag.expiresIn,
      data_access_expiration_time: frag.dataAccessExpiration,
    })
      .then((res) => {
        if (res.choix_requis && res.comptes?.length) {
          setEtat({ phase: 'choix', comptes: res.comptes })
          return
        }
        clearMetaFlow()
        setEtat({ phase: 'succes', message: res.message })
        setTimeout(() => {
          navigate('/accounts', { replace: true, state: { notice: res.message } })
        }, 1600)
      })
      .catch((err) => {
        clearMetaFlow()
        setEtat({ phase: 'erreur', message: friendlyError(err) })
      })
  }, [navigate])

  async function choisir(compte: CompteMeta) {
    const en_cours = jeton.current
    if (!en_cours) return
    setEtat({ phase: 'travail' })
    try {
      const res = await finaliserMeta({
        token: en_cours.token,
        brand: en_cours.brand,
        expires_in: en_cours.expiresIn,
        data_access_expiration_time: en_cours.dae,
        ig_user_id: compte.ig_user_id,
      })
      clearMetaFlow()
      setEtat({ phase: 'succes', message: res.message })
      setTimeout(() => {
        navigate('/accounts', { replace: true, state: { notice: res.message } })
      }, 1600)
    } catch (err) {
      setEtat({ phase: 'erreur', message: friendlyError(err) })
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-brand-500/30 bg-brand-500/15">
            <span className="text-xl">🚀</span>
          </div>
          <h1 className="text-xl font-bold tracking-tight">Connexion Instagram</h1>
        </div>

        <div className="panel p-6">
          {etat.phase === 'travail' && (
            <div className="text-center">
              <div
                className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-ink-700 border-t-brand-400"
                role="status"
                aria-label="Connexion en cours"
              />
              <p className="font-medium">Connexion en cours...</p>
              <p className="mt-1.5 text-sm text-mist-500">
                On recupere tes Pages et le compte Instagram qui y est rattache.
              </p>
            </div>
          )}

          {etat.phase === 'choix' && (
            <div>
              <p className="mb-1 font-medium">Quel compte connecter ?</p>
              <p className="mb-4 text-sm text-mist-500">
                Plusieurs comptes Instagram sont accessibles. Tu pourras en ajouter d'autres plus
                tard en relancant la connexion.
              </p>
              <div className="space-y-2">
                {etat.comptes.map((c) => (
                  <button
                    key={c.ig_user_id}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-ink-700 px-4 py-3 text-left transition-colors hover:border-brand-500/50 hover:bg-ink-800"
                    onClick={() => void choisir(c)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {c.ig_username ? `@${c.ig_username}` : c.page_name}
                      </span>
                      <span className="block truncate text-xs text-mist-500">
                        Page {c.page_name}
                      </span>
                    </span>
                    <span className="text-mist-600">→</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {etat.phase === 'succes' && (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full border border-ok-400/40 bg-ok-400/15 text-lg text-ok-400">
                ✓
              </div>
              <p className="font-medium text-ok-400">{etat.message}</p>
              <p className="mt-1.5 text-sm text-mist-500">Retour a la liste des comptes...</p>
            </div>
          )}

          {etat.phase === 'erreur' && (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full border border-bad-400/40 bg-bad-400/15 text-lg text-bad-400">
                ✕
              </div>
              <p className="font-medium text-bad-400">La connexion n'a pas abouti</p>
              <p className="mt-2 text-sm text-mist-300">{etat.message}</p>

              <div className="mt-6 flex flex-col gap-2">
                <button
                  className="btn btn-primary w-full"
                  onClick={() => navigate('/accounts', { replace: true })}
                >
                  Retourner aux comptes et reessayer
                </button>
                <button
                  className="btn btn-ghost w-full"
                  onClick={() => navigate('/', { replace: true })}
                >
                  Aller au dashboard
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-mist-600">
          Ferme cette page seulement une fois le message affiche.
        </p>
      </div>
    </div>
  )
}
