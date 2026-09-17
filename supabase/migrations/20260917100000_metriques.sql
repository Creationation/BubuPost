-- La derniere image de chaque video porte le tableau de bord de la session
-- (profit du jour, profit total, drawdown, spread, positions ouvertes). On la
-- garde, et ce qu on y lit, pour que les textes citent des chiffres vrais.
alter table public.bibliotheque
  add column if not exists image_fin text,
  add column if not exists metriques jsonb;

comment on column public.bibliotheque.image_fin is 'Derniere image de la video, ou se lit le tableau de bord de la session.';
comment on column public.bibliotheque.metriques is 'Ce que le modele a lu sur cette image : profit du jour, profit total, drawdown, spread, etc.';
