// Le point d'entree du watcher local.
//
// SECURITE, en un paragraphe. Le watcher tourne sur le PC de Diego et n'a
// AUCUN acces a la base. Il ne possede pas de session Supabase : la politique
// accounts_rw vaut `using (true)`, donc n'importe quel utilisateur connecte
// lit accounts.access_token, c'est-a-dire les jetons Instagram, TikTok et
// YouTube. Un compte dedie au watcher les lui donnerait.
//
// A la place il porte un seul secret partage, WATCHER_TOKEN, qui n'ouvre que
// cette fonction. Ce qu'il peut faire tient en quatre verbes :
//   config      lire les regles, et signaler qu'il est vivant
//   upload-url  demander un creneau d'envoi signe, valable quelques minutes,
//               pour UN chemin precis
//   import      soumettre une video deposee
//   ping        signaler qu'il est vivant, sans rien demander
// Il ne peut ni lire un compte, ni lire une publication, ni supprimer quoi que
// ce soit. La cle service_role reste ici, cote serveur.
//
// Deployee avec --no-verify-jwt : le watcher n'a pas de JWT. C'est donc cette
// fonction qui verifie le secret, a duree constante.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { jwtRole, memeSecret } from '../_shared/auth.ts'
import { notifyTelegram } from '../_shared/notify.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const WATCHER_TOKEN = Deno.env.get('WATCHER_TOKEN') ?? ''

/** Cout d'un envoi YouTube, en unites de quota. Identique au scheduler. */
const COUT_YOUTUBE = 1600
const QUOTA_YOUTUBE = 10_000

const JOURS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam']

type Profil = { nom: string; plateformes?: string[]; comptes?: string[] }

type Config = {
  actif: boolean
  nommage: {
    separateur: string
    ordre: string[]
    surNonConforme: 'rejeter' | 'defauts'
    defauts: { marque: string; langue: string }
  }
  profils: Profil[]
  cadence: {
    parMarque: Record<string, Record<string, number>>
    defaut: Record<string, number>
    plage: { debut: string; fin: string }
    ecartMinutes: number
    afflux: 'etaler' | 'auPlusTot'
  }
  quotas: { surDepassement: 'reporter' | 'ignorer' }
  validation: { parDefaut: boolean; parMarque: Record<string, boolean> }
  contenu: {
    cta: Record<string, Record<string, string[]>>
    liens: Record<string, Record<string, string>>
    position: 'debut' | 'fin'
  }
  alerteSilenceHeures: number
}

type Compte = {
  id: string
  platform: string
  brand: string
  account_name: string
  language: string | null
  status: string
}

// ---------------------------------------------------------------------------
// Lecture des reglages
// ---------------------------------------------------------------------------

async function lireConfig(db: SupabaseClient): Promise<Config> {
  const { data } = await db.from('automation_config').select('reglages').eq('id', true).single()
  return (data?.reglages ?? {}) as Config
}

async function lireDossiers(db: SupabaseClient) {
  const { data } = await db
    .from('watch_folders')
    .select('id, chemin, actif, marque, profil')
    .order('ordre')
  return data ?? []
}

// ---------------------------------------------------------------------------
// Lecture du nom de fichier
// ---------------------------------------------------------------------------

export type Lecture = {
  marque: string
  sujet: string
  langue: string
  variante: string
  conforme: boolean
  manquants: string[]
}

/**
 * Ce qu'on tire d'un nom de fichier.
 *
 * L'ordre et le separateur sont configures dans l'app. Le sujet remplace les
 * tirets par des espaces : « stop-loss-trop-serre » se lit « stop loss trop
 * serre », ce qui donne un sujet utilisable tel quel par la generation.
 */
export function lireNom(nom: string, nommage: Config['nommage']): Lecture {
  const sansExtension = nom.replace(/\.[^.]+$/, '')
  const sep = nommage.separateur || '_'
  const morceaux = sansExtension.split(sep).map((m) => m.trim()).filter(Boolean)

  const lu: Record<string, string> = {}
  nommage.ordre.forEach((champ, i) => {
    if (morceaux[i]) lu[champ] = morceaux[i]
  })

  const manquants = nommage.ordre.filter((champ) => !lu[champ])

  return {
    marque: lu.marque ?? '',
    sujet: (lu.sujet ?? '').replace(/[-+]/g, ' ').trim(),
    langue: (lu.langue ?? '').toLowerCase(),
    variante: lu.variante ?? '',
    conforme: manquants.length === 0,
    manquants,
  }
}

// ---------------------------------------------------------------------------
// Ciblage
// ---------------------------------------------------------------------------

/**
 * Les comptes vises pour une marque, selon le profil demande.
 *
 * Un profil sans plateforme ni compte precis vaut « tous les comptes de la
 * marque ». Les comptes nommes l'emportent sur le filtre de plateforme : c'est
 * ce qui permet un profil « test sur un seul compte ».
 */
export function ciblesPour(comptes: Compte[], marque: string, profil: Profil | null): Compte[] {
  const actifs = comptes.filter((c) => c.brand === marque && c.status === 'active')
  if (!profil) return actifs

  if (profil.comptes && profil.comptes.length > 0) {
    return actifs.filter((c) => profil.comptes!.includes(c.id))
  }
  if (profil.plateformes && profil.plateformes.length > 0) {
    return actifs.filter((c) => profil.plateformes!.includes(c.platform))
  }
  return actifs
}

// ---------------------------------------------------------------------------
// Planification
// ---------------------------------------------------------------------------

function minutesDepuisMinuit(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/**
 * Le premier creneau libre pour une marque.
 *
 * On avance jour par jour : un jour est disponible tant qu'il porte moins de
 * publications que la cadence prevue pour ce jour de la semaine. On se place
 * ensuite dans la plage horaire autorisee.
 *
 * En mode « auPlusTot » on ignore la cadence et on programme tout de suite,
 * ce qui reste utile pour rattraper un retard.
 */
export function prochainCreneau(
  cadence: Config['cadence'],
  dejaParJour: Record<string, number>,
  marque: string,
  depuis: Date,
): Date {
  if (cadence.afflux === 'auPlusTot') {
    // Deux minutes devant : le temps que la video finisse de se televerser et
    // que le prochain passage du scheduler arrive.
    return new Date(depuis.getTime() + 2 * 60_000)
  }

  const parMarque = cadence.parMarque?.[marque] ?? cadence.defaut ?? {}
  const debut = minutesDepuisMinuit(cadence.plage?.debut ?? '09:00')
  const fin = minutesDepuisMinuit(cadence.plage?.fin ?? '21:00')

  const jour = new Date(depuis)
  jour.setSeconds(0, 0)

  // Trente jours d'avance au maximum : au-dela, c'est que la cadence est a
  // zero partout, et il vaut mieux le dire que programmer dans deux ans.
  for (let i = 0; i < 30; i++) {
    const cle = cleJour(jour)
    const plafond = parMarque[JOURS[jour.getDay()]] ?? 0
    const deja = dejaParJour[cle] ?? 0

    if (plafond > 0 && deja < plafond) {
      // On repartit les publications du jour dans la plage autorisee.
      const pas = plafond > 1 ? (fin - debut) / plafond : 0
      const minute = Math.round(debut + pas * deja)
      const creneau = new Date(jour)
      creneau.setHours(Math.floor(minute / 60), minute % 60, 0, 0)

      if (creneau.getTime() > depuis.getTime()) return creneau
      // Le creneau theorique est deja passe : on prend le suivant du jour, ou
      // on bascule au lendemain si la plage est finie.
      const rattrapage = new Date(depuis.getTime() + 5 * 60_000)
      if (minutesDepuisMinuit(`${rattrapage.getHours()}:${rattrapage.getMinutes()}`) <= fin) {
        return rattrapage
      }
    }

    jour.setDate(jour.getDate() + 1)
    jour.setHours(0, 0, 0, 0)
  }

  return new Date(depuis.getTime() + 60 * 60_000)
}

function cleJour(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// ---------------------------------------------------------------------------
// Contenu : appel a l'action, lien, position
// ---------------------------------------------------------------------------

/**
 * L'appel a l'action a employer, en alternant entre les variantes.
 *
 * L'alternance suit le nombre de publications deja faites sur ce couple
 * marque plus plateforme : deux campagnes de suite ne se terminent donc pas
 * par la meme phrase, ce qui se verrait.
 */
export function choisirCta(
  contenu: Config['contenu'],
  marque: string,
  platform: string,
  rang: number,
): string {
  const variantes = contenu?.cta?.[marque]?.[platform] ?? []
  if (variantes.length === 0) return ''
  return variantes[rang % variantes.length]
}

/** Assemble le texte final : legende, appel a l'action, lien. */
export function assembler(
  caption: string,
  cta: string,
  lien: string,
  position: 'debut' | 'fin',
): string {
  const bloc = [cta, lien].filter((x) => x && x.trim()).join(' ')
  if (!bloc) return caption
  return position === 'debut' ? `${bloc}\n\n${caption}` : `${caption}\n\n${bloc}`
}

// ---------------------------------------------------------------------------
// Quotas
// ---------------------------------------------------------------------------

/**
 * Ce qui reste possible aujourd'hui sur une plateforme.
 *
 * YouTube compte a part : son quota est celui du projet Google, partage par
 * toutes les chaines, et il se lit dans quota_usage. Les autres se comptent
 * par compte sur 24 h glissantes.
 */
async function placeRestante(
  db: SupabaseClient,
  platform: string,
  accountId: string,
  limites: Record<string, number>,
): Promise<number> {
  if (platform === 'youtube') {
    const { data } = await db.rpc('quota_du_jour', { p_platform: 'youtube' })
    const consomme = Number(data ?? 0)
    return Math.floor((QUOTA_YOUTUBE - consomme) / COUT_YOUTUBE)
  }

  const depuis = new Date(Date.now() - 86_400_000).toISOString()
  const { count } = await db
    .from('posts')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .in('status', ['pending', 'processing', 'published'])
    .gte('scheduled_at', depuis)

  return (limites[platform] ?? 25) - (count ?? 0)
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

type CorpsImport = {
  fichier: string
  dossier?: string
  taille?: number
  video_url: string
  /** Renseigne quand le dossier impose une marque. */
  marque?: string
  profil?: string
}

async function importer(db: SupabaseClient, body: CorpsImport) {
  const config = await lireConfig(db)

  if (config.actif === false) {
    return json({ ok: false, error: "L'automatisation est suspendue dans l'application" }, 409)
  }

  const lecture = lireNom(body.fichier, config.nommage)

  // La marque du dossier l'emporte : c'est le reglage le plus explicite.
  let marque = (body.marque ?? '').trim() || lecture.marque
  let langue = lecture.langue
  let sujet = lecture.sujet

  const manquants = [...lecture.manquants]
  if (body.marque) {
    const i = manquants.indexOf('marque')
    if (i !== -1) manquants.splice(i, 1)
  }

  if (manquants.length > 0) {
    if (config.nommage.surNonConforme === 'rejeter') {
      await journal(db, body, 'rejete', `nom non conforme, il manque : ${manquants.join(', ')}`, {
        marque,
        sujet,
        langue,
      })
      return json({
        ok: false,
        rejete: true,
        error: `Nom non conforme, il manque : ${manquants.join(', ')}`,
      })
    }
    marque = marque || config.nommage.defauts.marque
    langue = langue || config.nommage.defauts.langue
    sujet = sujet || body.fichier.replace(/\.[^.]+$/, '').replace(/[-_+]/g, ' ')
  }

  if (!marque) {
    await journal(db, body, 'rejete', 'aucune marque, ni dans le nom ni en valeur par defaut', {})
    return json({ ok: false, rejete: true, error: 'Aucune marque determinee' })
  }
  if (!sujet) {
    await journal(db, body, 'rejete', 'aucun sujet lisible dans le nom', { marque })
    return json({ ok: false, rejete: true, error: 'Aucun sujet determine' })
  }

  // ---- les comptes vises -------------------------------------------------

  const { data: comptes } = await db
    .from('accounts')
    .select('id, platform, brand, account_name, language, status')

  const profil = config.profils?.find((p) => p.nom === body.profil) ?? null
  let cibles = ciblesPour((comptes ?? []) as Compte[], marque, profil)

  if (cibles.length === 0) {
    await journal(db, body, 'rejete', `aucun compte actif pour la marque ${marque}`, {
      marque,
      sujet,
      langue,
    })
    return json({ ok: false, rejete: true, error: `Aucun compte actif pour ${marque}` })
  }

  // ---- les quotas --------------------------------------------------------

  const { data: reglages } = await db.from('app_settings').select('value').eq('key', 'limits').single()
  const limites = (reglages?.value ?? {}) as Record<string, number>

  const ecartees: string[] = []
  const retenues: Compte[] = []

  for (const c of cibles) {
    const place = await placeRestante(db, c.platform, c.id, limites)
    if (place > 0) {
      retenues.push(c)
      continue
    }
    if (config.quotas?.surDepassement === 'ignorer') {
      ecartees.push(`${c.account_name} (${c.platform}, quota atteint, ignore)`)
    } else {
      // Reporter : on garde la cible, le creneau tombera demain de toute
      // facon puisque la cadence du jour est deja pleine.
      retenues.push(c)
      ecartees.push(`${c.account_name} (${c.platform}, quota atteint, reporte)`)
    }
  }
  cibles = retenues

  if (cibles.length === 0) {
    await journal(db, body, 'rejete', 'toutes les plateformes sont au quota', { marque, sujet, langue })
    return json({ ok: false, rejete: true, error: 'Toutes les plateformes sont au quota' })
  }

  // ---- le creneau --------------------------------------------------------

  const { data: prevus } = await db
    .from('posts')
    .select('scheduled_at, accounts!inner(brand)')
    .in('status', ['a_valider', 'pending', 'processing'])
    .gte('scheduled_at', new Date().toISOString())

  const dejaParJour: Record<string, number> = {}
  for (const p of (prevus ?? []) as Array<{ scheduled_at: string; accounts: { brand: string } }>) {
    if (p.accounts?.brand !== marque) continue
    const cle = cleJour(new Date(p.scheduled_at))
    dejaParJour[cle] = (dejaParJour[cle] ?? 0) + 1
  }

  const depart = prochainCreneau(config.cadence, dejaParJour, marque, new Date())
  const ecart = config.cadence?.ecartMinutes ?? 15

  // ---- les textes --------------------------------------------------------

  const langueDe = (c: Compte) => langue || c.language || 'fr'

  const generation = await fetch(`${SUPABASE_URL}/functions/v1/generate-caption`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject: sujet,
      targets: cibles.map((c) => ({
        id: c.id,
        platform: c.platform,
        brand: c.brand,
        account_name: c.account_name,
        language: langueDe(c),
        youtube_type: c.platform === 'youtube' ? 'short' : undefined,
      })),
    }),
  })

  const textes = await generation.json().catch(() => ({}))
  if (!generation.ok || !Array.isArray(textes.results)) {
    await journal(db, body, 'rejete', `generation des textes impossible : ${textes.error ?? generation.status}`, {
      marque,
      sujet,
      langue,
    })
    return json({ ok: false, rejete: true, error: textes.error ?? 'Generation impossible' }, 502)
  }

  const parId = new Map(
    (textes.results as Array<{ id: string; caption: string; hashtags: string[]; title?: string }>)
      .map((r) => [r.id, r]),
  )

  // ---- l'ecriture --------------------------------------------------------

  // Le rang sert a alterner les appels a l'action : on compte ce qui existe
  // deja pour ce couple marque plus plateforme.
  const { count: rangBase } = await db
    .from('posts')
    .select('id', { count: 'exact', head: true })
    .not('campaign_id', 'is', null)

  const validation =
    config.validation?.parMarque?.[marque] ?? config.validation?.parDefaut ?? true

  const campaignId = crypto.randomUUID()
  const lignes = cibles.map((c, i) => {
    const texte = parId.get(c.id)
    const cta = choisirCta(config.contenu, marque, c.platform, (rangBase ?? 0) + i)
    const lien = config.contenu?.liens?.[marque]?.[c.platform] ?? ''

    return {
      campaign_id: campaignId,
      account_id: c.id,
      video_url: body.video_url,
      caption: assembler(texte?.caption ?? '', cta, lien, config.contenu?.position ?? 'fin'),
      hashtags: texte?.hashtags?.length ? texte.hashtags : null,
      title: c.platform === 'youtube' ? (texte?.title ?? null) : null,
      youtube_type: c.platform === 'youtube' ? 'short' : null,
      language: langueDe(c),
      scheduled_at: new Date(depart.getTime() + i * ecart * 60_000).toISOString(),
      status: validation ? 'a_valider' : 'pending',
    }
  })

  const { data: crees, error } = await db.from('posts').insert(lignes).select('id')
  if (error) {
    await journal(db, body, 'rejete', `ecriture impossible : ${error.message}`, { marque, sujet, langue })
    return json({ ok: false, error: error.message }, 500)
  }

  await journal(db, body, 'importe', ecartees.join(' ; ') || null, {
    marque,
    sujet,
    langue,
    campaign_id: campaignId,
    video_url: body.video_url,
    publications: crees?.length ?? 0,
  })

  if (validation) {
    await notifyTelegram(
      [
        `📋 Campagne a valider : ${marque}`,
        `Sujet : ${sujet}`,
        `${crees?.length ?? 0} publication(s), a partir du ${depart.toLocaleString('fr-FR')}`,
        `Fichier : ${body.fichier}`,
        '',
        'Relis les textes dans BubuPost, onglet Automatisation, avant qu ils partent.',
      ].join('\n'),
      db,
    )
  }

  return json({
    ok: true,
    campaign_id: campaignId,
    marque,
    sujet,
    langue,
    publications: crees?.length ?? 0,
    premiere: depart.toISOString(),
    a_valider: validation,
    avertissements: ecartees,
  })
}

async function journal(
  db: SupabaseClient,
  body: CorpsImport,
  statut: 'importe' | 'rejete',
  raison: string | null,
  extra: Record<string, unknown>,
) {
  await db.from('imports').upsert(
    {
      cle: `${body.fichier}#${body.taille ?? 0}`,
      fichier: body.fichier,
      dossier: body.dossier ?? null,
      taille: body.taille ?? null,
      statut,
      raison,
      ...extra,
    },
    { onConflict: 'cle' },
  )
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Deux appelants possibles : le watcher avec son secret, ou Diego depuis
  // l'application avec sa session (pour rejouer un fichier rejete).
  const secret = req.headers.get('x-bubupost-watcher') ?? ''
  const bearer = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()

  let appelant: 'watcher' | 'app' | null = null

  if (WATCHER_TOKEN && secret && memeSecret(secret, WATCHER_TOKEN)) {
    appelant = 'watcher'
  } else if (bearer && bearer !== ANON_KEY) {
    if (bearer === SERVICE_KEY || jwtRole(bearer) === 'service_role') {
      appelant = 'app'
    } else {
      const check = createClient(SUPABASE_URL, ANON_KEY)
      const { data, error } = await check.auth.getUser(bearer)
      if (!error && data.user) appelant = 'app'
    }
  }

  if (!appelant) return json({ error: 'Non autorise' }, 401)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Corps de requete illisible' }, 400)
  }

  const action = String(body.action ?? '')

  try {
    switch (action) {
      case 'config': {
        await signeDeVie(db, body)
        const config = await lireConfig(db)
        const dossiers = await lireDossiers(db)
        return json({
          ok: true,
          actif: config.actif !== false,
          intervalleSecondes: 60,
          // Le watcher n'a pas besoin de tout : seulement ou regarder, quoi
          // accepter comme nom, et a quelle marque rattacher.
          dossiers: dossiers.filter((d) => d.actif),
          extensions: ['.mp4', '.mov', '.m4v'],
        })
      }

      case 'ping': {
        await signeDeVie(db, body)
        return json({ ok: true })
      }

      case 'upload-url': {
        const fichier = String(body.fichier ?? '')
        if (!fichier) return json({ error: 'Nom de fichier manquant' }, 400)

        const ext = (fichier.split('.').pop() ?? 'mp4').toLowerCase()
        const chemin = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`

        const { data, error } = await db.storage.from('videos').createSignedUploadUrl(chemin)
        if (error) return json({ error: error.message }, 500)

        return json({
          ok: true,
          chemin,
          signedUrl: data.signedUrl,
          token: data.token,
          video_url: db.storage.from('videos').getPublicUrl(chemin).data.publicUrl,
        })
      }

      case 'tester-nom': {
        // Reserve a l'application : le watcher n'a rien a tester, il envoie.
        if (appelant !== 'app') return json({ error: 'Non autorise' }, 403)
        const config = await lireConfig(db)
        return json({ ok: true, lecture: lireNom(String(body.fichier ?? ''), config.nommage) })
      }

      case 'import':
        return await importer(db, body as unknown as CorpsImport)

      default:
        return json({ error: `Action inconnue : ${action}` }, 400)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('watcher', action, message)
    return json({ error: message }, 500)
  }
})

async function signeDeVie(db: SupabaseClient, body: Record<string, unknown>) {
  await db.from('watcher_ping').upsert({
    id: true,
    vu_a: new Date().toISOString(),
    version: String(body.version ?? ''),
    dossiers: Number(body.dossiers ?? 0),
    detail: (body.detail ?? null) as Record<string, unknown> | null,
  })
}
