-- Renouvellement quotidien des tokens TikTok.
--
-- Un access token TikTok ne vit que 24 h. Sans ce passage, la premiere
-- publication du lendemain echouerait et il faudrait tout reconnecter a la
-- main. On passe a 4 h du matin, loin des heures de publication.
--
-- Comme pour le scheduler, la cle service_role est lue dans le Vault Supabase,
-- elle n'apparait pas dans ce fichier.

create or replace function public.run_tiktok_refresh()
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
    raise warning 'BubuPost : secret bubupost_service_key absent du Vault, renouvellement TikTok non appele';
    return;
  end if;

  perform net.http_post(
    url     := project_url || '/functions/v1/tiktok-refresh-tokens',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$fn$;

revoke all on function public.run_tiktok_refresh() from public, anon, authenticated;

select cron.unschedule('bubupost-tiktok-refresh')
where exists (select 1 from cron.job where jobname = 'bubupost-tiktok-refresh');

select cron.schedule('bubupost-tiktok-refresh', '0 4 * * *', 'select public.run_tiktok_refresh()');
