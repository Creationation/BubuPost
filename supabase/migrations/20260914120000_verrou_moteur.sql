-- Un seul passage du moteur a la fois.
--
-- Le verrou par video empeche de programmer deux fois la meme, mais deux
-- passages qui se chevauchent lisent les memes creneaux libres et les
-- remplissent tous les deux : vu le 14/09, deux campagnes EdgeSyncFX a la
-- meme heure. Le bail expire tout seul, un passage plante ne bloque rien.
create or replace function public.prendre_verrou_moteur(p_ttl_secondes integer default 240)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  pris boolean;
begin
  insert into public.app_settings (key, value, updated_at)
  values ('moteur_verrou', jsonb_build_object('a', now()), now())
  on conflict (key) do update
    set value = jsonb_build_object('a', now()), updated_at = now()
    where (public.app_settings.value ->> 'a')::timestamptz < now() - make_interval(secs => p_ttl_secondes)
  returning true into pris;
  return coalesce(pris, false);
end;
$$;

create or replace function public.liberer_verrou_moteur()
returns void
language sql
security definer
set search_path = public
as $$
  update public.app_settings
  set value = jsonb_build_object('a', '1970-01-01T00:00:00Z'), updated_at = now()
  where key = 'moteur_verrou';
$$;

revoke all on function public.prendre_verrou_moteur(integer) from public, anon, authenticated;
revoke all on function public.liberer_verrou_moteur() from public, anon, authenticated;
