# BubuPost

Publication automatique de videos courtes de trading sur huit comptes, trois
marques. Le proprietaire est Diego Renard (renardiego@gmail.com). **Il n'est pas
developpeur** : tout ce qu'on lui demande doit etre faisable dans l'application
ou en un double-clic, jamais en ligne de commande.

Application en ligne : https://bubu-post.vercel.app
Depot : https://github.com/Creationation/BubuPost (branche `main`)
Supabase : projet `ztelymzqhojuxaxryuty`
Videos sources : `C:\TradeReels\ready_to_post\JJMMAAAA\1_matin|2_apres_midi|3_soir\`

## La chaine, de bout en bout

1. **Le watcher** (`watcher/bubupost-watcher.cjs`, sur le PC de Diego) depose
   les videos trouvees sur disque. Il ne decide RIEN d'autre, et n'a **aucun
   acces a la base** : un seul secret `WATCHER_TOKEN`, qui n'ouvre que la
   fonction `watcher`.
2. **La reserve** (table `bibliotheque`) les garde en file, une entree par
   marque, dans l'ordre du tournage. Diego ordonne.
3. **Le moteur de cadence** (fonction `cadence`, cron `*/15`) prend le haut de
   la file, demande les textes a Claude, cree une campagne.
4. **Le scheduler** (fonction `scheduler`, cron `*/2`) publie quand l'heure est
   venue.

Les etapes 3 et 4 tournent dans le nuage : le PC de Diego peut etre eteint.

## Conventions a respecter

- **Aucun tiret cadratin** dans les textes visibles, nulle part. Idem dans les
  textes generes pour les reseaux : c'est une consigne de generation.
- Les fichiers `.txt` poses sur le Bureau sont en **ASCII pur** et en CRLF.
- **Verifier dans le reel** (base, navigateur) plutot que supposer. Les scripts
  de test nettoient derriere eux.
- Les secrets ne vont jamais dans le code, ni dans Git, ni dans le navigateur.
- Ecrire les scripts avec l'outil Write : les heredocs Bash de ce poste mangent
  les antislashs et executent les `$(...)`.

## Commandes utiles

```bash
# SQL (pas de mot de passe Postgres sur ce projet : API Management)
node 3-outils/sql.js "select count(*) from posts"

# Etat de sante complet, a lancer en premier quand quelque chose bloque
node 3-outils/etat.js

# Deployer une fonction
export SUPABASE_ACCESS_TOKEN=$(grep -o "sbp_[a-z0-9]*" "C:/Users/latitude/Documents/BubuPost/Keys etc.txt" | head -1)
npx supabase functions deploy cadence --project-ref ztelymzqhojuxaxryuty
npx supabase functions deploy watcher --no-verify-jwt --project-ref ztelymzqhojuxaxryuty

# Verifier avant de pousser
npx tsc --noEmit -p tsconfig.app.json && npx vite build
deno check --node-modules-dir=none supabase/functions/cadence/index.ts
```

Le site se deploie tout seul depuis GitHub. Vercel prend parfois vingt minutes :
comparer le nom du bundle `dist/assets/index-*.js` local avec celui servi en
production avant de conclure a un echec.

## Pieges qui ont deja coute cher

- **Un refus de plateforme sans explication** : verifier D'ABORD que l'objet
  stocke pese autant que le fichier local. Treize videos etaient tronquees dans
  le stockage (certaines a 48 octets) alors que les fichiers locaux etaient
  intacts ; Instagram repondait seulement « code 2207082 ».
- **Les dossiers `JJMMAAAA` ne se trient pas dans l'ordre du temps** : 01072026
  passerait avant 26062026. Voir `rangChronologique`.
- **Les creneaux se pensent en heure de Paris**, le serveur est en UTC. Voir
  `civil()` et `instant()` dans `supabase/functions/_shared/automatisation.ts`.
- **Tout compteur de places occupees doit inclure ce qui est deja parti.**
  Sans ca, le moteur reprogramme sur une heure deja prise : trois videos sont
  parties a 17h le meme jour, deux jours de suite.
- **Tout echec repete d'une boucle automatique doit se voir quelque part.** La
  chaine s'est arretee quatre jours en silence (credit Anthropic epuise), puis
  une nuit (quota de stockage depasse). D'ou `app_settings.panne_moteur`.
- **YouTube : 6 envois par jour maximum**, toutes chaines confondues (quota du
  projet Google, pas de la chaine).
- **RLS** : verifier `select count(*) from pg_policies`, pas seulement que la
  table repond 200. Une table avec RLS active et zero policy renvoie `[]` sans
  erreur.

## Regles d'ecriture des textes (decidees par Diego)

- Instagram EdgeSyncFX : « Comment GO », reponse en message prive.
- YouTube, toutes marques : site `https://edgesyncfx.app` + code `TCHABA`.
- Tout le reste : code `TCHABA`, le site, et renvoi vers `@edgesyncfx.app`.
- **Pas de mention legale dans le texte** : la video l'affiche deja a l'ecran.
- Les textes citent deux ou trois **vrais chiffres** de la seance, lus sur la
  derniere image de la video, jamais arrondis ni inventes. Un profit se cite
  toujours avec son risque (drawdown ou spread) a cote.
- Modele d'ecriture reglable dans Admin (`app_settings.modele_textes`). La
  lecture du tableau de bord est fixee a Haiku 4.5 : lire un panneau ne demande
  pas de raisonnement.

## Memoire

La fiche complete du projet, avec l'historique des incidents et de leurs causes,
est dans la memoire de Claude Code : `project_bubupost.md`. La lire avant un
gros chantier.

## Nouveau PC (08/10/2026)

- Le watcher tourne via l'icone pres de l'horloge : `desktop/bubupost_tray.pyw` (Python + pystray),
  raccourcis Bureau `BubuPost.lnk` et `shell:startup\BubuPost.lnk` (`--tray`). Ne plus utiliser
  `watcher/installer-demarrage.vbs` (doublon). `--sans-watcher` pour tester l'icone sans rien envoyer.
- Outils de `3-outils` : chemins via les variables utilisateur `BUBUPOST_CLES` / `BUBUPOST_ACCES`.
## Nouveau projet Supabase + envoi a la demande (08/10/2026)

- Projet actif : `ozisbzwmjrhmdeojcbkt` (compte du CLI de ce PC, plan Pro temporaire). L'ancien
  `ztelymzqhojuxaxryuty` est abandonne (quota depasse). Deployer avec `--project-ref ozisbzwmjrhmdeojcbkt`.
- La video n'est plus envoyee a l'ingestion : le watcher reserve l'adresse (`upload-url` sans PUT), puis
  `a-envoyer` / `envoi-url` l'envoient dans les 24 h (`HORIZON_ENVOI_H`) avant la 1re publication ;
  `effacerSiFini` l'efface apres le dernier compte. Video absente a l'heure : le scheduler repousse de
  30 min sans tentative + Telegram. Alerte Telegram `alerterStock` a 10/5/2/0 videos restantes.
- `desktop/bubupost_tray.pyw` : fenetre pywebview + icone + watcher. Dans `_sur_fermeture`, ne JAMAIS
  appeler `window.hide()` directement (deadlock) : le lancer dans un thread.