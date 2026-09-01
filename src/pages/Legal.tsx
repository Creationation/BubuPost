import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'

const CONTACT = 'renardiego@gmail.com'
const UPDATED = '1 septembre 2026'

/**
 * Bouton retour.
 *
 * Deux situations bien differentes. Si on arrive de l'application, on veut
 * revenir exactement d'ou l'on vient. Si on ouvre l'adresse directement, par
 * exemple un reviewer TikTok qui colle le lien, il n'y a pas d'historique :
 * un retour navigateur ferait sortir du site. Dans ce cas on renvoie vers
 * l'accueil. `location.key` vaut 'default' quand la page est la premiere de
 * l'historique, c'est ce qui permet de distinguer les deux cas.
 */
function BackButton({ className = '' }: { className?: string }) {
  const navigate = useNavigate()
  const location = useLocation()
  const cameFromApp = location.key !== 'default'

  return (
    <button
      type="button"
      onClick={() => (cameFromApp ? navigate(-1) : navigate('/'))}
      className={`btn btn-ghost ${className}`}
    >
      <span aria-hidden="true">←</span>
      {cameFromApp ? 'Retour' : "Retour a l'application"}
    </button>
  )
}

function LegalShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto min-h-full w-full max-w-3xl px-5 pb-12">
      {/* Barre collante : le bouton retour reste atteignable meme au milieu
          d'une page longue, sans avoir a remonter tout en haut. */}
      <div className="sticky top-0 z-10 -mx-5 mb-8 border-b border-ink-800 bg-ink-950/85 px-5 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <BackButton />
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-mist-500 hover:text-mist-100"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-brand-500/30 bg-brand-500/15 text-xs">
              🚀
            </span>
            BubuPost
          </Link>
        </div>
      </div>

      <header className="mb-10">
        <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">{title}</h1>
        <p className="mt-2 text-sm text-mist-500">Derniere mise a jour : {UPDATED}</p>
      </header>

      <div className="space-y-8 text-[15px] leading-relaxed text-mist-300">{children}</div>

      <div className="mt-12 border-t border-ink-800 pt-6">
        <BackButton />
      </div>

      <footer className="mt-8 text-sm text-mist-600">
        <div className="flex flex-wrap gap-4">
          <Link to="/terms" className="hover:text-mist-300">
            Terms of Service
          </Link>
          <Link to="/privacy" className="hover:text-mist-300">
            Privacy Policy
          </Link>
          <a href={`mailto:${CONTACT}`} className="hover:text-mist-300">
            Contact
          </a>
        </div>
        <p className="mt-3">BubuPost, https://bubu-post.vercel.app</p>
      </footer>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-base font-semibold text-mist-100">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

export function Terms() {
  return (
    <LegalShell title="Terms of Service">
      <p>
        Ces conditions encadrent l'utilisation de BubuPost, accessible a l'adresse
        https://bubu-post.vercel.app. En utilisant l'application, vous acceptez ce qui suit.
      </p>

      <Section title="1. Objet de l'application">
        <p>
          BubuPost est un outil de planification et de publication automatisee de videos courtes
          (Reels, Shorts, TikTok) vers des comptes de reseaux sociaux. Il permet de deposer une
          video, d'y associer une legende, de choisir les comptes de destination et l'heure de
          diffusion, puis de publier automatiquement au moment prevu via les API officielles des
          plateformes concernees : Instagram, Facebook, Threads, YouTube et TikTok.
        </p>
      </Section>

      <Section title="2. Utilisation reservee au proprietaire">
        <p>
          BubuPost est un outil interne et prive. Ce n'est pas un service ouvert au public, il
          n'accepte pas d'inscription libre et il n'est pas propose a des tiers, ni gratuitement ni
          contre paiement. L'application est utilisee exclusivement par son proprietaire, pour
          gerer ses propres marques de contenu et ses propres comptes de reseaux sociaux.
        </p>
        <p>
          Les comptes d'acces sont crees manuellement par le proprietaire. Toute utilisation non
          autorisee est interdite.
        </p>
      </Section>

      <Section title="3. Contenu publie et responsabilite">
        <p>
          Le proprietaire de l'application est seul responsable des videos, des legendes et de tout
          contenu publie au travers de BubuPost. Il lui appartient de s'assurer qu'il detient les
          droits necessaires sur ce contenu et que celui-ci respecte les regles de chaque
          plateforme de destination.
        </p>
        <p>
          BubuPost est fourni tel quel, sans garantie. L'application depend d'API tierces sur
          lesquelles elle n'a aucun controle : une publication peut echouer, etre retardee ou etre
          refusee par une plateforme. La responsabilite de l'application ne saurait etre engagee
          pour une publication manquee, un contenu refuse, une suspension de compte ou toute perte
          de donnees ou de revenus qui en decoulerait.
        </p>
      </Section>

      <Section title="4. Modification et arret du service">
        <p>
          Le proprietaire peut modifier, suspendre ou arreter tout ou partie du service a tout
          moment, sans preavis et sans justification. Ces conditions peuvent egalement etre mises a
          jour, la date de derniere mise a jour figurant en haut de cette page faisant foi.
        </p>
      </Section>

      <Section title="5. Contact">
        <p>
          Pour toute question relative a ces conditions, ecrivez a{' '}
          <a className="text-brand-400 hover:underline" href={`mailto:${CONTACT}`}>
            {CONTACT}
          </a>
          .
        </p>
      </Section>
    </LegalShell>
  )
}

export function Privacy() {
  return (
    <LegalShell title="Privacy Policy">
      <p>
        Cette politique explique quelles donnees BubuPost conserve, pourquoi, et comment elles sont
        protegees. BubuPost est un outil prive utilise par une seule personne pour publier sur ses
        propres comptes de reseaux sociaux.
      </p>

      <Section title="1. Donnees conservees">
        <p>Les seules donnees stockees par l'application sont les suivantes.</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong className="text-mist-100">Jetons d'acces aux plateformes.</strong> Les tokens
            d'acces et de rafraichissement fournis par Instagram, Facebook, Threads, YouTube et
            TikTok lors de la connexion des comptes, ainsi que leur date d'expiration et
            l'identifiant du compte concerne.
          </li>
          <li>
            <strong className="text-mist-100">Videos.</strong> Les fichiers video deposes en vue
            d'une publication.
          </li>
          <li>
            <strong className="text-mist-100">Legendes et hashtags</strong> associes a chaque
            publication.
          </li>
          <li>
            <strong className="text-mist-100">Metadonnees de publication.</strong> Date et heure
            prevues, compte de destination, statut (en attente, publie, en erreur), identifiant du
            post cree sur la plateforme et journal technique des tentatives.
          </li>
          <li>
            <strong className="text-mist-100">Compte utilisateur.</strong> L'adresse email servant a
            se connecter a l'application.
          </li>
        </ul>
        <p>
          L'application ne collecte aucune donnee de navigation, aucun cookie publicitaire, aucune
          statistique d'audience et aucune donnee personnelle de tiers.
        </p>
      </Section>

      <Section title="2. Usage des donnees">
        <p>
          Ces donnees servent uniquement a faire fonctionner l'application : preparer une
          publication, la programmer, l'envoyer a la plateforme choisie au moment prevu et en
          conserver la trace pour pouvoir diagnostiquer une erreur.
        </p>
        <p>
          Aucune donnee n'est vendue, louee, cedee, partagee avec des tiers, ni utilisee a des fins
          publicitaires ou d'analyse comportementale.
        </p>
      </Section>

      <Section title="3. Jetons d'acces aux reseaux sociaux">
        <p>
          Les jetons d'acces obtenus aupres des plateformes sont utilises exclusivement pour publier
          du contenu au nom du compte concerne, a la demande explicite du proprietaire de ce compte.
        </p>
        <p>
          Ils ne servent a rien d'autre : aucune lecture de messages prives, aucune extraction de
          donnees d'audience a des fins commerciales, aucune action sur d'autres comptes, aucune
          transmission a un service tiers. Les jetons ne quittent jamais l'infrastructure de
          l'application, sauf pour etre presentes a l'API officielle de la plateforme a laquelle ils
          appartiennent.
        </p>
      </Section>

      <Section title="4. Hebergement et securite">
        <p>
          Les donnees sont hebergees chez Supabase (base de donnees PostgreSQL et stockage de
          fichiers) et l'interface est distribuee par Vercel. Les echanges se font exclusivement en
          HTTPS, et les donnees sont chiffrees au repos par l'hebergeur.
        </p>
        <p>
          L'acces a l'application est protege par une authentification par email et mot de passe.
          L'acces aux donnees est restreint au niveau de la base elle-meme par des regles de
          securite par ligne (Row Level Security) : une requete non authentifiee ne peut lire ni
          ecrire aucune donnee. Les cles de service utilisees par les traitements automatiques sont
          conservees dans un coffre chiffre et ne sont jamais exposees a l'interface.
        </p>
      </Section>

      <Section title="5. Conservation et suppression">
        <p>
          Les videos et les publications sont conservees tant qu'elles sont utiles au suivi, et
          peuvent etre supprimees a tout moment depuis l'application. Deconnecter un compte de
          reseau social supprime immediatement les jetons associes.
        </p>
        <p>
          Pour toute question, ou pour demander la suppression de donnees, ecrivez a{' '}
          <a className="text-brand-400 hover:underline" href={`mailto:${CONTACT}`}>
            {CONTACT}
          </a>
          . La demande est traitee sous 30 jours.
        </p>
      </Section>
    </LegalShell>
  )
}
