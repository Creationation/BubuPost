-- Declenchement du scheduler toutes les 5 minutes.
--
-- La cle service_role n'est PAS ecrite ici : elle est rangee dans le Vault
-- Supabase sous le nom 'bubupost_service_key' et lue au moment de l'appel.
-- Ce fichier peut donc vivre dans Git sans rien exposer.
--
-- Prerequis, a faire une seule fois hors du depot :
--   select vault.create_secret('<cle service_role>', 'bubupost_service_key');

-- Fonction appelee par le cron. La passer par une fonction plutot que de mettre
-- l'appel http directement dans cron.schedule rend le job lisible et modifiable
-- sans avoir a le recreer.
create or replace function public.run_scheduler()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  service_key text;
  project_url text := 'https://ztelymzqhojuxaxryuty.supabase.co';
begin
  select decrypted_secret into service_key
  from vault.decrypted_secrets
  where name = 'bubupost_service_key';

  if service_key is null then
    raise warning 'BubuPost : secret bubupost_service_key absent du Vault, scheduler non appele';
    return;
  end if;

  perform net.http_post(
    url     := project_url || '/functions/v1/scheduler',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$fn$;

revoke all on function public.run_scheduler() from public, anon, authenticated;

-- Job toutes les 5 minutes. On le supprime d'abord pour rester rejouable.
select cron.unschedule('bubupost-scheduler')
where exists (select 1 from cron.job where jobname = 'bubupost-scheduler');

select cron.schedule('bubupost-scheduler', '*/5 * * * *', 'select public.run_scheduler()');
