-- Un compte fraichement connecte arrivait en francais : c'etait le defaut de
-- la colonne, pose avant que la regle soit claire. Les comptes publient en
-- anglais, seule l'interface est en francais. Le defaut suit.
alter table public.accounts alter column language set default 'en';
