import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { buildTikTokAuthUrl } from '../lib/tiktok'
import {
  checkAccount,
  createAccount,
  deleteAccount,
  listAccounts,
  updateAccount,
  type AccountCheck,
  type AccountInput,
} from '../lib/api'
import { friendlyError } from '../lib/errors'
import {
  ACCOUNT_STATUSES,
  ACCOUNT_STATUS_CLASS,
  PLATFORMS,
  PLATFORM_ICON,
  PLATFORM_LABEL,
  daysUntilExpiry,
  type Account,
} from '../lib/types'
import { toLocalInput } from '../lib/format'
import { Alert, Chip, ConfirmModal, EmptyState, Loading, Modal, PageHeader } from '../components/ui'

const EMPTY: AccountInput = {
  platform: 'instagram',
  brand: '',
  account_name: '',
  external_account_id: '',
  access_token: '',
  refresh_token: '',
  token_expiry: null,
  status: 'active',
}

/** Le message d'alerte lie a l'expiration du token, ou null si tout va bien. */
function expiryWarning(account: Account): { text: string; bad: boolean } | null {
  const days = daysUntilExpiry(account.token_expiry)
  if (days === null) return null
  if (days < 0) return { text: 'Token expire', bad: true }
  if (days <= 3) return { text: `Token expire dans ${days} j`, bad: true }
  if (days <= 10) return { text: `Token expire dans ${days} j`, bad: false }
  return null
}

function statusLabel(status: string): string {
  return ACCOUNT_STATUSES.find((s) => s.value === status)?.label ?? status
}

export default function Accounts() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editing, setEditing] = useState<Account | null>(null)
  const [creating, setCreating] = useState(false)
  const [toDelete, setToDelete] = useState<Account | null>(null)

  // Resultat du dernier test de connexion, par compte.
  const [checks, setChecks] = useState<Record<string, AccountCheck>>({})
  const [testing, setTesting] = useState<string | null>(null)

  const [connectingTikTok, setConnectingTikTok] = useState(false)

  // Message rapporte par la page de retour TikTok apres une connexion reussie.
  const location = useLocation()
  const [notice, setNotice] = useState<string | null>(
    (location.state as { notice?: string } | null)?.notice ?? null,
  )

  useEffect(() => {
    if (!notice) return
    // On vide l'etat de navigation, sinon un rechargement de la page reafficherait
    // la confirmation d'une connexion faite il y a longtemps.
    window.history.replaceState({}, '')
    const t = setTimeout(() => setNotice(null), 8000)
    return () => clearTimeout(t)
  }, [notice])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setAccounts(await listAccounts())
      setError(null)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  async function onDelete() {
    if (!toDelete) return
    try {
      await deleteAccount(toDelete.id)
      await reload()
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  /** Interroge la plateforme pour savoir si le compte est reellement utilisable. */
  async function testAccount(account: Account) {
    setTesting(account.id)
    setError(null)
    try {
      const result = await checkAccount(account.id)
      setChecks((c) => ({ ...c, [account.id]: result }))
      // Le test met le statut a jour cote base, on rafraichit pour le voir.
      await reload()
    } catch (err) {
      setChecks((c) => ({ ...c, [account.id]: { ok: false, message: friendlyError(err) } }))
    } finally {
      setTesting(null)
    }
  }

  const byBrand = accounts.reduce<Record<string, Account[]>>((acc, a) => {
    ;(acc[a.brand] ??= []).push(a)
    return acc
  }, {})

  return (
    <div>
      <PageHeader
        title="Comptes"
        subtitle={`${accounts.length} compte${accounts.length > 1 ? 's' : ''} enregistre${accounts.length > 1 ? 's' : ''}`}
        action={
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-ghost" onClick={() => setConnectingTikTok(true)}>
              Connecter un compte TikTok
            </button>
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              Ajouter un compte
            </button>
          </div>
        }
      />

      {notice && (
        <div className="mb-4">
          <Alert kind="ok">{notice}</Alert>
        </div>
      )}

      {error && (
        <div className="mb-4">
          <Alert kind="error">{error}</Alert>
        </div>
      )}

      {loading ? (
        <Loading />
      ) : accounts.length === 0 ? (
        <EmptyState
          icon="◍"
          title="Aucun compte pour le moment"
          hint="Ajoute un compte par marque et par plateforme, avec son token d'acces. Le scheduler ne publie que sur les comptes marques actifs."
        />
      ) : (
        <div className="space-y-8">
          {Object.entries(byBrand).map(([brand, list]) => (
            <section key={brand}>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-mist-500">
                {brand}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {list.map((account) => {
                  const warning = expiryWarning(account)
                  return (
                    <article key={account.id} className="panel p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{account.account_name}</p>
                          <p className="mt-0.5 text-xs text-mist-500">
                            <span className="mr-1 opacity-70">
                              {PLATFORM_ICON[account.platform]}
                            </span>
                            {PLATFORM_LABEL[account.platform] ?? account.platform}
                          </p>
                        </div>
                        <Chip className={ACCOUNT_STATUS_CLASS[account.status]}>
                          {statusLabel(account.status)}
                        </Chip>
                      </div>

                      {!account.access_token && (
                        <p className="mt-3 text-xs text-warn-400">Aucun token enregistre</p>
                      )}
                      {warning && (
                        <p
                          className={`mt-3 text-xs ${warning.bad ? 'text-bad-400' : 'text-warn-400'}`}
                        >
                          {warning.text}
                        </p>
                      )}

                      {checks[account.id] && (
                        <p
                          className={`mt-3 rounded-lg border px-2.5 py-2 text-xs ${
                            checks[account.id].ok
                              ? 'border-ok-600/40 bg-ok-600/10 text-ok-400'
                              : 'border-bad-600/40 bg-bad-600/10 text-bad-400'
                          }`}
                        >
                          {checks[account.id].message}
                        </p>
                      )}

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          className="btn btn-ghost flex-1"
                          onClick={() => void testAccount(account)}
                          disabled={testing === account.id}
                        >
                          {testing === account.id ? 'Test...' : 'Tester la connexion'}
                        </button>
                        <button className="btn btn-ghost" onClick={() => setEditing(account)}>
                          Modifier
                        </button>
                        <button className="btn btn-danger" onClick={() => setToDelete(account)}>
                          Supprimer
                        </button>
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <AccountForm
        open={creating || editing !== null}
        account={editing}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        onSaved={() => {
          setCreating(false)
          setEditing(null)
          void reload()
        }}
      />

      <TikTokConnect
        open={connectingTikTok}
        brands={[...new Set(accounts.map((a) => a.brand))].sort()}
        onClose={() => setConnectingTikTok(false)}
      />

      <ConfirmModal
        open={toDelete !== null}
        title="Supprimer ce compte"
        message={`Le compte ${toDelete?.account_name ?? ''} et toutes ses publications programmees seront supprimes. Cette action est definitive.`}
        confirmLabel="Supprimer"
        danger
        onConfirm={() => void onDelete()}
        onClose={() => setToDelete(null)}
      />
    </div>
  )
}

/**
 * Connexion TikTok en un clic.
 *
 * On demande la marque avant de partir : au retour, TikTok ne dit pas a quelle
 * marque rattacher le compte, et l'information serait perdue. Elle voyage donc
 * dans le sessionStorage, a cote du jeton anti-CSRF.
 */
function TikTokConnect({
  open,
  brands,
  onClose,
}: {
  open: boolean
  brands: string[]
  onClose: () => void
}) {
  const [brand, setBrand] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setBrand(brands[0] ?? '')
    setError(null)
    setBusy(false)
  }, [open, brands])

  async function go() {
    if (!brand.trim()) {
      setError('Indique la marque a laquelle rattacher ce compte')
      return
    }
    setBusy(true)
    setError(null)
    try {
      window.location.href = await buildTikTokAuthUrl(brand.trim())
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  return (
    <Modal open={open} title="Connecter un compte TikTok" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-mist-300">
          TikTok va te demander d'autoriser BubuPost, puis te ramenera ici. Le compte sera
          enregistre tout seul, tu n'as aucun token a copier.
        </p>

        <div>
          <label className="label" htmlFor="tiktok-brand">
            Marque
          </label>
          <input
            id="tiktok-brand"
            className="field"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            placeholder="EdgeSyncFX"
            list="brands-tiktok"
          />
          <datalist id="brands-tiktok">
            {brands.map((b) => (
              <option key={b} value={b} />
            ))}
            <option value="EdgeSyncFX" />
            <option value="TchabaRimonda" />
          </datalist>
          <p className="mt-1 text-xs text-mist-600">
            TikTok ne nous dira pas a quelle marque rattacher le compte, d'ou cette question avant
            de partir.
          </p>
        </div>

        {error && <Alert kind="error">{error}</Alert>}

        <div className="flex justify-end gap-2 pt-2">
          <button className="btn btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary" onClick={() => void go()} disabled={busy}>
            {busy ? 'Redirection...' : 'Continuer vers TikTok'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function AccountForm({
  open,
  account,
  onClose,
  onSaved,
}: {
  open: boolean
  account: Account | null
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<AccountInput>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showToken, setShowToken] = useState(false)

  useEffect(() => {
    if (!open) return
    setError(null)
    setShowToken(false)
    setForm(
      account
        ? {
            platform: account.platform,
            brand: account.brand,
            account_name: account.account_name,
            external_account_id: account.external_account_id ?? '',
            access_token: account.access_token ?? '',
            refresh_token: account.refresh_token ?? '',
            token_expiry: account.token_expiry,
            status: account.status,
          }
        : EMPTY,
    )
  }, [open, account])

  const set = <K extends keyof AccountInput>(key: K, value: AccountInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const payload: AccountInput = {
        ...form,
        brand: form.brand.trim(),
        account_name: form.account_name.trim(),
        external_account_id: form.external_account_id?.trim() || null,
        access_token: form.access_token?.trim() || null,
        refresh_token: form.refresh_token?.trim() || null,
      }
      if (account) await updateAccount(account.id, payload)
      else await createAccount(payload)
      onSaved()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  const needsRefreshToken = form.platform === 'youtube'

  return (
    <Modal
      open={open}
      title={account ? 'Modifier le compte' : 'Ajouter un compte'}
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="platform">
              Plateforme
            </label>
            <select
              id="platform"
              className="field"
              value={form.platform}
              onChange={(e) => set('platform', e.target.value)}
            >
              {PLATFORMS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="status">
              Statut
            </label>
            <select
              id="status"
              className="field"
              value={form.status}
              onChange={(e) => set('status', e.target.value)}
            >
              {ACCOUNT_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="brand">
              Marque
            </label>
            <input
              id="brand"
              className="field"
              value={form.brand}
              onChange={(e) => set('brand', e.target.value)}
              placeholder="EdgeSyncFX"
              list="brands"
              required
            />
            <datalist id="brands">
              <option value="EdgeSyncFX" />
              <option value="TchabaRimonda" />
            </datalist>
          </div>

          <div>
            <label className="label" htmlFor="account_name">
              Nom du compte
            </label>
            <input
              id="account_name"
              className="field"
              value={form.account_name}
              onChange={(e) => set('account_name', e.target.value)}
              placeholder="@edgesyncfx"
              required
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="external_account_id">
            Identifiant du compte sur la plateforme
          </label>
          <input
            id="external_account_id"
            className="field"
            value={form.external_account_id ?? ''}
            onChange={(e) => set('external_account_id', e.target.value)}
            placeholder="17841400000000000"
          />
          <p className="mt-1 text-xs text-mist-600">
            Instagram : IG User ID. Facebook : Page ID. Threads : Threads User ID. YouTube et
            TikTok : laisser vide.
          </p>
        </div>

        {/* TikTok a son flow automatise : proposer la saisie manuelle du token
            ici inviterait a se tromper, alors qu'un bouton fait tout. Les
            autres plateformes gardent le formulaire, leur flow n'existe pas. */}
        {form.platform === 'tiktok' && !account ? (
          <Alert kind="info">
            Pour TikTok, ferme cette fenetre et utilise le bouton{' '}
            <strong className="text-mist-100">Connecter un compte TikTok</strong> en haut de la
            page. Le token est recupere automatiquement, il n'y a rien a coller.
          </Alert>
        ) : (
        <>
        <div>
          <div className="flex items-baseline justify-between">
            <label className="label" htmlFor="access_token">
              Token d'acces
            </label>
            <button
              type="button"
              className="mb-1.5 text-xs text-mist-500 hover:text-mist-300"
              onClick={() => setShowToken((v) => !v)}
            >
              {showToken ? 'Masquer' : 'Afficher'}
            </button>
          </div>
          <input
            id="access_token"
            type={showToken ? 'text' : 'password'}
            className="field font-mono text-xs"
            value={form.access_token ?? ''}
            onChange={(e) => set('access_token', e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="EAAG..."
          />
          <p className="mt-1 text-xs text-mist-600">
            Masque par defaut. Colle-le tel quel, l'app retire les espaces autour toute seule.
          </p>
        </div>

        {needsRefreshToken && (
          <div>
            <label className="label" htmlFor="refresh_token">
              Refresh token
            </label>
            <input
              id="refresh_token"
              type={showToken ? 'text' : 'password'}
              className="field font-mono text-xs"
              value={form.refresh_token ?? ''}
              onChange={(e) => set('refresh_token', e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="1//0g..."
            />
            <p className="mt-1 text-xs text-mist-600">
              YouTube en a besoin : l'access token Google ne dure qu'une heure, le refresh token
              permet d'en regenerer un a chaque publication.
            </p>
          </div>
        )}

        <div>
          <label className="label" htmlFor="token_expiry">
            Expiration du token
          </label>
          <input
            id="token_expiry"
            type="datetime-local"
            className="field"
            value={form.token_expiry ? toLocalInput(form.token_expiry) : ''}
            onChange={(e) =>
              set('token_expiry', e.target.value ? new Date(e.target.value).toISOString() : null)
            }
          />
          <p className="mt-1 text-xs text-mist-600">
            Optionnel, mais c'est ce qui declenche l'alerte avant que le token ne lache.
          </p>
        </div>
        </>
        )}

        {error && <Alert kind="error">{error}</Alert>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
