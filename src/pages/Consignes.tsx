import { useCallback, useEffect, useMemo, useState } from 'react'
import { generateCaption, listAccounts, listConsignes, saveConsigne } from '../lib/api'
import { friendlyError } from '../lib/errors'
import { PLATFORMS, type Account } from '../lib/types'
import { LANGUE_DEFAUT, langue as trouverLangue } from '../lib/langues'
import {
  blocVide,
  INTERDITS,
  marqueVide,
  marqueVierge,
  normaliserBloc,
  normaliserMarque,
  normaliserPlateforme,
  plateformesTropCourtes,
  VARIANTES_YOUTUBE,
  type Bloc,
  type ConsigneMarque,
  type ConsignePlateforme,
  type Probleme,
} from '../lib/consignes'
import { Alert, Loading, PageHeader } from '../components/ui'
import RevisionTextes from '../components/RevisionTextes'

export default function Consignes() {
  const [plateformes, setPlateformes] = useState<Record<string, ConsignePlateforme>>({})
  const [marques, setMarques] = useState<Record<string, ConsigneMarque>>({})
  const [accounts, setAccounts] = useState<Account[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [portee, setPortee] = useState<'plateforme' | 'marque'>('plateforme')
  const [choix, setChoix] = useState('instagram')
  const [enregistrement, setEnregistrement] = useState(false)
  const [revision, setRevision] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [lignes, comptes] = await Promise.all([listConsignes(), listAccounts()])
      const p: Record<string, ConsignePlateforme> = {}
      const m: Record<string, ConsigneMarque> = {}
      for (const ligne of lignes) {
        if (ligne.portee === 'plateforme') p[ligne.cle] = normaliserPlateforme(ligne.reglages)
        else m[ligne.cle] = normaliserMarque(ligne.reglages)
      }
      setPlateformes(p)
      setMarques(m)
      setAccounts(comptes)
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

  // Les marques viennent des comptes connectes, pas d'une liste figee : une
  // quatrieme marque ajoutee demain apparait ici sans migration.
  const nomsMarques = useMemo(() => {
    const vus = new Set([...accounts.map((a) => a.brand), ...Object.keys(marques)])
    return [...vus].filter(Boolean).sort()
  }, [accounts, marques])

  useEffect(() => {
    if (portee === 'marque' && !nomsMarques.includes(choix)) {
      setChoix(nomsMarques[0] ?? '')
    }
    if (portee === 'plateforme' && !PLATFORMS.some((p) => p.value === choix)) {
      setChoix('instagram')
    }
  }, [portee, nomsMarques, choix])

  async function enregistrer(reglages: Record<string, unknown>) {
    setEnregistrement(true)
    setError(null)
    try {
      await saveConsigne(portee, choix, reglages)
      setNotice(`Consignes de ${choix} enregistrees. Elles s appliquent des la prochaine generation.`)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setEnregistrement(false)
    }
  }

  const plateformeCourante = plateformes[choix]
  const marqueCourante = marques[choix]

  const listeChoix =
    portee === 'plateforme'
      ? PLATFORMS.map((p) => ({ cle: p.value, label: p.label, icone: p.icon }))
      : nomsMarques.map((m) => ({ cle: m, label: m, icone: '◈' }))

  return (
    <div>
      <PageHeader
        title="Consignes de generation"
        subtitle="Ce que le modele doit respecter, par plateforme et par marque. La marque l emporte sur le style, la plateforme sur la technique."
        action={
          <button className="btn btn-primary" onClick={() => setRevision(true)}>
            Regenerer tous les textes en attente
          </button>
        }
      />

      <div className="mb-5 flex flex-wrap gap-3">
        <div className="flex gap-1 rounded-xl border border-ink-700 bg-ink-850 p-1">
          {(['plateforme', 'marque'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPortee(p)}
              aria-pressed={portee === p}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                portee === p ? 'bg-brand-500 text-white' : 'text-mist-500 hover:text-mist-100'
              }`}
            >
              {p === 'plateforme' ? 'Par plateforme' : 'Par marque'}
            </button>
          ))}
        </div>
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
        <div className="grid gap-5 lg:grid-cols-[13rem_1fr]">
          <nav className="flex flex-wrap gap-2 lg:flex-col">
            {listeChoix.map((c) => {
              const vierge = portee === 'marque' && marques[c.cle] && marqueVierge(marques[c.cle])
              return (
                <button
                  key={c.cle}
                  onClick={() => setChoix(c.cle)}
                  aria-pressed={choix === c.cle}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                    choix === c.cle
                      ? 'border-brand-500/40 bg-brand-500/10 text-mist-100'
                      : 'border-ink-700 text-mist-500 hover:border-ink-600 hover:text-mist-100'
                  }`}
                >
                  <span className="text-xs opacity-70">{c.icone}</span>
                  <span className="flex-1">{c.label}</span>
                  {vierge && (
                    <span
                      title="Aucune consigne renseignee pour cette marque"
                      className="text-xs text-warn-400"
                    >
                      ○
                    </span>
                  )}
                </button>
              )
            })}
          </nav>

          <div className="space-y-5">
            {portee === 'plateforme' ? (
              <EditeurPlateforme
                key={choix}
                cle={choix}
                consigne={plateformeCourante ?? normaliserPlateforme(null)}
                occupe={enregistrement}
                onEnregistrer={(v) => void enregistrer(v as unknown as Record<string, unknown>)}
              />
            ) : choix ? (
              <EditeurMarque
                key={choix}
                nom={choix}
                consigne={marqueCourante ?? marqueVide()}
                plateformes={plateformes}
                languesUtilisees={[
                  ...new Set([
                    LANGUE_DEFAUT,
                    ...accounts.filter((a) => a.brand === choix).map((a) => a.language ?? LANGUE_DEFAUT),
                  ]),
                ]}
                occupe={enregistrement}
                onEnregistrer={(v) => void enregistrer(v as unknown as Record<string, unknown>)}
              />
            ) : (
              <Alert kind="info">
                Aucune marque connue. Connecte un compte pour qu elle apparaisse ici.
              </Alert>
            )}

            <Apercu marques={nomsMarques} />
          </div>
        </div>
      )}

      <RevisionTextes
        open={revision}
        onClose={() => setRevision(false)}
        onApplique={(n) => {
          setRevision(false)
          setNotice(`${n} texte${n > 1 ? 's' : ''} remplace${n > 1 ? 's' : ''}.`)
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Champs
// ---------------------------------------------------------------------------

function Nombre({
  label,
  valeur,
  onChange,
  suffixe,
}: {
  label: string
  valeur: number
  onChange: (n: number) => void
  suffixe?: string
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          className="field tabular-nums"
          value={Number.isFinite(valeur) ? valeur : 0}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {suffixe && <span className="shrink-0 text-xs text-mist-600">{suffixe}</span>}
      </div>
    </label>
  )
}

function Zone({
  label,
  valeur,
  onChange,
  aide,
  lignes = 3,
  placeholder,
}: {
  label: string
  valeur: string
  onChange: (v: string) => void
  aide?: string
  lignes?: number
  placeholder?: string
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <textarea
        className="field resize-y"
        rows={lignes}
        value={valeur}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {aide && <span className="mt-1 block text-xs text-mist-600">{aide}</span>}
    </label>
  )
}

// ---------------------------------------------------------------------------
// Un bloc de regles
// ---------------------------------------------------------------------------

function EditeurBloc({
  bloc,
  onChange,
  sansHashtags,
}: {
  bloc: Bloc
  onChange: (b: Bloc) => void
  sansHashtags?: boolean
}) {
  const set = (changes: Partial<Bloc>) => onChange({ ...bloc, ...changes })

  // Un code stocke qu'on ne connait pas est conserve : il vient peut-etre d'une
  // version plus recente du catalogue serveur, l'effacer en silence serait pire
  // que de l'afficher sans case a cocher.
  const inconnus = bloc.interdits.filter((c) => !INTERDITS.some((i) => i.code === c))

  const incoherent = bloc.longueurMin > bloc.longueurMax || bloc.hashtagsMin > bloc.hashtagsMax

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Nombre
          label="Longueur minimale"
          valeur={bloc.longueurMin}
          suffixe="caracteres"
          onChange={(n) => set({ longueurMin: n })}
        />
        <Nombre
          label="Longueur maximale"
          valeur={bloc.longueurMax}
          suffixe="caracteres"
          onChange={(n) => set({ longueurMax: n })}
        />
      </div>

      {!sansHashtags && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Nombre
              label="Hashtags, minimum"
              valeur={bloc.hashtagsMin}
              onChange={(n) => set({ hashtagsMin: n })}
            />
            <Nombre
              label="Hashtags, maximum"
              valeur={bloc.hashtagsMax}
              onChange={(n) => set({ hashtagsMax: n })}
            />
          </div>

          <div>
            <span className="label">Placement des hashtags</span>
            <div className="flex gap-2">
              {(
                [
                  { v: 'fin', label: 'A la fin, apres le texte' },
                  { v: 'texte', label: 'Integres dans le texte' },
                ] as const
              ).map((o) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => set({ placementHashtags: o.v })}
                  aria-pressed={bloc.placementHashtags === o.v}
                  className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                    bloc.placementHashtags === o.v
                      ? 'border-brand-500/50 bg-brand-500/10 text-mist-100'
                      : 'border-ink-700 text-mist-500 hover:text-mist-100'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <Zone
        label="Ton et style attendus"
        valeur={bloc.ton}
        lignes={2}
        onChange={(v) => set({ ton: v })}
        placeholder="Visuel et direct. On decrit ce qu on voit autant que ce qu on dit."
      />

      <Zone
        label="Structure attendue"
        valeur={bloc.structure}
        lignes={2}
        onChange={(v) => set({ structure: v })}
        placeholder="Une accroche des le premier mot, puis deux a quatre lignes."
      />

      <div>
        <span className="label">Elements interdits, verifies automatiquement</span>
        <div className="flex flex-wrap gap-2">
          {INTERDITS.map((i) => {
            const coche = bloc.interdits.includes(i.code)
            return (
              <button
                key={i.code}
                type="button"
                aria-pressed={coche}
                onClick={() =>
                  set({
                    interdits: coche
                      ? bloc.interdits.filter((c) => c !== i.code)
                      : [...bloc.interdits, i.code],
                  })
                }
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                  coche
                    ? 'border-bad-600/50 bg-bad-600/10 text-bad-400'
                    : 'border-ink-700 text-mist-500 hover:text-mist-100'
                }`}
              >
                <span aria-hidden="true">{coche ? '✕' : '○'}</span>
                {i.label}
              </button>
            )
          })}
          {inconnus.map((c) => (
            <span
              key={c}
              title="Code enregistre que cette page ne connait pas. Il est conserve tel quel."
              className="rounded-lg border border-ink-700 px-2.5 py-1.5 text-xs text-mist-600"
            >
              {c}
            </span>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-mist-600">
          Coche ce qui est refuse. Un texte qui en contient est regenere une fois avant d etre
          signale.
        </p>
      </div>

      <Zone
        label="Autres interdits, en clair"
        valeur={bloc.interditsLibres}
        lignes={2}
        onChange={(v) => set({ interditsLibres: v })}
        aide="Transmis au modele mais pas verifiable automatiquement. Exemple : pas de formules toutes faites."
        placeholder="Pas d appat a clic. Pas de promesse de resultat."
      />

      {incoherent && (
        <Alert kind="error">
          Le minimum depasse le maximum. Aucun texte ne pourra passer les controles.
        </Alert>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function EditeurPlateforme({
  cle,
  consigne,
  occupe,
  onEnregistrer,
}: {
  cle: string
  consigne: ConsignePlateforme
  occupe: boolean
  onEnregistrer: (c: ConsignePlateforme) => void
}) {
  const [etat, setEtat] = useState<ConsignePlateforme>(consigne)
  const [variante, setVariante] = useState(VARIANTES_YOUTUBE[0].cle)

  const estYoutube = cle === 'youtube'
  const label = PLATFORMS.find((p) => p.value === cle)?.label ?? cle

  const blocVariante = estYoutube
    ? normaliserBloc(etat.variantes?.[variante] ?? blocVide())
    : etat

  const sansHashtags = estYoutube && variante.endsWith('_titre')

  function changerBloc(b: Bloc) {
    if (!estYoutube) {
      setEtat({ ...etat, ...b })
      return
    }
    setEtat({ ...etat, variantes: { ...(etat.variantes ?? {}), [variante]: b } })
  }

  return (
    <section className="panel p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">{label}</h2>
        <span className="text-xs text-mist-600">
          Ces regles s appliquent a tous les comptes {label}, quelle que soit la marque.
        </span>
      </div>

      {estYoutube && (
        <div className="mb-5">
          <p className="mb-2 text-xs text-mist-500">
            YouTube demande quatre jeux de regles : le titre et la description ne s ecrivent pas
            pareil, et un Short n est pas une video classique.
          </p>
          <div className="flex flex-wrap gap-2">
            {VARIANTES_YOUTUBE.map((v) => (
              <button
                key={v.cle}
                type="button"
                onClick={() => setVariante(v.cle)}
                aria-pressed={variante === v.cle}
                className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                  variante === v.cle
                    ? 'border-brand-500/50 bg-brand-500/10 text-mist-100'
                    : 'border-ink-700 text-mist-500 hover:text-mist-100'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-mist-600">
            {VARIANTES_YOUTUBE.find((v) => v.cle === variante)?.aide}
          </p>
        </div>
      )}

      <EditeurBloc bloc={blocVariante} onChange={changerBloc} sansHashtags={sansHashtags} />

      <div className="mt-5 flex justify-end">
        <button className="btn btn-primary" disabled={occupe} onClick={() => onEnregistrer(etat)}>
          {occupe ? 'Enregistrement...' : 'Enregistrer'}
        </button>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------

function EditeurMarque({
  nom,
  consigne,
  plateformes,
  languesUtilisees,
  occupe,
  onEnregistrer,
}: {
  nom: string
  consigne: ConsigneMarque
  plateformes: Record<string, ConsignePlateforme>
  /** Les langues des comptes de cette marque, francais toujours compris. */
  languesUtilisees: string[]
  occupe: boolean
  onEnregistrer: (c: ConsigneMarque) => void
}) {
  const [etat, setEtat] = useState<ConsigneMarque>(consigne)
  const set = (changes: Partial<ConsigneMarque>) => setEtat({ ...etat, ...changes })

  // Les langues a proposer : celles des comptes de la marque, plus celles qui
  // ont deja une mention enregistree. On n'affiche pas les sept autres champs,
  // qui ne serviraient a personne.
  const languesMention = [
    ...new Set([...languesUtilisees, ...Object.keys(etat.mentionsLegales)]),
  ]

  // Un avertissement obligatoire plus long que la limite d'une plateforme rend
  // les deux consignes inconciliables. Mieux vaut le voir ici qu'apres coup.
  const trop = languesMention.flatMap((code) =>
    plateformesTropCourtes(etat.mentionsLegales[code] ?? '', plateformes).map((t) => ({
      ...t,
      code,
    })),
  )

  return (
    <section className="panel p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">{nom}</h2>
        <span className="text-xs text-mist-600">
          En cas de contradiction avec la plateforme, la marque l emporte sur le style.
        </span>
      </div>

      {marqueVierge(etat) && (
        <div className="mb-4">
          <Alert kind="info">
            Cette marque n a aucune consigne. Ses textes sont ecrits avec les seules regles de
            plateforme, donc sur le meme ton que les autres marques.
          </Alert>
        </div>
      )}

      <div className="space-y-4">
        <Zone
          label="Niche et sujet traite"
          valeur={etat.niche}
          onChange={(v) => set({ niche: v })}
          placeholder="Trading algorithmique et forex. Robots d execution sur MetaTrader 5."
        />
        <Zone
          label="Public vise"
          valeur={etat.audience}
          lignes={2}
          onChange={(v) => set({ audience: v })}
          placeholder="Traders particuliers qui connaissent deja les bases."
        />
        <Zone
          label="Ton de la marque"
          valeur={etat.ton}
          lignes={2}
          onChange={(v) => set({ ton: v })}
          placeholder="Technique et sobre. On montre des chiffres, on ne promet pas de gains."
        />
        <Zone
          label="Vocabulaire et expressions a privilegier"
          valeur={etat.vocabulairePrefere}
          lignes={2}
          onChange={(v) => set({ vocabulairePrefere: v })}
          placeholder="execution, gestion du risque, drawdown, backtest"
        />
        <Zone
          label="Vocabulaire et sujets a eviter"
          valeur={etat.vocabulaireEvite}
          lignes={2}
          onChange={(v) => set({ vocabulaireEvite: v })}
          aide="Separes par des virgules, verifies dans toutes les langues. Si tu publies aussi en anglais, ajoute les equivalents anglais dans le meme champ."
          placeholder="argent facile, garanti, sans risque"
        />
        <Zone
          label="Appel a l action habituel"
          valeur={etat.appelAction}
          lignes={2}
          onChange={(v) => set({ appelAction: v })}
          placeholder="Laisse vide si tu n en veux pas."
        />

        <div>
          <span className="label">Hashtags recurrents de la marque</span>
          <p className="mb-2 text-xs text-mist-600">
            Une liste par langue. Un champ laisse vide veut dire « aucun impose » : le modele
            choisit alors les siens, dans la bonne langue. La liste francaise ne sert jamais de
            repli, un hashtag francais sous un texte anglais ne touche personne.
          </p>

          <div className="space-y-3">
            {languesMention.map((code) => (
              <label key={code} className="block">
                <span className="label">{trouverLangue(code).label}</span>
                <input
                  className="field"
                  value={(etat.hashtags[code] ?? []).join(' ')}
                  onChange={(e) => {
                    const liste = e.target.value
                      .split(/[\s,]+/)
                      .map((h) => h.replace(/^#/, '').trim())
                      .filter(Boolean)
                    const suite = { ...etat.hashtags }
                    if (liste.length > 0) suite[code] = liste
                    else delete suite[code]
                    set({ hashtags: suite })
                  }}
                  placeholder={code === LANGUE_DEFAUT ? 'trading forex mt5' : ''}
                />
              </label>
            ))}
          </div>

          <span className="mt-1 block text-xs text-mist-600">
            Separes par des espaces, sans le caractere #. Ils viennent en plus de ceux que le modele
            propose, dans la limite fixee par la plateforme.
          </span>
        </div>

        <div>
          <span className="label">Mentions legales a inclure systematiquement</span>
          <p className="mb-2 text-xs text-mist-600">
            Une version par langue. Elle est reprise telle quelle, jamais traduite a la volee : un
            avertissement juridique n est pas une phrase que le modele doit improviser. A defaut de
            version dans la langue d une publication, c est la version francaise qui part.
          </p>

          <div className="space-y-3">
            {languesMention.map((code) => {
              const valeur = etat.mentionsLegales[code] ?? ''
              const conflits = trop.filter((t) => t.code === code)
              return (
                <div key={code}>
                  <Zone
                    label={trouverLangue(code).label}
                    valeur={valeur}
                    lignes={2}
                    onChange={(v) => {
                      const suite = { ...etat.mentionsLegales }
                      if (v.trim()) suite[code] = v
                      else delete suite[code]
                      set({ mentionsLegales: suite })
                    }}
                    aide={
                      valeur.trim()
                        ? `${valeur.trim().length} caracteres, comptes dans la longueur du texte.`
                        : code === LANGUE_DEFAUT
                          ? 'Sert aussi de repli pour les langues sans version propre.'
                          : `Vide : les textes en ${trouverLangue(code).label.toLowerCase()} porteront la version francaise.`
                    }
                    placeholder={
                      code === LANGUE_DEFAUT
                        ? 'Le trading comporte un risque de perte en capital.'
                        : ''
                    }
                  />

                  {conflits.length > 0 && (
                    <div className="mt-2">
                      <Alert kind="error">
                        Cette version ne tient pas dans la limite de{' '}
                        {conflits.map((t) => `${t.plateforme} (${t.max} caracteres)`).join(', ')}.
                        Sur ces plateformes elle sera conservee entiere et le texte depassera la
                        longueur maximale. Allonge la limite de la plateforme, ou raccourcis la
                        mention.
                      </Alert>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {languesMention.length === 1 && (
            <p className="mt-2 text-xs text-mist-600">
              Seul le francais est propose : aucun compte de cette marque ne publie dans une autre
              langue. Change la langue d un compte pour voir apparaitre son champ ici.
            </p>
          )}
        </div>
      </div>

      <div className="mt-5 flex justify-end">
        <button className="btn btn-primary" disabled={occupe} onClick={() => onEnregistrer(etat)}>
          {occupe ? 'Enregistrement...' : 'Enregistrer'}
        </button>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Apercu
// ---------------------------------------------------------------------------

/**
 * Un texte d'essai avec les consignes en vigueur.
 *
 * Rien n'est enregistre : c'est le point de l'exercice, regler le ton sans
 * remplir la file d'attente de publications a supprimer ensuite.
 */
function Apercu({ marques }: { marques: string[] }) {
  const [sujet, setSujet] = useState('')
  const [marque, setMarque] = useState(marques[0] ?? '')
  const [plateforme, setPlateforme] = useState('instagram')
  const [typeYoutube, setTypeYoutube] = useState<'short' | 'video'>('short')

  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [resultat, setResultat] = useState<{
    caption: string
    hashtags: string[]
    title?: string | null
    problemes?: Probleme[]
  } | null>(null)

  useEffect(() => {
    if (!marque && marques.length > 0) setMarque(marques[0])
  }, [marques, marque])

  async function tester() {
    if (!sujet.trim()) {
      setErreur('Donne un sujet de video pour voir ce que les consignes produisent')
      return
    }
    setOccupe(true)
    setErreur(null)
    try {
      setResultat(
        await generateCaption({
          subject: sujet.trim(),
          platform: plateforme,
          brand: marque,
          youtube_type: plateforme === 'youtube' ? typeYoutube : undefined,
        }),
      )
    } catch (err) {
      setErreur(friendlyError(err))
      setResultat(null)
    } finally {
      setOccupe(false)
    }
  }

  return (
    <section className="panel p-5">
      <h2 className="mb-1 font-semibold">Tester la generation</h2>
      <p className="mb-4 text-sm text-mist-500">
        Produit un texte d essai avec les consignes enregistrees. Rien n est ajoute a la file
        d attente.
      </p>

      <div className="space-y-3">
        <label className="block">
          <span className="label">Sujet de la video</span>
          <input
            className="field"
            value={sujet}
            onChange={(e) => setSujet(e.target.value)}
            placeholder="Pourquoi un stop loss trop serre coute plus cher qu il ne protege"
          />
        </label>

        <div className="flex flex-wrap gap-3">
          <select
            className="field !w-auto"
            value={marque}
            onChange={(e) => setMarque(e.target.value)}
          >
            {marques.length === 0 && <option value="">Aucune marque</option>}
            {marques.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>

          <select
            className="field !w-auto"
            value={plateforme}
            onChange={(e) => setPlateforme(e.target.value)}
          >
            {PLATFORMS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>

          {plateforme === 'youtube' && (
            <select
              className="field !w-auto"
              value={typeYoutube}
              onChange={(e) => setTypeYoutube(e.target.value as 'short' | 'video')}
            >
              <option value="short">Short</option>
              <option value="video">Video classique</option>
            </select>
          )}

          <button className="btn btn-ghost" disabled={occupe} onClick={() => void tester()}>
            {occupe ? 'Generation...' : 'Tester la generation'}
          </button>
        </div>

        {erreur && <Alert kind="error">{erreur}</Alert>}

        {resultat && (
          <div className="rounded-xl border border-ink-700 bg-ink-850 p-4">
            {resultat.title && (
              <p className="mb-2 text-sm font-semibold text-mist-100">{resultat.title}</p>
            )}
            <p className="whitespace-pre-wrap text-sm text-mist-300">{resultat.caption}</p>

            {resultat.hashtags.length > 0 && (
              <p className="mt-2 text-xs text-brand-400">
                {resultat.hashtags.map((h) => `#${h}`).join(' ')}
              </p>
            )}

            <p className="mt-3 text-xs tabular-nums text-mist-600">
              {resultat.caption.length} caracteres, {resultat.hashtags.length} hashtag
              {resultat.hashtags.length > 1 ? 's' : ''}
            </p>

            <Problemes liste={resultat.problemes ?? []} />
          </div>
        )}
      </div>
    </section>
  )
}

/** Ce que les controles ont trouve, ou le fait qu'ils sont passes. */
export function Problemes({ liste }: { liste: Probleme[] }) {
  if (liste.length === 0) {
    return <p className="mt-2 text-xs text-ok-400">Tous les controles passent.</p>
  }
  return (
    <ul className="mt-2 space-y-1">
      {liste.map((p, i) => (
        <li key={`${p.code}-${i}`} className="text-xs text-warn-400">
          {p.message}
        </li>
      ))}
    </ul>
  )
}
