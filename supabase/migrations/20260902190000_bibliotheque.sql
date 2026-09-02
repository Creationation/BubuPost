-- La bibliotheque : ce qui separe l'ingestion de la programmation.
--
-- Avant, le watcher creait la campagne au moment ou il ramassait le fichier.
-- L'ordre de publication suivait donc l'ordre alphabetique du dossier, ce qui
-- est un choix technique la ou il faut un choix editorial.
--
-- Desormais le watcher ne fait que deposer. La bibliotheque garde les videos
-- en file, Diego les ordonne, et le moteur de cadence les pioche par le haut.

create table if not exists public.bibliotheque (
  id          uuid primary key default gen_random_uuid(),

  video_url   text not null,
  fichier     text not null,
  taille      bigint,

  -- Lu dans le nom du fichier, corrigeable a la main depuis l'app : un nom mal
  -- forme ne doit pas condamner la video.
  marque      text not null,
  sujet       text not null,
  langue      text,
  profil      text,

  /*
   * Rang editorial, en flottant.
   *
   * Deposer une video entre deux autres se fait en prenant la moyenne des deux
   * rangs voisins : une seule ecriture, au lieu de renumeroter toute la file a
   * chaque glisser-deposer. Une renumerotation reste possible quand l'ecart
   * entre deux rangs devient trop petit.
   */
  rang        double precision not null default 0,

  -- Passe devant tout le reste, quel que soit le rang.
  prioritaire boolean not null default false,

  -- en_file    : eligible, le moteur peut la piocher
  -- en_pause   : gardee en reserve, jamais piochee
  -- programmee : sa campagne existe, elle sort de la file
  statut      text not null default 'en_file'
              check (statut in ('en_file', 'en_pause', 'programmee')),

  -- Renseignes quand la campagne a ete creee.
  campaign_id uuid,
  programmee_pour timestamptz,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- L'ordre de pioche, exactement : les prioritaires d'abord, puis le rang.
create index if not exists bibliotheque_file_idx
  on public.bibliotheque (statut, prioritaire desc, rang asc);

create index if not exists bibliotheque_marque_idx on public.bibliotheque (marque, statut);

alter table public.bibliotheque enable row level security;

drop policy if exists bibliotheque_read on public.bibliotheque;
create policy bibliotheque_read on public.bibliotheque
  for select to authenticated using (true);

drop policy if exists bibliotheque_write on public.bibliotheque;
create policy bibliotheque_write on public.bibliotheque
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.touch_bibliotheque()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists bibliotheque_touch on public.bibliotheque;
create trigger bibliotheque_touch before update on public.bibliotheque
  for each row execute function public.touch_bibliotheque();

-- ---------------------------------------------------------------------------
-- Le rang d'une nouvelle entree : a la fin de la file de sa marque.
-- ---------------------------------------------------------------------------
create or replace function public.rang_suivant(p_marque text)
returns double precision language sql stable as $$
  select coalesce(max(rang), 0) + 1000
  from public.bibliotheque
  where marque = p_marque and statut <> 'programmee';
$$;

-- ---------------------------------------------------------------------------
-- Renumerotation d'une marque.
--
-- Apres beaucoup d'inserts entre deux voisins, l'ecart entre rangs finit par
-- approcher la precision du flottant. On remet alors des rangs bien espaces,
-- sans changer l'ordre.
-- ---------------------------------------------------------------------------
create or replace function public.renumeroter_bibliotheque(p_marque text)
returns integer language plpgsql as $$
declare
  n integer := 0;
begin
  with ordonnee as (
    select id, row_number() over (order by prioritaire desc, rang asc, created_at asc) as position
    from public.bibliotheque
    where marque = p_marque and statut <> 'programmee'
  )
  update public.bibliotheque b
  set rang = o.position * 1000
  from ordonnee o
  where b.id = o.id;

  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reglages du moteur, ajoutes a la configuration existante.
-- ---------------------------------------------------------------------------
update public.automation_config
set reglages = reglages
  || jsonb_build_object(
       'moteur', jsonb_build_object(
         'actif', false,
         -- Jusqu'ou le moteur remplit a l'avance. Trois jours laissent le temps
         -- de voir venir sans figer un mois de programmation.
         'horizonJours', 3
       ),
       'reserve', jsonb_build_object(
         'seuilParDefaut', 3,
         'seuilParMarque', '{}'::jsonb
       )
     )
where id = true
  and not (reglages ? 'moteur');
