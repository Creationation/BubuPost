-- Consignes de generation, par plateforme et par marque.
--
-- Elles vivaient en dur dans generate-caption/index.ts. Chaque ajustement de
-- ton passait donc par un redeploiement de fonction. Ici, Diego les modifie
-- depuis l'application.
--
-- Une table plutot que des cles dans app_settings : il y a une ligne par
-- plateforme et une par marque, chacune avec sa date de modification, et
-- app_settings est charge en entier par la page Admin a chaque visite.

create table if not exists public.consignes (
  portee     text not null check (portee in ('plateforme', 'marque')),
  cle        text not null,
  reglages   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (portee, cle)
);

alter table public.consignes enable row level security;

drop policy if exists consignes_read on public.consignes;
create policy consignes_read on public.consignes
  for select to authenticated using (true);

drop policy if exists consignes_write on public.consignes;
create policy consignes_write on public.consignes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.touch_consignes()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists consignes_touch on public.consignes;
create trigger consignes_touch before update on public.consignes
  for each row execute function public.touch_consignes();

-- ---------------------------------------------------------------------------
-- Valeurs de depart par plateforme.
--
-- Elles reprennent les briefs qui etaient codes en dur, en les rendant
-- explicites : longueurs, nombre de hashtags, interdits mecaniques.
-- Les codes d'interdits sont verifies automatiquement avant enregistrement.
-- ---------------------------------------------------------------------------

insert into public.consignes (portee, cle, reglages) values

('plateforme', 'instagram', '{
  "longueurMin": 80,
  "longueurMax": 300,
  "hashtagsMin": 5,
  "hashtagsMax": 8,
  "placementHashtags": "fin",
  "ton": "Visuel et direct. On decrit ce qu''on voit autant que ce qu''on dit.",
  "structure": "Une accroche forte des le premier mot, puis deux a quatre lignes. Pas de long appel a l''action.",
  "interdits": ["tiret-cadratin", "hashtag-dans-texte"],
  "interditsLibres": "Pas de formules toutes faites du type << tu ne vas pas y croire >> ou << la methode que personne ne connait >>."
}'::jsonb),

('plateforme', 'facebook', '{
  "longueurMin": 150,
  "longueurMax": 500,
  "hashtagsMin": 0,
  "hashtagsMax": 3,
  "placementHashtags": "fin",
  "ton": "Plus narratif. On raconte, on prend le temps de poser le contexte.",
  "structure": "Trois a cinq lignes en phrases completes. Le contexte d''abord, l''idee ensuite.",
  "interdits": ["tiret-cadratin", "hashtag-dans-texte"],
  "interditsLibres": ""
}'::jsonb),

('plateforme', 'threads', '{
  "longueurMin": 50,
  "longueurMax": 200,
  "hashtagsMin": 0,
  "hashtagsMax": 2,
  "placementHashtags": "fin",
  "ton": "Conversationnel, comme un message a des gens qui suivent deja.",
  "structure": "Une a trois lignes. Une seule idee.",
  "interdits": ["tiret-cadratin"],
  "interditsLibres": ""
}'::jsonb),

('plateforme', 'tiktok', '{
  "longueurMin": 30,
  "longueurMax": 150,
  "hashtagsMin": 3,
  "hashtagsMax": 5,
  "placementHashtags": "fin",
  "ton": "Natif de la plateforme, accrocheur des le premier mot.",
  "structure": "Une a deux lignes, pas plus.",
  "interdits": ["tiret-cadratin", "hashtag-dans-texte"],
  "interditsLibres": ""
}'::jsonb),

-- YouTube porte quatre jeux de regles : titre et description, pour un Short et
-- pour une video longue. Un titre de Short et un titre de video classique ne
-- s''ecrivent pas du tout de la meme facon.
('plateforme', 'youtube', '{
  "longueurMin": 80,
  "longueurMax": 350,
  "hashtagsMin": 3,
  "hashtagsMax": 5,
  "placementHashtags": "fin",
  "ton": "Clair et informatif.",
  "structure": "Une phrase qui dit ce que la video montre, puis le detail.",
  "interdits": ["tiret-cadratin"],
  "interditsLibres": "",
  "variantes": {
    "short_titre": {
      "longueurMin": 20,
      "longueurMax": 90,
      "hashtagsMin": 0,
      "hashtagsMax": 0,
      "placementHashtags": "fin",
      "ton": "Court et clair, il sert de premiere ligne.",
      "structure": "Une seule phrase, sans point final.",
      "interdits": ["tiret-cadratin", "emoji"],
      "interditsLibres": ""
    },
    "short_description": {
      "longueurMin": 80,
      "longueurMax": 350,
      "hashtagsMin": 3,
      "hashtagsMax": 5,
      "placementHashtags": "fin",
      "ton": "Direct, il prolonge le titre sans le repeter.",
      "structure": "Deux a quatre lignes.",
      "interdits": ["tiret-cadratin"],
      "interditsLibres": ""
    },
    "video_titre": {
      "longueurMin": 55,
      "longueurMax": 70,
      "hashtagsMin": 0,
      "hashtagsMax": 0,
      "placementHashtags": "fin",
      "ton": "Optimise pour la recherche YouTube. Les mots que les gens tapent reellement.",
      "structure": "Entre 55 et 70 caracteres, pour ne pas etre tronque dans les resultats.",
      "interdits": ["tiret-cadratin", "emoji", "exclamation", "majuscules"],
      "interditsLibres": "Pas d''appat a clic. Le titre doit decrire ce que la video contient vraiment."
    },
    "video_description": {
      "longueurMin": 300,
      "longueurMax": 1200,
      "hashtagsMin": 5,
      "hashtagsMax": 8,
      "placementHashtags": "fin",
      "ton": "Informatif, ecrit pour quelqu''un qui hesite a lancer la video.",
      "structure": "Deux ou trois phrases qui donnent envie et reprennent les mots-cles des les premieres lignes, puis un court sommaire de ce que la video couvre.",
      "interdits": ["tiret-cadratin"],
      "interditsLibres": ""
    }
  }
}'::jsonb)

on conflict (portee, cle) do nothing;

-- ---------------------------------------------------------------------------
-- Marques.
--
-- EdgeSyncFX est renseignee : la niche et l''avertissement sur le risque sont
-- connus. Les deux autres sont creees vides plutot qu''inventees : une consigne
-- de marque fausse est pire que pas de consigne du tout, elle oriente chaque
-- texte dans la mauvaise direction sans qu''on s''en apercoive.
-- ---------------------------------------------------------------------------

insert into public.consignes (portee, cle, reglages) values

('marque', 'EdgeSyncFX', '{
  "niche": "Trading algorithmique et forex. Robots d''execution sur MetaTrader 5, gestion du risque, lecture de marche.",
  "audience": "Traders particuliers qui connaissent deja les bases et cherchent a automatiser leur execution plutot qu''a apprendre a trader.",
  "ton": "Technique et sobre. On montre des chiffres et des mecaniques, on ne promet pas de gains.",
  "vocabulairePrefere": "execution, gestion du risque, drawdown, backtest, parametrage, discipline",
  "vocabulaireEvite": "argent facile, devenir riche, secret, garanti, sans risque, revenus passifs",
  "appelAction": "",
  "hashtags": ["trading", "forex", "tradingalgorithmique", "mt5"],
  "mentionsLegales": "Le trading comporte un risque de perte en capital. Ceci n''est pas un conseil en investissement."
}'::jsonb),

('marque', 'BigBossGrowth', '{
  "niche": "",
  "audience": "",
  "ton": "",
  "vocabulairePrefere": "",
  "vocabulaireEvite": "",
  "appelAction": "",
  "hashtags": [],
  "mentionsLegales": ""
}'::jsonb),

('marque', 'CosmicSucces', '{
  "niche": "",
  "audience": "",
  "ton": "",
  "vocabulairePrefere": "",
  "vocabulaireEvite": "",
  "appelAction": "",
  "hashtags": [],
  "mentionsLegales": ""
}'::jsonb)

on conflict (portee, cle) do nothing;
