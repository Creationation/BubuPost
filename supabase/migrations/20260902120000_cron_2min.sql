-- Le scheduler passe de 5 a 2 minutes.
--
-- L'intervalle est aussi range dans app_settings : le compte a rebours de
-- l'interface doit lire la valeur reelle, pas une constante ecrite en dur.
-- Les deux changent ici, ensemble, pour qu'ils ne puissent pas diverger.

select cron.unschedule('bubupost-scheduler')
where exists (select 1 from cron.job where jobname = 'bubupost-scheduler');

select cron.schedule('bubupost-scheduler', '*/2 * * * *', 'select public.run_scheduler()');

insert into public.app_settings (key, value)
values ('scheduler', '{"interval_minutes": 2}'::jsonb)
on conflict (key) do update
  set value = '{"interval_minutes": 2}'::jsonb,
      updated_at = now();

comment on table public.scheduler_runs is
  'Un enregistrement par passage du scheduler. Sert au compte a rebours de l''interface. La cadence est dans app_settings, cle scheduler.';
