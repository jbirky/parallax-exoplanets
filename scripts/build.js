// Builds dist/, what Parallax imports: sandbox.html, the plugin's one page,
// is src/sandbox.html with the styles, the scripts and the snapshot
// (gzipped, then base64) written into it, because Parallax puts the page in
// an iframe's srcdoc, where links to other files lead nowhere; and icon.svg.
//
//   node scripts/build.js

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const root = path.join(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

// The snapshot as the page carries it
function packSnapshot(json) {
  return zlib.gzipSync(Buffer.from(JSON.stringify(JSON.parse(json))), { level: 9 }).toString('base64')
}

function buildPage() {
  const parts = {
    STYLES: read('src/styles.css'),
    PLOT: read('src/plot.js'),
    APP: read('src/app.js'),
    SNAPSHOT: packSnapshot(read('data/snapshot.json')),
  }
  for (const [name, text] of Object.entries(parts)) {
    // Would end its <script> or <style> early
    if (/<\/(script|style)/i.test(text) || text.includes('<!--')) throw new Error(`${name} holds "</script", "</style" or "<!--"`)
  }
  return read('src/sandbox.html').replace(/@@(STYLES|PLOT|APP|SNAPSHOT)@@/g, (_, name) => parts[name])
}

function build() {
  const manifest = JSON.parse(read('parallax-plugin.json'))
  const pkg = JSON.parse(read('package.json'))
  if (manifest.version !== pkg.version) throw new Error(`parallax-plugin.json says ${manifest.version}, package.json ${pkg.version}`)
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true })
  const page = buildPage()
  fs.writeFileSync(path.join(root, 'dist', 'sandbox.html'), page)
  fs.copyFileSync(path.join(root, 'src', 'icon.svg'), path.join(root, 'dist', 'icon.svg'))
  return page
}

if (require.main === module) {
  const page = build()
  console.log(`Wrote dist/sandbox.html (${Math.round(Buffer.byteLength(page) / 1024)} KB) and dist/icon.svg`)
}

module.exports = { buildPage, packSnapshot }
