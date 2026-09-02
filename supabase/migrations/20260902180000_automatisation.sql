-- Automatisation : le watcher local depose des videos, l'app decide de tout.
--
-- Le watcher n'a AUCUN acces a la base. Il ne possede pas de session Supabase,
-- seulement un jeton partage qui n'ouvre qu'une Edge Function. La raison est
-- dans les politiques existantes : accounts_rw vaut `using (true)`, donc tout
-- utilisateur connecte lit `accounts.access_token`. Un compte dedie au watcher
-- lui donnerait les jetons Instagram, TikTok et YouTube. Il n'en a pas besoin.

-- ---------------------------------------------------------------------------
-- 1. Un nouvel etat de publication : ecrite, mais pas encore approuvee.
-- ---------------------------------------------------------------------------
-- Le scheduler ne lit que 'pending' et 'processing' : une publication en
-- 'a_valider' ne peut donc pas partir par accident.
alter table public.posts drop constraint if exists posts_status_check;
alter table public.posts add constraint posts_status_check
  check (status in ('a_valider', 'pending', 'processing', 'published', 'failed', 'cancelled'));

-- ---------------------------------------------------------------------------
-- 2. Les reglages de l'automatisation, en une seule ligne.
-- ---------------------------------------------------------------------------
-- Une ligne unique, garantie par la cle primaire booleenne : deux jeux de
-- reglages concurrents seraient impossibles a diagnostiquer.
create table if not exists public.automation_config (
  id         boolean primary key default true check (id),
  reglages   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.automation_config enable row level security;

drop policy if exists automation_config_read on public.automation_config;
create policy automation_config_read on public.automation_config
  for select to authenticated using (true);

drop policy if exists automation_config_write on public.automation_config;
create policy automation_config_write on public.automation_config
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 3. Les dossiers surveilles.
-- ---------------------------------------------------------------------------
create table if not exists public.watch_folders (
  id         uuid primary key default gen_random_uuid(),
  chemin     text not null,
  actif      boolean not null default true,
  -- Marque imposee au dossier. NULL veut dire : la lire dans le nom du fichier.
  marque     text,
  -- Nom d'un profil de ciblage defini dans automation_config.
  profil     text,
  ordre      integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.watch_folders enable row level security;

drop policy if exists watch_folders_read on public.watch_folders;
create policy watch_folders_read on public.watch_folders
  for select to authenticated using (true);

drop policy if exists watch_folders_write on public.watch_folders;
create policy watch_folders_write on public.watch_folders
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 4. Le journal des fichiers vus.
-- ---------------------------------------------------------------------------
-- Sert a trois choses : montrer ce qui s'est passe, empecher qu'un fichier
-- soit importe deux fois, et permettre de rejouer un rejet apres correction.
create table if not exists public.imports (
  id          uuid primary key default gen_random_uuid(),
  -- Nom du fichier plus sa taille : deux videos differentes portant le meme
  -- nom restent distinctes, et un meme fichier redepose est reconnu.
  cle         text not null unique,
  fichier     text not null,
  dossier     text,
  taille      bigint,
  statut      text not null check (statut in ('importe', 'rejete')),
  raison      text,
  marque      text,
  sujet       text,
  langue      text,
  campaign_id uuid,
  video_url   text,
  publications integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists imports_created_idx on public.imports (created_at desc);

alter table public.imports enable row level security;

drop policy if exists imports_read on public.imports;
create policy imports_read on public.imports
  for select to authenticated using (true);

drop policy if exists imports_write on public.imports;
create policy imports_write on public.imports
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 5. Le signe de vie du watcher.
-- ---------------------------------------------------------------------------
-- Une ligne unique, ecrasee a chaque passage. On ne garde pas l'historique :
-- ce qui compte est « depuis quand n'a-t-il pas donne signe de vie ».
create table if not exists public.watcher_ping (
  id       boolean primary key default true check (id),
  vu_a     timestamptz not null default now(),
  version  text,
  dossiers integer,
  detail   jsonb
);

alter table public.watcher_ping enable row level security;

drop policy if exists watcher_ping_read on public.watcher_ping;
create policy watcher_ping_read on public.watcher_ping
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 6. Reglages de depart.
-- ---------------------------------------------------------------------------
insert into public.automation_config (id, reglages) values (true, '{
  "actif": false,
  "nommage": {
    "separateur": "_",
    "ordre": ["marque", "sujet", "langue"],
    "surNonConforme": "rejeter",
    "defauts": { "marque": "", "langue": "fr" }
  },
  "profils": [
    { "nom": "Tous les comptes", "plateformes": [], "comptes": [] },
    { "nom": "Reseaux courts", "plateformes": ["instagram", "tiktok", "facebook"], "comptes": [] },
    { "nom": "Test sur un compte", "plateformes": ["instagram"], "comptes": [] }
  ],
  "cadence": {
    "parMarque": {},
    "defaut": { "lun": 3, "mar": 3, "mer": 3, "jeu": 3, "ven": 3, "sam": 1, "dim": 1 },
    "plage": { "debut": "09:00", "fin": "21:00" },
    "ecartMinutes": 15,
    "afflux": "etaler"
  },
  "quotas": { "surDepassement": "reporter" },
  "validation": { "parDefaut": true, "parMarque": {} },
  "contenu": {
    "cta": {},
    "liens": {},
    "position": "fin"
  },
  "alerteSilenceHeures": 26
}'::jsonb)
on conflict (id) do nothing;
