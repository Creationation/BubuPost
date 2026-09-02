import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  creerDossier,
  dernierSigneDeVie,
  enregistrerConfigAuto,
  listAccounts,
  listerDossiers,
  listerImports,
  listPosts,
  lireConfigAuto,
  majDossier,
  rejeterCampagne,
  rejouerImport,
  supprimerDossier,
  testerNom,
  validerCampagne,
  type LectureNom,
  type SignesDeVie,
} from '../lib/api'
import { friendlyError } from '../lib/errors'
import { PLATFORMS, PLATFORM_LABEL, type Account, type PostWithAccount } from '../lib/types'
import {
  CHAMPS_NOM,
  configVide,
  exempleNom,
  exemplesNom,
  JOURS_CADENCE,
  normaliserConfig,
  silenceDepuis,
  type ConfigAuto,
  type Dossier,
  type Import,
} from '../lib/automatisation'
import { formatDateTime } from '../lib/format'
import { Alert, ConfirmModal, EmptyState, Loading, PageHeader } from '../components/ui'

type Onglet = 'suivi' | 'dossiers' | 'nommage' | 'ciblage' | 'cadence' | 'validation' | 'contenu'

const ONGLETS: { cle: Onglet; label: string }[] = [
  { cle: 'suivi', label: 'Suivi' },
  { cle: 'dossiers', label: 'Dossiers' },
  { cle: 'nommage', label: 'Nommage' },
  { cle: 'ciblage', label: 'Ciblage' },
  { cle: 'cadence', label: 'Cadence' },
  { cle: 'validation', label: 'Validation' },
  { cle: 'contenu', label: 'Contenu' },
]

export default function Automatisation() {
  const [config, setConfig] = useState<ConfigAuto>(configVide())
  const [dossiers, setDossiers] = useState<Dossier[]>([])
  const [imports, setImports] = useState<Import[]>([])
  const [comptes, setComptes] = useState<Account[]>([])
  const [aValider, setAValider] = useState<PostWithAccount[]>([])
  const [ping, setPing] = useState<SignesDeVie | null>(null)

  const [onglet, setOnglet] = useState<Onglet>('suivi')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const reload = useCallback(async (premier = false) => {
    if (premier) setLoading(true)
    try {
      const [c, d, i, a, p, posts] = await Promise.all([
        lireConfigAuto(),
        listerDossiers(),
        listerImports(),
        listAccounts(),
        dernierSigneDeVie(),
        listPosts(),
      ])
      setConfig(normaliserConfig(c))
      setDossiers(d)
      setImports(i)
      setComptes(a)
      setPing(p)
      setAValider(posts.filter((x) => x.status === 'a_valider'))
      setError(null)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      if (premier) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload(true)
  }, [reload])

  const marques = useMemo(
    () => [...new Set(comptes.map((c) => c.brand))].filter(Boolean).sort(),
    [comptes],
  )

  async function enregistrer(suite: ConfigAuto, message = 'Reglages enregistres') {
    setConfig(suite)
    setBusy(true)
    setError(null)
    try {
      await enregistrerConfigAuto(suite)
      setNotice(`${message}. Le watcher les appliquera a son prochain passage.`)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  async function agir(fn: () => Promise<void>, message: string) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      setNotice(message)
      await reload()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  const silence = silenceDepuis(ping?.vu_a ?? null)
  const enSilence = silence != null && silence.heures > (config.alerteSilenceHeures || 26)

  return (
    <div>
      <PageHeader
        title="Automatisation"
        subtitle="Le watcher depose les videos, l application decide de tout le reste."
        action={
          <button
            className={config.actif ? 'btn btn-danger' : 'btn btn-primary'}
            disabled={busy}
            onClick={() =>
              void enregistrer(
                { ...config, actif: !config.actif },
                config.actif ? 'Automatisation suspendue' : 'Automatisation activee',
              )
            }
          >
            {config.actif ? 'Tout suspendre' : "Activer l'automatisation"}
          </button>
        }
      />

      {!config.actif && (
        <div className="mb-4">
          <Alert kind="info">
            L automatisation est suspendue. Le watcher continue de tourner mais ne traite aucun
            fichier, et rien n est deplace.
          </Alert>
        </div>
      )}

      {enSilence && (
        <div className="mb-4">
          <Alert kind="error">
            Le watcher n a pas donne signe de vie depuis {silence.texte}. Le PC est peut-etre
            eteint, ou le script arrete. Les videos deposees ne sont pas traitees.
          </Alert>
        </div>
      )}

      <div className="mb-5 flex flex-wrap gap-1 rounded-xl border border-ink-700 bg-ink-850 p-1">
        {ONGLETS.map((o) => (
          <button
            key={o.cle}
            onClick={() => setOnglet(o.cle)}
            aria-pressed={onglet === o.cle}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              onglet === o.cle ? 'bg-brand-500 text-white' : 'text-mist-500 hover:text-mist-100'
            }`}
          >
            {o.label}
            {o.cle === 'suivi' && aValider.length > 0 && (
              <span className="ml-1.5 rounded-full bg-brand-400/20 px-1.5 text-[10px] text-brand-400">
                {aValider.length}
              </span>
            )}
          </button>
        ))}
      </div>

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

      {loading ? (
        <Loading />
      ) : (
        <>
          {/*
            Tous les panneaux restent montes, les inactifs sont masques.
            Les demonter effacait la saisie en cours des qu'on changeait
            d'onglet, sans le dire : on tapait, on allait voir ailleurs, et on
            revenait sur l'ancienne valeur.
          */}
          <div hidden={onglet !== 'suivi'}>
            <Suivi
              ping={ping}
              silence={silence}
              imports={imports}
              aValider={aValider}
              onRejouer={(id) =>
                void agir(
                  () => rejouerImport(id),
                  'Fichier oublie du journal, il sera repris au prochain passage',
                )
              }
              onValider={(c) =>
                void agir(async () => {
                  await validerCampagne(c)
                }, 'Campagne validee, elle part en file d attente')
              }
              onRejeter={(c) =>
                void agir(async () => {
                  await rejeterCampagne(c)
                }, 'Campagne rejetee, ses publications sont annulees')
              }
            />
          </div>

          <div hidden={onglet !== 'dossiers'}>
            <Dossiers
              dossiers={dossiers}
              profils={config.profils}
              marques={marques}
              busy={busy}
              onCreer={(d) => void agir(async () => void (await creerDossier(d)), 'Dossier ajoute')}
              onMaj={(id, d) => void agir(() => majDossier(id, d), 'Dossier mis a jour')}
              onSupprimer={(id) => void agir(() => supprimerDossier(id), 'Dossier retire')}
            />
          </div>

          <div hidden={onglet !== 'nommage'}>
            <Nommage config={config} busy={busy} onEnregistrer={enregistrer} />
          </div>

          <div hidden={onglet !== 'ciblage'}>
            <Ciblage config={config} comptes={comptes} busy={busy} onEnregistrer={enregistrer} />
          </div>

          <div hidden={onglet !== 'cadence'}>
            <CadenceOnglet
              config={config}
              marques={marques}
              busy={busy}
              onEnregistrer={enregistrer}
            />
          </div>

          <div hidden={onglet !== 'validation'}>
            <Validation config={config} marques={marques} busy={busy} onEnregistrer={enregistrer} />
          </div>

          <div hidden={onglet !== 'contenu'}>
            <ContenuOnglet
              config={config}
              marques={marques}
              busy={busy}
              onEnregistrer={enregistrer}
            />
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Suivi
// ---------------------------------------------------------------------------

function Suivi({
  ping,
  silence,
  imports,
  aValider,
  onRejouer,
  onValider,
  onRejeter,
}: {
  ping: SignesDeVie | null
  silence: { heures: number; texte: string } | null
  imports: Import[]
  aValider: PostWithAccount[]
  onRejouer: (id: string) => void
  onValider: (campaignId: string) => void
  onRejeter: (campaignId: string) => void
}) {
  const campagnes = useMemo(() => {
    const map = new Map<string, PostWithAccount[]>()
    for (const p of aValider) {
      const cle = p.campaign_id ?? p.id
      const l = map.get(cle)
      if (l) l.push(p)
      else map.set(cle, [p])
    }
    return [...map.entries()]
  }, [aValider])

  const rejetes = imports.filter((i) => i.statut === 'rejete')

  return (
    <div className="space-y-5">
      <section className="panel p-5">
        <h2 className="mb-3 font-semibold">Le watcher</h2>
        {ping?.vu_a ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-mist-600">Dernier passage</dt>
              <dd className={silence && silence.heures > 26 ? 'text-bad-400' : 'text-mist-300'}>
                {silence?.texte}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-mist-600">Le</dt>
              <dd className="text-mist-300">{formatDateTime(ping.vu_a)}</dd>
            </div>
            <div>
              <dt className="text-xs text-mist-600">Version du script</dt>
              <dd className="text-mist-300">{ping.version || 'inconnue'}</dd>
            </div>
          </dl>
        ) : (
          <Alert kind="info">
            Le watcher ne s est jamais manifeste. Suis les instructions du Guide pour l installer.
          </Alert>
        )}
      </section>

      {campagnes.length > 0 && (
        <section className="panel p-5">
          <h2 className="mb-1 font-semibold">
            {campagnes.length} campagne{campagnes.length > 1 ? 's' : ''} a valider
          </h2>
          <p className="mb-4 text-sm text-mist-500">
            Elles ne partiront pas tant qu elles ne sont pas approuvees. Pour corriger un texte ou
            changer la video, ouvre-les depuis{' '}
            <Link to="/posts" className="text-brand-400 hover:underline">
              Publications
            </Link>{' '}
            en filtrant sur « A valider ».
          </p>

          <div className="space-y-3">
            {campagnes.map(([cle, posts]) => (
              <div key={cle} className="rounded-xl border border-brand-500/40 bg-brand-500/5 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {posts[0].accounts?.brand ?? 'marque inconnue'}, {posts.length} publication
                      {posts.length > 1 ? 's' : ''}
                    </p>
                    <p className="mt-0.5 text-xs text-mist-600">
                      A partir du {formatDateTime(posts[0].scheduled_at)}
                    </p>
                    <p className="mt-1.5 line-clamp-2 text-xs text-mist-500">
                      {posts[0].caption || 'aucun texte'}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      className="btn btn-primary !py-1 !text-xs"
                      onClick={() => onValider(cle)}
                    >
                      Valider
                    </button>
                    <button className="btn btn-danger !py-1 !text-xs" onClick={() => onRejeter(cle)}>
                      Rejeter
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel p-5">
        <h2 className="mb-1 font-semibold">Fichiers vus</h2>
        <p className="mb-2 text-sm text-mist-500">
          Un fichier accepte va dans la{' '}
          <Link to="/bibliotheque" className="text-brand-400 hover:underline">
            bibliotheque
          </Link>
          , pas directement en campagne : c est la que tu decides de l ordre.
        </p>
        <p className="mb-4 text-sm text-mist-500">
          {rejetes.length > 0
            ? `${rejetes.length} fichier(s) refuse(s). Ils sont restes en place : corrige le nom ou les reglages, puis rejoue-les.`
            : 'Les derniers fichiers deposes dans les dossiers surveilles.'}
        </p>

        {imports.length === 0 ? (
          <EmptyState
            icon="▽"
            title="Aucun fichier traite pour l instant"
            hint="Depose une video dans un dossier surveille, le watcher s en occupe au passage suivant."
          />
        ) : (
          <ul className="space-y-2">
            {imports.map((i) => (
              <li
                key={i.id}
                className={`rounded-xl border p-3 ${
                  i.statut === 'rejete' ? 'border-bad-600/40 bg-bad-600/5' : 'border-ink-700'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" title={i.fichier}>
                      <span className="mr-1.5 opacity-70">{i.statut === 'rejete' ? '✕' : '✓'}</span>
                      {i.fichier}
                    </p>
                    <p className="mt-0.5 text-xs text-mist-600">
                      {formatDateTime(i.created_at)}
                      {i.marque && ` · ${i.marque}`}
                      {i.publications > 0 && ` · ${i.publications} publication(s)`}
                    </p>
                    {i.raison && (
                      <p
                        className={`mt-1 text-xs ${
                          i.statut === 'rejete' ? 'text-bad-400' : 'text-warn-400'
                        }`}
                      >
                        {i.raison}
                      </p>
                    )}
                  </div>
                  {i.statut === 'rejete' && (
                    <button
                      className="btn btn-ghost !py-1 !text-xs"
                      onClick={() => onRejouer(i.id)}
                      title="Oublie ce fichier du journal pour que le watcher le reprenne"
                    >
                      Rejouer
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dossiers
// ---------------------------------------------------------------------------

function Dossiers({
  dossiers,
  profils,
  marques,
  busy,
  onCreer,
  onMaj,
  onSupprimer,
}: {
  dossiers: Dossier[]
  profils: ConfigAuto['profils']
  marques: string[]
  busy: boolean
  onCreer: (d: {
    chemin: string
    actif: boolean
    marque: string | null
    profil: string | null
    ordre: number
  }) => void
  onMaj: (id: string, d: Record<string, unknown>) => void
  onSupprimer: (id: string) => void
}) {
  const [chemin, setChemin] = useState('')
  const [marque, setMarque] = useState('')
  const [profil, setProfil] = useState(profils[0]?.nom ?? '')
  const [aSupprimer, setASupprimer] = useState<Dossier | null>(null)

  return (
    <div className="space-y-5">
      <section className="panel p-5">
        <h2 className="mb-1 font-semibold">Ajouter un dossier</h2>
        <p className="mb-4 text-sm text-mist-500">
          Le chemin doit exister sur le PC ou tourne le watcher. Les videos deposees a la racine
          sont traitees, puis rangees dans un sous-dossier « traite ».
        </p>

        <div className="space-y-3">
          <label className="block">
            <span className="label">Chemin du dossier</span>
            <input
              className="field font-mono text-xs"
              value={chemin}
              onChange={(e) => setChemin(e.target.value)}
              placeholder="C:\Users\latitude\Videos\BubuPost\EdgeSyncFX"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">Marque du dossier</span>
              <select
                className="field"
                value={marque}
                onChange={(e) => setMarque(e.target.value)}
              >
                <option value="">Lire la marque dans le nom du fichier</option>
                {marques.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-mist-600">
                Une marque imposee ici dispense de l ecrire dans chaque nom de fichier.
              </span>
            </label>

            <label className="block">
              <span className="label">Profil de ciblage</span>
              <select className="field" value={profil} onChange={(e) => setProfil(e.target.value)}>
                {profils.map((p) => (
                  <option key={p.nom} value={p.nom}>
                    {p.nom}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex justify-end">
            <button
              className="btn btn-primary"
              disabled={busy || !chemin.trim()}
              onClick={() => {
                onCreer({
                  chemin: chemin.trim(),
                  actif: true,
                  marque: marque || null,
                  profil: profil || null,
                  ordre: dossiers.length,
                })
                setChemin('')
              }}
            >
              Ajouter
            </button>
          </div>
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="mb-4 font-semibold">
          {dossiers.length} dossier{dossiers.length > 1 ? 's' : ''} surveille
          {dossiers.length > 1 ? 's' : ''}
        </h2>

        {dossiers.length === 0 ? (
          <EmptyState icon="▤" title="Aucun dossier surveille" hint="Ajoute-en un ci-dessus." />
        ) : (
          <ul className="space-y-3">
            {dossiers.map((d) => (
              <li
                key={d.id}
                className={`rounded-xl border p-3 ${
                  d.actif ? 'border-ink-700' : 'border-ink-800 opacity-60'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs text-mist-100" title={d.chemin}>
                      {d.chemin}
                    </p>
                    <p className="mt-1 text-xs text-mist-600">
                      {d.marque ? `Marque imposee : ${d.marque}` : 'Marque lue dans le nom'}
                      {d.profil && ` · ${d.profil}`}
                    </p>
                  </div>

                  <div className="flex shrink-0 gap-2">
                    <button
                      className="btn btn-ghost !py-1 !text-xs"
                      onClick={() => onMaj(d.id, { actif: !d.actif })}
                    >
                      {d.actif ? 'Desactiver' : 'Activer'}
                    </button>
                    <button
                      className="btn btn-danger !py-1 !text-xs"
                      onClick={() => setASupprimer(d)}
                    >
                      Retirer
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmModal
        open={aSupprimer !== null}
        title="Retirer ce dossier"
        message="Le dossier n est plus surveille. Rien n est supprime sur ton disque, et les campagnes deja creees ne bougent pas."
        confirmLabel="Retirer"
        danger
        onConfirm={() => {
          if (aSupprimer) onSupprimer(aSupprimer.id)
        }}
        onClose={() => setASupprimer(null)}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Nommage
// ---------------------------------------------------------------------------

function Nommage({
  config,
  busy,
  onEnregistrer,
}: {
  config: ConfigAuto
  busy: boolean
  onEnregistrer: (c: ConfigAuto) => Promise<void>
}) {
  const [etat, setEtat] = useState(config.nommage)
  const [essai, setEssai] = useState('')
  const [lecture, setLecture] = useState<LectureNom | null>(null)
  const [testEnCours, setTestEnCours] = useState(false)
  const [erreurTest, setErreurTest] = useState<string | null>(null)

  const set = (c: Partial<ConfigAuto['nommage']>) => setEtat({ ...etat, ...c })

  function basculerChamp(cle: string) {
    const dedans = etat.ordre.includes(cle)
    // Le sujet ne se retire pas : sans lui, il n'y a rien a ecrire.
    if (dedans && cle === 'sujet') return
    set({ ordre: dedans ? etat.ordre.filter((c) => c !== cle) : [...etat.ordre, cle] })
  }

  function deplacer(cle: string, sens: -1 | 1) {
    const i = etat.ordre.indexOf(cle)
    const j = i + sens
    if (i === -1 || j < 0 || j >= etat.ordre.length) return
    const suite = [...etat.ordre]
    ;[suite[i], suite[j]] = [suite[j], suite[i]]
    set({ ordre: suite })
  }

  async function tester() {
    if (!essai.trim()) return
    setTestEnCours(true)
    setErreurTest(null)
    try {
      setLecture(await testerNom(essai.trim()))
    } catch (err) {
      setErreurTest(friendlyError(err))
      setLecture(null)
    } finally {
      setTestEnCours(false)
    }
  }

  return (
    <div className="space-y-5">
      <section className="panel p-5">
        <h2 className="mb-1 font-semibold">La regle de nommage</h2>
        <p className="mb-2 text-sm text-mist-500">
          Ce que le watcher lit dans le nom d un fichier. Avec la regle actuelle, ces trois noms
          sont valides :
        </p>
        <ul className="mb-4 space-y-1">
          {exemplesNom(etat).map((e) => (
            <li key={e} className="font-mono text-xs text-mist-100">
              {e}
            </li>
          ))}
        </ul>

        <div className="space-y-4">
          <label className="block max-w-xs">
            <span className="label">Separateur</span>
            <input
              className="field font-mono"
              maxLength={3}
              value={etat.separateur}
              onChange={(e) => set({ separateur: e.target.value })}
            />
            <span className="mt-1 block text-xs text-mist-600">
              Un caractere qui n apparait jamais dans un sujet. Le tiret bas convient bien, le
              tiret simple non : il sert a separer les mots du sujet.
            </span>
          </label>

          <div>
            <span className="label">Ordre des elements</span>
            <div className="space-y-2">
              {etat.ordre.map((cle, i) => {
                const champ = CHAMPS_NOM.find((c) => c.cle === cle)
                return (
                  <div
                    key={cle}
                    className="flex items-center gap-2 rounded-lg border border-ink-700 px-3 py-2"
                  >
                    <span className="w-5 text-xs tabular-nums text-mist-600">{i + 1}</span>
                    <span className="flex-1 text-sm">
                      {champ?.label ?? cle}
                      <span className="ml-2 text-xs text-mist-600">{champ?.aide}</span>
                      {cle === 'marque' && (
                        <span className="ml-2 text-xs text-mist-600">
                          la casse n a pas d importance
                        </span>
                      )}
                    </span>
                    <button
                      className="rounded px-1.5 text-mist-500 hover:bg-ink-800 hover:text-mist-100"
                      onClick={() => deplacer(cle, -1)}
                      aria-label="Monter"
                    >
                      ↑
                    </button>
                    <button
                      className="rounded px-1.5 text-mist-500 hover:bg-ink-800 hover:text-mist-100"
                      onClick={() => deplacer(cle, 1)}
                      aria-label="Descendre"
                    >
                      ↓
                    </button>
                    {cle !== 'sujet' && (
                      <button
                        className="rounded px-1.5 text-bad-400 hover:bg-ink-800"
                        onClick={() => basculerChamp(cle)}
                        aria-label="Retirer"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              {CHAMPS_NOM.filter((c) => !etat.ordre.includes(c.cle)).map((c) => (
                <button
                  key={c.cle}
                  className="rounded-lg border border-ink-700 px-2.5 py-1 text-xs text-mist-500 hover:text-mist-100"
                  onClick={() => basculerChamp(c.cle)}
                >
                  + {c.label}
                </button>
              ))}
            </div>
          </div>

          <label className="block max-w-xs">
            <span className="label">Langues reconnues</span>
            <input
              className="field font-mono"
              value={etat.languesReconnues.join(' ')}
              onChange={(e) =>
                set({
                  languesReconnues: e.target.value
                    .split(/[\s,]+/)
                    .map((l) => l.trim().toLowerCase())
                    .filter(Boolean),
                })
              }
              placeholder="en fr"
            />
            <span className="mt-1 block text-xs text-mist-600">
              Codes a deux lettres, separes par des espaces. Un fichier portant une langue absente
              de cette liste est mis de cote : mieux vaut corriger le nom que publier dans une
              langue tiree au hasard.
            </span>
          </label>

          <div>
            <span className="label">Si le nom ne suit pas la regle</span>
            <div className="space-y-2">
              {(
                [
                  {
                    v: 'rejeter' as const,
                    label: 'Mettre le fichier de cote',
                    aide: 'Il reste en place, apparait dans le suivi avec la raison, et tu peux le rejouer apres correction.',
                  },
                  {
                    v: 'defauts' as const,
                    label: 'Traiter avec des valeurs par defaut',
                    aide: 'Ce qui manque est comble par les valeurs ci-dessous.',
                  },
                ]
              ).map((o) => (
                <label
                  key={o.v}
                  className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    etat.surNonConforme === o.v
                      ? 'border-brand-500/50 bg-brand-500/10'
                      : 'border-ink-700'
                  }`}
                >
                  <input
                    type="radio"
                    name="non-conforme"
                    className="mt-1"
                    checked={etat.surNonConforme === o.v}
                    onChange={() => set({ surNonConforme: o.v })}
                  />
                  <span>
                    <span className="block text-mist-100">{o.label}</span>
                    <span className="block text-xs text-mist-600">{o.aide}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {etat.surNonConforme === 'defauts' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="label">Marque par defaut</span>
                <input
                  className="field"
                  value={etat.defauts.marque}
                  onChange={(e) => set({ defauts: { ...etat.defauts, marque: e.target.value } })}
                  placeholder="EdgeSyncFX"
                />
              </label>
              <label className="block">
                <span className="label">Langue par defaut</span>
                <input
                  className="field"
                  value={etat.defauts.langue}
                  onChange={(e) => set({ defauts: { ...etat.defauts, langue: e.target.value } })}
                  placeholder="fr"
                />
              </label>
            </div>
          )}

          <div className="flex justify-end">
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void onEnregistrer({ ...config, nommage: etat })}
            >
              {busy ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="mb-1 font-semibold">Tester un nom de fichier</h2>
        <p className="mb-4 text-sm text-mist-500">
          C est le serveur qui repond, celui-la meme qui traitera le vrai fichier. Enregistre tes
          modifications avant de tester, sinon tu testes l ancienne regle.
        </p>

        <div className="flex flex-wrap gap-2">
          <input
            className="field flex-1 font-mono text-xs"
            value={essai}
            onChange={(e) => setEssai(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void tester()
            }}
            placeholder={exempleNom(etat)}
          />
          <button className="btn btn-ghost" disabled={testEnCours} onClick={() => void tester()}>
            {testEnCours ? 'Analyse...' : 'Tester'}
          </button>
        </div>

        {erreurTest && (
          <div className="mt-3">
            <Alert kind="error">{erreurTest}</Alert>
          </div>
        )}

        {lecture && (
          <div className="mt-3 rounded-xl border border-ink-700 bg-ink-850 p-4">
            <dl className="grid gap-3 text-sm sm:grid-cols-4">
              {(
                [
                  ['Marque', lecture.marque],
                  ['Sujet', lecture.sujet],
                  ['Langue', lecture.langue],
                  ['Variante', lecture.variante],
                ] as const
              ).map(([label, valeur]) => (
                <div key={label}>
                  <dt className="text-xs text-mist-600">{label}</dt>
                  <dd className={valeur ? 'text-mist-100' : 'text-mist-600'}>
                    {valeur || 'non lu'}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="mt-3">
              {lecture.conforme ? (
                <p className="text-xs text-ok-400">
                  Ce nom suit la regle. Le fichier serait traite.
                </p>
              ) : (
                <p className="text-xs text-warn-400">
                  Il manque : {lecture.manquants.join(', ')}.{' '}
                  {etat.surNonConforme === 'rejeter'
                    ? 'Le fichier serait mis de cote.'
                    : 'Les valeurs par defaut seraient employees.'}
                </p>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ciblage
// ---------------------------------------------------------------------------

function Ciblage({
  config,
  comptes,
  busy,
  onEnregistrer,
}: {
  config: ConfigAuto
  comptes: Account[]
  busy: boolean
  onEnregistrer: (c: ConfigAuto) => Promise<void>
}) {
  const [profils, setProfils] = useState(config.profils)

  function maj(i: number, changes: Partial<ConfigAuto['profils'][number]>) {
    setProfils(profils.map((p, j) => (i === j ? { ...p, ...changes } : p)))
  }

  return (
    <section className="panel p-5">
      <h2 className="mb-1 font-semibold">Profils de ciblage</h2>
      <p className="mb-4 text-sm text-mist-500">
        Un profil dit quels comptes d une marque sont vises. Chaque dossier surveille en choisit
        un. Un profil sans plateforme ni compte precis vise tous les comptes actifs de la marque.
      </p>

      <div className="space-y-4">
        {profils.map((p, i) => (
          <div key={i} className="rounded-xl border border-ink-700 p-4">
            <div className="mb-3 flex items-center gap-2">
              <input
                className="field flex-1 font-medium"
                value={p.nom}
                onChange={(e) => maj(i, { nom: e.target.value })}
              />
              {profils.length > 1 && (
                <button
                  className="btn btn-danger !py-1 !text-xs"
                  onClick={() => setProfils(profils.filter((_, j) => j !== i))}
                >
                  Retirer
                </button>
              )}
            </div>

            <div>
              <span className="label">Plateformes visees</span>
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map((plat) => {
                  const on = p.plateformes.includes(plat.value)
                  return (
                    <button
                      key={plat.value}
                      onClick={() =>
                        maj(i, {
                          plateformes: on
                            ? p.plateformes.filter((x) => x !== plat.value)
                            : [...p.plateformes, plat.value],
                        })
                      }
                      aria-pressed={on}
                      className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                        on
                          ? 'border-brand-500/50 bg-brand-500/10 text-mist-100'
                          : 'border-ink-700 text-mist-500 hover:text-mist-100'
                      }`}
                    >
                      {plat.icon} {plat.label}
                    </button>
                  )
                })}
              </div>
              <p className="mt-1.5 text-xs text-mist-600">
                {p.plateformes.length === 0
                  ? 'Aucune cochee : toutes les plateformes de la marque sont visees.'
                  : `Seules ces ${p.plateformes.length} plateformes. Une marque sans compte sur l une d elles l ignore simplement.`}
              </p>
            </div>

            <div className="mt-3">
              <span className="label">Ou des comptes precis</span>
              <div className="flex flex-wrap gap-2">
                {comptes.map((c) => {
                  const on = p.comptes.includes(c.id)
                  return (
                    <button
                      key={c.id}
                      onClick={() =>
                        maj(i, {
                          comptes: on
                            ? p.comptes.filter((x) => x !== c.id)
                            : [...p.comptes, c.id],
                        })
                      }
                      aria-pressed={on}
                      className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                        on
                          ? 'border-brand-500/50 bg-brand-500/10 text-mist-100'
                          : 'border-ink-700 text-mist-500 hover:text-mist-100'
                      }`}
                    >
                      {c.account_name}
                      <span className="ml-1 text-mist-600">{PLATFORM_LABEL[c.platform]}</span>
                    </button>
                  )
                })}
              </div>
              <p className="mt-1.5 text-xs text-mist-600">
                Des comptes nommes ici l emportent sur le filtre de plateforme. C est ce qui permet
                un profil de test sur un seul compte.
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex justify-between">
        <button
          className="btn btn-ghost"
          onClick={() => setProfils([...profils, { nom: 'Nouveau profil', plateformes: [], comptes: [] }])}
        >
          Ajouter un profil
        </button>
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={() => void onEnregistrer({ ...config, profils })}
        >
          {busy ? 'Enregistrement...' : 'Enregistrer'}
        </button>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Cadence
// ---------------------------------------------------------------------------

function CadenceOnglet({
  config,
  marques,
  busy,
  onEnregistrer,
}: {
  config: ConfigAuto
  marques: string[]
  busy: boolean
  onEnregistrer: (c: ConfigAuto) => Promise<void>
}) {
  const [etat, setEtat] = useState(config.cadence)
  const [quotas, setQuotas] = useState(config.quotas)
  const [moteur, setMoteur] = useState(config.moteur)
  const [reserve, setReserve] = useState(config.reserve)
  const [marque, setMarque] = useState('')

  const grille = marque ? (etat.parMarque[marque] ?? etat.defaut) : etat.defaut

  function majJour(jour: string, n: number) {
    if (marque) {
      setEtat({
        ...etat,
        parMarque: { ...etat.parMarque, [marque]: { ...grille, [jour]: n } },
      })
    } else {
      setEtat({ ...etat, defaut: { ...etat.defaut, [jour]: n } })
    }
  }

  return (
    <div className="space-y-5">
      <section className="panel p-5">
        <h2 className="mb-1 font-semibold">Publications par jour</h2>
        <p className="mb-4 text-sm text-mist-500">
          Combien de campagnes au maximum par jour et par marque. Une video deposee au-dela part
          le jour suivant qui a de la place.
        </p>

        <label className="mb-4 block max-w-xs">
          <span className="label">Regler pour</span>
          <select className="field" value={marque} onChange={(e) => setMarque(e.target.value)}>
            <option value="">Toutes les marques (valeur par defaut)</option>
            {marques.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {JOURS_CADENCE.map((j) => (
            <label key={j.cle} className="block">
              <span className="label">{j.label}</span>
              <input
                type="number"
                min={0}
                max={20}
                className="field tabular-nums"
                value={grille[j.cle] ?? 0}
                onChange={(e) => majJour(j.cle, Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
          ))}
        </div>

        {marque && etat.parMarque[marque] && (
          <button
            className="mt-3 text-xs text-brand-400 hover:underline"
            onClick={() => {
              const suite = { ...etat.parMarque }
              delete suite[marque]
              setEtat({ ...etat, parMarque: suite })
            }}
          >
            Revenir a la valeur par defaut pour {marque}
          </button>
        )}
      </section>

      <section className="panel p-5">
        <h2 className="mb-4 font-semibold">Horaires et espacement</h2>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="label">Plage autorisee, debut</span>
            <input
              type="time"
              className="field"
              value={etat.plage.debut}
              onChange={(e) => setEtat({ ...etat, plage: { ...etat.plage, debut: e.target.value } })}
            />
          </label>
          <label className="block">
            <span className="label">Plage autorisee, fin</span>
            <input
              type="time"
              className="field"
              value={etat.plage.fin}
              onChange={(e) => setEtat({ ...etat, plage: { ...etat.plage, fin: e.target.value } })}
            />
          </label>
          <label className="block">
            <span className="label">Ecart entre comptes</span>
            <input
              type="number"
              min={0}
              max={240}
              className="field tabular-nums"
              value={etat.ecartMinutes}
              onChange={(e) =>
                setEtat({ ...etat, ecartMinutes: Math.max(0, Number(e.target.value) || 0) })
              }
            />
            <span className="mt-1 block text-xs text-mist-600">
              En minutes. Neuf comptes a la meme seconde se voient.
            </span>
          </label>
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="mb-1 font-semibold">Quand plusieurs videos arrivent d un coup</h2>
        <div className="mt-3 space-y-2">
          {(
            [
              {
                v: 'etaler' as const,
                label: 'Etaler sur les jours suivants',
                aide: 'La cadence est respectee : le surplus part demain, apres-demain, et ainsi de suite.',
              },
              {
                v: 'auPlusTot' as const,
                label: 'Tout programmer au plus tot',
                aide: 'La cadence est ignoree. Utile pour rattraper, dangereux au quotidien.',
              },
            ]
          ).map((o) => (
            <label
              key={o.v}
              className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                etat.afflux === o.v ? 'border-brand-500/50 bg-brand-500/10' : 'border-ink-700'
              }`}
            >
              <input
                type="radio"
                name="afflux"
                className="mt-1"
                checked={etat.afflux === o.v}
                onChange={() => setEtat({ ...etat, afflux: o.v })}
              />
              <span>
                <span className="block text-mist-100">{o.label}</span>
                <span className="block text-xs text-mist-600">{o.aide}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="mb-1 font-semibold">Le moteur de cadence</h2>
        <p className="mb-4 text-sm text-mist-500">
          Il pioche dans la{' '}
          <Link to="/bibliotheque" className="text-brand-400 hover:underline">
            bibliotheque
          </Link>{' '}
          toutes les quinze minutes et cree les campagnes. Le watcher, lui, ne fait que deposer :
          c est toi qui decides de l ordre.
        </p>

        <label className="mb-4 flex cursor-pointer items-start gap-3 rounded-xl border border-ink-700 p-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={moteur.actif}
            onChange={(e) => setMoteur({ ...moteur, actif: e.target.checked })}
          />
          <span>
            <span className="block text-sm text-mist-100">Laisser le moteur tourner</span>
            <span className="block text-xs text-mist-600">
              Eteint, les videos s accumulent dans la bibliotheque sans etre programmees. Tu peux
              toujours lancer un passage a la main depuis la bibliotheque.
            </span>
          </span>
        </label>

        <label className="block max-w-xs">
          <span className="label">Remplir a l avance</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={30}
              className="field tabular-nums"
              value={moteur.horizonJours}
              onChange={(e) =>
                setMoteur({ ...moteur, horizonJours: Math.max(1, Number(e.target.value) || 3) })
              }
            />
            <span className="shrink-0 text-xs text-mist-600">jours</span>
          </div>
          <span className="mt-1 block text-xs text-mist-600">
            Jusqu ou le moteur programme. Trois jours laissent le temps de voir venir sans figer un
            mois entier : une campagne creee peut encore etre corrigee, mais pas reordonnee.
          </span>
        </label>
      </section>

      <section className="panel p-5">
        <h2 className="mb-1 font-semibold">Alerte de reserve</h2>
        <p className="mb-4 text-sm text-mist-500">
          Un message Telegram quand la bibliotheque descend sous le seuil, pour produire avant
          d etre a sec. Une marque sans video voit ses creneaux sautes, et l alerte le dit.
        </p>

        <label className="mb-4 block max-w-xs">
          <span className="label">Seuil par defaut</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={50}
              className="field tabular-nums"
              value={reserve.seuilParDefaut}
              onChange={(e) =>
                setReserve({ ...reserve, seuilParDefaut: Math.max(0, Number(e.target.value) || 0) })
              }
            />
            <span className="shrink-0 text-xs text-mist-600">videos</span>
          </div>
        </label>

        <div className="space-y-2">
          {marques.map((m) => {
            const propre = m in (reserve.seuilParMarque ?? {})
            return (
              <div
                key={m}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-700 px-3 py-2.5"
              >
                <span className="text-sm font-medium">{m}</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={50}
                    className="field !w-20 tabular-nums"
                    value={propre ? reserve.seuilParMarque[m] : reserve.seuilParDefaut}
                    onChange={(e) =>
                      setReserve({
                        ...reserve,
                        seuilParMarque: {
                          ...reserve.seuilParMarque,
                          [m]: Math.max(0, Number(e.target.value) || 0),
                        },
                      })
                    }
                  />
                  {propre ? (
                    <button
                      className="text-xs text-mist-600 hover:text-mist-300"
                      onClick={() => {
                        const suite = { ...reserve.seuilParMarque }
                        delete suite[m]
                        setReserve({ ...reserve, seuilParMarque: suite })
                      }}
                    >
                      par defaut
                    </button>
                  ) : (
                    <span className="text-xs text-mist-600">par defaut</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="mb-1 font-semibold">Si une plateforme est au quota</h2>
        <p className="mb-3 text-sm text-mist-500">
          Six envois YouTube par jour toutes chaines confondues, vingt-cinq publications Instagram
          par 24 h et par compte.
        </p>

        <div className="space-y-2">
          {(
            [
              {
                v: 'reporter' as const,
                label: 'Decaler au lendemain',
                aide: 'La publication est quand meme creee, avec un creneau plus tard.',
              },
              {
                v: 'ignorer' as const,
                label: 'Ignorer cette plateforme',
                aede: '',
                aide: 'La campagne part sans elle. Le suivi dit lesquelles ont ete ecartees.',
              },
            ]
          ).map((o) => (
            <label
              key={o.v}
              className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                quotas.surDepassement === o.v
                  ? 'border-brand-500/50 bg-brand-500/10'
                  : 'border-ink-700'
              }`}
            >
              <input
                type="radio"
                name="quota"
                className="mt-1"
                checked={quotas.surDepassement === o.v}
                onChange={() => setQuotas({ surDepassement: o.v })}
              />
              <span>
                <span className="block text-mist-100">{o.label}</span>
                <span className="block text-xs text-mist-600">{o.aide}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="mt-5 flex justify-end">
          <span className="mr-auto text-xs text-mist-600">
            Tes modifications ne sont enregistrees qu avec ce bouton.
          </span>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void onEnregistrer({ ...config, cadence: etat, quotas, moteur, reserve })}
          >
            {busy ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function Validation({
  config,
  marques,
  busy,
  onEnregistrer,
}: {
  config: ConfigAuto
  marques: string[]
  busy: boolean
  onEnregistrer: (c: ConfigAuto) => Promise<void>
}) {
  const [etat, setEtat] = useState(config.validation)
  const [silence, setSilence] = useState(config.alerteSilenceHeures)

  return (
    <section className="panel p-5">
      <h2 className="mb-1 font-semibold">Avant publication</h2>
      <p className="mb-4 text-sm text-mist-500">
        Une campagne « a valider » ne peut pas partir : le scheduler ne la voit pas tant qu elle n
        est pas approuvee. Tu recois une alerte Telegram a chaque fois.
      </p>

      <label className="mb-4 flex cursor-pointer items-start gap-3 rounded-xl border border-ink-700 p-3">
        <input
          type="checkbox"
          className="mt-1"
          checked={etat.parDefaut}
          onChange={(e) => setEtat({ ...etat, parDefaut: e.target.checked })}
        />
        <span>
          <span className="block text-sm text-mist-100">
            Demander validation par defaut
          </span>
          <span className="block text-xs text-mist-600">
            S applique aux marques qui n ont pas de reglage propre ci-dessous.
          </span>
        </span>
      </label>

      <div className="space-y-2">
        {marques.map((m) => {
          const propre = m in etat.parMarque
          const valeur = propre ? etat.parMarque[m] : etat.parDefaut
          return (
            <div
              key={m}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-700 px-3 py-2.5"
            >
              <span className="text-sm font-medium">{m}</span>
              <div className="flex items-center gap-2">
                {(
                  [
                    { v: true, label: 'A valider' },
                    { v: false, label: 'Directement en file' },
                  ] as const
                ).map((o) => (
                  <button
                    key={String(o.v)}
                    onClick={() =>
                      setEtat({ ...etat, parMarque: { ...etat.parMarque, [m]: o.v } })
                    }
                    aria-pressed={propre && valeur === o.v}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                      propre && valeur === o.v
                        ? 'border-brand-500/50 bg-brand-500/10 text-mist-100'
                        : 'border-ink-700 text-mist-500 hover:text-mist-100'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
                {propre && (
                  <button
                    className="text-xs text-mist-600 hover:text-mist-300"
                    onClick={() => {
                      const suite = { ...etat.parMarque }
                      delete suite[m]
                      setEtat({ ...etat, parMarque: suite })
                    }}
                  >
                    par defaut
                  </button>
                )}
                {!propre && (
                  <span className="text-xs text-mist-600">
                    par defaut : {valeur ? 'a valider' : 'directement'}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <label className="mt-5 block max-w-xs">
        <span className="label">Alerter si le watcher se tait plus de</span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={720}
            className="field tabular-nums"
            value={silence}
            onChange={(e) => setSilence(Math.max(1, Number(e.target.value) || 26))}
          />
          <span className="shrink-0 text-xs text-mist-600">heures</span>
        </div>
        <span className="mt-1 block text-xs text-mist-600">
          Vingt-six heures laissent passer une nuit PC eteint sans crier au loup.
        </span>
      </label>

      <div className="mt-5 flex justify-end">
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={() =>
            void onEnregistrer({ ...config, validation: etat, alerteSilenceHeures: silence })
          }
        >
          {busy ? 'Enregistrement...' : 'Enregistrer'}
        </button>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Contenu
// ---------------------------------------------------------------------------

function ContenuOnglet({
  config,
  marques,
  busy,
  onEnregistrer,
}: {
  config: ConfigAuto
  marques: string[]
  busy: boolean
  onEnregistrer: (c: ConfigAuto) => Promise<void>
}) {
  const [etat, setEtat] = useState(config.contenu)
  const [marque, setMarque] = useState(marques[0] ?? '')

  const cta = etat.cta[marque] ?? {}
  const liens = etat.liens[marque] ?? {}

  function majCta(platform: string, texte: string) {
    const variantes = texte
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    setEtat({
      ...etat,
      cta: { ...etat.cta, [marque]: { ...cta, [platform]: variantes } },
    })
  }

  return (
    <div className="space-y-5">
      <section className="panel p-5">
        <h2 className="mb-1 font-semibold">Appel a l action et lien</h2>
        <p className="mb-4 text-sm text-mist-500">
          Ajoutes automatiquement au texte genere. Le ton, le vocabulaire et les mentions legales
          se reglent ailleurs, dans{' '}
          <Link to="/consignes" className="text-brand-400 hover:underline">
            Textes
          </Link>{' '}
          : ici on ne fait qu ajouter ce qui manquait pour l automatisation.
        </p>

        <label className="mb-4 block max-w-xs">
          <span className="label">Marque</span>
          <select className="field" value={marque} onChange={(e) => setMarque(e.target.value)}>
            {marques.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>

        <div className="space-y-4">
          {PLATFORMS.map((p) => (
            <div key={p.value} className="rounded-xl border border-ink-700 p-3">
              <p className="mb-2 text-sm font-medium">
                <span className="mr-1.5 opacity-70">{p.icon}</span>
                {p.label}
              </p>

              <label className="block">
                <span className="label">Appels a l action, un par ligne</span>
                <textarea
                  className="field resize-y text-sm"
                  rows={3}
                  value={(cta[p.value] ?? []).join('\n')}
                  onChange={(e) => majCta(p.value, e.target.value)}
                  placeholder={'Le detail est sur @edgesyncfx.app\nTout est explique sur @edgesyncfx.app'}
                />
                <span className="mt-1 block text-xs text-mist-600">
                  {(cta[p.value] ?? []).length > 1
                    ? `${(cta[p.value] ?? []).length} variantes, employees a tour de role pour ne pas repeter la meme phrase.`
                    : 'Ajoute plusieurs lignes pour alterner entre elles.'}
                </span>
              </label>

              <label className="mt-3 block">
                <span className="label">Lien de redirection</span>
                <input
                  className="field text-sm"
                  value={liens[p.value] ?? ''}
                  onChange={(e) =>
                    setEtat({
                      ...etat,
                      liens: { ...etat.liens, [marque]: { ...liens, [p.value]: e.target.value } },
                    })
                  }
                  placeholder="Lien en bio"
                />
                <span className="mt-1 block text-xs text-mist-600">
                  {p.value === 'instagram' || p.value === 'tiktok'
                    ? 'Ces plateformes ne rendent pas les liens cliquables dans le texte : « lien en bio » est plus utile qu une adresse.'
                    : 'Une adresse complete fonctionne ici.'}
                </span>
              </label>
            </div>
          ))}
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="mb-3 font-semibold">Ou les placer dans le texte</h2>
        <div className="space-y-2">
          {(
            [
              { v: 'fin' as const, label: 'A la fin, apres la legende' },
              { v: 'debut' as const, label: 'Au debut, avant la legende' },
            ]
          ).map((o) => (
            <label
              key={o.v}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                etat.position === o.v ? 'border-brand-500/50 bg-brand-500/10' : 'border-ink-700'
              }`}
            >
              <input
                type="radio"
                name="position"
                checked={etat.position === o.v}
                onChange={() => setEtat({ ...etat, position: o.v })}
              />
              {o.label}
            </label>
          ))}
        </div>

        <div className="mt-5 flex justify-end">
          <span className="mr-auto text-xs text-mist-600">
            Tes modifications ne sont enregistrees qu avec ce bouton.
          </span>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void onEnregistrer({ ...config, contenu: etat })}
          >
            {busy ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </section>
    </div>
  )
}
