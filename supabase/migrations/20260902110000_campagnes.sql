-- La notion de campagne : une video, plusieurs comptes, un texte par compte.
--
-- La colonne group_id faisait deja exactement ce travail. On la renomme plutot
-- que d'ajouter campaign_id a cote : deux colonnes pour la meme idee, c'est la
-- garantie qu'un jour l'une sera remplie et pas l'autre. Le renommage preserve
-- les donnees existantes.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'posts' and column_name = 'group_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'posts' and column_name = 'campaign_id'
  ) then
    alter table public.posts rename column group_id to campaign_id;
  end if;
end
$$;

alter table public.posts add column if not exists campaign_id uuid;

drop index if exists idx_posts_group;
create index if not exists idx_posts_campaign on public.posts (campaign_id);

comment on column public.posts.campaign_id is
  'Relie les publications issues d''une meme video. Nul pour une publication simple.';
