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
const path = require('path')

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

function videosDe(dossier, extensions) {
  try {
    return fs
      .readdirSync(dossier, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .filter((nom) => extensions.some((ext) => nom.toLowerCase().endsWith(ext)))
      .sort()
  } catch (e) {
    souci(`Dossier illisible : ${dossier} (${e.message})`)
    return []
  }
}

/**
 * Deplace le fichier traite dans son sous-dossier.
 *
 * En cas de collision de nom, on suffixe plutot que d'ecraser : deux videos
 * differentes portant le meme nom arrivent plus souvent qu'on ne croit.
 */
function ranger(dossier, fichier, sousDossier) {
  const destination = path.join(dossier, sousDossier)
  if (!fs.existsSync(destination)) fs.mkdirSync(destination, { recursive: true })

  let cible = path.join(destination, fichier)
  if (fs.existsSync(cible)) {
    const base = path.parse(fichier)
    cible = path.join(destination, `${base.name}-${Date.now()}${base.ext}`)
  }

  fs.renameSync(path.join(dossier, fichier), cible)
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
  if (n.endsWith('.mov')) return 'video/quicktime'
  if (n.endsWith('.m4v')) return 'video/x-m4v'
  return 'video/mp4'
}

// ---------------------------------------------------------------------------
// Un passage
// ---------------------------------------------------------------------------

/** Compte les echecs consecutifs par fichier, pour ne pas alerter au premier. */
const echecs = new Map()

async function passage(local) {
  let reglages
  try {
    reglages = await appeler(local, {
      action: 'config',
      version: VERSION,
      dossiers: 0,
    })
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

  for (const dossier of dossiers) {
    if (!fs.existsSync(dossier.chemin)) {
      souci(`Dossier introuvable sur ce PC : ${dossier.chemin}`)
      continue
    }

    const fichiers = videosDe(dossier.chemin, extensions)
    if (fichiers.length === 0) continue

    info(`${fichiers.length} fichier(s) dans ${dossier.chemin}`)

    for (const fichier of fichiers) {
      const complet = path.join(dossier.chemin, fichier)

      if (!(await estStable(complet))) {
        info(`${fichier} : copie encore en cours, on attend le passage suivant.`)
        continue
      }

      const taille = fs.statSync(complet).size

      try {
        info(`${fichier} : envoi de ${(taille / 1048576).toFixed(1)} Mo...`)
        const videoUrl = await deposer(local, complet, fichier)

        const resultat = await appeler(local, {
          action: 'ingest',
          fichier,
          dossier: dossier.chemin,
          taille,
          video_url: videoUrl,
          marque: dossier.marque || undefined,
          profil: dossier.profil || undefined,
        })

        if (resultat.rejete) {
          // Le fichier RESTE en place : c'est un reglage ou un nom a corriger,
          // pas une perte. Il sera repris apres correction.
          souci(`${fichier} : refuse par l application. ${resultat.error}`)
          souci('   Le fichier reste en place. Corrige le nom ou les reglages.')
          echecs.delete(fichier)
          continue
        }

        bien(
          `${fichier} : ajoute a la bibliotheque de ${resultat.marque}, sujet « ${resultat.sujet} ».`,
        )
        info(
          `   ${resultat.en_reserve} video(s) en reserve pour cette marque. Le moteur de cadence les programmera.`,
        )

        const range = ranger(dossier.chemin, fichier, local.sousDossierTraite)
        info(`   range dans ${range}`)
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
