import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { exchangeTikTokCode, readTikTokFlow, clearTikTokFlow } from '../lib/tiktok'
import { friendlyError } from '../lib/errors'

type Etat =
  | { phase: 'travail' }
  | { phase: 'succes'; message: string }
  | { phase: 'erreur'; message: string; technique?: string }

export default function TikTokCallback() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [etat, setEtat] = useState<Etat>({ phase: 'travail' })

  // React 19 en mode strict monte deux fois : sans ce garde, le code partirait
  // deux fois vers TikTok et le second appel echouerait, un code ne servant
  // qu'une seule fois. L'utilisateur verrait une erreur alors que tout a marche.
  const lance = useRef(false)

  useEffect(() => {
    if (lance.current) return
    lance.current = true

    const code = params.get('code')
    const state = params.get('state')
    const erreurTikTok = params.get('error')
    const descriptionTikTok = params.get('error_description')

    if (erreurTikTok) {
      clearTikTokFlow()
      setEtat({
        phase: 'erreur',
        message:
          erreurTikTok === 'access_denied'
            ? "Tu as refuse l'autorisation sur TikTok, ou elle a ete annulee. Rien n'a ete enregistre."
            : `TikTok a refuse la connexion : ${descriptionTikTok || erreurTikTok}`,
      })
      return
    }

    if (!code) {
      setEtat({
        phase: 'erreur',
        message:
          "Cette page attend un retour de TikTok et n'a rien recu. Relance la connexion depuis l'onglet Comptes.",
      })
      return
    }

    const flow = readTikTokFlow()

    // Verification anti-CSRF : sans elle, un lien piege pourrait faire
    // enregistrer le compte TikTok d'un inconnu dans l'application.
    if (!flow || !state || flow.state !== state) {
      clearTikTokFlow()
      setEtat({
        phase: 'erreur',
        message:
          "Le jeton de securite ne correspond pas. Cela arrive si la connexion a ete lancee depuis un autre onglet, ou si elle a trop attendu. Relance-la depuis l'onglet Comptes.",
      })
      return
    }

    exchangeTikTokCode(code, flow.brand)
      .then((res) => {
        clearTikTokFlow()
        setEtat({ phase: 'succes', message: res.message })
        // On laisse le message a l'ecran un instant, sinon la redirection
        // efface la confirmation avant qu'elle soit lue.
        setTimeout(() => {
          navigate('/accounts', {
            replace: true,
            state: { notice: res.message },
          })
        }, 1600)
      })
      .catch((err) => {
        clearTikTokFlow()
        setEtat({ phase: 'erreur', message: friendlyError(err) })
      })
  }, [params, navigate])

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-brand-500/30 bg-brand-500/15">
            <span className="text-xl">🚀</span>
          </div>
          <h1 className="text-xl font-bold tracking-tight">Connexion TikTok</h1>
        </div>

        <div className="panel p-6 text-center">
          {etat.phase === 'travail' && (
            <>
              <div
                className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-ink-700 border-t-brand-400"
                role="status"
                aria-label="Connexion en cours"
              />
              <p className="font-medium">Connexion en cours...</p>
              <p className="mt-1.5 text-sm text-mist-500">
                On echange le code recu de TikTok contre un acces, puis on enregistre le compte.
              </p>
            </>
          )}

          {etat.phase === 'succes' && (
            <>
              <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full border border-ok-400/40 bg-ok-400/15 text-lg text-ok-400">
                ✓
              </div>
              <p className="font-medium text-ok-400">{etat.message}</p>
              <p className="mt-1.5 text-sm text-mist-500">Retour a la liste des comptes...</p>
            </>
          )}

          {etat.phase === 'erreur' && (
            <>
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
                <button className="btn btn-ghost w-full" onClick={() => navigate('/', { replace: true })}>
                  Aller au dashboard
                </button>
              </div>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-mist-600">
          Ferme cette page seulement une fois le message affiche.
        </p>
      </div>
    </div>
  )
}
