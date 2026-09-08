-- Reprendre une archive au bon endroit.
--
-- Le dossier TradeReels contient 77 videos couvrant deux mois et demi, dont
-- une partie a deja ete publiee a la main. Le brancher tel quel les ferait
-- toutes entrer en reserve, y compris celles qui sont deja parties.
--
-- D'ou un point de depart : « tout ce qui precede ce dossier-la est fait,
-- commence a partir de lui et remonte le temps ». C'est une date, parce que
-- c'est ce que le dossier JJMMAAAA designe, et parce qu'une date se compare
-- alors que « 01072026 » et « 26062026 » se comparent mal.

alter table public.watch_folders
  -- Inclusive : la journee designee est traitee, celles d'avant sont ignorees.
  add column if not exists depuis_date date;

comment on column public.watch_folders.depuis_date is
  'Premiere journee a traiter, incluse. Ce qui precede est considere comme deja publie.';

-- ---------------------------------------------------------------------------
-- Ce que le watcher voit sur le disque.
-- ---------------------------------------------------------------------------
-- L'application ne voit pas le disque de Diego. Sans cet inventaire, choisir
-- le point de depart voudrait dire taper une date de tete, en esperant qu'un
-- dossier lui corresponde. Le watcher rapporte donc ce qu'il trouve, et
-- l'ecran propose la vraie liste.
alter table public.watch_folders
  add column if not exists inventaire      jsonb,
  add column if not exists inventaire_vu_a timestamptz;

comment on column public.watch_folders.inventaire is
  'Journees vues sur le disque au dernier passage : [{ "date": "2026-09-07", "dossier": "07092026", "videos": 3 }]';
