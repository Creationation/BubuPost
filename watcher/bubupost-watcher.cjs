#!/usr/bin/env node
/**
 * BubuPost, surveillance de dossiers.
 *
 * Extension .cjs et non .js : le package.json du projet declare
 * "type": "module", et Node refuserait alors require() dans un .js.
 *
 * Ce script est volontairement bete. Il ne decide de rien, et il ne programme
 * RIEN : a chaque passage il demande a l'application ce qu'il doit surveiller,
 * puis il depose ce qu'il trouve dans la bibliotheque.
 *
 * Ce qui part en premier n'est pas son affaire. L'ordre de publication est un
 * choix editorial : Diego ordonne la file dans l'app, et le moteur de cadence
 * la vide. Un ramassage alphabetique n'a pas a decider de ca.
 *
 * Consequence directe : changer un reglage dans BubuPost change le
 * comportement au passage suivant. Ce fichier n'a pas a etre rouvert.
 *
 * Ce qu'il possede comme droit : un seul jeton, qui n'ouvre qu'une fonction.
 * Pas de session Supabase, donc aucun acces a la base, aucun jeton de
 * plateforme lisible depuis ce PC.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const VERSION = '1.0.0'
const CONFIG = path.join(__dirname, 'config.json')

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

const DOSSIER_LOGS = path.join(__dirname, 'logs')

function horodatage() {
  return new Date().toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' })
}

function ecrire(niveau, message) {
  const ligne = `${horodatage()}  ${niveau}  ${message}`
  console.log(ligne)

  try {
    if (!fs.existsSync(DOSSIER_LOGS)) fs.mkdirSync(DOSSIER_LOGS, { recursive: true })
    const jour = new Date().toISOString().slice(0, 10)
    fs.appendFileSync(path.join(DOSSIER_LOGS, `${jour}.log`), ligne + '\n')
  } catch {
    // Un journal qui n'arrive pas a s'ecrire ne doit pas arreter la
    // surveillance : le message est deja passe a l'ecran.
  }
}

const info = (m) => ecrire('  ', m)
const bien = (m) => ecrire('OK', m)
const souci = (m) => ecrire('!!', m)

// ---------------------------------------------------------------------------
// Configuration locale
// ---------------------------------------------------------------------------

function lireConfigLocale() {
  if (!fs.existsSync(CONFIG)) {
    souci(`Fichier de configuration absent : ${CONFIG}`)
    souci('Copie config.exemple.json en config.json et renseigne les deux valeurs.')
    process.exit(1)
  }

  let brut
  try {
    brut = JSON.parse(fs.readFileSync(CONFIG, 'utf8'))
  } catch (e) {
    souci(`Le fichier config.json n'est pas lisible : ${e.message}`)
    process.exit(1)
  }

  if (!brut.url || !brut.jeton) {
    souci('config.json doit contenir "url" et "jeton".')
    process.exit(1)
  }

  return {
    url: String(brut.url).replace(/\/$/, ''),
    jeton: String(brut.jeton),
    intervalleSecondes: Number(brut.intervalleSecondes) || 60,
    sousDossierTraite: brut.sousDossierTraite || 'traite',
    // Nombre d'echecs consecutifs sur un meme fichier avant d'alerter.
    echecsAvantAlerte: Number(brut.echecsAvantAlerte) || 3,
    // Chemin de ffmpeg si le script ne le trouve pas seul.
    ffmpeg: brut.ffmpeg ? String(brut.ffmpeg) : '',
  }
}

// ---------------------------------------------------------------------------
// Dialogue avec l'application
// ---------------------------------------------------------------------------

async function appeler(local, corps) {
  const res = await fetch(`${local.url}/functions/v1/watcher`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-bubupost-watcher': local.jeton,
    },
    body: JSON.stringify(corps),
  })

  let donnees
  try {
    donnees = await res.json()
  } catch {
    donnees = {}
  }

  if (!res.ok && !donnees.rejete) {
    const detail = donnees.error || `HTTP ${res.status}`
    throw new Error(detail)
  }
  return donnees
}

// ---------------------------------------------------------------------------
// Fichiers
// ---------------------------------------------------------------------------

/**
 * La date portee par un nom de dossier JJMMAAAA, au format AAAA-MM-JJ.
 *
 * Ce format-la se compare comme du texte, ce que JJMMAAAA ne permet pas :
 * « 01072026 » est inferieur a « 26062026 » alors que le 1er juillet suit le
 * 26 juin.
 */
function dateDuDossier(nom) {
  const m = nom.match(/^(\d{2})(\d{2})(\d{4})$/)
  if (!m) return null
  const [, j, mo, a] = m
  if (Number(j) < 1 || Number(j) > 31 || Number(mo) < 1 || Number(mo) > 12) return null
  return `${a}-${mo}-${j}`
}

/** La date lue dans la premiere partie datee d'un chemin relatif. */
function dateDuChemin(relatif) {
  for (const partie of relatif.split(/[\\/]+/)) {
    const d = dateDuDossier(partie)
    if (d) return d
  }
  return null
}

/**
 * Ce que contient un dossier surveille, journee par journee.
 *
 * L'application ne voit pas ce disque. Sans cet inventaire, choisir le point
 * de depart voudrait dire taper une date de tete en esperant qu'un dossier lui
 * corresponde. On le lui envoie donc a chaque passage.
 */
function inventorier(racine, extensions, sousDossierTraite) {
  const parJour = new Map()

  let entrees
  try {
    entrees = fs.readdirSync(racine, { withFileTypes: true })
  } catch {
    return []
  }

  for (const e of entrees) {
    if (!e.isDirectory() || e.name === sousDossierTraite) continue
    const date = dateDuDossier(e.name)
    if (!date) continue

    let videos = 0
    ;(function compter(d, profondeur) {
      if (profondeur > 3) return
      for (const x of fs.readdirSync(d, { withFileTypes: true })) {
        if (x.isDirectory()) compter(path.join(d, x.name), profondeur + 1)
        else if (extensions.some((ext) => x.name.toLowerCase().endsWith(ext))) videos++
      }
    })(path.join(racine, e.name), 0)

    parJour.set(e.name, { dossier: e.name, date, videos })
  }

  return [...parJour.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Un fichier est pret quand sa taille ne bouge plus.
 *
 * Sans cela, une video encore en cours de copie depuis une carte SD ou un
 * telephone partirait a moitie. On mesure deux fois a deux secondes.
 */
async function estStable(chemin) {
  try {
    const a = fs.statSync(chemin).size
    await pause(2000)
    const b = fs.statSync(chemin).size
    return a === b && a > 0
  } catch {
    return false
  }
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Les videos d'un dossier, en profondeur si demande.
 *
 * Renvoie le chemin RELATIF a la racine surveillee. C'est lui qui identifie la
 * video : deux fichiers de meme nom dans deux dossiers de dates differentes
 * sont deux videos distinctes, et le chemin porte aussi l'information quand le
 * nom du fichier n'en porte pas.
 *
 * Le sous-dossier des fichiers ranges est ignore : sans cela, une video
 * traitee serait relue au passage suivant.
 */
function videosDe(racine, extensions, recursif, sousDossierTraite) {
  const trouvees = []

  function parcourir(dossier, prefixe, profondeur) {
    let entrees
    try {
      entrees = fs.readdirSync(dossier, { withFileTypes: true })
    } catch (e) {
      souci(`Dossier illisible : ${dossier} (${e.message})`)
      return
    }

    for (const e of entrees) {
      const relatif = prefixe ? `${prefixe}/${e.name}` : e.name

      if (e.isDirectory()) {
        if (!recursif) continue
        if (e.name === sousDossierTraite) continue
        // Garde-fou : une arborescence profonde ou un lien circulaire ne doit
        // pas faire tourner le watcher indefiniment.
        if (profondeur >= 5) continue
        parcourir(path.join(dossier, e.name), relatif, profondeur + 1)
        continue
      }

      if (e.isFile() && extensions.some((ext) => e.name.toLowerCase().endsWith(ext))) {
        trouvees.push(relatif)
      }
    }
  }

  parcourir(racine, '', 0)
  return trouvees.sort()
}

/**
 * Deplace le fichier traite dans son sous-dossier.
 *
 * En cas de collision de nom, on suffixe plutot que d'ecraser : deux videos
 * differentes portant le meme nom arrivent plus souvent qu'on ne croit.
 */
function ranger(racine, relatif, sousDossier) {
  const destination = path.join(racine, sousDossier)
  if (!fs.existsSync(destination)) fs.mkdirSync(destination, { recursive: true })

  const nom = path.basename(relatif)
  let cible = path.join(destination, nom)
  if (fs.existsSync(cible)) {
    const base = path.parse(nom)
    cible = path.join(destination, `${base.name}-${Date.now()}${base.ext}`)
  }

  fs.renameSync(path.join(racine, relatif), cible)
  return cible
}

// ---------------------------------------------------------------------------
// Envoi
// ---------------------------------------------------------------------------

/**
 * Depose la video dans le stockage.
 *
 * Le creneau d'envoi est signe par l'application et ne vaut que pour ce
 * chemin, quelques minutes. Le watcher n'a donc jamais de cle de stockage.
 */
async function deposer(local, cheminFichier, nomFichier) {
  const creneau = await appeler(local, { action: 'upload-url', fichier: nomFichier })

  const octets = fs.readFileSync(cheminFichier)
  const res = await fetch(creneau.signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': typeVideo(nomFichier) },
    body: octets,
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`envoi refuse (HTTP ${res.status}) ${detail.slice(0, 160)}`)
  }

  return creneau.video_url
}

function typeVideo(nom) {
  const n = nom.toLowerCase()
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg'
  if (n.endsWith('.mov')) return 'video/quicktime'
  if (n.endsWith('.m4v')) return 'video/x-m4v'
  return 'video/mp4'
}

// ---------------------------------------------------------------------------
// La derniere image
//
// Chaque Reel se termine sur le tableau de bord de la session : profit du
// jour, profit total, drawdown, spread. On l'envoie a cote de la video, et
// l'application y lit les chiffres que les textes citeront.
// ---------------------------------------------------------------------------

let ffmpegConnu

/** Le chemin de ffmpeg : config.json, le PATH, ou l'installation winget. */
function trouverFfmpeg(local) {
  if (ffmpegConnu !== undefined) return ffmpegConnu
  const candidats = []
  if (local.ffmpeg) candidats.push(local.ffmpeg)
  candidats.push('ffmpeg')
  const winget = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages')
  try {
    for (const paquet of fs.readdirSync(winget)) {
      if (!/ffmpeg/i.test(paquet)) continue
      for (const version of fs.readdirSync(path.join(winget, paquet))) {
        const exe = path.join(winget, paquet, version, 'bin', 'ffmpeg.exe')
        if (fs.existsSync(exe)) candidats.push(exe)
      }
    }
  } catch {
    // Pas de winget ici, ce n'est pas grave.
  }
  for (const c of candidats) {
    try {
      execFileSync(c, ['-version'], { stdio: 'ignore', timeout: 10000 })
      ffmpegConnu = c
      return c
    } catch {
      // Suivant.
    }
  }
  ffmpegConnu = null
  souci('ffmpeg introuvable : les videos entrent sans leurs chiffres de session.')
  souci('   Indique son chemin dans config.json, cle "ffmpeg".')
  return null
}

/** Extrait la derniere seconde de la video en JPEG. Null si impossible. */
function derniereImage(local, cheminVideo) {
  const ffmpeg = trouverFfmpeg(local)
  if (!ffmpeg) return null
  const sortie = path.join(os.tmpdir(), `bubupost-fin-${process.pid}-${Date.now()}.jpg`)
  try {
    execFileSync(
      ffmpeg,
      ['-sseof', '-1', '-i', cheminVideo, '-update', '1', '-frames:v', '1', '-q:v', '2', '-y', sortie],
      { stdio: 'ignore', timeout: 60000 },
    )
    return fs.existsSync(sortie) && fs.statSync(sortie).size > 0 ? sortie : null
  } catch (e) {
    souci(`   derniere image illisible : ${e.message}`)
    return null
  }
}

// ---------------------------------------------------------------------------
// Un passage
// ---------------------------------------------------------------------------

/** Compte les echecs consecutifs par fichier, pour ne pas alerter au premier. */
const echecs = new Map()

/** Par dossier, le nombre de fichiers deja traites annonce au dernier passage calme. */
const calme = new Map()

/**
 * Les cles (chemin relatif et taille) que l'application a deja acceptees.
 * Si la question echoue, on renvoie un ensemble vide : au pire on uploade
 * pour rien, comme avant, plutot que de ne rien traiter.
 */
async function dejaTraites(local, cles) {
  const traites = new Set()
  for (let i = 0; i < cles.length; i += 200) {
    try {
      const r = await appeler(local, { action: 'deja-traites', cles: cles.slice(i, i + 200) })
      for (const c of r.traites ?? []) traites.add(c)
    } catch (e) {
      souci(`Impossible de savoir ce qui est deja traite : ${e.message}`)
    }
  }
  return traites
}

async function passage(local) {
  // Premier appel : on demande la configuration sans inventaire, puisqu'on ne
  // sait pas encore quels dossiers surveiller.
  let reglages
  try {
    reglages = await appeler(local, { action: 'config', version: VERSION, dossiers: 0 })
  } catch (e) {
    souci(`L'application ne repond pas : ${e.message}`)
    return
  }

  if (!reglages.actif) {
    info('Automatisation suspendue dans l application, rien n est traite.')
    return
  }

  const dossiers = reglages.dossiers ?? []
  if (dossiers.length === 0) {
    info('Aucun dossier surveille. Ajoute-en un dans l onglet Automatisation.')
    return
  }

  const extensions = reglages.extensions ?? ['.mp4', '.mov', '.m4v']

  // On renvoie aussitot ce qu'on voit sur le disque, pour que l'ecran puisse
  // proposer les vraies journees au moment de choisir le point de depart.
  const inventaires = {}
  for (const dossier of dossiers) {
    if (!fs.existsSync(dossier.chemin)) continue
    inventaires[dossier.id] = inventorier(dossier.chemin, extensions, local.sousDossierTraite)
  }
  if (Object.keys(inventaires).length > 0) {
    try {
      await appeler(local, {
        action: 'config',
        version: VERSION,
        dossiers: dossiers.length,
        inventaires,
      })
    } catch {
      // L'inventaire est un confort pour l'ecran de reglages. S'il ne part
      // pas, le ramassage doit continuer quand meme.
    }
  }

  for (const dossier of dossiers) {
    if (!fs.existsSync(dossier.chemin)) {
      souci(`Dossier introuvable sur ce PC : ${dossier.chemin}`)
      continue
    }

    const fichiers = videosDe(
      dossier.chemin,
      extensions,
      dossier.recursif === true,
      local.sousDossierTraite,
    )
    if (fichiers.length === 0) continue

    // Le tri chronologique se fait ici, pas au retour : la file doit suivre
    // l'ordre du tournage, et l'ordre du disque est alphabetique.
    const ordonnes = fichiers
      .map((f) => ({ f, date: dateDuChemin(f) }))
      .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.f.localeCompare(b.f))

    // Ce qui precede le point de depart est considere comme deja publie. On
    // l'ecarte AVANT l'envoi : uploader soixante videos pour se les faire
    // refuser ensuite serait du temps et de la bande passante perdus.
    const depuis = dossier.depuis_date || null
    const retenus = depuis
      ? ordonnes.filter((x) => !x.date || x.date >= depuis)
      : ordonnes
    const ecartes = ordonnes.length - retenus.length

    // Meme regle que plus bas : on ne le repete pas a chaque minute.
    if (ecartes > 0 && calme.get(`${dossier.id}#avant`) !== ecartes) {
      info(
        `${ecartes} fichier(s) anterieurs au ${depuis} ignores, consideres comme deja publies.`,
      )
      calme.set(`${dossier.id}#avant`, ecartes)
    }
    if (retenus.length === 0) continue

    // Un dossier qu'on ne remue pas est relu a chaque passage. On demande
    // donc d'abord ce que l'application a deja accepte, au lieu d'uploader
    // chaque video toutes les soixante secondes pour l'apprendre apres coup.
    // La cle est celle du journal des imports : chemin relatif et taille.
    const aTraiter = []
    for (const x of retenus) {
      const complet = path.join(dossier.chemin, x.f)
      let taille
      try {
        taille = fs.statSync(complet).size
      } catch {
        continue
      }
      aTraiter.push({ fichier: x.f, complet, taille, cle: `${x.f}#${taille}` })
    }
    const traites = await dejaTraites(local, aTraiter.map((x) => x.cle))
    const nouveaux = aTraiter.filter((x) => !traites.has(x.cle))

    if (nouveaux.length === 0) {
      // Une ligne par minute pour dire que rien n'a change remplirait le
      // journal pour rien : on ne l'ecrit que quand le compte change.
      if (calme.get(dossier.id) !== aTraiter.length) {
        info(`${aTraiter.length} fichier(s) deja traites dans ${dossier.chemin}, rien de nouveau.`)
        calme.set(dossier.id, aTraiter.length)
      }
      continue
    }
    calme.delete(dossier.id)
    if (aTraiter.length > nouveaux.length) {
      info(`${aTraiter.length - nouveaux.length} fichier(s) deja traites, ignores.`)
    }

    info(`${nouveaux.length} fichier(s) a traiter dans ${dossier.chemin}`)

    for (const { fichier, complet, taille } of nouveaux) {
      if (!(await estStable(complet))) {
        info(`${fichier} : copie encore en cours, on attend le passage suivant.`)
        continue
      }

      try {
        info(`${fichier} : envoi de ${(taille / 1048576).toFixed(1)} Mo...`)
        const videoUrl = await deposer(local, complet, fichier)

        // La derniere image part a cote. Si elle manque, la video entre
        // quand meme : un texte sans chiffres vaut mieux qu'une video bloquee.
        let imageFinUrl
        const image = derniereImage(local, complet)
        if (image) {
          try {
            imageFinUrl = await deposer(local, image, path.basename(fichier).replace(/\.[^.]+$/, '') + '-fin.jpg')
          } catch (e) {
            souci(`   derniere image non envoyee : ${e.message}`)
          } finally {
            try {
              fs.unlinkSync(image)
            } catch {
              // Un fichier temporaire qui reste n'est pas un probleme.
            }
          }
        }

        const resultat = await appeler(local, {
          action: 'ingest',
          fichier: path.basename(fichier),
          chemin_relatif: fichier,
          dossier: dossier.chemin,
          taille,
          video_url: videoUrl,
          image_fin_url: imageFinUrl,
          marque: dossier.marque || undefined,
          marques: dossier.marques?.length ? dossier.marques : undefined,
          profil: dossier.profil || undefined,
          mode_nommage: dossier.mode_nommage || undefined,
          modele_sujet: dossier.modele_sujet || undefined,
          depuis_date: dossier.depuis_date || undefined,
        })

        if (resultat.ignore) {
          info(`${fichier} : ignore, ${resultat.error}`)
          echecs.delete(fichier)
          continue
        }

        if (resultat.rejete) {
          // Le fichier RESTE en place : c'est un reglage ou un nom a corriger,
          // pas une perte. Il sera repris apres correction.
          souci(`${fichier} : refuse par l application. ${resultat.error}`)
          souci('   Le fichier reste en place. Corrige le nom ou les reglages.')
          echecs.delete(fichier)
          continue
        }

        const creees = resultat.marques_creees ?? []
        if (creees.length > 0) {
          bien(`${fichier} : ajoute pour ${creees.join(', ')}, sujet « ${resultat.sujet} ».`)
        } else {
          info(`${fichier} : deja en bibliotheque, rien a faire.`)
        }
        for (const a of resultat.avertissements ?? []) info(`   ${a}`)
        info(`   ${resultat.en_reserve} video(s) en reserve au total.`)

        // Certains dossiers ne doivent pas etre remues : une archive rangee
        // par date appartient au pipeline qui l'a produite. On se souvient a
        // la place, et le chemin relatif suffit a ne pas la relire deux fois.
        if (dossier.deplacer === false) {
          info('   fichier laisse en place, ce dossier n est pas remue.')
        } else {
          const range = ranger(dossier.chemin, fichier, local.sousDossierTraite)
          info(`   range dans ${range}`)
        }
        echecs.delete(fichier)
      } catch (e) {
        const n = (echecs.get(fichier) ?? 0) + 1
        echecs.set(fichier, n)
        souci(`${fichier} : echec ${n}. ${e.message}`)
        souci('   Le fichier reste en place, nouvelle tentative au passage suivant.')

        if (n === local.echecsAvantAlerte) {
          try {
            await appeler(local, {
              action: 'ping',
              version: VERSION,
              detail: { alerte: `${fichier} echoue ${n} fois : ${e.message}` },
            })
          } catch {
            // L'alerte est un confort. Si elle ne part pas, le journal local
            // porte deja l'information.
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------

async function main() {
  const local = lireConfigLocale()

  console.log('')
  console.log('  BubuPost, surveillance de dossiers')
  console.log(`  version ${VERSION}`)
  console.log(`  application : ${local.url}`)
  console.log(`  passage toutes les ${local.intervalleSecondes} secondes`)
  console.log('  ferme cette fenetre pour arreter')
  console.log('')

  const unique = process.argv.includes('--une-fois')

  for (;;) {
    try {
      await passage(local)
    } catch (e) {
      souci(`Passage interrompu : ${e.message}`)
    }
    if (unique) break
    await pause(local.intervalleSecondes * 1000)
  }
}

main().catch((e) => {
  souci(`Arret : ${e.message}`)
  process.exit(1)
})
