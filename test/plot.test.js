// The plot's arithmetic (src/plot.js): settings, ticks, number formats, the
// snapshot's encoding, and which planets a plot shows.

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const P = require('../src/plot.js')

const rows = [
  { pl_name: 'Kepler-22 b', discoverymethod: 'Transit', disc_year: 2011, pl_orbper: 289.8623, pl_bmasse: null, pl_rade: 2.1, pl_orbsmax: 0.812, pl_insol: 1.11, pl_eqt: 262, st_teff: 5596, sy_dist: 194.4 },
  { pl_name: '51 Peg b', discoverymethod: 'Radial Velocity', disc_year: 1995, pl_orbper: 4.230785, pl_bmasse: 146.2, pl_rade: null, pl_orbsmax: 0.0527, pl_insol: null, pl_eqt: null, st_teff: 5768, sy_dist: 15.47 },
  { pl_name: 'TRAPPIST-1 e', discoverymethod: 'Transit', disc_year: 2017, pl_orbper: 6.099, pl_bmasse: 0.692, pl_rade: 0.92, pl_orbsmax: 0.02925, pl_insol: 0.646, pl_eqt: 251, st_teff: 2566, sy_dist: 12.43 },
  { pl_name: 'OGLE-2005-BLG-390L b', discoverymethod: 'Microlensing', disc_year: 2005, pl_orbper: 3500, pl_bmasse: 5.5, pl_rade: null, pl_orbsmax: 2.6, pl_insol: null, pl_eqt: 50, st_teff: null, sy_dist: 6500 },
  { pl_name: 'Odd one', discoverymethod: 'Transit', disc_year: 2020, pl_orbper: 0, pl_bmasse: 3, pl_rade: 1, pl_orbsmax: null, pl_insol: null, pl_eqt: null, st_teff: null, sy_dist: null },
]
const table = () => P.decodeSnapshot(P.encodeSnapshot(rows, { asOf: '2026-10-08' }))

describe('settings', () => {
  it('fills in defaults and refuses what it doesn’t know', () => {
    const s = P.settings({ x: 'radius', y: 'nonsense', color: 'rainbow', pointSize: 40, throughYear: 2001.5, hiddenMethods: ['Imaging', 7] })
    assert.equal(s.x, 'radius')
    assert.equal(s.y, 'mass')
    assert.equal(s.color, 'method')
    assert.equal(s.pointSize, 8)
    assert.equal(s.throughYear, null)
    assert.deepEqual(s.hiddenMethods, ['Imaging'])
    assert.equal(s.solarSystem, true)
    assert.equal(s.theme, 'dark')
  })

  it('reads each quantity on its usual scale until someone picks one', () => {
    assert.equal(P.settings({ x: 'period' }).xLog, true)
    assert.equal(P.settings({ x: 'teq' }).xLog, false)
    assert.equal(P.settings({ x: 'period', xLog: false }).xLog, false)
    assert.equal(P.settings({ y: 'year', yLog: null }).yLog, false)
  })
})

describe('ticks', () => {
  it('labels each power of ten on a log scale, and 2 and 5 over a short span', () => {
    const wide = P.logTicks(0.05, 2000)
    assert.deepEqual(wide.filter(t => t.label).map(t => t.label), ['0.1', '1', '10', '100', '1,000'])
    assert.ok(wide.some(t => !t.major && t.v === 0.2))
    const short = P.logTicks(1, 50)
    assert.deepEqual(short.filter(t => t.label).map(t => t.label), ['1', '2', '5', '10', '20', '50'])
  })

  it('writes powers of ten when values are very large, and thins labels over many decades', () => {
    const labels = P.logTicks(1e-3, 1e9).filter(t => t.label).map(t => t.label)
    assert.deepEqual(labels, ['0.01', '1', '100', '10,000', '10⁶', '10⁸'])
    assert.ok(P.logTicks(1e-3, 1e9).every(t => t.major))
  })

  it('steps a linear scale by 1, 2 or 5 times a power of ten, years without commas', () => {
    assert.deepEqual(P.linearTicks(1990, 2026, { plain: true }).map(t => t.label), ['1990', '1995', '2000', '2005', '2010', '2015', '2020', '2025'])
    assert.deepEqual(P.linearTicks(0, 3000).map(t => t.label), ['0', '500', '1,000', '1,500', '2,000', '2,500', '3,000'])
  })

  it('maps values to pixels', () => {
    const s = P.scale([1, 100], [0, 200], true)
    assert.equal(s.map(10), 100)
    const t = P.scale([0, 10], [100, 0], false)
    assert.equal(t.map(5), 50)
  })

  it('pads an extent, and gives a range even with one value or none', () => {
    const [lo, hi] = P.extent([1, 100], true)
    assert.ok(lo < 1 && hi > 100)
    assert.deepEqual(P.extent([5, 5], true), [2.5, 10])
    assert.deepEqual(P.extent([null, -1], true), [1, 10])
  })
})

describe('numbers', () => {
  it('keeps three significant figures, groups thousands, and uses powers of ten at the ends', () => {
    assert.equal(P.formatNumber(289.8623), '290')
    assert.equal(P.formatNumber(4332.6), '4,330')
    assert.equal(P.formatNumber(0.02925), '0.0293')
    assert.equal(P.formatNumber(0.00012), '1.2×10⁻⁴')
    assert.equal(P.formatNumber(2.5e8), '2.5×10⁸')
    assert.equal(P.formatNumber(1e9), '10⁹')
    assert.equal(P.formatNumber(null), '—')
  })
})

describe('the snapshot', () => {
  it('stores columns, methods by index, and four significant figures, and reads back', () => {
    const packed = P.encodeSnapshot(rows, { asOf: '2026-10-08', query: 'select …' })
    assert.deepEqual(packed.methods, ['Microlensing', 'Radial Velocity', 'Transit'])
    assert.deepEqual(packed.columns.discoverymethod, [2, 1, 2, 0, 2])
    assert.equal(packed.columns.pl_orbper[0], 289.9)
    assert.equal(packed.columns.pl_bmasse[0], null)
    const t = P.decodeSnapshot(packed)
    assert.equal(t.n, 5)
    assert.equal(t.columns.discoverymethod[1], 'Radial Velocity')
    assert.equal(t.asOf, '2026-10-08')
  })

  it('reads a deck dataset’s columns, numbers from text too', () => {
    const t = P.fromDataset({ columns: { pl_name: ['a', 'b'], pl_orbper: ['3.5', ''], disc_year: [2001, null] }, totalRows: 2 }, { name: 'planets' })
    assert.equal(t.n, 2)
    assert.deepEqual(t.columns.pl_orbper, [3.5, null])
    assert.deepEqual(t.columns.disc_year, [2001, null])
    assert.equal(t.name, 'planets')
  })
})

describe('the points a plot shows', () => {
  it('takes planets with both values, positive on log axes, and counts them by method', () => {
    const res = P.points(table(), P.settings({ x: 'period', y: 'mass' }))
    assert.deepEqual(res.points.map(p => p.name), ['51 Peg b', 'TRAPPIST-1 e', 'OGLE-2005-BLG-390L b'])
    assert.equal(res.plottable, 3)
    assert.deepEqual(res.methods, [{ method: 'Microlensing', count: 1 }, { method: 'Radial Velocity', count: 1 }, { method: 'Transit', count: 1 }])
    // A period of 0 plots on a linear axis
    assert.equal(P.points(table(), P.settings({ x: 'period', xLog: false, y: 'mass' })).plottable, 4)
  })

  it('hides methods and later years without moving the axes', () => {
    const all = P.points(table(), P.settings({}))
    const some = P.points(table(), P.settings({ hiddenMethods: ['Transit'], throughYear: 2000 }))
    assert.deepEqual(some.points.map(p => p.name), ['51 Peg b'])
    assert.deepEqual(some.xValues, all.xValues)
    assert.equal(some.plottable, all.plottable)
  })

  it('says which columns a dataset lacks', () => {
    const t = P.fromDataset({ columns: { pl_name: ['a'], pl_orbper: [1] } })
    assert.deepEqual(P.points(t, P.settings({ x: 'period', y: 'radius' })).missing, ['pl_rade'])
  })

  it('finds the nearest point within reach', () => {
    const list = [{ x: 1, y: 1 }, { x: 5, y: 5 }]
    const id = v => v * 10
    assert.equal(P.nearest(list, id, id, 48, 52, 5), list[1])
    assert.equal(P.nearest(list, id, id, 30, 30, 5), null)
  })

  it('puts the Solar System only on axes it has values for', () => {
    assert.equal(P.solarSystemPoints(P.settings({ x: 'period', y: 'mass' })).length, 8)
    assert.equal(P.solarSystemPoints(P.settings({ x: 'distance', y: 'mass' })).length, 0)
    const earth = P.solarSystemPoints(P.settings({ x: 'insolation', y: 'radius' })).find(p => p.name === 'Earth')
    assert.deepEqual([earth.x, earth.y], [1, 1])
  })

  it('colors each method, and years from purple to yellow', () => {
    assert.equal(P.methodColor('Transit', 'light'), '#0072b2')
    assert.match(P.methodColor('A new method', 'dark'), /^#[0-9a-f]{6}$/)
    assert.equal(P.yearColor(0, 'light'), 'rgb(68,1,84)')
    assert.equal(P.yearColor(1, 'light'), 'rgb(217,200,0)')
  })
})
