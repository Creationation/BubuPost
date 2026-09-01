-- Conserver les permissions reellement accordees par la plateforme.
--
-- Sans cette colonne, impossible de repondre a la question « ce compte a-t-il
-- le droit de publier ». Il fallait interroger l'API a la main pour le savoir,
-- alors que la plateforme nous le dit au moment de la connexion.
alter table public.accounts add column if not exists scope text;

comment on column public.accounts.scope is
  'Permissions accordees, telles que renvoyees par la plateforme lors de l''echange OAuth.';
