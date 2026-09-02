import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { listAccounts, setupStatus, type SetupStatus } from '../lib/api'
import { friendlyError } from '../lib/errors'
import { PLATFORMS, PLATFORM_ICON, type Account } from '../lib/types'
import { Alert, Loading, PageHeader } from '../components/ui'
import { useScheduler } from '../lib/scheduler'

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
  const { intervalleMinutes } = useScheduler()

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
          <Check
            done
            label={`Le scheduler tourne automatiquement, toutes les ${intervalleMinutes} minutes`}
          />
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
          <p className="mb-4 rounded-lg border border-ok-600/40 bg-ok-600/10 px-3 py-2 text-xs text-ok-400">
            Configure et teste. Tu recevras un message quand une publication echoue
            definitivement, quand un token ne peut plus etre renouvele, ou quand un quota est
            atteint.
          </p>
          <ol className="space-y-3">
            <Step n={1}>
              Pour verifier a tout moment, va dans l'onglet Admin et clique sur{' '}
              <strong className="text-mist-100">Tester les alertes Telegram</strong>. Un message
              arrive dans la seconde.
            </Step>
            <Step n={2}>
              Tu n'es prevenu que sur un abandon definitif, jamais sur une tentative
              intermediaire : beaucoup d'erreurs se resolvent toutes seules au deuxieme essai.
            </Step>
            <Step n={3}>
              Si plusieurs publications tombent en meme temps, par exemple parce qu'un token a
              expire, tu recois <strong className="text-mist-100">un seul message</strong> qui les
              regroupe. Un meme message ne se repete jamais dans l'heure.
            </Step>
            <Step n={4}>
              Tu peux couper les alertes, ou au contraire etre prevenu aussi des reussites, dans
              l'onglet Admin.
            </Step>
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
          <p className="mb-4 rounded-lg border border-ok-600/40 bg-ok-600/10 px-3 py-2 text-xs text-ok-400">
            Connexion automatisee, comme TikTok : aucun token a copier. Il te faut juste un compte
            Instagram Professionnel relie a une Page Facebook dont tu es administrateur.
          </p>
          <ol className="space-y-3">
            <Step n={1}>
              Dans l'application Instagram : Parametres, Compte, puis "Passer a un compte
              professionnel". Sans ca, l'API de publication n'existe tout simplement pas.
            </Step>
            <Step n={2}>
              Toujours dans Instagram, relie le compte a ta Page Facebook. C'est cette Page qui
              porte le droit de publier.
            </Step>
            <Step n={3}>
              Onglet Comptes, bouton{' '}
              <strong className="text-mist-100">Connecter un compte Instagram</strong>. Tu choisis
              la marque, Facebook te demande d'autoriser, et le compte s'enregistre tout seul.
            </Step>
            <Step n={4}>
              Pendant l'autorisation, <strong className="text-mist-100">coche bien la Page</strong>{' '}
              concernee. Si tu la decoches, Facebook renvoie une liste vide et la connexion echoue
              sans dire pourquoi.
            </Step>
            <Step n={5}>
              Si plusieurs comptes Instagram sont accessibles, l'application te les affiche et te
              laisse choisir. Rien n'est importe sans ton accord.
            </Step>
            <Step n={6}>
              Clique ensuite sur <strong className="text-mist-100">Tester la connexion</strong>. Le
              jeton se renouvelle ensuite tout seul, il expire au bout de 60 jours.
            </Step>
          </ol>
        </Panel>

        <Panel
          title="Facebook Reels"
          badge={<Badge ok={connected('facebook')} label={connected('facebook') ? 'Connecte' : 'A faire'} />}
          open={open === 'facebook'}
          onToggle={() => toggle('facebook')}
        >
          <p className="mb-4 rounded-lg border border-ok-600/40 bg-ok-600/10 px-3 py-2 text-xs text-ok-400">
            Automatise, et deja fait pour toi si tu as connecte Instagram : la Page Facebook est
            enregistree en meme temps, avec le meme jeton. Tu n'as rien de plus a coller.
          </p>
          <ol className="space-y-3">
            <Step n={1}>
              Facebook Reels publie sur ta <strong className="text-mist-100">Page</strong>, pas sur
              ton compte Instagram. Ce sont deux comptes distincts dans l'application, avec chacun
              son heure et sa legende.
            </Step>
            <Step n={2}>
              Deux permissions supplementaires sont necessaires,{' '}
              <Code>pages_manage_posts</Code> et <Code>publish_video</Code>. Meta ne les accorde
              pas aux autorisations deja donnees.
            </Step>
            <Step n={3}>
              Il faut donc{' '}
              <strong className="text-mist-100">relancer une fois la connexion Instagram</strong>{' '}
              depuis l'onglet Comptes. Coche a nouveau ta Page et ton compte Instagram. La Page
              apparaitra ensuite comme un compte Facebook Reels.
            </Step>
            <Step n={4}>
              Clique sur <strong className="text-mist-100">Tester la connexion</strong> sur la
              ligne Facebook pour confirmer.
            </Step>
            <Step n={5}>
              Dans une nouvelle publication, coche les deux comptes pour diffuser la meme video sur
              Instagram et sur Facebook, chacun a son heure.
            </Step>
          </ol>
          <p className="mt-4 text-xs text-mist-500">
            Cote technique : Facebook n'accepte pas qu'on lui donne une URL a telecharger, il faut
            lui transmettre les octets de la video. C'est fait automatiquement, la limite est de
            150 Mo par video.
          </p>
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
              ok={connected('youtube') && Boolean(status?.youtube)}
              label={connected('youtube') && status?.youtube ? 'Connecte' : 'A faire'}
            />
          }
          open={open === 'youtube'}
          onToggle={() => toggle('youtube')}
        >
          <p className="mb-4 text-sm text-mist-300">
            Connexion automatisee, comme TikTok. Tu peux publier des Shorts et des videos
            classiques : le choix se fait publication par publication.
          </p>
          <ol className="space-y-3">
            <Step n={1}>
              Onglet Comptes, bouton{' '}
              <strong className="text-mist-100">Connecter une chaine YouTube</strong>. Google te
              demande d'autoriser l'envoi de videos, et la chaine s'enregistre toute seule.
            </Step>
            <Step n={2}>
              Si ton compte Google gere plusieurs chaines, l'application te les affiche et te
              laisse choisir.
            </Step>
            <Step n={3}>
              Dans une nouvelle publication, un compte YouTube affiche un choix{' '}
              <strong className="text-mist-100">Short</strong> ou{' '}
              <strong className="text-mist-100">Video classique</strong>. Le Short recoit{' '}
              <Code>#Shorts</Code> automatiquement et son titre vient de la legende. La video
              classique ouvre un titre, une description et une miniature separes.
            </Step>
            <Step n={4}>
              Pour une video classique, le bouton de generation ecrit un titre optimise pour la
              recherche YouTube, ce qui est un exercice different d'une legende Instagram.
            </Step>
          </ol>

          <p className="mt-4 rounded-lg border border-warn-600/40 bg-warn-600/10 px-3 py-2 text-xs text-warn-400">
            <strong>Quota, le point le plus contraignant.</strong> Google alloue 10 000 unites par
            jour et un envoi en coute 1600, soit <strong>6 videos par jour maximum</strong>, toutes
            chaines confondues : le quota appartient au projet Google, pas a la chaine. Une
            miniature coute 50 unites de plus. L'application compte, bloque proprement avant
            d'appeler Google, et te previent sur Telegram quand tu approches de la limite. Le
            compteur repart a zero a minuit, heure du Pacifique.
          </p>

          <p className="mt-3 rounded-lg border border-ink-700 bg-ink-850/50 px-3 py-2 text-xs text-mist-500">
            Tant que ton ecran de consentement Google reste en mode Test, les autorisations
            expirent au bout de 7 jours. L'application te le dira clairement le moment venu, il
            suffira de reconnecter la chaine. Passer l'application en production supprime cette
            limite.
          </p>
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
          <p className="mb-4 rounded-lg border border-ok-600/40 bg-ok-600/10 px-3 py-2 text-xs text-ok-400">
            Deja fait de mon cote : tes cles sont posees sur le serveur, le fichier de verification
            de domaine est en ligne, et la connexion est automatisee. Tu n'auras aucun token a
            copier pour TikTok, contrairement aux autres plateformes.
          </p>
          <ol className="space-y-3">
            <Step n={1}>
              Sur <Ext href="https://developers.tiktok.com">developers.tiktok.com</Ext>, ouvre ton
              application et ajoute le produit "Login Kit" en plus de "Content Posting API".
            </Step>
            <Step n={2}>
              Dans les reglages du Login Kit, declare cette URL de redirection,{' '}
              <strong className="text-mist-100">exactement</strong>, au caractere pres :{' '}
              <Code>https://bubu-post.vercel.app/auth/tiktok/callback</Code>. C'est l'erreur la plus
              frequente : un slash en trop et TikTok refuse sans expliquer pourquoi.
            </Step>
            <Step n={3}>
              Demande les scopes <Code>user.info.basic</Code> et <Code>video.publish</Code>.
            </Step>
            <Step n={4}>
              TikTok reclame deux adresses, elles sont deja en ligne et accessibles sans compte :{' '}
              <Ext href="/terms">bubu-post.vercel.app/terms</Ext> et{' '}
              <Ext href="/privacy">bubu-post.vercel.app/privacy</Ext>.
            </Step>
            <Step n={5}>
              Ils demandent aussi une video de demonstration. Filme ton ecran pendant que tu crees
              une publication dans l'application, deux minutes suffisent.
            </Step>
            <Step n={6}>
              Une fois l'application approuvee, va dans l'onglet Comptes et clique sur{' '}
              <strong className="text-mist-100">Connecter un compte TikTok</strong>. Tu choisis la
              marque, TikTok te demande d'autoriser, et le compte s'enregistre tout seul. Son token
              sera ensuite renouvele chaque nuit automatiquement.
            </Step>
          </ol>
          <p className="mt-4 rounded-lg border border-warn-600/40 bg-warn-600/10 px-3 py-2 text-xs text-warn-400">
            Tant que l'app n'est pas approuvee, TikTok reste en bac a sable et les videos arrivent
            dans tes brouillons au lieu d'etre publiees. C'est normal, ce n'est pas une panne.
          </p>
        </Panel>
      </div>

      <section className="panel mt-6 p-5">
        <h2 className="mb-1 font-semibold">Deposer une video et laisser faire</h2>
        <p className="mb-4 text-sm text-mist-500">
          Le watcher est un petit programme qui tourne sur ton PC. Il surveille les dossiers que tu
          designes, envoie les videos qu il y trouve, et laisse l application ecrire les textes et
          placer les horaires. Ton PC n a besoin d etre allume qu au moment du depot : la
          publication, elle, se fait dans le nuage, PC eteint.
        </p>

        <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-mist-500">
          Comment nommer tes fichiers
        </h3>
        <p className="text-sm text-mist-300">
          Le nom du fichier porte les informations. Avec la regle de depart, les elements sont
          separes par un tiret bas, dans cet ordre :
        </p>
        <p className="my-3 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 font-mono text-xs text-mist-100">
          EdgeSyncFX_stop-loss-trop-serre_fr.mp4
        </p>
        <ul className="space-y-1.5 text-sm text-mist-300">
          <li>
            <span className="font-medium text-mist-100">EdgeSyncFX</span> : la marque. Elle doit
            correspondre exactement a celle de tes comptes.
          </li>
          <li>
            <span className="font-medium text-mist-100">stop-loss-trop-serre</span> : le sujet. Les
            tirets deviennent des espaces, donc ecris la phrase avec des tirets entre les mots.
          </li>
          <li>
            <span className="font-medium text-mist-100">fr</span> : la langue, en deux lettres.
          </li>
        </ul>
        <p className="mt-3 text-sm text-mist-500">
          Tu peux changer le separateur, l ordre et les elements dans{' '}
          <Link to="/automatisation" className="text-brand-400 hover:underline">
            Automatisation, onglet Nommage
          </Link>
          , et surtout tester un nom avant de deposer quoi que ce soit. Si un dossier est dedie a
          une marque, tu peux omettre la marque dans le nom.
        </p>
        <p className="mt-2 text-sm text-mist-500">
          Un nom qui ne suit pas la regle ne fait rien perdre : le fichier reste ou il est, apparait
          dans le suivi avec la raison, et tu le rejoues apres l avoir renomme.
        </p>

        <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-mist-500">
          Installer le watcher, une seule fois
        </h3>
        <ol className="space-y-3">
          <Step n={1}>
            Ouvre le dossier <Code>C:\BubuPost\watcher</Code>.
          </Step>
          <Step n={2}>
            Copie le fichier <Code>config.exemple.json</Code> et renomme la copie en{' '}
            <Code>config.json</Code>.
          </Step>
          <Step n={3}>
            Ouvre <Code>config.json</Code> avec le Bloc-notes et remplace la ligne du jeton par
            celui qui est ecrit dans <Code>BUBUPOST - ACCES.txt</Code> sur ton bureau. Enregistre.
          </Step>
          <Step n={4}>
            Dans l application, onglet Automatisation, ajoute le ou les dossiers a surveiller, puis
            clique sur <span className="text-mist-100">Activer l automatisation</span>.
          </Step>
          <Step n={5}>
            Double-clique sur <Code>demarrer.bat</Code>. Une fenetre noire s ouvre et reste
            ouverte : c est normal, c est le watcher qui tourne. La fermer l arrete.
          </Step>
          <Step n={6}>
            Pour qu il demarre tout seul avec Windows : appuie sur la touche Windows plus R, tape{' '}
            <Code>shell:startup</Code>, valide, et glisse un raccourci de{' '}
            <Code>demarrer.bat</Code> dans le dossier qui s ouvre.
          </Step>
        </ol>

        <p className="mt-4 text-sm text-mist-500">
          L onglet Automatisation te dit quand le watcher s est manifeste pour la derniere fois, ce
          qu il a traite, et ce qu il a refuse. S il se tait plus longtemps que prevu, un bandeau
          rouge apparait.
        </p>
      </section>

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
