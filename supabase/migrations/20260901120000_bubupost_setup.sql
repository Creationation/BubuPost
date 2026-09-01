-- BubuPost : mise en place complete par-dessus le schema existant.
-- Le schema de base (accounts, posts, publish_logs) existait deja et n'est PAS recree.
-- Cette migration est additive et rejouable.

-- ---------------------------------------------------------------------------
-- 1. Extensions
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- 2. Profils utilisateurs (necessaire pour l'admin center)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  role       text not null default 'user' check (role in ('admin', 'user')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Trigger de creation du profil + backfill des comptes deja existants.
-- Sans le backfill, un compte cree avant le trigger n'a pas de ligne profiles
-- et l'app plante juste apres le login.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$fn$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (id, email)
select u.id, u.email from auth.users u
on conflict (id) do nothing;

-- Fonction d'aide : l'utilisateur courant est-il admin ?
-- security definer pour eviter la recursion infinie dans les policies de profiles.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$fn$;

-- ---------------------------------------------------------------------------
-- 3. Reglages globaux (admin center)
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

insert into public.app_settings (key, value) values
  ('cadence', '{"mon":3,"tue":3,"wed":3,"thu":3,"fri":1,"sat":1,"sun":1}'::jsonb),
  ('retry',   '{"max_attempts":3,"backoff_minutes":[5,20,60]}'::jsonb),
  ('limits',  '{"instagram":25,"facebook":25,"threads":250,"youtube":6,"tiktok":15}'::jsonb),
  ('notify',  '{"telegram_enabled":true,"notify_on_success":false}'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Colonnes additives sur posts
-- ---------------------------------------------------------------------------
-- group_id relie les lignes issues d'une meme video publiee sur plusieurs comptes.
alter table public.posts add column if not exists group_id uuid;
-- Suivi des tentatives pour le retry automatique du scheduler.
alter table public.posts add column if not exists attempts int not null default 0;
alter table public.posts add column if not exists next_attempt_at timestamptz;
-- Identifiant du media container renvoye par la plateforme, entre deux passages du scheduler.
alter table public.posts add column if not exists container_id text;

-- 'cancelled' manquait : on doit pouvoir annuler un post non publie.
alter table public.posts drop constraint if exists posts_status_check;
alter table public.posts add constraint posts_status_check
  check (status in ('pending', 'processing', 'published', 'failed', 'cancelled'));

create index if not exists idx_posts_group on public.posts (group_id);
create index if not exists idx_posts_due on public.posts (scheduled_at)
  where status in ('pending', 'processing');
create index if not exists idx_publish_logs_post on public.publish_logs (post_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 5. updated_at automatique
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

drop trigger if exists accounts_touch on public.accounts;
create trigger accounts_touch before update on public.accounts
  for each row execute function public.touch_updated_at();

drop trigger if exists posts_touch on public.posts;
create trigger posts_touch before update on public.posts
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 6. Policies RLS
--    Il n'en existait AUCUNE : RLS etait active sur les trois tables mais sans
--    policy, donc meme connecte personne ne pouvait rien lire ni ecrire.
--    Le scheduler passe par la cle service_role, qui contourne la RLS.
-- ---------------------------------------------------------------------------
drop policy if exists accounts_rw on public.accounts;
create policy accounts_rw on public.accounts
  for all to authenticated using (true) with check (true);

drop policy if exists posts_rw on public.posts;
create policy posts_rw on public.posts
  for all to authenticated using (true) with check (true);

drop policy if exists publish_logs_read on public.publish_logs;
create policy publish_logs_read on public.publish_logs
  for select to authenticated using (true);

drop policy if exists profiles_read_self_or_admin on public.profiles;
create policy profiles_read_self_or_admin on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings
  for select to authenticated using (true);

drop policy if exists app_settings_admin_write on public.app_settings;
create policy app_settings_admin_write on public.app_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 7. Stockage des videos
--    Bucket public : les API Meta et TikTok telechargent la video depuis une URL
--    que leurs propres serveurs doivent pouvoir joindre sans authentification.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('videos', 'videos', true, 524288000,
        array['video/mp4', 'video/quicktime', 'video/x-m4v'])
on conflict (id) do update
  set public = true,
      file_size_limit = 524288000,
      allowed_mime_types = array['video/mp4', 'video/quicktime', 'video/x-m4v'];

drop policy if exists videos_public_read on storage.objects;
create policy videos_public_read on storage.objects
  for select to public using (bucket_id = 'videos');

drop policy if exists videos_auth_write on storage.objects;
create policy videos_auth_write on storage.objects
  for insert to authenticated with check (bucket_id = 'videos');

drop policy if exists videos_auth_update on storage.objects;
create policy videos_auth_update on storage.objects
  for update to authenticated using (bucket_id = 'videos');

drop policy if exists videos_auth_delete on storage.objects;
create policy videos_auth_delete on storage.objects
  for delete to authenticated using (bucket_id = 'videos');

-- ---------------------------------------------------------------------------
-- 8. Vue de suivi des quotas par compte sur 24 h
-- ---------------------------------------------------------------------------
create or replace view public.account_usage_24h
with (security_invoker = true) as
select a.id as account_id,
       a.platform,
       a.brand,
       a.account_name,
       a.status,
       a.token_expiry,
       count(p.id) filter (
         where p.status = 'published' and p.published_at > now() - interval '24 hours'
       ) as published_24h
from public.accounts a
left join public.posts p on p.account_id = a.id
group by a.id;
