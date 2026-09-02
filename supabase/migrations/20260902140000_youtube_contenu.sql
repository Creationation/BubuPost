-- Type de contenu YouTube, et champs propres a la video classique.
--
-- Un Short et une video longue ne se preparent pas pareil. Le Short vit de sa
-- premiere seconde, la video longue vit de son titre dans la recherche et de sa
-- description. YouTube separe d'ailleurs titre et description, contrairement
-- aux autres plateformes qui n'ont qu'une legende.
alter table public.posts add column if not exists youtube_type text;
alter table public.posts drop constraint if exists posts_youtube_type_check;
alter table public.posts add constraint posts_youtube_type_check
  check (youtube_type is null or youtube_type in ('short', 'video'));

-- Titre distinct. Reste nul pour un Short, ou il est tire de la legende, et
-- pour les autres plateformes qui n'ont pas de titre.
alter table public.posts add column if not exists title text;

-- Miniature personnalisee, reservee a la video classique : YouTube l'ignore
-- sur un Short.
alter table public.posts add column if not exists thumbnail_url text;

comment on column public.posts.youtube_type is
  'short ou video. Nul pour les publications qui ne visent pas YouTube.';
comment on column public.posts.title is
  'Titre YouTube. Pour un Short il est derive de la legende si absent.';
comment on column public.posts.thumbnail_url is
  'Miniature personnalisee, video classique uniquement. Coute 50 unites de quota.';

-- Le cout de la miniature s'ajoute a celui de l'envoi.
update public.app_settings
set value = value || '{"cout_miniature": 50}'::jsonb,
    updated_at = now()
where key = 'quota_youtube';
