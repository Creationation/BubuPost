-- Trace des passages du scheduler.
--
-- Sans elle, l'interface devait supposer que le cron tombait pile aux minutes
-- multiples de 5. C'est faux : pg_cron declenche a la minute, l'appel HTTP et
-- le demarrage de la fonction ajoutent leur delai, et le compte a rebours
-- affichait des valeurs qui ne correspondaient a rien.
create table if not exists public.scheduler_runs (
  id          uuid primary key default gen_random_uuid(),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  processed   int not null default 0
);

create index if not exists idx_scheduler_runs_started
  on public.scheduler_runs (started_at desc);

alter table public.scheduler_runs enable row level security;

-- Lecture seule pour l'application : c'est le scheduler, en service_role, qui
-- ecrit. Personne d'autre n'a de raison d'inventer un passage.
drop policy if exists scheduler_runs_read on public.scheduler_runs;
create policy scheduler_runs_read on public.scheduler_runs
  for select to authenticated using (true);

comment on table public.scheduler_runs is
  'Un enregistrement par passage du scheduler. Sert au compte a rebours de l''interface.';
