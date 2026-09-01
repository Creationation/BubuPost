import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { friendlyError } from '../lib/errors'

const CONTACT = 'renardiego@gmail.com'

export default function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await signIn(email.trim(), password)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500/15 border border-brand-500/30">
            <span className="text-xl">🚀</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">BubuPost</h1>
          <p className="mt-1 text-sm text-mist-500">Publication automatisee multi-comptes</p>
        </div>

        <form onSubmit={onSubmit} className="panel p-6 space-y-4">
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              className="field"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>

          <div>
            <label className="label" htmlFor="password">Mot de passe</label>
            <input
              id="password"
              type="password"
              className="field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <p className="rounded-lg border border-bad-600/50 bg-bad-600/10 px-3 py-2 text-sm text-bad-400">
              {error}
            </p>
          )}

          <button type="submit" className="btn btn-primary w-full" disabled={busy}>
            {busy ? 'Connexion...' : 'Se connecter'}
          </button>
        </form>

        {/* Ce bloc doit rester visible sans connexion : c'est par la que les
            equipes de validation de TikTok et de Meta accedent aux mentions
            legales, et elles n'ont pas de compte pour aller plus loin. */}
        <div className="mt-8 space-y-4 border-t border-ink-800 pt-6 text-center">
          <p className="text-xs leading-relaxed text-mist-500">
            BubuPost est un outil prive de planification et de publication de videos courtes sur
            les comptes de reseaux sociaux de son proprietaire. L'acces est reserve, il n'y a pas
            d'inscription ouverte au public.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-xs">
            <Link
              to="/terms"
              className="rounded-lg border border-ink-700 px-3 py-1.5 font-medium text-mist-300 transition-colors hover:border-brand-500/50 hover:text-mist-100"
            >
              Terms of Service
            </Link>
            <Link
              to="/privacy"
              className="rounded-lg border border-ink-700 px-3 py-1.5 font-medium text-mist-300 transition-colors hover:border-brand-500/50 hover:text-mist-100"
            >
              Privacy Policy
            </Link>
            <a
              href={`mailto:${CONTACT}`}
              className="rounded-lg border border-ink-700 px-3 py-1.5 font-medium text-mist-300 transition-colors hover:border-brand-500/50 hover:text-mist-100"
            >
              Contact
            </a>
          </div>

          <p className="text-xs text-mist-600">
            Plateformes prises en charge : Instagram, Facebook, Threads, YouTube, TikTok.
          </p>
          <p className="text-xs text-mist-600">
            Une question ou une demande de suppression de donnees :{' '}
            <a className="text-brand-400 hover:underline" href={`mailto:${CONTACT}`}>
              {CONTACT}
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
