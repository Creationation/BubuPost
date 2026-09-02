// Instagram Reels via la Graph API (Content Publishing).
// Flux en trois temps : creation du conteneur, attente du traitement, publication.
import {
  Account,
  MediaStatus,
  PlatformAdapter,
  PlatformError,
  apiFetch,
  requireExternalId,
  requireToken,
} from './types.ts'

const GRAPH = 'https://graph.facebook.com/v21.0'

export const instagram: PlatformAdapter = {
  label: 'Instagram',

  async createContainer(account: Account, videoUrl: string, caption: string): Promise<string> {
    const token = requireToken(account)
    const igUserId = requireExternalId(account)

    const body = new URLSearchParams({
      media_type: 'REELS',
      video_url: videoUrl,
      caption,
      share_to_feed: 'true',
      access_token: token,
    })

    const json = await apiFetch(
      `${GRAPH}/${igUserId}/media`,
      { method: 'POST', body },
      'Instagram creation du conteneur',
    )

    const id = json.id
    if (typeof id !== 'string') {
      throw new PlatformError('Instagram n\'a pas renvoye d\'identifiant de conteneur', {
        detail: json,
      })
    }
    return id
  },

  async checkStatus(account: Account, containerId: string): Promise<MediaStatus> {
    const token = requireToken(account)
    const json = await apiFetch(
      `${GRAPH}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(token)}`,
      { method: 'GET' },
      'Instagram statut du conteneur',
    )

    switch (json.status_code) {
      case 'FINISHED':
        return 'ready'
      case 'IN_PROGRESS':
        return 'processing'
      case 'ERROR':
      case 'EXPIRED':
        throw new PlatformError(
          `Instagram a rejete la video : ${json.status ?? json.status_code}`,
          { detail: json },
        )
      default:
        return 'processing'
    }
  },

  async publish(account: Account, containerId: string): Promise<string> {
    const token = requireToken(account)
    const igUserId = requireExternalId(account)

    const body = new URLSearchParams({ creation_id: containerId, access_token: token })
    const json = await apiFetch(
      `${GRAPH}/${igUserId}/media_publish`,
      { method: 'POST', body },
      'Instagram publication',
    )

    const id = json.id
    if (typeof id !== 'string') {
      throw new PlatformError('Instagram n\'a pas renvoye d\'identifiant de publication', {
        detail: json,
      })
    }
    return id
  },

  /**
   * Verification en deux temps : le compte repond, et il a le droit de publier.
   *
   * Ne jamais demander le champ account_type : il appartient a l'Instagram
   * Basic Display API, pas a la Graph API des comptes professionnels. Un seul
   * champ inexistant fait echouer TOUTE la requete en erreur #100, et le
   * compte etait affiche comme n'ayant pas les droits alors que tout marchait.
   * Meme piege que le champ username cote TikTok.
   */
  async verify(account: Account): Promise<string> {
    const token = requireToken(account)
    const igUserId = requireExternalId(account)
    const t = encodeURIComponent(token)

    const json = await apiFetch(
      `${GRAPH}/${igUserId}?fields=username,name&access_token=${t}`,
      { method: 'GET' },
      'Instagram verification du compte',
    )

    if (typeof json.username !== 'string') {
      throw new PlatformError(
        "Instagram repond, mais cet identifiant n'est pas un compte professionnel. Reconnecte le compte depuis le bouton Connecter un compte Instagram.",
        { detail: json },
      )
    }

    // Cet endpoint n'existe que si instagram_content_publish est reellement
    // accorde : un succes ici prouve le droit de publier, au lieu de le
    // supposer. Il donne en prime le quota tel que Meta le compte.
    await apiFetch(
      `${GRAPH}/${igUserId}/content_publishing_limit?fields=config,quota_usage&access_token=${t}`,
      { method: 'GET' },
      'Instagram verification du droit de publier',
    )

    return `@${json.username}`
  },
}
