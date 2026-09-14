-- « Ou j en suis » : la vue par fichier source disait programmee ou en file,
-- jamais PUBLIEE. Pour savoir ce qui est parti sans ouvrir chaque campagne,
-- chaque marque porte desormais son etat complet, et les lignes se trient
-- dans l ordre du tournage (rang), pas dans l ordre alphabetique de la cle.
drop view if exists public.sources_etat;
create view public.sources_etat as
select
  b.source_cle,
  b.fichier,
  min(b.created_at)                                     as vue_le,
  min(b.rang)                                           as rang,
  count(*)                                              as marques_ingerees,
  array_agg(b.marque order by b.marque)                 as marques,
  array_agg(b.statut order by b.marque)                 as statuts,
  count(*) filter (where b.statut = 'programmee')       as marques_programmees,
  count(*) filter (where b.statut = 'en_file')          as marques_en_file,
  count(*) filter (where b.statut = 'en_pause')         as marques_en_pause,
  (
    select count(*) from public.posts p
    where p.campaign_id = any(
      array(select campaign_id from public.bibliotheque b2
            where b2.source_cle = b.source_cle and b2.campaign_id is not null)
    )
    and p.status = 'published'
  )                                                     as publications_parties,
  jsonb_agg(
    jsonb_build_object(
      'marque', b.marque,
      'statut', b.statut,
      'programmee_pour', b.programmee_pour,
      'total', (select count(*) from public.posts p where p.campaign_id = b.campaign_id),
      'publiees', (select count(*) from public.posts p where p.campaign_id = b.campaign_id and p.status = 'published'),
      'echecs', (select count(*) from public.posts p where p.campaign_id = b.campaign_id and p.status = 'failed'),
      'en_attente', (select count(*) from public.posts p where p.campaign_id = b.campaign_id and p.status in ('pending', 'processing', 'a_valider'))
    )
    order by b.marque
  )                                                     as etats
from public.bibliotheque b
where b.source_cle is not null
group by b.source_cle, b.fichier;
