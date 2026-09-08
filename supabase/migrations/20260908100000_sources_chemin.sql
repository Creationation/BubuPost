-- Ingerer un dossier deja organise, sans le deranger.
--
-- Le cas reel : C:\TradeReels\ready_to_post, range en DDMMYYYY/N_creneau/,
-- 77 videos, une par creneau de la journee. Trois choses ne collaient pas.
--
-- 1. Le nom du fichier ne porte ni marque, ni sujet, ni langue. La regle
--    « marque_sujet_langue » y lisait marque=07092026, sujet=1, langue=matin.
--    D'ou un second mode de lecture, ou c'est le CHEMIN qui informe.
--
-- 2. Les fichiers sont deux niveaux plus bas que le dossier surveille. Le
--    watcher ne lisait que la racine.
--
-- 3. Deplacer les fichiers vers « traite » detruirait l'archive par date, qui
--    appartient au pipeline TradeReels. On peut donc ne pas les deplacer, et
--    se souvenir a la place.
--
-- Et une decision : un fichier alimente PLUSIEURS marques. Diego publie la
-- meme video sur ses trois marques avec des textes differents, donc une
-- entree de bibliotheque par marque, chacune dans sa propre file.

alter table public.watch_folders
  add column if not exists recursif      boolean not null default false,
  add column if not exists deplacer      boolean not null default true,
  -- Plusieurs marques alimentees par le meme dossier. La colonne `marque`
  -- reste pour les dossiers a marque unique, deja configures.
  add column if not exists marques       text[],
  add column if not exists mode_nommage  text not null default 'champs'
      check (mode_nommage in ('champs', 'chemin')),
  -- Modele de sujet, avec {date} et {creneau}. Sert quand le nom du fichier
  -- ne porte pas de sujet.
  add column if not exists modele_sujet  text;

-- ---------------------------------------------------------------------------
-- L'identite stable d'un fichier source.
-- ---------------------------------------------------------------------------
-- Le chemin relatif au dossier surveille : 07092026/1_matin/07092026_1_matin.mp4
-- Il ne change pas quand le fichier n'est pas deplace, et il se lit.
alter table public.bibliotheque
  add column if not exists source_cle text;

-- Le verrou anti-doublon, exactement au bon endroit : un fichier ne peut
-- entrer qu'UNE FOIS par marque. Rejouer le dossier entier ne cree rien de
-- nouveau, et une marque ajoutee plus tard rattrape son retard toute seule.
create unique index if not exists bibliotheque_source_marque_idx
  on public.bibliotheque (source_cle, marque)
  where source_cle is not null;

create index if not exists bibliotheque_source_idx
  on public.bibliotheque (source_cle)
  where source_cle is not null;

-- ---------------------------------------------------------------------------
-- Ce qui a deja ete fait, par fichier source.
-- ---------------------------------------------------------------------------
-- Une vue plutot qu'une table : l'information existe deja dans bibliotheque et
-- posts, la dupliquer garantirait qu'un jour les deux se contredisent.
create or replace view public.sources_etat as
select
  b.source_cle,
  b.fichier,
  min(b.created_at)                                     as vue_le,
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
  )                                                     as publications_parties
from public.bibliotheque b
where b.source_cle is not null
group by b.source_cle, b.fichier;
