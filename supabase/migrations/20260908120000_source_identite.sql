-- Un dossier surveille est une SOURCE, pas une marque.
--
-- Le formulaire demandait « la marque du dossier », ce qui laissait croire
-- qu'un dossier appartient a une marque. Diego a corrige : chaque dossier a sa
-- propre identite, et son contenu est ensuite distribue vers les marques ou il
-- doit paraitre. Un meme dossier de reels de trading alimente les trois.
--
-- D'ou un nom : « Reels de trading », « Shorts motivation ». C'est ce nom qui
-- apparait dans les listes, pas un chemin Windows de soixante caracteres.

alter table public.watch_folders
  add column if not exists nom text;

comment on column public.watch_folders.nom is
  'Nom de la source, ce que contient ce dossier. Pas une marque : une source alimente plusieurs marques.';

-- Les dossiers deja crees prennent le nom de leur dernier segment de chemin,
-- ce qui vaut mieux que rien et se corrige en un clic.
update public.watch_folders
set nom = regexp_replace(chemin, '^.*[\\/]', '')
where nom is null;
