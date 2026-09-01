// TikTok via la Content Posting API, en mode FILE_UPLOAD : on telecharge la
// video depuis le bucket et on envoie les octets nous-memes.
//
// Pourquoi pas PULL_FROM_URL, plus simple : TikTok exige alors que le domaine
// hebergeant la video soit verifie dans la console developpeur. Le domaine de
// Supabase Storage ne nous appartient pas, on ne peut donc pas le verifier, et
// l'API repond 403 "URL ownership verification rules".
//
// Attention : l'acces direct au post exige que l'app passe l'app review TikTok.
// Tant qu'elle n'est pas approuvee, l'API repond en mode sandbox et la video
// arrive dans les brouillons du compte au lieu d'etre publiee.
import {
  Account,
  MediaStatus,
  PlatformAdapter,
  PlatformError,
  apiFetch,
  requireToken,
} from './types.ts'

const API = 'https://open.tiktokapis.com/v2'

/**
 * Taille de morceau. TikTok impose entre 5 et 64 Mo.
 * On reste a 32 Mo : c'est le compromis entre le nombre d'allers-retours et la
 * memoire d'une Edge Function, qui ne tient jamais plus d'un morceau a la fois.
 */
const TAILLE_MORCEAU = 32 * 1024 * 1024

/** Au-dela, l'envoi depasserait le temps imparti a la fonction. */
const TAILLE_MAX = 300 * 1024 * 1024

function typeMime(url: string): string {
  const ext = new URL(url).pathname.split('.').pop()?.toLowerCase()
  if (ext === 'mov') return 'video/quicktime'
  if (ext === 'webm') return 'video/webm'
  return 'video/mp4'
}

/** Taille de la video, sans la telecharger. */
async function tailleVideo(url: string): Promise<number> {
  let res: Response
  try {
    res = await fetch(url, { method: 'HEAD' })
  } catch (err) {
    throw new PlatformError("TikTok : la video est injoignable a l'URL fournie", {
      retryable: true,
      detail: String(err),
    })
  }

  if (!res.ok) {
    throw new PlatformError(
      `TikTok : la video est introuvable a l'URL fournie (${res.status}). Verifie qu'elle est bien publique.`,
      { retryable: res.status >= 500 },
    )
  }

  const taille = Number(res.headers.get('content-length') ?? 0)
  if (!taille) {
    throw new PlatformError(
      "TikTok : impossible de connaitre la taille de la video. L'hebergeur ne renvoie pas sa taille, il faut une autre URL.",
      { retryable: false },
    )
  }
  if (taille > TAILLE_MAX) {
    throw new PlatformError(
      `TikTok : la video fait ${Math.round(taille / 1024 / 1024)} Mo, c'est trop lourd pour l'envoi automatique. Compresse-la sous 300 Mo.`,
      { retryable: false },
    )
  }
  return taille
}

/** Un morceau precis du fichier, sans charger le reste en memoire. */
async function lireMorceau(url: string, debut: number, fin: number): Promise<Uint8Array> {
  const res = await fetch(url, { headers: { Range: `bytes=${debut}-${fin}` } })
  if (!res.ok && res.status !== 206) {
    throw new PlatformError(`TikTok : lecture de la video impossible (${res.status})`, {
      retryable: true,
    })
  }
  return new Uint8Array(await res.arrayBuffer())
}

/** Decoupage attendu par TikTok : le dernier morceau absorbe le reste. */
function decouper(taille: number): { tailleMorceau: number; nombre: number } {
  if (taille <= TAILLE_MORCEAU) return { tailleMorceau: taille, nombre: 1 }
  const tailleMorceau = TAILLE_MORCEAU
  return { tailleMorceau, nombre: Math.floor(taille / tailleMorceau) }
}

/**
 * Les niveaux de confidentialite reellement ouverts a ce compte.
 * TikTok les fait varier selon le compte et selon que l'application a passe
 * ou non l'app review : les deviner mene a un refus incomprehensible.
 */
async function niveauxAutorises(token: string): Promise<string[]> {
  const json = await apiFetch(
    `${API}/post/publish/creator_info/query/`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
    },
    'TikTok lecture des options de publication',
  )
  const data = (json.data ?? {}) as Record<string, unknown>
  const options = data.privacy_level_options
  return Array.isArray(options) ? (options as string[]) : []
}

/**
 * Traduit les refus propres a la Content Posting API.
 *
 * On lit le champ error.code du corps, pas seulement le message : TikTok met
 * la raison exploitable dans le code, et se contente d'un renvoi vers sa
 * documentation dans le message, qui ne dit rien a personne.
 */
function traduireRefus(message: string, detail: unknown): string | null {
  const codeApi =
    detail && typeof detail === 'object'
      ? String(((detail as Record<string, never>).error as Record<string, never>)?.code ?? '')
      : ''
  const m = `${codeApi} ${message}`.toLowerCase()

  if (m.includes('unaudited_client_can_only_post_to_private_accounts')) {
    return [
      "TikTok bloque la publication parce que l'application n'a pas encore passe l'app review.",
      'Tant que ce n est pas fait, elle ne peut publier que sur un compte TikTok prive.',
      'Deux solutions : passer le compte en prive dans les reglages TikTok pour tester,',
      "ou attendre l'approbation de l'application pour publier sur un compte public.",
    ].join(' ')
  }
  if (m.includes('url_ownership_unverified')) {
    return "TikTok refuse de telecharger la video depuis notre hebergeur. L'application doit envoyer les octets elle-meme, previens-moi si tu vois ce message."
  }
  if (m.includes('spam_risk_too_many_posts')) {
    return 'TikTok a bloque la publication pour cause de trop nombreux envois recents. Espace les publications sur ce compte.'
  }
  if (m.includes('spam_risk_user_banned_from_posting')) {
    return "Ce compte TikTok est temporairement interdit de publication par TikTok. Rien a corriger de notre cote."
  }
  if (m.includes('reached_active_user_cap')) {
    return "Le quota d'utilisateurs de l'application en bac a sable est atteint. Il se libere chaque jour."
  }
  if (m.includes('privacy_level_option_mismatch')) {
    return "Le niveau de confidentialite demande n'est pas propose a ce compte. Reessaie, l'application le choisit maintenant automatiquement."
  }
  return null
}

/**
 * Motifs de rejet apres analyse de la video par TikTok.
 * Ils arrivent en anglais et sans contexte, alors que ce sont les erreurs que
 * Diego rencontrera le plus souvent.
 */
function traduireRejet(motif: string): string {
  const messages: Record<string, string> = {
    file_format_check_failed:
      "TikTok n'a pas reconnu le format du fichier. Il attend un MP4 ou un MOV avec une video et un son valides. Reexporte la video et reessaie.",
    duration_check_failed:
      'La duree de la video sort des limites acceptees par TikTok pour ce compte.',
    frame_rate_check_failed:
      "Le nombre d'images par seconde n'est pas accepte. Reexporte entre 23 et 60 images par seconde.",
    picture_size_check_failed:
      "Les dimensions de la video ne conviennent pas. Vise du 1080 sur 1920, en format vertical.",
    video_pull_failed: "TikTok n'a pas reussi a recuperer la video envoyee. Reessaie.",
    publish_cancelled: 'La publication a ete annulee cote TikTok.',
    internal: "Panne interne chez TikTok. Ce n'est pas ta video, reessaie plus tard.",
  }
  return messages[motif] ?? `TikTok a rejete la video : ${motif || 'raison inconnue'}`
}

export const tiktok: PlatformAdapter = {
  label: 'TikTok',

  async createContainer(account: Account, videoUrl: string, caption: string): Promise<string> {
    const token = requireToken(account)
    const taille = await tailleVideo(videoUrl)
    const { tailleMorceau, nombre } = decouper(taille)

    // Confidentialite : SELF_ONLY tant que l'application n'est pas auditee.
    //
    // C'est une exigence de l'API elle-meme, pas un reglage du compte : une
    // application non auditee ne peut publier qu'en visible par le proprietaire
    // seul. Demander PUBLIC_TO_EVERYONE avant l'audit fait echouer la
    // publication, meme si le compte propose l'option.
    //
    // A REVOIR APRES L'APP REVIEW : mettre TIKTOK_AUDITED=1 en secret Supabase.
    // La publication passera alors au niveau le plus ouvert que TikTok declare
    // pour ce compte, sans toucher au code. On interroge creator_info avant
    // chaque publication car ces options varient d'un compte a l'autre et dans
    // le temps.
    const niveaux = await niveauxAutorises(token)
    const auditee = Deno.env.get('TIKTOK_AUDITED') === '1'

    let confidentialite = 'SELF_ONLY'
    if (auditee && niveaux.includes('PUBLIC_TO_EVERYONE')) {
      confidentialite = 'PUBLIC_TO_EVERYONE'
    } else if (!niveaux.includes('SELF_ONLY') && niveaux.length > 0) {
      // Ce compte ne propose pas SELF_ONLY : on prend ce qu'il offre plutot que
      // d'envoyer une valeur que TikTok rejettera.
      confidentialite = niveaux[0]
    }

    // 1. Ouvrir la session : TikTok renvoie un publish_id et une URL d'envoi.
    let init: Record<string, unknown>
    try {
      init = await apiFetch(
        `${API}/post/publish/video/init/`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json; charset=UTF-8',
          },
          body: JSON.stringify({
            post_info: {
              title: caption.slice(0, 2200),
              privacy_level: confidentialite,
              disable_duet: false,
              disable_comment: false,
              disable_stitch: false,
            },
            source_info: {
              source: 'FILE_UPLOAD',
              video_size: taille,
              chunk_size: tailleMorceau,
              total_chunk_count: nombre,
            },
          }),
        },
        'TikTok initialisation de la publication',
      )
    } catch (err) {
      const brut = err instanceof Error ? err.message : String(err)
      const detail = err instanceof PlatformError ? err.detail : null
      const clair = traduireRefus(brut, detail)
      if (clair) {
        throw new PlatformError(clair, { retryable: false, detail: detail ?? brut })
      }
      throw err
    }

    const data = (init.data ?? {}) as Record<string, unknown>
    const publishId = data.publish_id
    const uploadUrl = data.upload_url

    if (typeof publishId !== 'string' || typeof uploadUrl !== 'string') {
      throw new PlatformError("TikTok n'a pas renvoye d'URL d'envoi", { detail: init })
    }

    // 2. Envoyer les octets, morceau par morceau.
    const mime = typeMime(videoUrl)
    for (let i = 0; i < nombre; i++) {
      const debut = i * tailleMorceau
      const fin = i === nombre - 1 ? taille - 1 : debut + tailleMorceau - 1
      const octets = await lireMorceau(videoUrl, debut, fin)

      let res: Response
      try {
        res = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': mime,
            'Content-Length': String(octets.byteLength),
            'Content-Range': `bytes ${debut}-${fin}/${taille}`,
          },
          body: octets,
        })
      } catch (err) {
        throw new PlatformError(`TikTok : envoi du morceau ${i + 1} sur ${nombre} interrompu`, {
          retryable: true,
          detail: String(err),
        })
      }

      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300)
        throw new PlatformError(
          `TikTok : envoi du morceau ${i + 1} sur ${nombre} refuse (${res.status})`,
          { retryable: res.status === 429 || res.status >= 500, detail },
        )
      }
    }

    return publishId
  },

  async checkStatus(account: Account, containerId: string): Promise<MediaStatus> {
    const token = requireToken(account)

    const json = await apiFetch(
      `${API}/post/publish/status/fetch/`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({ publish_id: containerId }),
      },
      'TikTok statut de la publication',
    )

    const data = (json.data ?? {}) as Record<string, unknown>
    switch (data.status) {
      case 'PUBLISH_COMPLETE':
      case 'SEND_TO_USER_INBOX':
        return 'ready'
      case 'FAILED':
        throw new PlatformError(traduireRejet(String(data.fail_reason ?? '')), { detail: json })
      default:
        return 'processing'
    }
  },

  // TikTok publie de lui-meme des que le traitement est termine : il n'y a pas
  // d'etape de publication separee. On se contente de renvoyer l'identifiant.
  publish(_account: Account, containerId: string): Promise<string> {
    return Promise.resolve(containerId)
  },

  /**
   * Verification par l'endpoint de publication plutot que par le profil.
   *
   * C'est lui qui compte : il ne repond que si video.publish est reellement
   * accorde, donc un succes ici prouve que le compte peut publier. Il renvoie
   * en prime le nom d'utilisateur, sans exiger le scope user.info.profile.
   *
   * Ne jamais revenir a /user/info/?fields=...,username : le champ username
   * demande le scope user.info.profile, que l'application ne requiert pas. Un
   * seul champ non autorise fait echouer toute la requete en
   * scope_not_authorized, et le compte etait affiche en erreur alors que tout
   * fonctionnait.
   */
  async verify(account: Account): Promise<string> {
    const token = requireToken(account)

    const json = await apiFetch(
      `${API}/post/publish/creator_info/query/`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
      },
      'TikTok verification du droit de publier',
    )

    const data = (json.data ?? {}) as Record<string, unknown>
    const username = data.creator_username
    const nickname = data.creator_nickname

    if (typeof username === 'string' && username) return `@${username}`
    if (typeof nickname === 'string' && nickname) return nickname

    throw new PlatformError(
      "TikTok accepte le token mais ne renvoie pas le nom du compte. Reconnecte le compte depuis le bouton Connecter un compte TikTok.",
      { detail: json },
    )
  },
}
