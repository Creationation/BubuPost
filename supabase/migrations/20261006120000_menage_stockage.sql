-- Les fichiers du stockage dont plus personne n'a besoin.
--
-- Un fichier sert encore si une publication A VENIR le reclame, ou si une
-- entree de la reserve attend son tour. Une video deja publiee n'a plus besoin
-- de son fichier : la plateforme en a sa copie, et l'original est sur le disque
-- de Diego. Garder le reste a fini par remplir le quota et couper le service,
-- le 6 octobre 2026.
create or replace function public.fichiers_inutiles(p_limite integer default 200)
returns table (chemin text, taille bigint)
language sql
security definer
set search_path = public, storage
as $$
  with utiles as (
    select regexp_replace(video_url, '^.*/videos/', '') as nom
      from public.posts
     where video_url is not null
       and status in ('pending', 'a_valider', 'processing')
    union
    select regexp_replace(thumbnail_url, '^.*/videos/', '')
      from public.posts
     where thumbnail_url is not null
       and status in ('pending', 'a_valider', 'processing')
    union
    select regexp_replace(video_url, '^.*/videos/', '')
      from public.bibliotheque
     where video_url is not null
       and statut in ('en_file', 'en_pause')
    union
    select regexp_replace(image_fin, '^.*/videos/', '')
      from public.bibliotheque
     where image_fin is not null
       and statut in ('en_file', 'en_pause')
  )
  select o.name, coalesce((o.metadata->>'size')::bigint, 0)
    from storage.objects o
   where o.bucket_id = 'videos'
     and o.name not in (select nom from utiles where nom is not null)
   order by o.created_at
   limit greatest(p_limite, 1);
$$;

revoke all on function public.fichiers_inutiles(integer) from public, anon, authenticated;

comment on function public.fichiers_inutiles(integer) is
  'Les fichiers du bucket videos que plus aucune publication a venir ni entree de reserve ne reclame.';
