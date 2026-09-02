-- Les trois marques, remplies.
--
-- Ce que Diego a precise le 2 septembre 2026 : les trois marques publient les
-- MEMES videos avec des textes differents, et tout doit ramener vers
-- EdgeSyncFX, qui est la destination.
--
-- Elles partagent donc le sujet, le vocabulaire interdit et l'avertissement
-- legal. Ce qui les separe, c'est l'ANGLE et le PUBLIC : sans cela, trois
-- textes ecrits sur la meme video pour le meme sujet se ressembleraient, ce
-- qui est exactement ce que la diffusion multi-comptes cherche a eviter.
--
-- EdgeSyncFX parle produit, BigBossGrowth parle resultat et methode,
-- CosmicSucces parle parcours et discipline. Les trois assument le meme fond
-- technique, avec des entrees differentes.

update public.consignes set reglages = '{
  "niche": "Trading algorithmique et forex. Robots d''execution sur MetaTrader 5, gestion du risque, lecture de marche. C''est la marque de destination : le produit et les resultats detailles sont ici.",
  "audience": "Traders particuliers qui connaissent deja les bases et cherchent a automatiser leur execution plutot qu''a apprendre a trader.",
  "ton": "Technique et sobre. On montre des chiffres, des reglages et des mecaniques. On ne promet jamais de gains.",
  "vocabulairePrefere": "execution, gestion du risque, drawdown, backtest, parametrage, discipline, invalidation, taille de position",
  "vocabulaireEvite": "argent facile, devenir riche, secret, garanti, sans risque, revenus passifs, methode miracle, gains assures",
  "appelAction": "Renvoyer vers le detail du fonctionnement, sans insister. Pas de vente directe : la personne est deja sur le compte de destination.",
  "hashtags": {
    "fr": ["trading", "forex", "tradingalgorithmique", "mt5", "gestiondurisque"]
  },
  "mentionsLegales": {
    "fr": "Le trading comporte un risque de perte en capital. Ceci n''est pas un conseil en investissement."
  }
}'::jsonb
where portee = 'marque' and cle = 'EdgeSyncFX';

update public.consignes set reglages = '{
  "niche": "Meme sujet qu''EdgeSyncFX, trading algorithmique et forex, aborde par le resultat et la methode plutot que par la technique. Ce compte sert d''entree : il fait decouvrir, il ne conclut pas.",
  "audience": "Gens qui veulent construire un revenu serieux et cherchent une methode qui tienne dans la duree. Ils ne connaissent pas forcement le vocabulaire technique du trading.",
  "ton": "Direct et concret, oriente methode. On part d''une erreur courante ou d''un chiffre, on explique ce qui la corrige. Jamais de motivation creuse ni de promesse de rendement.",
  "vocabulairePrefere": "methode, regularite, process, decision, cadre, automatisation, temps gagne, erreur evitee",
  "vocabulaireEvite": "argent facile, devenir riche, secret, garanti, sans risque, revenus passifs, methode miracle, gains assures, liberte financiere",
  "appelAction": "Terminer en renvoyant vers le compte EdgeSyncFX, nomme explicitement @edgesyncfx.app, ou le fonctionnement est detaille. Une phrase courte, sans point d exclamation.",
  "hashtags": {
    "fr": ["trading", "mindsettrading", "discipline", "automatisation", "entrepreneuriat"]
  },
  "mentionsLegales": {
    "fr": "Le trading comporte un risque de perte en capital. Ceci n''est pas un conseil en investissement."
  }
}'::jsonb
where portee = 'marque' and cle = 'BigBossGrowth';

update public.consignes set reglages = '{
  "niche": "Meme sujet qu''EdgeSyncFX, trading algorithmique et forex, aborde par le parcours et la discipline plutot que par la technique. Ce compte sert d''entree : il fait decouvrir, il ne conclut pas.",
  "audience": "Gens attires par le trading pour ce qu''il change dans une journee, et qui sous-estiment la part de rigueur que ca demande.",
  "ton": "Narratif et pose. On raconte une situation, ce qu''elle a coute, ce qu''on en a tire. On assume que c''est lent. Jamais de mise en scene de reussite.",
  "vocabulairePrefere": "patience, rigueur, habitude, recul, apprentissage, constance, ce que ca demande vraiment",
  "vocabulaireEvite": "argent facile, devenir riche, secret, garanti, sans risque, revenus passifs, methode miracle, gains assures, liberte financiere, train de vie",
  "appelAction": "Terminer en renvoyant vers le compte EdgeSyncFX, nomme explicitement @edgesyncfx.app, ou le fonctionnement est detaille. Une phrase courte, sans point d exclamation.",
  "hashtags": {
    "fr": ["trading", "parcourstrading", "constance", "financespersonnelles", "apprentissage"]
  },
  "mentionsLegales": {
    "fr": "Le trading comporte un risque de perte en capital. Ceci n''est pas un conseil en investissement."
  }
}'::jsonb
where portee = 'marque' and cle = 'CosmicSucces';
