// Genere l'icone Windows du raccourci bureau, sans aucune dependance.
// Un PNG est encode a la main (zlib est dans Node), puis emballe dans un
// conteneur ICO. Windows Vista et suivants acceptent du PNG dans un ICO.
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const SIZE = 256

// Palette reprise du theme de l'application.
const FOND = [16, 18, 24, 255] // ink-900
const BORD = [38, 43, 58, 255] // ink-700
const MARQUE = [124, 140, 255, 255] // brand-400
const MARQUE_SOMBRE = [69, 83, 216, 255] // brand-600

function creerToile(w, h) {
  return { w, h, data: Buffer.alloc(w * h * 4, 0) }
}

function poser(toile, x, y, couleur, alpha = 1) {
  if (x < 0 || y < 0 || x >= toile.w || y >= toile.h) return
  const i = (y * toile.w + x) * 4
  const a = alpha * (couleur[3] / 255)
  const fondA = toile.data[i + 3] / 255
  const sortieA = a + fondA * (1 - a)
  if (sortieA === 0) return
  for (let c = 0; c < 3; c++) {
    const src = couleur[c] * a
    const dst = toile.data[i + c] * fondA * (1 - a)
    toile.data[i + c] = Math.round((src + dst) / sortieA)
  }
  toile.data[i + 3] = Math.round(sortieA * 255)
}

/** Rectangle aux coins arrondis, avec anticrenelage par sur-echantillonnage. */
function rectArrondi(toile, x0, y0, x1, y1, r, couleur) {
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
      let dedans = 0
      const N = 4
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const px = x + (sx + 0.5) / N
          const py = y + (sy + 0.5) / N
          if (px < x0 || px > x1 || py < y0 || py > y1) continue
          const cx = Math.min(Math.max(px, x0 + r), x1 - r)
          const cy = Math.min(Math.max(py, y0 + r), y1 - r)
          const dx = px - cx
          const dy = py - cy
          if (dx * dx + dy * dy <= r * r) dedans++
        }
      }
      if (dedans > 0) poser(toile, x, y, couleur, dedans / (N * N))
    }
  }
}

/** Segment epais aux bouts arrondis. */
function trait(toile, x0, y0, x1, y1, epaisseur, couleur) {
  const r = epaisseur / 2
  const minX = Math.floor(Math.min(x0, x1) - r - 1)
  const maxX = Math.ceil(Math.max(x0, x1) + r + 1)
  const minY = Math.floor(Math.min(y0, y1) - r - 1)
  const maxY = Math.ceil(Math.max(y0, y1) + r + 1)
  const dx = x1 - x0
  const dy = y1 - y0
  const longueur2 = dx * dx + dy * dy

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let dedans = 0
      const N = 4
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const px = x + (sx + 0.5) / N
          const py = y + (sy + 0.5) / N
          let t = longueur2 === 0 ? 0 : ((px - x0) * dx + (py - y0) * dy) / longueur2
          t = Math.min(Math.max(t, 0), 1)
          const cx = x0 + t * dx
          const cy = y0 + t * dy
          const ddx = px - cx
          const ddy = py - cy
          if (ddx * ddx + ddy * ddy <= r * r) dedans++
        }
      }
      if (dedans > 0) poser(toile, x, y, couleur, dedans / (N * N))
    }
  }
}

function disque(toile, cx, cy, r, couleur) {
  trait(toile, cx, cy, cx, cy, r * 2, couleur)
}

// --- encodage PNG -----------------------------------------------------------

function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const octet of buf) crc = table[(crc ^ octet) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function morceau(type, donnees) {
  const longueur = Buffer.alloc(4)
  longueur.writeUInt32BE(donnees.length)
  const corps = Buffer.concat([Buffer.from(type, 'ascii'), donnees])
  const controle = Buffer.alloc(4)
  controle.writeUInt32BE(crc32(corps))
  return Buffer.concat([longueur, corps, controle])
}

function versPNG(toile) {
  const entete = Buffer.alloc(13)
  entete.writeUInt32BE(toile.w, 0)
  entete.writeUInt32BE(toile.h, 4)
  entete[8] = 8 // 8 bits par canal
  entete[9] = 6 // RGBA
  entete[10] = 0
  entete[11] = 0
  entete[12] = 0

  // Chaque ligne est prefixee par son octet de filtre, ici 0 (aucun).
  const lignes = Buffer.alloc(toile.h * (toile.w * 4 + 1))
  for (let y = 0; y < toile.h; y++) {
    const depart = y * (toile.w * 4 + 1)
    lignes[depart] = 0
    toile.data.copy(lignes, depart + 1, y * toile.w * 4, (y + 1) * toile.w * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    morceau('IHDR', entete),
    morceau('IDAT', zlib.deflateSync(lignes, { level: 9 })),
    morceau('IEND', Buffer.alloc(0)),
  ])
}

function versICO(png, taille) {
  const entete = Buffer.alloc(6)
  entete.writeUInt16LE(0, 0)
  entete.writeUInt16LE(1, 2) // type icone
  entete.writeUInt16LE(1, 4) // une seule image

  const entree = Buffer.alloc(16)
  entree[0] = taille >= 256 ? 0 : taille // 0 signifie 256
  entree[1] = taille >= 256 ? 0 : taille
  entree[2] = 0
  entree[3] = 0
  entree.writeUInt16LE(1, 4)
  entree.writeUInt16LE(32, 6)
  entree.writeUInt32BE(0, 8)
  entree.writeUInt32LE(png.length, 8)
  entree.writeUInt32LE(22, 12)

  return Buffer.concat([entete, entree, png])
}

// --- dessin -----------------------------------------------------------------

const toile = creerToile(SIZE, SIZE)

// Fond arrondi, facon icone d'application moderne.
rectArrondi(toile, 8, 8, SIZE - 8, SIZE - 8, 56, FOND)
rectArrondi(toile, 8, 8, SIZE - 8, SIZE - 8, 56, BORD)
rectArrondi(toile, 11, 11, SIZE - 11, SIZE - 11, 53, FOND)

// Une fleche vers le haut : publier, envoyer.
const cx = SIZE / 2
trait(toile, cx, 178, cx, 92, 22, MARQUE_SOMBRE)
trait(toile, cx, 176, cx, 94, 18, MARQUE)
trait(toile, cx - 40, 130, cx, 90, 18, MARQUE)
trait(toile, cx + 40, 130, cx, 90, 18, MARQUE)

// Le point sous la fleche evoque la programmation dans le temps.
disque(toile, cx, 202, 11, MARQUE_SOMBRE)

const png = versPNG(toile)
const ico = versICO(png, SIZE)

const dossier = path.join(__dirname, '..', 'desktop')
fs.mkdirSync(dossier, { recursive: true })
fs.writeFileSync(path.join(dossier, 'BubuPost.ico'), ico)
fs.writeFileSync(path.join(dossier, 'BubuPost.png'), png)

console.log('Icone generee :')
console.log('  ' + path.join(dossier, 'BubuPost.ico'), '-', ico.length, 'octets')
console.log('  ' + path.join(dossier, 'BubuPost.png'), '-', png.length, 'octets')
