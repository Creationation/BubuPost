// Transforme un jeton Meta recu dans le navigateur en compte Instagram
// utilisable pour publier.
//
// Le jeton arrive du fragment d'URL, donc le navigateur est le seul a l'avoir
// vu. Il nous l'envoie, on en tire le Page Access Token, et rien ne repart :
// la reponse ne contient jamais de jeton.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import {
  MetaError,
  explain,
  expirationReelle,
  pagesAvecInstagram,
  prolongerJeton,
  type PageInstagram,
} from '../_shared/meta-oauth.ts'
import { diagnostiquer } from '../_shared/meta-diagnostic.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

type Db = ReturnType<typeof createClient>

/** Cree ou met a jour un compte, identifie par sa plateforme et son id externe. */
async function poser(
  db: Db,
  valeurs: Record<string, unknown>,
  platform: string,
  externalId: string,
): Promise<boolean> {
  const { data: existant } = await db
    .from('accounts')
    .select('id')
    .eq('platform', platform)
    .eq('external_account_id', externalId)
    .maybeSingle()

  if (existant?.id) {
    const { error } = await db.from('accounts').update(valeurs).eq('id', existant.id)
    if (error) throw new MetaError(error.message, 'db')
    return true
  }

  const { error } = await db.from('accounts').insert(valeurs)
  if (error) throw new MetaError(error.message, 'db')
  return false
}

/**
 * Enregistre le compte Instagram, et la Page Facebook qui va avec.
 *
 * Deux lignes distinctes pour un seul jeton : Instagram publie sur le compte
 * professionnel, Facebook Reels publie sur la Page, et les identifiants ne
 * sont pas les memes. Les separer permet de programmer une video sur l'un sans
 * l'autre, avec sa propre heure et sa propre legende.
 */
async function enregistrer(
  db: Db,
  page: PageInstagram,
  brand: string,
  userToken: string,
  expiry: string | null,
): Promise<{ nom: string; misAJour: boolean; facebook: string | null }> {
  const nom = page.ig_username ? `@${page.ig_username}` : page.page_name

  const commun = {
    brand,
    // C'est le jeton de la Page qui publie, des deux cotes.
    access_token: page.page_access_token,
    // Le jeton utilisateur sert a regenerer celui de la Page : sans lui, le
    // renouvellement automatique serait impossible.
    refresh_token: userToken,
    token_expiry: expiry,
    status: 'active',
  }

  const misAJour = await poser(
    db,
    { ...commun, platform: 'instagram', account_name: nom, external_account_id: page.ig_user_id },
    'instagram',
    page.ig_user_id,
  )

  // La Page Facebook, seulement si on la connait : le troisieme chemin de
  // secours peut renvoyer un compte Instagram sans Page associee.
  let facebook: string | null = null
  if (page.page_id) {
    facebook = page.page_name
    await poser(
      db,
      {
        ...commun,
        platform: 'facebook',
        account_name: page.page_name,
        external_account_id: page.page_id,
      },
      'facebook',
      page.page_id,
    )
  }

  return { nom, misAJour, facebook }
}

/** Une seule phrase, qu'il y ait une ou deux lignes creees. */
function messageFinal(nom: string, misAJour: boolean, facebook: string | null): string {
  const verbe = misAJour ? 'a ete reconnecte' : 'a ete ajoute'
  if (facebook) {
    return `Le compte ${nom} ${verbe}, ainsi que la Page Facebook ${facebook} pour les Reels.`
  }
  return `Le compte ${nom} ${verbe} et il est actif.`
}

/** Message pour une selection de plusieurs comptes d'un coup. */
function messageGroupe(
  resultats: Array<{ nom: string; misAJour: boolean; facebook: string | null }>,
): string {
  if (resultats.length === 1) {
    const r = resultats[0]
    return messageFinal(r.nom, r.misAJour, r.facebook)
  }

  const noms = resultats.map((r) => r.nom).join(', ')
  const pages = resultats.filter((r) => r.facebook).length

  return pages > 0
    ? `${resultats.length} comptes connectes : ${noms}. Leurs ${pages} Pages Facebook sont ajoutees pour les Reels.`
    : `${resultats.length} comptes connectes : ${noms}.`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // Autorisation avant tout appel externe.
  const bearer = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
  const auth = createClient(SUPABASE_URL, ANON_KEY)
  const { data: userData, error: userErr } = await auth.auth.getUser(bearer)
  if (userErr || !userData.user) return json({ ok: false, error: 'Non autorise' }, 401)

  let body: {
    token?: string
    brand?: string
    expires_in?: number
    data_access_expiration_time?: number
    /** Choix de l'utilisateur quand plusieurs Pages sont disponibles. */
    ig_user_id?: string
    /** Selection multiple. L'ancien champ singulier reste accepte. */
    ig_user_ids?: string[]
  }
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'Corps de requete illisible' }, 400)
  }

  const token = (body.token ?? '').trim()
  if (!token) return json({ ok: false, error: 'Le jeton Meta est manquant' }, 400)

  const brand = (body.brand ?? '').trim() || 'Instagram'

  try {
    // Si le jeton est deja de longue duree, Meta renvoie simplement le meme
    // avec sa duree restante : l'appel est sans risque et evite d'avoir a
    // deviner de quel type de jeton il s'agit.
    let userToken = token
    let expiresIn = body.expires_in ?? null
    try {
      const prolonge = await prolongerJeton(token)
      userToken = prolonge.token
      expiresIn = prolonge.expiresIn ?? expiresIn
    } catch (err) {
      // Un echec ici n'est pas bloquant : on continue avec le jeton recu, la
      // connexion aboutira, simplement avec une echeance plus courte.
      console.warn('Prolongation impossible', err instanceof Error ? err.message : err)
    }

    // On demande l'echeance a Meta plutot que de la deduire du fragment : ce
    // dernier porte celle du jeton court, une ou deux heures, alors qu'on
    // detient un jeton valable soixante jours.
    const expiry =
      (await expirationReelle(userToken)) ??
      (body.data_access_expiration_time
        ? new Date(body.data_access_expiration_time * 1000).toISOString()
        : expiresIn
          ? new Date(Date.now() + expiresIn * 1000).toISOString()
          : null)

    const pages = await pagesAvecInstagram(userToken)

    console.log(
      'Connexion Meta',
      JSON.stringify({
        pages: pages.length,
        comptes: pages.map((p) => p.ig_username ?? p.ig_user_id),
        expire_le: expiry,
      }),
    )

    const db = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // Choix deja fait par l'utilisateur, un compte ou plusieurs.
    const choisis = body.ig_user_ids?.length
      ? body.ig_user_ids
      : body.ig_user_id
        ? [body.ig_user_id]
        : []

    if (choisis.length > 0) {
      const retenues = pages.filter((p) => choisis.includes(p.ig_user_id))
      if (retenues.length === 0) {
        return json(
          { ok: false, error: "Aucun des comptes choisis n'est plus accessible" },
          400,
        )
      }

      // En serie, pas en parallele : chaque enregistrement lit puis ecrit dans
      // accounts, et deux ecritures simultanees sur la meme Page creeraient un
      // doublon au lieu d'une mise a jour.
      const resultats = []
      for (const page of retenues) {
        resultats.push(await enregistrer(db, page, brand, userToken, expiry))
      }

      const manquants = choisis.length - retenues.length

      return json({
        ok: true,
        account_name: resultats[0].nom,
        comptes_connectes: resultats.length,
        message:
          manquants > 0
            ? `${messageGroupe(resultats)} ${manquants} compte(s) n'etaient plus accessibles.`
            : messageGroupe(resultats),
      })
    }

    // Plusieurs Pages : on laisse choisir plutot que de tout importer.
    if (pages.length > 1) {
      return json({
        ok: true,
        choix_requis: true,
        // Aucun jeton ici, seulement de quoi afficher la liste.
        comptes: pages.map((p) => ({
          ig_user_id: p.ig_user_id,
          ig_username: p.ig_username,
          page_name: p.page_name,
        })),
        message: 'Plusieurs comptes Instagram sont disponibles, choisis celui a connecter.',
      })
    }

    const { nom, misAJour, facebook } = await enregistrer(db, pages[0], brand, userToken, expiry)
    return json({
      ok: true,
      account_name: nom,
      message: messageFinal(nom, misAJour, facebook),
    })
  } catch (err) {
    const e = err instanceof MetaError ? err : null
    console.error('Connexion Meta en echec', e?.code, e?.message)

    // Un echec sur les Pages ne se diagnostique pas depuis l'exterieur : le
    // jeton n'existe que le temps de cet appel. On interroge donc Meta tout de
    // suite, sous tous les angles, et on range le resultat brut pour pouvoir
    // le relire. Les jetons y sont caviardes.
    if (e && (e.code === 'aucune_page' || e.code === 'aucun_instagram')) {
      try {
        const diagnostic = await diagnostiquer(token)
        console.log('Diagnostic Meta', JSON.stringify(diagnostic))

        const db = createClient(SUPABASE_URL, SERVICE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
        await db
          .from('app_settings')
          .upsert(
            { key: 'diagnostic_meta', value: diagnostic as never, updated_at: new Date().toISOString() },
            { onConflict: 'key' },
          )
      } catch (err2) {
        console.error('Diagnostic impossible', String(err2))
      }
    }

    return json(
      {
        ok: false,
        error: e ? explain(e.message, e.code) : String(err),
        technical: e ? `${e.code}: ${e.message}` : undefined,
        diagnostic_enregistre: e?.code === 'aucune_page' || e?.code === 'aucun_instagram',
      },
      e?.code === 'missing_secrets' ? 500 : 400,
    )
  }
})
