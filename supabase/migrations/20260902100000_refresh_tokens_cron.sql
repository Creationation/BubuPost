-- Le renouvellement quotidien couvre desormais TikTok et Instagram.
--
-- La fonction s'appelait tiktok-refresh-tokens, ce qui devenait faux des lors
-- qu'elle prolonge aussi les jetons Meta. On pointe le cron vers refresh-tokens
-- et on retire l'ancien job.

create or replace function public.run_refresh_tokens()
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
    raise warning 'BubuPost : secret bubupost_service_key absent du Vault, renouvellement non appele';
    return;
  end if;

  perform net.http_post(
    url     := project_url || '/functions/v1/refresh-tokens',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end;
$fn$;

revoke all on function public.run_refresh_tokens() from public, anon, authenticated;

-- L'ancien job, devenu obsolete.
select cron.unschedule('bubupost-tiktok-refresh')
where exists (select 1 from cron.job where jobname = 'bubupost-tiktok-refresh');

select cron.unschedule('bubupost-refresh-tokens')
where exists (select 1 from cron.job where jobname = 'bubupost-refresh-tokens');

select cron.schedule('bubupost-refresh-tokens', '0 4 * * *', 'select public.run_refresh_tokens()');

-- L'ancienne fonction SQL ne sert plus a rien.
drop function if exists public.run_tiktok_refresh();
