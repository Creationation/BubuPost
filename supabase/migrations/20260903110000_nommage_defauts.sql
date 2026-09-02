-- Les valeurs de nommage, alignees sur la configuration reelle de Diego.
--
-- Deux points valent d'etre notes.
--
-- La langue par defaut est l'ANGLAIS. Les trois marques publient en anglais ;
-- seule l'interface de l'application est en francais, ce qui n'a rien a voir.
-- La valeur LANGUE_DEFAUT du reste de l'app reste 'fr' et doit le rester :
-- elle sert a lire les publications creees avant l'ajout des langues, qui
-- etaient bien en francais. Ce sont deux defauts differents.
--
-- Sur un nom non conforme, on met de cote. Diego l'a demande explicitement :
-- il prefere renommer un fichier que decouvrir une publication imprevue.

update public.automation_config
set reglages = jsonb_set(
      reglages,
      '{nommage}',
      '{
        "separateur": "_",
        "ordre": ["marque", "sujet", "langue"],
        "surNonConforme": "rejeter",
        "defauts": { "marque": "", "langue": "en" },
        "languesReconnues": ["en", "fr"]
      }'::jsonb
    ),
    updated_at = now()
where id = true;
