// Ajoute les balises PWA a index.html et l'enregistrement du service worker
// a main.tsx. Idempotent : relancer le script ne duplique rien.
const fs = require('fs')

const HEAD_TAGS = [
  '    <meta name="theme-color" content="#0a0b0e" />',
  '    <meta name="description" content="Planification et publication automatisee de videos courtes sur plusieurs comptes." />',
  '    <meta name="apple-mobile-web-app-capable" content="yes" />',
  '    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
  '    <link rel="manifest" href="/manifest.webmanifest" />',
  '    <link rel="apple-touch-icon" href="/icon.svg" />',
  '  </head>',
].join('\n')

const html = fs.readFileSync('index.html', 'utf8')
if (!html.includes('manifest.webmanifest')) {
  fs.writeFileSync('index.html', html.replace('  </head>', HEAD_TAGS))
  console.log('index.html : balises PWA ajoutees')
} else {
  console.log('index.html : deja a jour')
}

const SW_SNIPPET = [
  '',
  "// Enregistrement du service worker : rend l'app installable sur mobile.",
  "if ('serviceWorker' in navigator) {",
  "  window.addEventListener('load', () => {",
  "    navigator.serviceWorker.register('/sw.js').catch(() => {",
  '      // Pas de service worker disponible, l’app fonctionne quand meme.',
  '    })',
  '  })',
  '}',
  '',
].join('\n')

const main = fs.readFileSync('src/main.tsx', 'utf8')
if (!main.includes('serviceWorker')) {
  fs.writeFileSync('src/main.tsx', main.trimEnd() + '\n' + SW_SNIPPET)
  console.log('main.tsx : service worker enregistre')
} else {
  console.log('main.tsx : deja a jour')
}
