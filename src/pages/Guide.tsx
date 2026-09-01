import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { listAccounts, setupStatus, type SetupStatus } from '../lib/api'
import { friendlyError } from '../lib/errors'
import { PLATFORMS, PLATFORM_ICON, type Account } from '../lib/types'
import { Alert, Loading, PageHeader } from '../components/ui'

/** Une ligne de la liste de controle : fait, ou pas encore. */
function Check({ done, label, hint }: { done: boolean; label: string; hint?: string }) {
  return (
    <li className="flex gap-3">
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] ${
          done
            ? 'border-ok-400/40 bg-ok-400/15 text-ok-400'
            : 'border-ink-600 bg-ink-800 text-mist-600'
        }`}
      >
        {done ? '✓' : ''}
      </span>
      <span className="min-w-0">
        <span className={done ? 'text-sm text-mist-500 line-through' : 'text-sm text-mist-100'}>
          {label}
        </span>
        {hint && !done && <span className="mt-0.5 block text-xs text-mist-500">{hint}</span>}
      </span>
    </li>
  )
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-ink-600 bg-ink-800 text-[11px] text-mist-400">
        {n}
      </span>
      <span className="min-w-0 text-sm leading-relaxed text-mist-300">{children}</span>
    </li>
  )
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="break-all rounded bg-ink-950/70 px-1.5 py-0.5 font-mono text-[12px] text-brand-400">
      {children}
    </code>
  )
}

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-brand-400 hover:underline">
      {children}
    </a>
  )
}

function Panel({
  title,
  badge,
  children,
  open,
  onToggle,
}: {
  title: string
  badge?: ReactNode
  children: ReactNode
  open: boolean
  onToggle: () => void
}) {
  return (
    <section className="panel overflow-hidden">
      <button
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-ink-800/40"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="flex items-center gap-3">
          <span className="font-semibold">{title}</span>
          {badge}
        </span>
        <span className="text-xs text-mist-600">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="border-t border-ink-800 px-5 py-5">{children}</div>}
    </section>
  )
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`chip ${
        ok
          ? 'border-ok-400/30 bg-ok-400/10 text-ok-400'
          : 'border-warn-400/30 bg-warn-400/10 text-warn-400'
      }`}
    >
      {label}
    </span>
  )
}

export default function Guide() {
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([setupStatus(), listAccounts()])
      .then(([s, a]) => {
        setStatus(s)
        setAccounts(a)
      })
      .catch((err) => setError(friendlyError(err)))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <Loading label="Verification de la configuration..." />

  const connected = (platform: string) =>
    accounts.some((a) => a.platform === platform && a.access_token)

  const toggle = (key: string) => setOpen((o) => (o === key ? null : key))

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Guide de mise en route"
        subtitle="Ce qui est deja fait, et ce qu'il reste a brancher"
      />

      {error && (
        <div className="mb-4">
          <Alert kind="error">{error}</Alert>
        </div>
      )}

      <section className="panel mb-6 p-5">
        <h2 className="mb-4 font-semibold">Ou tu en es</h2>
        <ul className="space-y-3">
          <Check done label="L'application est en ligne et tu es connecte" />
          <Check done label="Le scheduler tourne automatiquement, toutes les 5 minutes" />
          <Check
            done={Boolean(status?.anthropic)}
            label="Cle API Claude, pour ecrire les legendes toutes seules"
            hint="Sans elle, tu ecris tes legendes a la main. Voir la section plus bas."
          />
          <Check
            done={Boolean(status?.telegram)}
            label="Alertes Telegram quand une publication rate"
            hint="Sans elles, il faut penser a venir verifier le dashboard."
          />
          <Check
            done={accounts.length > 0}
            label="Au moins un compte de reseau social enregistre"
            hint="C'est l'etape principale. Choisis une plateforme ci-dessous."
          />
          <Check
            done={accounts.some((a) => a.status === 'active' && a.access_token)}
            label="Au moins un compte teste et actif"
            hint="Une fois le compte ajoute, clique sur Tester la connexion dans l'onglet Comptes."
          />
        </ul>

        <p className="mt-5 border-t border-ink-800 pt-4 text-xs text-mist-500">
          Tu n'as pas besoin de tout faire d'un coup. Une seule plateforme branchee suffit pour que
          l'application publie pour toi.
        </p>
      </section>

      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-mist-500">
        Les cles a fournir
      </h2>

      <div className="mb-6 space-y-3">
        <Panel
          title="Cle API Claude"
          badge={<Badge ok={Boolean(status?.anthropic)} label={status?.anthropic ? 'En place' : 'Manquante'} />}
          open={open === 'claude'}
          onToggle={() => toggle('claude')}
        >
          <p className="mb-4 text-sm text-mist-300">
            Elle sert uniquement au bouton "Generer la legende". Le reste de l'application marche
            sans. Le cout est de quelques centimes par mois.
          </p>
          <ol className="space-y-3">
            <Step n={1}>
              Va sur <Ext href="https://console.anthropic.com/settings/keys">console.anthropic.com</Ext>{' '}
              et clique sur "Create Key".
            </Step>
            <Step n={2}>
              Copie la cle, elle commence par <Code>sk-ant-</Code>. Elle ne sera plus jamais
              reaffichee, garde-la de cote.
            </Step>
            <Step n={3}>
              Envoie-la moi, ou colle-la dans{' '}
              <Code>Documents\BubuPost\Keys etc.txt</Code> et dis-moi de la prendre. Je la mets en
              place et je verifie qu'elle marche.
            </Step>
          </ol>
        </Panel>

        <Panel
          title="Alertes Telegram"
          badge={<Badge ok={Boolean(status?.telegram)} label={status?.telegram ? 'En place' : 'Manquante'} />}
          open={open === 'telegram'}
          onToggle={() => toggle('telegram')}
        >
          <p className="mb-4 text-sm text-mist-300">
            C'est ce qui t'evite de venir verifier l'application tous les jours : si une publication
            rate, tu recois un message.
          </p>
          <ol className="space-y-3">
            <Step n={1}>
              Dans Telegram, cherche <Code>@BotFather</Code> et envoie-lui <Code>/newbot</Code>.
            </Step>
            <Step n={2}>
              Donne un nom, puis un identifiant finissant par <Code>_bot</Code>. BotFather te
              repond avec un token.
            </Step>
            <Step n={3}>
              Envoie un simple "salut" a ton nouveau bot. Sans ce premier message, il n'a pas le
              droit de t'ecrire.
            </Step>
            <Step n={4}>
              Ouvre <Code>https://api.telegram.org/botTON_TOKEN/getUpdates</Code> dans ton
              navigateur, et releve le nombre affiche apres <Code>"chat":&#123;"id":</Code>.
            </Step>
            <Step n={5}>Donne-moi le token et ce nombre, je branche le tout.</Step>
          </ol>
        </Panel>
      </div>

      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-mist-500">
        Connecter tes comptes
      </h2>

      <div className="space-y-3">
        <Panel
          title="Instagram"
          badge={
            <Badge
              ok={connected('instagram')}
              label={connected('instagram') ? 'Connecte' : 'A faire, commence par la'}
            />
          }
          open={open === 'instagram'}
          onToggle={() => toggle('instagram')}
        >
          <p className="mb-4 text-sm text-mist-300">
            La mieux documentee des cinq. Ton compte Instagram doit etre un compte Professionnel et
            etre relie a une Page Facebook, sinon l'API de publication n'existe pas.
          </p>
          <ol className="space-y-3">
            <Step n={1}>
              Sur <Ext href="https://developers.facebook.com/apps">developers.facebook.com</Ext>,
              cree une app de type "Business".
            </Step>
            <Step n={2}>
              Ajoute les produits "Instagram Graph API" et "Facebook Login".
            </Step>
            <Step n={3}>
              Dans{' '}
              <Ext href="https://developers.facebook.com/tools/explorer">l'explorateur d'API</Ext>,
              genere un token avec les permissions <Code>instagram_basic</Code>,{' '}
              <Code>instagram_content_publish</Code>, <Code>pages_show_list</Code>,{' '}
              <Code>pages_read_engagement</Code>.
            </Step>
            <Step n={4}>
              Ce token ne dure qu'une heure. Echange-le contre un token de 60 jours avec l'URL{' '}
              <Code>
                graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=...&client_secret=...&fb_exchange_token=...
              </Code>
            </Step>
            <Step n={5}>
              Recupere ton IG User ID : appelle <Code>me/accounts</Code> pour l'ID de ta Page, puis{' '}
              <Code>PAGE_ID?fields=instagram_business_account</Code>.
            </Step>
            <Step n={6}>
              Onglet Comptes, "Ajouter un compte". L'IG User ID va dans "Identifiant sur la
              plateforme", le token de 60 jours dans "Token d'acces". Puis clique sur{' '}
              <strong className="text-mist-100">Tester la connexion</strong> : si le nom de ton
              compte s'affiche, c'est bon.
            </Step>
          </ol>
        </Panel>

        <Panel
          title="Facebook Reels"
          badge={<Badge ok={connected('facebook')} label={connected('facebook') ? 'Connecte' : 'A faire'} />}
          open={open === 'facebook'}
          onToggle={() => toggle('facebook')}
        >
          <p className="mb-4 text-sm text-mist-300">
            Tu reutilises l'app Facebook creee pour Instagram. Il faut juste un token de Page.
          </p>
          <ol className="space-y-3">
            <Step n={1}>
              Regenere un token avec en plus <Code>pages_manage_posts</Code>.
            </Step>
            <Step n={2}>
              Appelle <Code>me/accounts</Code>. Chaque page listee a son propre champ{' '}
              <Code>access_token</Code> : c'est celui-la qu'il faut, pas celui de l'utilisateur.
            </Step>
            <Step n={3}>Echange-le en longue duree, comme pour Instagram.</Step>
            <Step n={4}>
              Onglet Comptes : le Page ID dans "Identifiant sur la plateforme", le token de Page
              dans "Token d'acces". Puis teste la connexion.
            </Step>
          </ol>
        </Panel>

        <Panel
          title="Threads"
          badge={<Badge ok={connected('threads')} label={connected('threads') ? 'Connecte' : 'A faire'} />}
          open={open === 'threads'}
          onToggle={() => toggle('threads')}
        >
          <ol className="space-y-3">
            <Step n={1}>Dans ton app Facebook, ajoute le produit "Threads API".</Step>
            <Step n={2}>
              Demande les permissions <Code>threads_basic</Code> et{' '}
              <Code>threads_content_publish</Code>.
            </Step>
            <Step n={3}>
              Recupere ton Threads User ID avec <Code>graph.threads.net/v1.0/me?fields=id,username</Code>
              . Attention, il est different de l'IG User ID.
            </Step>
            <Step n={4}>Onglet Comptes, puis teste la connexion.</Step>
          </ol>
        </Panel>

        <Panel
          title="YouTube"
          badge={
            <Badge
              ok={connected('youtube') && Boolean(status?.google)}
              label={connected('youtube') && status?.google ? 'Connecte' : 'A faire'}
            />
          }
          open={open === 'youtube'}
          onToggle={() => toggle('youtube')}
        >
          <p className="mb-4 text-sm text-mist-300">
            YouTube marche autrement : le token ne dure qu'une heure, mais le "refresh token" ne
            perime pas. L'application s'en sert pour en regenerer un a chaque publication. Une fois
            branche, tu n'y touches plus jamais.
          </p>
          <ol className="space-y-3">
            <Step n={1}>
              Sur <Ext href="https://console.cloud.google.com">console.cloud.google.com</Ext>, cree
              un projet et active "YouTube Data API v3".
            </Step>
            <Step n={2}>
              Ecran de consentement OAuth : type Externe, et ajoute-toi comme utilisateur de test.
            </Step>
            <Step n={3}>
              Cree des identifiants OAuth de type "Desktop app". Note le Client ID et le Client
              Secret, et donne-les moi : ce sont des secrets serveur, ils ne se collent pas dans
              l'application.
            </Step>
            <Step n={4}>
              Sur{' '}
              <Ext href="https://developers.google.com/oauthplayground">l'OAuth Playground</Ext>,
              coche "Use your own OAuth credentials", colle tes identifiants, choisis les scopes{' '}
              <Code>youtube.upload</Code> et <Code>youtube</Code>, autorise, puis echange le code
              contre des tokens.
            </Step>
            <Step n={5}>
              Copie le refresh token, il commence par <Code>1//</Code>. Onglet Comptes, plateforme
              YouTube : colle-le dans "Refresh token" et laisse les autres champs vides.
            </Step>
          </ol>
        </Panel>

        <Panel
          title="TikTok"
          badge={<Badge ok={connected('tiktok')} label={connected('tiktok') ? 'Connecte' : 'Lance la demande tot'} />}
          open={open === 'tiktok'}
          onToggle={() => toggle('tiktok')}
        >
          <p className="mb-4 text-sm text-mist-300">
            Le seul qui demande une validation humaine, elle prend en general 2 a 4 semaines. Lance
            la demande maintenant, meme si tu branches le compte plus tard.
          </p>
          <ol className="space-y-3">
            <Step n={1}>
              Sur <Ext href="https://developers.tiktok.com">developers.tiktok.com</Ext>, cree une
              app et ajoute le produit "Content Posting API".
            </Step>
            <Step n={2}>
              Demande les scopes <Code>video.publish</Code>, <Code>video.upload</Code> et{' '}
              <Code>user.info.basic</Code>.
            </Step>
            <Step n={3}>
              TikTok reclame deux adresses, elles sont deja en ligne et accessibles sans compte :{' '}
              <Ext href="/terms">bubu-post.vercel.app/terms</Ext> et{' '}
              <Ext href="/privacy">bubu-post.vercel.app/privacy</Ext>.
            </Step>
            <Step n={4}>
              Ils demandent aussi une video de demonstration. Filme ton ecran pendant que tu crees
              une publication dans l'application, deux minutes suffisent.
            </Step>
            <Step n={5}>
              Pour la verification du domaine, ils te donneront un fichier ou une balise a poser.
              Envoie-la moi, je la mets en ligne.
            </Step>
          </ol>
          <p className="mt-4 rounded-lg border border-warn-600/40 bg-warn-600/10 px-3 py-2 text-xs text-warn-400">
            Tant que l'app n'est pas approuvee, TikTok reste en bac a sable et les videos arrivent
            dans tes brouillons au lieu d'etre publiees. C'est normal, ce n'est pas une panne.
          </p>
        </Panel>
      </div>

      <section className="panel mt-6 p-5">
        <h2 className="mb-3 font-semibold">Une fois un compte branche</h2>
        <ol className="space-y-3">
          <Step n={1}>Onglet Publications, "Nouvelle publication".</Step>
          <Step n={2}>Depose ta video, ou colle une URL deja publique.</Step>
          <Step n={3}>Coche les comptes vises.</Step>
          <Step n={4}>
            Ecris le sujet du jour, puis "Generer toutes les legendes" : une legende differente et
            adaptee par plateforme.
          </Step>
          <Step n={5}>
            Ajuste l'heure et le texte de chaque compte separement, puis "Programmer".
          </Step>
        </ol>
        <p className="mt-4 text-sm text-mist-500">
          Ensuite tu n'as plus rien a faire. Si quelque chose rate, le bouton "Journal" de la
          publication te montre exactement ce qui s'est passe.
        </p>
      </section>

      <p className="mt-6 text-xs text-mist-600">
        Plateformes prises en charge :{' '}
        {PLATFORMS.map((p) => `${PLATFORM_ICON[p.value]} ${p.label}`).join(', ')}.
      </p>
    </div>
  )
}
