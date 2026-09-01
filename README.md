# BubuPost

Planification et publication automatisee de videos courtes (Reels, Shorts, TikTok)
sur plusieurs comptes et plusieurs marques.

Production : https://bubu-post.vercel.app

## Stack

- React 19 + TypeScript + Vite + Tailwind v4
- Supabase : Postgres, Auth, Storage, Edge Functions, pg_cron
- Vercel pour le frontend

## Comment ca marche

Une ligne de `posts` = une video sur **un** compte. C'est ce qui permet a chaque
compte d'avoir son propre horaire et sa propre legende pour la meme video. Les
lignes issues d'une meme video partagent un `group_id`.

Le scheduler (`supabase/functions/scheduler`) est appele toutes les 5 minutes par
pg_cron. A chaque passage il prend les publications dues, cree le media container
chez la plateforme, attend que le media soit pret, publie, et journalise. S'il n'a
pas fini au bout d'une minute, il laisse la publication en `processing` et le
passage suivant reprend ou il s'est arrete.

## Ajouter une plateforme

1. Ecrire `supabase/functions/_shared/adapters/<nom>.ts` qui exporte un
   `PlatformAdapter` : `createContainer`, `checkStatus`, `publish`.
2. L'enregistrer dans `adapters/index.ts`.
3. Ajouter la valeur dans la contrainte `platform` de la table `accounts` et dans
   `PLATFORMS` de `src/lib/types.ts`.

Rien d'autre ne bouge.

## Developpement

```bash
npm install
npm run dev
```

`.env.local` doit contenir `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`.

## Deploiement backend

```bash
export SUPABASE_ACCESS_TOKEN=...
npx supabase functions deploy scheduler        --project-ref ztelymzqhojuxaxryuty
npx supabase functions deploy generate-caption --project-ref ztelymzqhojuxaxryuty
```

## Secrets des Edge Functions

| Secret | Sert a | Obligatoire |
|---|---|---|
| `ANTHROPIC_API_KEY` | generation des legendes | pour le bouton "Generer" |
| `TELEGRAM_BOT_TOKEN` et `TELEGRAM_CHAT_ID` | alertes d'echec | recommande |
| `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET` | rafraichir le token YouTube | pour YouTube |

```bash
npx supabase secrets set CLE=valeur --project-ref ztelymzqhojuxaxryuty
```

La cle `service_role` utilisee par le cron est rangee dans le Vault Supabase sous
le nom `bubupost_service_key`, elle n'apparait nulle part dans ce depot.

## Migrations

`supabase/migrations/` est additif : le schema d'origine (`accounts`, `posts`,
`publish_logs`) existait deja et n'est pas recree.
