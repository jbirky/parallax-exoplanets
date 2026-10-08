// Fetches the NASA Exoplanet Archive's planets into data/snapshot.json, the
// data the plugin plots when it isn't given a deck dataset. One row per
// planet, from the Planetary Systems Composite Parameters table
// (pscomppars), stored a column at a time with numbers rounded to four
// significant figures and discovery methods as indexes into a list.
//
//   node scripts/snapshot.js

const fs = require('fs')
const path = require('path')
const { SNAPSHOT_COLUMNS, encodeSnapshot } = require('../src/plot.js')

const TAP = 'https://exoplanetarchive.ipac.caltech.edu/TAP/sync'
// Ordered, so the snapshot only changes when the data does
const QUERY = `select ${SNAPSHOT_COLUMNS.join(', ')} from pscomppars order by pl_name`

async function main() {
  const url = `${TAP}?${new URLSearchParams({ query: QUERY, format: 'json' })}`
  const res = await fetch(url, { headers: { 'User-Agent': 'parallax-exoplanets snapshot (https://github.com/jbirky/parallax-exoplanets)' } })
  if (!res.ok) throw new Error(`The archive answered ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const rows = await res.json()
  if (!Array.isArray(rows) || rows.length < 1000) throw new Error(`Expected thousands of planets, got ${Array.isArray(rows) ? rows.length : typeof rows}`)
  const snapshot = encodeSnapshot(rows, { asOf: new Date().toISOString().slice(0, 10), query: QUERY })
  // A column to a line, so a refresh's diff says which columns changed
  const lines = Object.entries(snapshot.columns).map(([name, values]) => `    ${JSON.stringify(name)}: ${JSON.stringify(values)}`)
  const { columns, ...about } = snapshot
  const head = JSON.stringify(about, null, 2).replace(/\n}$/, '')
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'snapshot.json'), `${head},\n  "columns": {\n${lines.join(',\n')}\n  }\n}\n`)
  console.log(`Wrote ${rows.length} planets, as of ${snapshot.asOf}`)
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
