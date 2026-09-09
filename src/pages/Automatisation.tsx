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
  type DossierInput,
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
  dateLisible,
  exempleNom,
  JOURS_CADENCE,
  journeesVues,
  normaliserConfig,
  silenceDepuis,
  type ConfigAuto,
  type Dossier,
  type Import,
  type Journee,
} from '../lib/automatisation'
import { formatDateTime, relative } from '../lib/format'
import { Aide, Alert, ConfirmModal, EmptyState, Loading, PageHeader } from '../components/ui'

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
              onCreer={(d) =>
                void agir(
                  async () => void (await creerDossier(d as unknown as DossierInput)),
                  'Dossier ajoute',
                )
              }
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
        <p className="mb-4 text-sm text-mist-500">
          {rejetes.length > 0
            ? `${rejetes.length} fichier(s) refuse(s), restes en place. Corrige le nom ou les reglages, puis rejoue-les.`
            : 'Les derniers fichiers vus, et ce qu ils sont devenus.'}{' '}
          Un fichier accepte va dans la{' '}
          <Link to="/bibliotheque" className="text-brand-400 hover:underline">
            Reserve
          </Link>
          , pas directement en campagne.
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

type ReglagesDossier = {
  nom: string
  chemin: string
  marque: string
  marques: string[]
  marqueDansLeNom: boolean
  profil: string
  recursif: boolean
  deplacer: boolean
  mode_nommage: 'champs' | 'chemin'
  modele_sujet: string
  depuis_date: string
}

function dossierVide(profilParDefaut: string): ReglagesDossier {
  return {
    nom: '',
    chemin: '',
    marque: '',
    marques: [],
    marqueDansLeNom: false,
    profil: profilParDefaut,
    recursif: false,
    deplacer: true,
    mode_nommage: 'champs',
    modele_sujet: '',
    depuis_date: '',
  }
}

/**
 * Choisir a partir de quelle journee reprendre.
 *
 * Les journees viennent du disque, rapportees par le watcher : choisir dans
 * une vraie liste vaut mieux que taper une date de tete en esperant qu'un
 * dossier lui corresponde. Tant que le watcher n'est pas passe, on retombe sur
 * une simple saisie de date, qui marche aussi.
 */
function PointDeDepart({
  journees,
  vuA,
  valeur,
  onChange,
}: {
  journees: Journee[]
  vuA: string | null
  valeur: string
  onChange: (v: string) => void
}) {
  const avant = journees.filter((j) => valeur && j.date < valeur)
  const apres = journees.filter((j) => !valeur || j.date >= valeur)
  const videosAvant = avant.reduce((n, j) => n + j.videos, 0)
  const videosApres = apres.reduce((n, j) => n + j.videos, 0)

  return (
    <div>
      <span className="label">Commencer a partir de</span>

      {journees.length > 0 ? (
        <>
          <select className="field" value={valeur} onChange={(e) => onChange(e.target.value)}>
            <option value="">Tout traiter, depuis la plus ancienne</option>
            {journees.map((j) => (
              <option key={j.dossier} value={j.date}>
                {j.dossier} · {dateLisible(j.date)} · {j.videos} video{j.videos > 1 ? 's' : ''}
              </option>
            ))}
          </select>

          {/*
            Ce resume-la ne se replie pas : c'est le seul endroit qui dit
            combien de videos vont reellement entrer, et le lire APRES avoir
            choisi serait trop tard.
          */}
          <p className="mt-2 text-xs text-mist-500">
            {valeur ? (
              <>
                <span className="text-mist-300">{videosAvant}</span> video
                {videosAvant > 1 ? 's' : ''} ignoree{videosAvant > 1 ? 's' : ''},{' '}
                <span className="text-ok-400">{videosApres}</span> a traiter.
              </>
            ) : (
              <>
                <span className="text-ok-400">{videosApres}</span> videos entreront en reserve, la
                plus ancienne en premier.
              </>
            )}
          </p>

          <Aide>
            <p>
              Les journees anterieures a celle-ci sont considerees comme deja publiees, et ne
              seront jamais reprises. La journee choisie, elle, EST traitee.
            </p>
            <p className="mt-2">
              A utiliser quand une partie du dossier est deja partie a la main. Avancer ce point
              plus tard ne supprime rien : c est un filtre a l entree, pas un menage.
            </p>
            {vuA && <p className="mt-2 text-mist-600">Liste relevee sur ton disque {relative(vuA)}.</p>}
          </Aide>
        </>
      ) : (
        <>
          <input
            type="date"
            className="field"
            value={valeur}
            onChange={(e) => onChange(e.target.value)}
          />
          <Aide titre="Pourquoi une date et pas une liste">
            Le watcher n a pas encore rapporte le contenu de ce dossier. Enregistre-le, laisse
            passer une minute, et la liste de tes journees reelles apparaitra ici. En attendant,
            une date fonctionne aussi : la journee choisie est traitee, celles d avant sont
            ignorees.
          </Aide>
        </>
      )}
    </div>
  )
}

/**
 * Les reglages d'une source de contenu.
 *
 * Un dossier n'appartient PAS a une marque : c'est une source, avec sa propre
 * identite, dont le contenu est ensuite distribue vers les marques ou il doit
 * paraitre. Le meme dossier de reels de trading alimente les trois. Le
 * formulaire suit donc trois questions, dans cet ordre : ce qu'on surveille,
 * ce qu'on y trouve, et ou ca part.
 */
function FormulaireDossier({
  valeur,
  onChange,
  profils,
  marques,
  journees = [],
  inventaireVuA = null,
}: {
  valeur: ReglagesDossier
  onChange: (v: ReglagesDossier) => void
  profils: ConfigAuto['profils']
  marques: string[]
  journees?: Journee[]
  inventaireVuA?: string | null
}) {
  const set = (c: Partial<ReglagesDossier>) => onChange({ ...valeur, ...c })
  const parChemin = valeur.mode_nommage === 'chemin'

  return (
    <div className="space-y-6">
      {/* 1. Quel dossier */}
      <div className="space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-mist-500">
          1. Quel dossier
        </p>

        <label className="block">
          <span className="label">Ce que contient ce dossier</span>
          <input
            className="field"
            value={valeur.nom}
            onChange={(e) => set({ nom: e.target.value })}
            placeholder="Reels de trading"
          />
          <Aide>
            Un nom court pour t y retrouver. C est lui qui apparait dans les listes, plutot qu un
            chemin Windows de soixante caracteres. Ce n est pas une marque : cette source pourra
            alimenter plusieurs marques a la fois.
          </Aide>
        </label>

        <label className="block">
          <span className="label">Son chemin sur le PC</span>
          <input
            className="field font-mono text-xs"
            value={valeur.chemin}
            onChange={(e) => set({ chemin: e.target.value })}
            placeholder={'C:\\TradeReels\\ready_to_post'}
          />
          <Aide>
            Le chemin complet, tel qu il apparait dans la barre d adresse de l Explorateur Windows.
            Pour l obtenir sans faute de frappe : ouvre le dossier, clique dans la barre d adresse,
            copie, colle ici. Il doit exister sur le PC ou tourne le watcher.
          </Aide>
        </label>
      </div>

      {/* 2. Ce qu'on y trouve */}
      <div className="space-y-4 border-t border-ink-800 pt-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-mist-500">
          2. Comment lire ce qu il contient
        </p>

        <div>
          <div className="space-y-2">
            {(
              [
                {
                  v: 'champs' as const,
                  titre: 'Le nom du fichier dit tout',
                  exemple: 'mon-sujet_en.mp4',
                },
                {
                  v: 'chemin' as const,
                  titre: 'Le dossier est range par date',
                  exemple: 'JJMMAAAA/1_matin/video.mp4',
                },
              ]
            ).map((o) => (
              <label
                key={o.v}
                className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2.5 transition-colors ${
                  valeur.mode_nommage === o.v
                    ? 'border-brand-500/50 bg-brand-500/10'
                    : 'border-ink-700'
                }`}
              >
                <input
                  type="radio"
                  className="mt-1"
                  checked={valeur.mode_nommage === o.v}
                  onChange={() =>
                    set(
                      o.v === 'chemin'
                        ? { mode_nommage: o.v, recursif: true, deplacer: false }
                        : { mode_nommage: o.v },
                    )
                  }
                />
                <span>
                  <span className="block text-sm text-mist-100">{o.titre}</span>
                  <span className="block font-mono text-xs text-mist-600">{o.exemple}</span>
                </span>
              </label>
            ))}
          </div>

          <Aide titre="Lequel choisir">
            <p>
              <span className="text-mist-100">Le nom du fichier dit tout</span> : tu jettes des
              videos dans le dossier en les nommant toi-meme. Elles sont rangees dans un
              sous-dossier « traite » une fois prises.
            </p>
            <p className="mt-2">
              <span className="text-mist-100">Range par date</span> : le dossier est deja organise
              par un autre outil, comme TradeReels. Rien n est renomme, rien n est deplace.
            </p>
          </Aide>
        </div>

        {parChemin && (
          <label className="block">
            <span className="label">De quoi parlent ces videos</span>
            <input
              className="field"
              value={valeur.modele_sujet}
              onChange={(e) => set({ modele_sujet: e.target.value })}
              placeholder="Seance de trading en accelere sur MT5, {creneau} du {date}"
            />
            <Aide>
              <p>
                Le chemin ne donne qu une date et un moment. C est cette phrase qui dit de quoi
                parlent les videos, et c est elle que le modele recevra pour ecrire les textes.
              </p>
              <p className="mt-2">
                <span className="font-mono">{'{date}'}</span> devient « 7 septembre 2026 »,{' '}
                <span className="font-mono">{'{creneau}'}</span> devient « du matin », « de
                l apres-midi » ou « du soir ».
              </p>
              <p className="mt-2">
                Tu peux corriger le sujet video par video dans la Reserve, si l une merite mieux.
              </p>
            </Aide>
          </label>
        )}

        {parChemin && (
          <PointDeDepart
            journees={journees}
            vuA={inventaireVuA}
            valeur={valeur.depuis_date}
            onChange={(v) => set({ depuis_date: v })}
          />
        )}
      </div>

      {/* 3. Ou ca part */}
      <div className="space-y-4 border-t border-ink-800 pt-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-mist-500">
          3. Vers quelles marques
        </p>

        {!parChemin && (
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-ink-700 px-3 py-2 text-sm text-mist-300">
            <input
              type="checkbox"
              checked={valeur.marqueDansLeNom}
              onChange={(e) => set({ marqueDansLeNom: e.target.checked })}
            />
            La marque est ecrite dans le nom de chaque fichier
          </label>
        )}

        {valeur.marqueDansLeNom && !parChemin ? (
          <Aide titre="Ce que ca change">
            Chaque fichier decide de sa marque, comme{' '}
            <span className="font-mono">EdgeSyncFX_mon-sujet_en.mp4</span>. A n employer que si tu
            melanges plusieurs marques dans un meme dossier.
          </Aide>
        ) : (
          <div>
            <div className="flex flex-wrap gap-2">
              {marques.map((m) => {
                const on = valeur.marques.includes(m)
                return (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      set({
                        marques: on
                          ? valeur.marques.filter((x) => x !== m)
                          : [...valeur.marques, m],
                      })
                    }
                    className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                      on
                        ? 'border-brand-500/50 bg-brand-500/10 text-mist-100'
                        : 'border-ink-700 text-mist-500 hover:text-mist-100'
                    }`}
                  >
                    {on ? '✓ ' : ''}
                    {m}
                  </button>
                )
              })}
            </div>

            <p className="mt-2 text-xs text-mist-500">
              {valeur.marques.length === 0
                ? 'Coche au moins une marque.'
                : `Chaque video partira sur ${valeur.marques.length} marque${
                    valeur.marques.length > 1 ? 's' : ''
                  }, avec un texte different pour chacune.`}
            </p>

            <Aide>
              Une video entre une fois PAR MARQUE cochee, dans sa propre file d attente. Elle part
              donc sur toutes avec des textes differents, sans jamais compter deux fois. Si tu
              ajoutes une marque dans six mois, elle rattrapera l historique toute seule.
            </Aide>
          </div>
        )}

        <label className="block">
          <span className="label">Sur quels comptes</span>
          <select
            className="field"
            value={valeur.profil}
            onChange={(e) => set({ profil: e.target.value })}
          >
            {profils.map((p) => (
              <option key={p.nom} value={p.nom}>
                {p.nom}
              </option>
            ))}
          </select>
          <Aide>
            A l interieur de chaque marque, quels comptes sont vises. Les profils se creent dans
            l onglet Ciblage : « tous les comptes », « seulement les reseaux courts », « test sur un
            seul compte ».
          </Aide>
        </label>
      </div>

      {/* 4. Options */}
      <div className="space-y-2 border-t border-ink-800 pt-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-mist-500">
          4. Options du ramassage
        </p>

        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-ink-700 px-3 py-2 text-sm text-mist-300">
          <input
            type="checkbox"
            checked={valeur.recursif}
            onChange={(e) => set({ recursif: e.target.checked })}
          />
          Parcourir les sous-dossiers
        </label>

        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-ink-700 px-3 py-2 text-sm text-mist-300">
          <input
            type="checkbox"
            checked={valeur.deplacer}
            onChange={(e) => set({ deplacer: e.target.checked })}
          />
          Ranger les videos traitees dans « traite »
        </label>

        <Aide>
          <p>
            <span className="text-mist-100">Parcourir les sous-dossiers</span> : sans cela, seules
            les videos posees a la racine sont vues.
          </p>
          <p className="mt-2">
            <span className="text-mist-100">Ranger dans « traite »</span> : a decocher pour une
            archive produite par un autre outil, que la deranger casserait. Le watcher se souvient
            de ce qu il a vu, il ne relira pas deux fois.
          </p>
          <p className="mt-2 text-mist-600">
            Ces deux cases se reglent toutes seules quand tu choisis « range par date ».
          </p>
        </Aide>
      </div>
    </div>
  )
}

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
  onCreer: (d: Record<string, unknown>) => void
  onMaj: (id: string, d: Record<string, unknown>) => void
  onSupprimer: (id: string) => void
}) {
  const [nouveau, setNouveau] = useState<ReglagesDossier>(() => dossierVide(profils[0]?.nom ?? ''))
  const [ouvert, setOuvert] = useState<string | null>(null)
  const [brouillons, setBrouillons] = useState<Record<string, ReglagesDossier>>({})
  const [aSupprimer, setASupprimer] = useState<Dossier | null>(null)

  function brouillon(d: Dossier): ReglagesDossier {
    return (
      brouillons[d.id] ?? {
        nom: d.nom ?? '',
        chemin: d.chemin,
        marque: d.marque ?? '',
        marques: d.marques ?? [],
        marqueDansLeNom: d.mode_nommage !== 'chemin' && (d.marques ?? []).length === 0,
        profil: d.profil ?? '',
        recursif: d.recursif ?? false,
        deplacer: d.deplacer ?? true,
        mode_nommage: (d.mode_nommage as 'champs' | 'chemin') ?? 'champs',
        modele_sujet: d.modele_sujet ?? '',
        depuis_date: d.depuis_date ?? '',
      }
    )
  }

  function versBase(v: ReglagesDossier) {
    // Une source distribue vers des marques. Le cas « la marque est dans le
    // nom du fichier » est l'exception, pas la regle.
    const parLeNom = v.mode_nommage !== 'chemin' && v.marqueDansLeNom
    return {
      nom: v.nom.trim() || null,
      chemin: v.chemin.trim(),
      marque: null,
      marques: parLeNom ? null : v.marques,
      profil: v.profil || null,
      recursif: v.recursif,
      deplacer: v.deplacer,
      mode_nommage: v.mode_nommage,
      modele_sujet: v.modele_sujet.trim() || null,
      depuis_date: v.depuis_date || null,
    }
  }

  const incomplet =
    !nouveau.chemin.trim() ||
    (!nouveau.marqueDansLeNom && nouveau.marques.length === 0)

  return (
    <div className="space-y-5">
      <section className="panel p-5">
        <h2 className="mb-1 font-semibold">Ajouter une source</h2>
        <p className="mb-5 text-sm text-mist-500">
          Un dossier surveille sur ton PC, dont le contenu part vers une ou plusieurs marques. Les
          videos trouvees entrent dans la Reserve : rien n est programme a ce stade, c est toi qui
          ordonnes la file.
        </p>

        <FormulaireDossier
          valeur={nouveau}
          onChange={setNouveau}
          profils={profils}
          marques={marques}
        />

        <div className="mt-4 flex justify-end">
          <button
            className="btn btn-primary"
            disabled={busy || incomplet}
            onClick={() => {
              onCreer({ ...versBase(nouveau), actif: true, ordre: dossiers.length })
              setNouveau(dossierVide(profils[0]?.nom ?? ''))
            }}
          >
            {incomplet && nouveau.chemin.trim() ? 'Coche au moins une marque' : 'Ajouter'}
          </button>
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="mb-4 font-semibold">
          {dossiers.length} source{dossiers.length > 1 ? 's' : ''} surveillee
          {dossiers.length > 1 ? 's' : ''}
        </h2>

        {dossiers.length === 0 ? (
          <EmptyState icon="▤" title="Aucune source surveillee" hint="Ajoute-en une ci-dessus." />
        ) : (
          <ul className="space-y-3">
            {dossiers.map((d) => {
              const ouvertIci = ouvert === d.id
              const v = brouillon(d)
              return (
                <li
                  key={d.id}
                  className={`rounded-xl border p-3 ${
                    d.actif ? 'border-ink-700' : 'border-ink-800 opacity-60'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-mist-100">
                        {d.nom || d.chemin.split(/[\\/]/).pop()}
                        <span className="ml-2 text-xs font-normal text-mist-500">
                          vers {(d.marques ?? []).join(', ') || 'la marque lue dans le nom'}
                        </span>
                      </p>
                      <p className="mt-0.5 truncate font-mono text-xs text-mist-600" title={d.chemin}>
                        {d.chemin}
                      </p>
                      <p className="mt-1 text-xs text-mist-600">
                        {d.mode_nommage === 'chemin' ? 'Range par date' : 'Nom de fichier'}
                        {d.profil && ` · ${d.profil}`}
                        {d.recursif && ' · sous-dossiers'}
                        {d.deplacer === false && ' · laisses en place'}
                        {d.depuis_date && ` · a partir du ${dateLisible(d.depuis_date)}`}
                      </p>
                    </div>

                    <div className="flex shrink-0 gap-2">
                      <button
                        className="btn btn-ghost !py-1 !text-xs"
                        onClick={() => setOuvert(ouvertIci ? null : d.id)}
                      >
                        {ouvertIci ? 'Fermer' : 'Modifier'}
                      </button>
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

                  {ouvertIci && (
                    <div className="mt-4 border-t border-ink-800 pt-4">
                      <FormulaireDossier
                        valeur={v}
                        onChange={(suite) => setBrouillons({ ...brouillons, [d.id]: suite })}
                        profils={profils}
                        marques={marques}
                        journees={journeesVues(d.inventaire)}
                        inventaireVuA={d.inventaire_vu_a}
                      />
                      <div className="mt-4 flex items-center justify-end gap-2">
                        <span className="mr-auto text-xs text-mist-600">
                          Tes modifications ne sont enregistrees qu avec ce bouton.
                        </span>
                        <button
                          className="btn btn-primary !py-1 !text-xs"
                          disabled={busy}
                          onClick={() => {
                            onMaj(d.id, versBase(v))
                            setOuvert(null)
                          }}
                        >
                          Enregistrer
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <ConfirmModal
        open={aSupprimer !== null}
        title="Retirer ce dossier"
        message="Le dossier n est plus surveille. Rien n est supprime sur ton disque, et les videos deja en Reserve ne bougent pas."
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

/** Une couleur par element, la meme partout sur l'ecran. */
const TEINTE_CHAMP: Record<string, { texte: string; fond: string }> = {
  marque: { texte: 'text-brand-400', fond: 'bg-brand-400/10' },
  sujet: { texte: 'text-ok-400', fond: 'bg-ok-400/10' },
  langue: { texte: 'text-warn-400', fond: 'bg-warn-400/10' },
  variante: { texte: 'text-idle-400', fond: 'bg-idle-400/10' },
}

const VALEURS_EXEMPLE: Record<string, string> = {
  marque: 'EdgeSyncFX',
  sujet: 'backtest-vs-real-account',
  langue: 'en',
  variante: 'v2',
}

/**
 * Un nom d'exemple, decoupe et etiquete.
 *
 * C'est la piece qui explique la regle. Une phrase decrivant « marque puis
 * separateur puis sujet » se lit trois fois avant d'etre comprise ; le meme
 * nom decoupe et colore se comprend d'un coup d'oeil, et la couleur se
 * retrouve ensuite sur chaque champ du formulaire.
 */
function NomDecompose({ nommage }: { nommage: ConfigAuto['nommage'] }) {
  const sep = nommage.separateur || '_'

  return (
    <div className="rounded-xl border border-ink-700 bg-ink-850 p-4">
      <div className="flex flex-wrap items-end gap-x-1 gap-y-3 font-mono text-sm">
        {nommage.ordre.map((cle, i) => {
          const champ = CHAMPS_NOM.find((c) => c.cle === cle)
          const teinte = TEINTE_CHAMP[cle] ?? { texte: 'text-mist-300', fond: 'bg-ink-800' }
          return (
            <span key={cle} className="flex items-end gap-1">
              {i > 0 && <span className="pb-1 text-mist-600">{sep}</span>}
              <span className="flex flex-col items-center gap-1">
                <span className={`rounded px-1.5 py-0.5 ${teinte.fond} ${teinte.texte}`}>
                  {VALEURS_EXEMPLE[cle] ?? cle}
                </span>
                <span className={`text-[10px] font-sans ${teinte.texte}`}>
                  {(champ?.label ?? cle).toLowerCase()}
                </span>
              </span>
            </span>
          )
        })}
        <span className="pb-1 text-mist-600">.mp4</span>
      </div>
    </div>
  )
}

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
        <p className="mb-4 text-sm text-mist-500">
          Quand tu deposes une video, le watcher doit savoir a quelle marque elle appartient, de
          quoi elle parle et dans quelle langue ecrire. Il le lit dans le nom du fichier, decoupe
          comme ceci :
        </p>

        <NomDecompose nommage={etat} />

        <Aide titre="Et si mes fichiers ne sont pas nommes comme ca">
          <p>
            Cette regle ne concerne que les dossiers regles sur « Dans le nom du fichier ». Un
            dossier deja organise par un autre outil, comme TradeReels, se lit par son
            arborescence et ignore completement cette page.
          </p>
          <p className="mt-2">
            Tu peux aussi imposer la marque au niveau du dossier : elle disparait alors du nom, et
            tu ecris seulement <span className="font-mono">mon-sujet_en.mp4</span>.
          </p>
        </Aide>

        <div className="mt-6 space-y-5">
          <label className="block max-w-xs">
            <span className="label">Le separateur</span>
            <input
              className="field font-mono"
              maxLength={3}
              value={etat.separateur}
              onChange={(e) => set({ separateur: e.target.value })}
            />
            <Aide>
              Le caractere qui separe les trois parties. Il ne doit JAMAIS apparaitre a l interieur
              d une partie. Le tiret bas convient bien. Le tiret simple ne convient pas : il sert
              deja a separer les mots du sujet, et tout se melangerait.
            </Aide>
          </label>

          <div>
            <span className="label">Les elements, dans l ordre</span>

            <div className="space-y-2">
              {etat.ordre.map((cle, i) => {
                const champ = CHAMPS_NOM.find((c) => c.cle === cle)
                const teinte = TEINTE_CHAMP[cle] ?? { texte: 'text-mist-300', fond: 'bg-ink-800' }
                return (
                  <div
                    key={cle}
                    className="flex items-center gap-3 rounded-lg border border-ink-700 px-3 py-2.5"
                  >
                    <span className="w-4 shrink-0 text-xs tabular-nums text-mist-600">{i + 1}</span>

                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm font-medium ${teinte.texte}`}>
                        {champ?.label ?? cle}
                      </span>
                      <span className="mt-0.5 block text-xs text-mist-600">
                        {cle === 'marque'
                          ? 'EdgeSyncFX, BigBossGrowth ou CosmicSucces. La casse n a pas d importance.'
                          : cle === 'sujet'
                            ? 'Les mots separes par des tirets simples, qui redeviennent des espaces.'
                            : cle === 'langue'
                              ? 'en ou fr, en deux lettres.'
                              : (champ?.aide ?? '')}
                      </span>
                    </span>

                    <span className="flex shrink-0 items-center gap-0.5">
                      <button
                        className="rounded px-1.5 py-1 text-mist-500 hover:bg-ink-800 hover:text-mist-100 disabled:opacity-30"
                        onClick={() => deplacer(cle, -1)}
                        disabled={i === 0}
                        aria-label={`Monter ${champ?.label ?? cle}`}
                        title="Monter"
                      >
                        ↑
                      </button>
                      <button
                        className="rounded px-1.5 py-1 text-mist-500 hover:bg-ink-800 hover:text-mist-100 disabled:opacity-30"
                        onClick={() => deplacer(cle, 1)}
                        disabled={i === etat.ordre.length - 1}
                        aria-label={`Descendre ${champ?.label ?? cle}`}
                        title="Descendre"
                      >
                        ↓
                      </button>
                      {cle === 'sujet' ? (
                        <span
                          className="px-1.5 text-mist-700"
                          title="Le sujet ne peut pas etre retire : sans lui, il n y a rien a ecrire"
                        >
                          ✕
                        </span>
                      ) : (
                        <button
                          className="rounded px-1.5 py-1 text-bad-400 hover:bg-ink-800"
                          onClick={() => basculerChamp(cle)}
                          aria-label={`Retirer ${champ?.label ?? cle}`}
                          title="Retirer du nom"
                        >
                          ✕
                        </button>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>

            {CHAMPS_NOM.filter((c) => !etat.ordre.includes(c.cle)).length > 0 && (
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
            )}

            <Aide>
              <p>
                Les fleches changent l ordre dans lequel les parties apparaissent. L exemple en
                haut de page suit tes changements en direct.
              </p>
              <p className="mt-2">
                La croix retire une partie du nom : sans « Langue », tes fichiers s appellent{' '}
                <span className="font-mono">EdgeSyncFX_mon-sujet.mp4</span> et la langue par defaut
                s applique. Le sujet, lui, ne se retire pas.
              </p>
            </Aide>
          </div>

          <label className="block max-w-xs">
            <span className="label">Langues acceptees</span>
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
            <Aide>
              Codes a deux lettres, separes par des espaces. Un fichier portant une langue absente
              de cette liste est mis de cote plutot que traite : mieux vaut corriger le nom que
              publier dans une langue tiree au hasard.
            </Aide>
          </label>

          <div>
            <span className="label">Si un nom ne suit pas la regle</span>
            <div className="space-y-2">
              {(
                [
                  { v: 'rejeter' as const, label: 'Mettre le fichier de cote' },
                  { v: 'defauts' as const, label: 'Le traiter avec des valeurs par defaut' },
                ]
              ).map((o) => (
                <label
                  key={o.v}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    etat.surNonConforme === o.v
                      ? 'border-brand-500/50 bg-brand-500/10 text-mist-100'
                      : 'border-ink-700 text-mist-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="non-conforme"
                    checked={etat.surNonConforme === o.v}
                    onChange={() => set({ surNonConforme: o.v })}
                  />
                  {o.label}
                </label>
              ))}
            </div>

            <Aide>
              <p>
                <span className="text-mist-100">Mettre de cote</span> : le fichier reste ou il est,
                apparait dans l onglet Suivi avec la raison, et tu le rejoues apres l avoir
                renomme. Rien n est perdu.
              </p>
              <p className="mt-2">
                <span className="text-mist-100">Valeurs par defaut</span> : ce qui manque est
                comble automatiquement. Plus rapide, mais tu peux te retrouver avec une publication
                que tu n avais pas prevue.
              </p>
            </Aide>
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
                  placeholder="en"
                />
              </label>
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <span className="mr-auto text-xs text-mist-600">
            Tes modifications ne sont enregistrees qu avec ce bouton.
          </span>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void onEnregistrer({ ...config, nommage: etat })}
          >
            {busy ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="mb-1 font-semibold">Essayer un nom avant de deposer</h2>
        <p className="mb-4 text-sm text-mist-500">
          Tape un nom de fichier, l app te montre ce qu elle en comprend.
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

        <Aide>
          C est le serveur qui repond, celui-la meme qui traitera le vrai fichier : ce qu il affiche
          est donc exactement ce qui se passera. Enregistre tes modifications avant de tester,
          sinon tu testes l ancienne regle.
        </Aide>

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
                  ['marque', 'Marque', lecture.marque],
                  ['sujet', 'Sujet', lecture.sujet],
                  ['langue', 'Langue', lecture.langue],
                  ['variante', 'Variante', lecture.variante],
                ] as const
              ).map(([cle, label, valeur]) => (
                <div key={cle}>
                  <dt className={`text-xs ${TEINTE_CHAMP[cle]?.texte ?? 'text-mist-600'}`}>
                    {label}
                  </dt>
                  <dd className={valeur ? 'text-mist-100' : 'text-mist-600'}>
                    {valeur || 'non lu'}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="mt-3">
              {lecture.conforme ? (
                <p className="text-xs text-ok-400">Ce nom suit la regle, le fichier serait traite.</p>
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
      <p className="mb-2 text-sm text-mist-500">
        Un profil dit quels comptes sont vises. Chaque dossier surveille en choisit un.
      </p>
      <Aide>
        Un profil sans plateforme ni compte precis vise tous les comptes actifs de la marque. C est
        le cas courant. Les autres servent a publier plus etroitement : un profil « reseaux courts »
        qui exclut YouTube, un profil « test » sur un seul compte pour verifier une nouvelle marque
        sans exposer les autres.
      </Aide>

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
                  ? 'Aucune cochee : toutes les plateformes sont visees.'
                  : `Seules ces ${p.plateformes.length}. Une marque sans compte sur l une d elles l ignore.`}
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
              <Aide titre="Quand s en servir">
                Des comptes nommes ici l emportent sur le filtre de plateforme. C est ce qui permet
                un profil de test sur un seul compte, pour verifier ce que produit une nouvelle
                marque avant de la lacher partout.
              </Aide>
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
      setEtat({ ...etat, parMarque: { ...etat.parMarque, [marque]: { ...grille, [jour]: n } } })
    } else {
      setEtat({ ...etat, defaut: { ...etat.defaut, [jour]: n } })
    }
  }

  const total = JOURS_CADENCE.reduce((n, j) => n + (grille[j.cle] ?? 0), 0)

  return (
    <div className="space-y-5">
      <section className="panel p-5">
        <h2 className="mb-3 font-semibold">Le moteur</h2>

        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-ink-700 px-3 py-3">
          <input
            type="checkbox"
            checked={moteur.actif}
            onChange={(e) => setMoteur({ ...moteur, actif: e.target.checked })}
          />
          <span className="text-sm text-mist-100">
            Programmer les videos automatiquement
          </span>
        </label>

        <Aide>
          <p>
            Toutes les quinze minutes, le moteur prend le haut de la file de la Reserve et cree les
            campagnes, en respectant la cadence reglee plus bas.
          </p>
          <p className="mt-2">
            Eteint, les videos s accumulent dans la Reserve sans jamais partir. Tu peux quand meme
            lancer un passage a la main, depuis la Reserve.
          </p>
        </Aide>

        {moteur.actif && (
          <label className="mt-4 block max-w-xs">
            <span className="label">Programmer jusqu a</span>
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
              <span className="shrink-0 text-xs text-mist-600">jours a l avance</span>
            </div>
            <Aide>
              Une campagne creee peut encore etre corrigee, mais plus reordonnee. Trois jours
              laissent le temps de voir venir sans figer un mois entier.
            </Aide>
          </label>
        )}
      </section>

      <section className="panel p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">Combien de videos par jour</h2>
          <span className="text-xs text-mist-600">
            {total} par semaine{marque ? ` pour ${marque}` : ''}
          </span>
        </div>

        <label className="mb-4 block max-w-xs">
          <span className="label">Pour</span>
          <select className="field" value={marque} onChange={(e) => setMarque(e.target.value)}>
            <option value="">Toutes les marques</option>
            {marques.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
          {JOURS_CADENCE.map((j) => (
            <label key={j.cle} className="block">
              <span className="mb-1 block text-center text-xs text-mist-500">
                {j.label.slice(0, 3)}
              </span>
              <input
                type="number"
                min={0}
                max={20}
                className="field text-center tabular-nums"
                value={grille[j.cle] ?? 0}
                onChange={(e) => majJour(j.cle, Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
          ))}
        </div>

        <Aide>
          <p>
            Le maximum de videos publiees par jour, pour une marque. Chaque video devient une
            campagne, envoyee sur tous les comptes de cette marque.
          </p>
          <p className="mt-2">
            Ce qui depasse n est pas perdu : ca part le premier jour suivant qui a de la place.
          </p>
        </Aide>

        {marque && etat.parMarque[marque] && (
          <button
            className="mt-3 text-xs text-brand-400 hover:underline"
            onClick={() => {
              const suite = { ...etat.parMarque }
              delete suite[marque]
              setEtat({ ...etat, parMarque: suite })
            }}
          >
            Revenir a la valeur commune pour {marque}
          </button>
        )}
      </section>

      <section className="panel p-5">
        <h2 className="mb-3 font-semibold">A quelle heure</h2>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="label">Pas avant</span>
            <input
              type="time"
              className="field"
              value={etat.plage.debut}
              onChange={(e) => setEtat({ ...etat, plage: { ...etat.plage, debut: e.target.value } })}
            />
          </label>
          <label className="block">
            <span className="label">Pas apres</span>
            <input
              type="time"
              className="field"
              value={etat.plage.fin}
              onChange={(e) => setEtat({ ...etat, plage: { ...etat.plage, fin: e.target.value } })}
            />
          </label>
          <label className="block">
            <span className="label">Ecart entre comptes</span>
            <div className="flex items-center gap-2">
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
              <span className="shrink-0 text-xs text-mist-600">min</span>
            </div>
          </label>
        </div>

        <Aide>
          <p>
            Les publications du jour se repartissent dans cette plage. Avec trois par jour entre 9 h
            et 21 h, elles tombent vers 9 h, 13 h et 17 h.
          </p>
          <p className="mt-2">
            L ecart separe les comptes d une MEME video. Neuf comptes qui publient a la meme seconde
            se remarquent.
          </p>
        </Aide>
      </section>

      <section className="panel p-5">
        <h2 className="mb-1 font-semibold">Cas particuliers</h2>
        <p className="mb-4 text-sm text-mist-500">
          Regles une fois, puis oublies. Les valeurs en place conviennent dans la plupart des cas.
        </p>

        <div className="space-y-5">
          <div>
            <span className="label">Quand plusieurs videos arrivent d un coup</span>
            <div className="space-y-2">
              {(
                [
                  { v: 'etaler' as const, label: 'Etaler sur les jours suivants' },
                  { v: 'auPlusTot' as const, label: 'Tout programmer au plus tot' },
                ]
              ).map((o) => (
                <label
                  key={o.v}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    etat.afflux === o.v
                      ? 'border-brand-500/50 bg-brand-500/10 text-mist-100'
                      : 'border-ink-700 text-mist-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="afflux"
                    checked={etat.afflux === o.v}
                    onChange={() => setEtat({ ...etat, afflux: o.v })}
                  />
                  {o.label}
                </label>
              ))}
            </div>
            <Aide>
              <p>
                <span className="text-mist-100">Etaler</span> respecte la cadence : le surplus part
                demain, apres-demain, et ainsi de suite. C est ce que tu veux au quotidien.
              </p>
              <p className="mt-2">
                <span className="text-mist-100">Au plus tot</span> ignore la cadence et programme
                tout tout de suite. Utile pour rattraper un retard, dangereux le reste du temps.
              </p>
            </Aide>
          </div>

          <div>
            <span className="label">Si une plateforme a atteint sa limite du jour</span>
            <div className="space-y-2">
              {(
                [
                  { v: 'reporter' as const, label: 'Decaler au lendemain' },
                  { v: 'ignorer' as const, label: 'Publier sans cette plateforme' },
                ]
              ).map((o) => (
                <label
                  key={o.v}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    quotas.surDepassement === o.v
                      ? 'border-brand-500/50 bg-brand-500/10 text-mist-100'
                      : 'border-ink-700 text-mist-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="quota"
                    checked={quotas.surDepassement === o.v}
                    onChange={() => setQuotas({ surDepassement: o.v })}
                  />
                  {o.label}
                </label>
              ))}
            </div>
            <Aide>
              Six envois YouTube par jour toutes chaines confondues, vingt-cinq publications
              Instagram par 24 h et par compte. Ces limites viennent des plateformes, elles ne se
              negocient pas.
            </Aide>
          </div>

          <div>
            <span className="label">Prevenir quand la Reserve se vide</span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={50}
                className="field !w-24 tabular-nums"
                value={reserve.seuilParDefaut}
                onChange={(e) =>
                  setReserve({
                    ...reserve,
                    seuilParDefaut: Math.max(0, Number(e.target.value) || 0),
                  })
                }
              />
              <span className="text-xs text-mist-600">videos restantes ou moins</span>
            </div>
            <Aide>
              <p>
                Un message Telegram quand une marque descend a ce niveau, pour produire avant d etre
                a sec. Une marque a zero voit ses creneaux sautes, et l alerte le dit autrement.
              </p>
              <p className="mt-2">
                Un seuil different par marque se regle ci-dessous, si l une produit plus vite que
                les autres.
              </p>
            </Aide>

            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-mist-600 hover:text-mist-300">
                Un seuil different par marque
              </summary>
              <div className="mt-2 space-y-2">
                {marques.map((m) => {
                  const propre = m in (reserve.seuilParMarque ?? {})
                  return (
                    <div
                      key={m}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-700 px-3 py-2"
                    >
                      <span className="text-sm">{m}</span>
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
                            valeur commune
                          </button>
                        ) : (
                          <span className="text-xs text-mist-600">valeur commune</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </details>
          </div>
        </div>
      </section>

      <div className="flex items-center justify-end gap-2">
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
      <p className="mb-2 text-sm text-mist-500">
        Une campagne a valider ne peut pas partir tant que tu ne l as pas approuvee.
      </p>
      <Aide>
        Le planificateur ne voit que les publications validees : une campagne en attente ne risque
        donc pas de partir par accident. Tu recois une alerte Telegram a chaque fois, et tu la
        relis dans l onglet Suivi, ou dans Publications en filtrant sur « A valider ».
      </Aide>

      <label className="mb-4 flex cursor-pointer items-start gap-3 rounded-xl border border-ink-700 p-3">
        <input
          type="checkbox"
          className="mt-1"
          checked={etat.parDefaut}
          onChange={(e) => setEtat({ ...etat, parDefaut: e.target.checked })}
        />
        <span className="text-sm text-mist-100">Demander validation par defaut</span>
      </label>
      <Aide>
        S applique aux marques qui n ont pas de reglage propre ci-dessous. Garde-le actif tant que
        tu n as pas confiance dans ce que la generation produit.
      </Aide>

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
        <Aide>
          Le watcher se manifeste a chaque passage. Passe ce delai sans nouvelles, un bandeau rouge
          apparait : PC eteint, ou script arrete. Vingt-six heures laissent passer une nuit sans
          crier au loup.
        </Aide>
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
        <p className="mb-2 text-sm text-mist-500">
          Ajoutes automatiquement a la fin de chaque texte genere.
        </p>
        <Aide>
          Le ton, le vocabulaire et les mentions legales se reglent ailleurs, dans{' '}
          <Link to="/consignes" className="text-brand-400 hover:underline">
            Textes
          </Link>
          . Ici on n ajoute que le renvoi, qui ne concerne que l automatisation.
        </Aide>

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
                    ? `${(cta[p.value] ?? []).length} variantes, employees a tour de role.`
                    : 'Une ligne par variante. Elles alternent d une publication a l autre.'}
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
                    ? 'Lien non cliquable ici : ecris plutot « lien en bio ».'
                    : 'Une adresse complete fonctionne.'}
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
