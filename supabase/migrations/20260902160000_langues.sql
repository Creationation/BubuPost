-- Langue de publication, par compte et par publication.
--
-- Tout etait ecrit en francais. Certains comptes visent un public anglophone,
-- et une meme video peut partir en francais sur un compte et en anglais sur un
-- autre.
--
-- Deux niveaux, volontairement :
--   accounts.language : la langue habituelle du compte, ce qui evite de la
--                       choisir a chaque campagne.
--   posts.language    : la surcharge, quand une campagne fait exception.
--
-- posts.language reste NULLABLE et sans valeur par defaut. Une publication
-- creee avant aujourd'hui n'a donc pas de langue, et l'application la lit
-- comme du francais : les campagnes existantes continuent exactement comme
-- avant. Mettre un defaut ici aurait fait la meme chose en apparence, mais on
-- ne saurait plus distinguer « francais choisi » de « jamais renseigne ».

alter table public.accounts
  add column if not exists language text not null default 'fr';

alter table public.posts
  add column if not exists language text;

-- Les codes sont ceux d'ISO 639-1, en deux lettres minuscules. La contrainte
-- reste large : ajouter une langue ne doit pas demander une migration.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'accounts_language_format'
  ) then
    alter table public.accounts
      add constraint accounts_language_format check (language ~ '^[a-z]{2}$');
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'posts_language_format'
  ) then
    alter table public.posts
      add constraint posts_language_format check (language is null or language ~ '^[a-z]{2}$');
  end if;
end $$;

-- Filtrer le calendrier par langue doit rester instantane a trente-trois
-- publications par jour.
create index if not exists posts_language_idx on public.posts (language);
