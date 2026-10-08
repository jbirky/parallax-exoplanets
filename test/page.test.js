// What Parallax imports: dist/ built from the sources as they are, and a
// manifest that follows the rules a community plugin is checked against
// (Parallax's server/services/plugin-import.js).

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const { buildPage } = require('../scripts/build.js')

const root = path.join(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const manifest = JSON.parse(read('parallax-plugin.json'))

// The page with its snapshot taken out, and the snapshot unpacked. Compared
// that way because gzip's bytes can differ between zlib versions.
function split(page) {
  const m = page.match(/(<script type="application\/octet-stream" id="snapshot">\n)([A-Za-z0-9+/=]+)(\n<\/script>)/)
  assert.ok(m, 'the page carries the snapshot')
  return { rest: page.replace(m[2], ''), snapshot: JSON.parse(zlib.gunzipSync(Buffer.from(m[2], 'base64')).toString('utf8')) }
}

describe('dist/', () => {
  it('is built from the sources as they are (run npm run build)', () => {
    const built = split(read('dist/sandbox.html'))
    const fresh = split(buildPage())
    assert.equal(built.rest, fresh.rest)
    assert.deepEqual(built.snapshot, JSON.parse(read('data/snapshot.json')))
    assert.equal(read('dist/icon.svg'), read('src/icon.svg'))
  })

  it('stands alone: no file it links to, and nothing that ends a script early', () => {
    const page = read('dist/sandbox.html')
    assert.doesNotMatch(page, /<(script|link|img)[^>]+(src|href)=/i)
    assert.equal(page.match(/<\/script>/g).length, 3)
    assert.ok(Buffer.byteLength(page) < 1024 * 1024, 'under the 1 MB a file may be')
  })

  it('holds the planets the snapshot says it does', () => {
    const snapshot = JSON.parse(read('data/snapshot.json'))
    assert.ok(snapshot.count > 5000)
    for (const values of Object.values(snapshot.columns)) assert.equal(values.length, snapshot.count)
  })
})

describe('the manifest', () => {
  it('follows the rules for community plugins', () => {
    assert.match(manifest.id, /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/)
    assert.doesNotMatch(manifest.id, /^com\.parallax\./)
    assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
    assert.equal(manifest.version, JSON.parse(read('package.json')).version)
    assert.ok(manifest.name.length <= 60 && manifest.description.length <= 300)
    assert.ok(manifest.license)
    assert.equal(manifest.main, undefined, 'community plugins can’t have main')
    assert.deepEqual(Object.keys(manifest.contributes), ['elementTypes'])
    for (const file of [manifest.sandbox, manifest.icon]) assert.ok(fs.existsSync(path.join(root, 'dist', file.replace(/^\.\//, ''))), file)
    for (const et of manifest.contributes.elementTypes) assert.match(et.type, /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/)
    for (const p of manifest.permissions) assert.match(p, /^network:/)
    assert.ok(manifest.categories.every(c => ['math', 'physics', 'chemistry', 'biology', 'astronomy', 'data', 'computer science', 'teaching', 'other'].includes(c)))
  })

  it('starts an element with settings the plot reads', () => {
    const P = require('../src/plot.js')
    const data = manifest.contributes.elementTypes[0].defaultData
    const s = P.settings(data)
    for (const [key, value] of Object.entries(data)) assert.equal(s[key], value, key)
  })
})
