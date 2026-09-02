import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  clearYoutubeFlow,
  finaliserYoutube,
  readYoutubeFlow,
  type ChaineYoutube,
} from '../lib/youtube'
import { friendlyError } from '../lib/errors'

type Etat =
  | { phase: 'travail' }
  | { phase: 'choix'; chaines: ChaineYoutube[] }
  | { phase: 'succes'; message: string }
  | { phase: 'erreur'; message: string }

export default function YoutubeCallback() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [etat, setEtat] = useState<Etat>({ phase: 'travail' })

  // Le jeton de renouvellement obtenu au premier echange, garde en memoire le
  // temps du choix : le code Google ne sert qu'une fois, impossible de le
  // rejouer pour la chaine choisie.
  const reprise = useRef<{ refreshToken: string; brand: string } | null>(null)
  const lance = useRef(false)

  useEffect(() => {
    if (lance.current) return
    lance.current = true

    const code = params.get('code')
    const erreur = params.get('error')

    if (erreur) {
      clearYoutubeFlow()
      setEtat({
        phase: 'erreur',
        message:
          erreur === 'access_denied'
            ? "Tu as refuse l'autorisation sur Google, ou elle a ete annulee. Rien n'a ete enregistre."
            : `Google a refuse la connexion : ${erreur}`,
      })
      return
    }

    if (!code) {
      setEtat({
        phase: 'erreur',
        message:
          "Cette page attend un retour de Google et n'a rien recu. Relance la connexion depuis l'onglet Comptes.",
      })
      return
    }

    const flow = readYoutubeFlow()
    const state = params.get('state')

    if (!flow || !state || flow.state !== state) {
      clearYoutubeFlow()
      setEtat({
        phase: 'erreur',
        message:
          "Le jeton de securite ne correspond pas. Cela arrive si la connexion a ete lancee depuis un autre onglet, ou si elle a trop attendu. Relance-la depuis l'onglet Comptes.",
      })
      return
    }

    finaliserYoutube({ code, brand: flow.brand })
      .then((res) => {
        if (res.choix_requis && res.chaines?.length && res.refresh_token) {
          reprise.current = { refreshToken: res.refresh_token, brand: flow.brand }
          setEtat({ phase: 'choix', chaines: res.chaines })
          return
        }
        clearYoutubeFlow()
        setEtat({ phase: 'succes', message: res.message })
        setTimeout(() => {
          navigate('/accounts', { replace: true, state: { notice: res.message } })
        }, 1600)
      })
      .catch((err) => {
        clearYoutubeFlow()
        setEtat({ phase: 'erreur', message: friendlyError(err) })
      })
  }, [params, navigate])

  async function choisir(chaine: ChaineYoutube) {
    const en_cours = reprise.current
    if (!en_cours) return
    setEtat({ phase: 'travail' })
    try {
      const res = await finaliserYoutube({
        refresh_token: en_cours.refreshToken,
        brand: en_cours.brand,
        channel_id: chaine.id,
      })
      clearYoutubeFlow()
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
          <h1 className="text-xl font-bold tracking-tight">Connexion YouTube</h1>
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
                On recupere tes chaines et on prepare l'acces pour la publication.
              </p>
            </div>
          )}

          {etat.phase === 'choix' && (
            <div>
              <p className="mb-1 font-medium">Quelle chaine connecter ?</p>
              <p className="mb-4 text-sm text-mist-500">
                Ce compte Google en gere plusieurs. Tu pourras ajouter les autres plus tard en
                relancant la connexion.
              </p>
              <div className="space-y-2">
                {etat.chaines.map((c) => (
                  <button
                    key={c.id}
                    className="flex w-full items-center gap-3 rounded-xl border border-ink-700 px-4 py-3 text-left transition-colors hover:border-brand-500/50 hover:bg-ink-800"
                    onClick={() => void choisir(c)}
                  >
                    {c.vignette && (
                      <img
                        src={c.vignette}
                        alt=""
                        className="h-8 w-8 shrink-0 rounded-full"
                        loading="lazy"
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.titre}</span>
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
