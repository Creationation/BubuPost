-- Le moteur de cadence tourne tout seul, comme le scheduler.
--
-- Toutes les quinze minutes : assez souvent pour qu'une video deposee le matin
-- soit programmee dans l'heure, assez rare pour qu'un passage qui appelle le
-- modele trois fois ne devienne pas une facture.
--
-- La cle service_role vient du Vault, jamais du code : meme mecanique que
-- run_scheduler, pour n'avoir qu'un seul endroit ou la changer.

create or replace function public.run_cadence()
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  service_key text;
  project_url text := 'https://ztelymzqhojuxaxryuty.supabase.co';
begin
  select decrypted_secret into service_key
  from vault.decrypted_secrets
  where name = 'bubupost_service_key';

  if service_key is null then
    raise warning 'BubuPost : secret bubupost_service_key absent du Vault, moteur de cadence non appele';
    return;
  end if;

  perform net.http_post(
    url     := project_url || '/functions/v1/cadence',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body    := '{}'::jsonb,
    -- Trois campagnes, donc trois appels au modele : il faut de la marge.
    timeout_milliseconds := 180000
  );
end;
$$;

select cron.unschedule('bubupost-cadence')
where exists (select 1 from cron.job where jobname = 'bubupost-cadence');

select cron.schedule('bubupost-cadence', '*/15 * * * *', $$select public.run_cadence();$$);
