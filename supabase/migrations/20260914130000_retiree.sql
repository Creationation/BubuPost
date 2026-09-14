-- Retirer une video de la reserve la supprimait : plus aucune trace, et
-- l ecran « Ou j en suis » ne pouvait plus dire ce qu elle etait devenue.
-- Elle reste, marquee retiree : hors de la file, hors du moteur, visible.
alter table public.bibliotheque drop constraint if exists bibliotheque_statut_check;
alter table public.bibliotheque
  add constraint bibliotheque_statut_check
  check (statut in ('en_file', 'en_pause', 'programmee', 'retiree'));
