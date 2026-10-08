// The plugin's arithmetic, with nothing that needs a page: the quantities it
// plots, settings, scales and their ticks, number formats, the snapshot's
// encoding, and the points a plot shows. app.js draws with it; the tests
// and scripts/snapshot.js use it from Node.
(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.ExoPlot = api
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict'

  // What can go on an axis: the archive's column, and whether it's usually
  // read on a log scale
  const FIELDS = {
    period: { column: 'pl_orbper', label: 'Orbital period', unit: 'days', log: true },
    semimajor: { column: 'pl_orbsmax', label: 'Semi-major axis', unit: 'AU', log: true },
    mass: { column: 'pl_bmasse', label: 'Planet mass', unit: 'M⊕', log: true },
    radius: { column: 'pl_rade', label: 'Planet radius', unit: 'R⊕', log: true },
    insolation: { column: 'pl_insol', label: 'Insolation', unit: 'S⊕', log: true },
    teq: { column: 'pl_eqt', label: 'Equilibrium temperature', unit: 'K', log: false },
    steff: { column: 'st_teff', label: 'Star temperature', unit: 'K', log: false },
    distance: { column: 'sy_dist', label: 'Distance', unit: 'pc', log: true },
    year: { column: 'disc_year', label: 'Discovery year', unit: '', log: false },
  }
  const FIELD_KEYS = Object.keys(FIELDS)
  const NUMERIC_COLUMNS = FIELD_KEYS.map(k => FIELDS[k].column)
  // The columns the plugin reads, in a snapshot or a deck dataset
  const SNAPSHOT_COLUMNS = ['pl_name', 'discoverymethod', ...NUMERIC_COLUMNS]

  const COLORINGS = ['method', 'year', 'none']
  const DEFAULTS = {
    x: 'period', y: 'mass', xLog: null, yLog: null, color: 'method', hiddenMethods: [], solarSystem: true,
    highlight: '', throughYear: null, timeline: false, theme: 'dark', title: '', dataset: '', pointSize: 3,
  }

  // An element's data with every setting filled in and checked. xLog and
  // yLog are null until someone picks a scale: the quantity's usual one.
  function settings(data) {
    const d = Object.assign({}, DEFAULTS, data && typeof data === 'object' ? data : {})
    const s = {}
    s.x = FIELDS[d.x] ? d.x : DEFAULTS.x
    s.y = FIELDS[d.y] ? d.y : DEFAULTS.y
    s.xLog = typeof d.xLog === 'boolean' ? d.xLog : FIELDS[s.x].log
    s.yLog = typeof d.yLog === 'boolean' ? d.yLog : FIELDS[s.y].log
    s.color = COLORINGS.includes(d.color) ? d.color : DEFAULTS.color
    s.hiddenMethods = Array.isArray(d.hiddenMethods) ? d.hiddenMethods.filter(m => typeof m === 'string') : []
    s.solarSystem = d.solarSystem !== false
    s.highlight = typeof d.highlight === 'string' ? d.highlight.trim().slice(0, 60) : ''
    s.throughYear = Number.isInteger(d.throughYear) ? d.throughYear : null
    s.timeline = d.timeline === true
    s.theme = d.theme === 'light' ? 'light' : 'dark'
    s.title = typeof d.title === 'string' ? d.title.slice(0, 120) : ''
    s.dataset = typeof d.dataset === 'string' ? d.dataset.slice(0, 100) : ''
    const size = Number(d.pointSize)
    s.pointSize = Number.isFinite(size) ? Math.min(8, Math.max(1, size)) : DEFAULTS.pointSize
    return s
  }

  // --- Numbers ---

  const SUPERSCRIPT = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' }
  const superscript = n => String(n).split('').map(c => SUPERSCRIPT[c]).join('')
  const grouped = v => v.toLocaleString('en-US', { maximumFractionDigits: 10 })

  // A value as a reader wants it: three significant figures, grouped
  // thousands, and powers of ten when it's very large or small
  function formatNumber(v) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—'
    const a = Math.abs(v)
    if (a !== 0 && (a < 0.001 || a >= 1e7)) {
      const e = Math.floor(Math.log10(a))
      const m = Number((v / Math.pow(10, e)).toPrecision(3))
      return `${m === 1 ? '' : `${m}×`}10${superscript(e)}`
    }
    return grouped(Number(v.toPrecision(3)))
  }

  // The value of an archive cell, or null for an empty one
  function toNumber(v) {
    if (v === null || v === undefined || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  // --- Scales and ticks ---

  // The range a set of values spans, with a little room either side. A log
  // scale takes only positive values.
  function extent(values, log) {
    let min = Infinity
    let max = -Infinity
    for (const v of values) {
      if (v === null || !Number.isFinite(v) || (log && v <= 0)) continue
      if (v < min) min = v
      if (v > max) max = v
    }
    if (min === Infinity) return log ? [1, 10] : [0, 1]
    if (log) {
      if (min === max) return [min / 2, max * 2]
      const pad = Math.pow(max / min, 0.04)
      return [min / pad, max * pad]
    }
    if (min === max) return [min - (Math.abs(min) * 0.1 || 1), max + (Math.abs(max) * 0.1 || 1)]
    const pad = (max - min) * 0.04
    return [min - pad, max + pad]
  }

  // Ticks at 1, 2 or 5 times a power of ten. plain: no grouping (years).
  function linearTicks(min, max, { count = 6, plain = false } = {}) {
    const span = max - min
    if (!(span > 0)) return []
    const rough = span / count
    const mag = Math.pow(10, Math.floor(Math.log10(rough)))
    const norm = rough / mag
    const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag
    const ticks = []
    for (let i = Math.ceil(min / step); i * step <= max + step * 1e-9; i++) {
      const v = Number((i * step).toPrecision(12))
      ticks.push({ v, major: true, label: plain ? String(v) : grouped(v) })
    }
    return ticks
  }

  function logLabel(m, e) {
    const v = Number(`${m}e${e}`)
    if (v >= 0.01 && v < 1e5) return grouped(v)
    return m === 1 ? `10${superscript(e)}` : `${m}×10${superscript(e)}`
  }

  // A tick at each power of ten (labeled, thinned out over many decades),
  // and small ones between; over two decades or fewer, 2 and 5 are labeled too
  function logTicks(min, max) {
    if (!(min > 0) || !(max > min)) return []
    const lo = Math.floor(Math.log10(min))
    const hi = Math.ceil(Math.log10(max))
    const decades = Math.log10(max / min)
    const every = Math.max(1, Math.ceil((hi - lo) / 8))
    const ticks = []
    for (let e = lo; e <= hi; e++) {
      for (let m = 1; m <= 9; m++) {
        const v = Number(`${m}e${e}`)
        if (v < min * (1 - 1e-9) || v > max * (1 + 1e-9)) continue
        const major = m === 1
        const labeled = major ? ((e % every) + every) % every === 0 : decades <= 2 && (m === 2 || m === 5)
        if (!major && decades > 6) continue
        ticks.push({ v, major, label: labeled ? logLabel(m, e) : '' })
      }
    }
    return ticks
  }

  // Maps values in domain to pixels in range, on a linear or log scale
  function scale(domain, range, log, { plain = false } = {}) {
    const f = log ? Math.log10 : v => v
    const a = f(domain[0])
    const b = f(domain[1])
    const k = (range[1] - range[0]) / (b - a || 1)
    return {
      log, domain, range,
      map: v => range[0] + (f(v) - a) * k,
      ticks: () => (log ? logTicks(domain[0], domain[1]) : linearTicks(domain[0], domain[1], { plain })),
    }
  }

  // --- The data ---

  const round4 = v => {
    const n = toNumber(v)
    return n === null ? null : n === 0 ? 0 : Number(n.toPrecision(4))
  }

  // The archive's rows ({ column: value }) as the snapshot stores them:
  // a column at a time, numbers to four significant figures, discovery
  // methods as indexes into `methods`
  function encodeSnapshot(rows, { asOf, query } = {}) {
    const methods = [...new Set(rows.map(r => r.discoverymethod).filter(m => typeof m === 'string' && m))].sort()
    const columns = {
      pl_name: rows.map(r => (r.pl_name == null ? null : String(r.pl_name))),
      discoverymethod: rows.map(r => (methods.includes(r.discoverymethod) ? methods.indexOf(r.discoverymethod) : null)),
    }
    for (const c of NUMERIC_COLUMNS) columns[c] = rows.map(r => (c === 'disc_year' ? toNumber(r[c]) : round4(r[c])))
    return {
      asOf, source: 'NASA Exoplanet Archive, Planetary Systems Composite Parameters (pscomppars)',
      query, count: rows.length, methods, columns,
    }
  }

  // A snapshot as the plot reads it: { n, columns, asOf, source }
  function decodeSnapshot(snapshot) {
    const columns = Object.assign({}, snapshot.columns)
    columns.discoverymethod = (snapshot.columns.discoverymethod || []).map(i => (i === null ? null : snapshot.methods[i] || null))
    return { n: snapshot.count, columns, asOf: snapshot.asOf || null, source: 'snapshot' }
  }

  // A deck dataset's columns ({ columns, totalRows }, as
  // parallax.datasets.query answers) as the plot reads them
  function fromDataset(result, { asOf = null, name = '' } = {}) {
    const columns = {}
    let n = 0
    for (const [c, values] of Object.entries((result && result.columns) || {})) {
      if (!Array.isArray(values)) continue
      columns[c] = NUMERIC_COLUMNS.includes(c) ? values.map(toNumber) : values.map(v => (v == null || v === '' ? null : String(v)))
      n = Math.max(n, values.length)
    }
    return { n, columns, asOf, source: 'dataset', name }
  }

  // The discovery methods in a table, most planets first: [{ method, count }]
  function methodsIn(table) {
    const counts = new Map()
    for (const m of table.columns.discoverymethod || []) {
      const key = m || 'Unknown'
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    return [...counts].map(([method, count]) => ({ method, count })).sort((a, b) => b.count - a.count || (a.method < b.method ? -1 : 1))
  }

  // What a plot shows: { points, plottable, methods, xValues, yValues,
  // missing }. plottable counts the planets with both values (positive on
  // a log axis), and methods counts them by discovery method, most first;
  // points are those of them the settings show. xValues and yValues
  // are all plottable planets' values, for the axes' extents, so the axes
  // hold still as methods are hidden or the years play. missing names
  // columns the table lacks.
  function points(table, s) {
    const cx = FIELDS[s.x].column
    const cy = FIELDS[s.y].column
    const xs = table.columns[cx]
    const ys = table.columns[cy]
    const missing = [!xs && cx, !ys && cy].filter(Boolean)
    if (missing.length) return { points: [], plottable: 0, methods: [], xValues: [], yValues: [], missing }
    const names = table.columns.pl_name || []
    const methods = table.columns.discoverymethod || []
    const years = table.columns.disc_year || []
    const hidden = new Set(s.hiddenMethods)
    const shown = []
    const counts = new Map()
    const allX = []
    const allY = []
    for (let i = 0; i < table.n; i++) {
      const x = toNumber(xs[i])
      const y = toNumber(ys[i])
      if (x === null || y === null || (s.xLog && x <= 0) || (s.yLog && y <= 0)) continue
      allX.push(x)
      allY.push(y)
      const method = methods[i] || 'Unknown'
      counts.set(method, (counts.get(method) || 0) + 1)
      const year = toNumber(years[i])
      if (hidden.has(method)) continue
      if (s.throughYear !== null && year !== null && year > s.throughYear) continue
      shown.push({ i, x, y, method, year, name: names[i] || '' })
    }
    const byMethod = [...counts].map(([method, count]) => ({ method, count })).sort((a, b) => b.count - a.count || (a.method < b.method ? -1 : 1))
    return { points: shown, plottable: allX.length, methods: byMethod, xValues: allX, yValues: allY, missing }
  }

  // The point nearest (px, py) in pixels, within maxDist, or null
  function nearest(list, toX, toY, px, py, maxDist = 12) {
    let best = null
    let bestD = maxDist * maxDist
    for (const p of list) {
      const dx = toX(p.x) - px
      const dy = toY(p.y) - py
      const d = dx * dx + dy * dy
      if (d <= bestD) { best = p; bestD = d }
    }
    return best
  }

  // The first and last discovery years in a table
  function yearRange(table) {
    let lo = Infinity
    let hi = -Infinity
    for (const v of table.columns.disc_year || []) {
      const y = toNumber(v)
      if (y === null) continue
      if (y < lo) lo = y
      if (y > hi) hi = y
    }
    return lo === Infinity ? null : [lo, hi]
  }

  // --- The Solar System, for comparison (zero-albedo equilibrium temperature) ---

  const SOLAR_SYSTEM = [
    ['Mercury', 87.97, 0.387, 0.0553, 0.383, 6.67, 448],
    ['Venus', 224.7, 0.723, 0.815, 0.949, 1.91, 328],
    ['Earth', 365.25, 1.0, 1.0, 1.0, 1.0, 279],
    ['Mars', 687.0, 1.524, 0.107, 0.532, 0.431, 226],
    ['Jupiter', 4332.6, 5.203, 317.8, 11.21, 0.0369, 122],
    ['Saturn', 10759, 9.537, 95.16, 9.45, 0.011, 90],
    ['Uranus', 30687, 19.19, 14.54, 4.01, 0.00271, 64],
    ['Neptune', 60190, 30.07, 17.15, 3.88, 0.0011, 51],
  ].map(([name, pl_orbper, pl_orbsmax, pl_bmasse, pl_rade, pl_insol, pl_eqt]) => ({
    name, values: { pl_orbper, pl_orbsmax, pl_bmasse, pl_rade, pl_insol, pl_eqt, st_teff: 5772 },
  }))

  // The Solar System's planets on these axes (none for a quantity they
  // don't have, such as distance)
  function solarSystemPoints(s) {
    const cx = FIELDS[s.x].column
    const cy = FIELDS[s.y].column
    return SOLAR_SYSTEM
      .map(p => ({ name: p.name, x: p.values[cx], y: p.values[cy] }))
      .filter(p => p.x !== undefined && p.y !== undefined && (!s.xLog || p.x > 0) && (!s.yLog || p.y > 0))
  }

  // --- Colors ---

  const METHOD_COLORS = {
    dark: {
      Transit: '#4cc9f0', 'Radial Velocity': '#f4a259', Microlensing: '#6bd49a', Imaging: '#e377c2',
      'Transit Timing Variations': '#f7e463', 'Eclipse Timing Variations': '#ff6b6b', 'Orbital Brightness Modulation': '#a99bff',
      'Pulsar Timing': '#cfcfcf', Astrometry: '#ffffff', 'Pulsation Timing Variations': '#d4a5a5', 'Disk Kinematics': '#8ecae6',
    },
    light: {
      Transit: '#0072b2', 'Radial Velocity': '#d55e00', Microlensing: '#009e73', Imaging: '#cc79a7',
      'Transit Timing Variations': '#a68f00', 'Eclipse Timing Variations': '#c0392b', 'Orbital Brightness Modulation': '#6a4c93',
      'Pulsar Timing': '#555555', Astrometry: '#222222', 'Pulsation Timing Variations': '#8c564b', 'Disk Kinematics': '#17a2b8',
    },
  }
  const SPARE = { dark: ['#b5e48c', '#ffd6a5', '#bdb2ff', '#ffadad'], light: ['#2a9d8f', '#e76f51', '#264653', '#9c6644'] }

  function methodColor(method, theme) {
    const known = METHOD_COLORS[theme][method]
    if (known) return known
    let h = 0
    for (const c of String(method)) h = (h * 31 + c.charCodeAt(0)) >>> 0
    return SPARE[theme][h % SPARE[theme].length]
  }

  // Viridis, from purple to yellow; lifted at its dark end on a dark slide
  const YEAR_STOPS = {
    dark: ['#7b4fb8', '#3e70b9', '#21a19c', '#6ccf5f', '#fde725'],
    light: ['#440154', '#3b528b', '#21918c', '#5ec962', '#d9c800'],
  }
  const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16))
  function yearColor(t, theme) {
    const stops = YEAR_STOPS[theme]
    const u = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (stops.length - 1)
    const i = Math.min(stops.length - 2, Math.floor(u))
    const a = hex(stops[i])
    const b = hex(stops[i + 1])
    const f = u - i
    return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',')})`
  }

  return {
    FIELDS, FIELD_KEYS, NUMERIC_COLUMNS, SNAPSHOT_COLUMNS, COLORINGS, DEFAULTS, SOLAR_SYSTEM, YEAR_STOPS,
    settings, formatNumber, toNumber, extent, linearTicks, logTicks, scale,
    encodeSnapshot, decodeSnapshot, fromDataset, methodsIn, points, nearest, yearRange, solarSystemPoints,
    methodColor, yearColor,
  }
})
