-- Suivi du quota d'API YouTube.
--
-- Google alloue 10 000 unites par jour et par projet, et un envoi de video en
-- coute 1600. Cela plafonne a 6 videos par jour, TOUS COMPTES CONFONDUS : le
-- quota appartient au projet Google, pas a la chaine. Sans compteur, la
-- septieme publication echouerait avec une erreur brute de Google, en plein
-- milieu de la journee, sans qu'on comprenne pourquoi.
--
-- Le quota se remet a zero a minuit, heure du Pacifique. On compte donc par
-- jour Pacifique, pas par jour local, sinon le compteur repartirait au mauvais
-- moment et autoriserait des envois que Google refuserait.
create table if not exists public.quota_usage (
  platform   text not null,
  jour       date not null,
  units      int  not null default 0,
  updated_at timestamptz not null default now(),
  primary key (platform, jour)
);

alter table public.quota_usage enable row level security;

drop policy if exists quota_usage_read on public.quota_usage;
create policy quota_usage_read on public.quota_usage
  for select to authenticated using (true);

/**
 * Consomme des unites et renvoie le total du jour.
 *
 * Une seule instruction atomique : deux passages du scheduler qui publient en
 * meme temps ne peuvent pas lire la meme valeur et l'ecraser mutuellement.
 */
create or replace function public.consommer_quota(p_platform text, p_units int)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  total int;
begin
  insert into public.quota_usage (platform, jour, units)
  values (p_platform, (now() at time zone 'America/Los_Angeles')::date, p_units)
  on conflict (platform, jour) do update
    set units = public.quota_usage.units + excluded.units,
        updated_at = now()
  returning units into total;

  return total;
end;
$fn$;

/** Unites deja consommees aujourd'hui, sans rien modifier. */
create or replace function public.quota_du_jour(p_platform text)
returns int
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(
    (select units from public.quota_usage
     where platform = p_platform
       and jour = (now() at time zone 'America/Los_Angeles')::date),
    0
  );
$fn$;

revoke all on function public.consommer_quota(text, int) from public, anon;
grant execute on function public.quota_du_jour(text) to authenticated;

-- Reglages du quota, modifiables depuis l'admin sans toucher au code.
insert into public.app_settings (key, value)
values ('quota_youtube', '{"quota_journalier": 10000, "cout_envoi": 1600, "seuil_alerte": 0.8}'::jsonb)
on conflict (key) do nothing;

comment on table public.quota_usage is
  'Unites d''API consommees par jour et par plateforme. Le quota YouTube appartient au projet Google, pas a la chaine.';
