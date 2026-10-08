// The plot: planets from the built-in snapshot, or from a deck dataset
// through parallax.datasets, drawn on a canvas with a legend, hover cards,
// a settings panel and an optional year slider. Settings live in the
// element's data (parallax.data), and a change goes back with
// parallax.updateData, so the editor keeps it and undo works. Opened on
// its own, outside Parallax, it keeps its settings in memory.
(function () {
  'use strict'
  const P = window.ExoPlot
  const host = window.parallax || standaloneHost()
  const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
  const THEMES = {
    dark: { text: '#e8e8f0', muted: 'rgba(232,232,240,0.62)', grid: 'rgba(255,255,255,0.08)', axis: 'rgba(255,255,255,0.4)', ring: '#ffffff', solar: '#ffd166', solarEdge: '#1b1b28' },
    light: { text: '#1d1d28', muted: 'rgba(29,29,40,0.64)', grid: 'rgba(0,0,0,0.08)', axis: 'rgba(0,0,0,0.42)', ring: '#000000', solar: '#d97706', solarEdge: '#ffffff' },
  }
  const COLOR_NAMES = { method: 'Discovery method', year: 'Discovery year', none: 'One color' }

  function standaloneHost() {
    let data = {}
    const listeners = []
    const copy = () => JSON.parse(JSON.stringify(data))
    return {
      get data() { return copy() },
      updateData(patch) { Object.assign(data, patch); listeners.forEach(cb => cb(copy())) },
      onDataChanged(cb) { listeners.push(cb) },
    }
  }

  // --- The page ---

  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v
      else if (k === 'text') node.textContent = v
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v)
      else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v)
    }
    for (const c of children) if (c != null) node.append(c)
    return node
  }
  const GEAR = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'
  const PLAY = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg>'
  const PAUSE = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>'

  const canvas = el('canvas', { role: 'img' })
  const ctx = canvas.getContext('2d')
  const title = el('div', { class: 'title', hidden: true })
  const legend = el('div', { class: 'legend' })
  const footer = el('div', { class: 'footer' })
  const message = el('div', { class: 'message', hidden: true })
  const card = el('div', { class: 'card', hidden: true })
  const playButton = el('button', { class: 'round', type: 'button', 'aria-label': 'Play the discoveries year by year' })
  const yearInput = el('input', { type: 'range', 'aria-label': 'Discovered through' })
  const yearLabel = el('span', { class: 'year' })
  const timeline = el('div', { class: 'timeline', hidden: true }, playButton, yearInput, yearLabel)
  const gear = el('button', { class: 'round gear', type: 'button', 'aria-label': 'Plot settings', 'aria-expanded': 'false' })
  const panel = el('form', { class: 'panel', hidden: true })
  gear.innerHTML = GEAR
  playButton.innerHTML = PLAY
  const app = el('div', { id: 'app', class: 'theme-dark' }, canvas, title, legend, timeline, footer, message, card, gear, panel)
  document.body.append(app)

  // --- State ---

  let data = host.data || {}
  let table = null
  let tableKey = null
  let loadError = ''
  let note = ''
  let snapshotPromise = null
  let view = null
  let hovered = null
  let playing = null

  // Changes some settings here and in the element's data
  function save(patch) {
    data = Object.assign({}, data, patch)
    host.updateData(patch)
    refresh()
  }

  // --- Data ---

  function readSnapshot() {
    if (!snapshotPromise) {
      snapshotPromise = (async () => {
        if (typeof DecompressionStream === 'undefined') throw new Error('This browser can’t unpack the built-in data. Choose a deck dataset in the settings.')
        const text = document.getElementById('snapshot').textContent.trim()
        const bytes = Uint8Array.from(atob(text), c => c.charCodeAt(0))
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
        return P.decodeSnapshot(JSON.parse(await new Response(stream).text()))
      })()
    }
    return snapshotPromise
  }

  async function readDataset(name) {
    const list = await host.datasets.list()
    const meta = (list || []).find(d => d.name === name)
    if (!meta) throw new Error(`The deck has no dataset named “${name}”`)
    const have = new Set((meta.columns || []).map(c => (typeof c === 'string' ? c : c.name)))
    const columns = P.SNAPSHOT_COLUMNS.filter(c => have.has(c))
    if (!columns.length) throw new Error(`The dataset “${name}” has none of the archive’s columns, such as pl_orbper or pl_bmasse`)
    return P.fromDataset(await host.datasets.query(name, { columns }), { asOf: meta.asOf, name })
  }

  // Loads what the settings plot from: the deck dataset they name, or the
  // snapshot (also when that dataset can't be read here)
  async function load(s) {
    const key = s.dataset ? `dataset:${s.dataset}` : 'snapshot'
    if (key === tableKey) return
    tableKey = key
    table = null
    loadError = ''
    note = ''
    draw()
    let next = null
    let nextNote = ''
    try {
      if (s.dataset && host.datasets) next = await readDataset(s.dataset)
      else {
        next = await readSnapshot()
        if (s.dataset) nextNote = `The deck’s dataset “${s.dataset}” isn’t here, so this is the built-in snapshot`
      }
    } catch (err) {
      if (s.dataset) {
        try {
          next = await readSnapshot()
          nextNote = `${err.message}. This is the built-in snapshot.`
        } catch (err2) { loadError = err2.message }
      } else loadError = err.message
    }
    if (tableKey !== key) return
    table = next
    note = nextNote
    draw()
  }

  // --- Drawing ---

  const formatDate = iso => {
    if (!iso) return ''
    const d = new Date(String(iso).length === 10 ? `${iso}T00:00:00Z` : iso)
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
  }
  const axisTitle = key => {
    const f = P.FIELDS[key]
    return f.unit ? `${f.label} (${f.unit})` : f.label
  }
  const count = n => n.toLocaleString('en-US')

  // Where things go, from the bottom up: the footer, the year slider, a
  // legend under the plot when it's too narrow for one beside it, then the
  // x axis's labels and title. legend: 'side', 'below' or null; legendH, the
  // height a legend below takes.
  function layout(W, H, s, legend, legendH) {
    const small = W < 380 || H < 260
    const font = small ? 10 : 12
    const titleH = s.title ? (small ? 20 : 26) : 0
    const timelineH = s.timeline ? 30 : 0
    const legendW = legend === 'side' ? Math.min(210, Math.round(W * 0.3)) : 0
    const timelineTop = H - 14 - timelineH
    const legendTop = timelineTop - (legend === 'below' ? legendH : 0)
    return {
      small, font, titleH, timelineH, legendW, timelineTop, legendTop,
      x0: small ? 46 : 62,
      x1: W - 14 - legendW,
      y0: 10 + titleH,
      y1: legendTop - (small ? 34 : 44),
    }
  }

  // The height a legend under the plot needs, its entries wrapped to width
  function legendRows(entries, width) {
    ctx.font = `11px ${FONT}`
    let rows = 1
    let used = 0
    for (const text of entries) {
      const w = 9 + 6 + ctx.measureText(text).width + 12
      if (used && used + w > width) { rows++; used = 0 }
      used += w
    }
    return rows * 16 + 4
  }

  function draw() {
    const s = P.settings(data)
    const theme = THEMES[s.theme]
    const W = Math.max(1, window.innerWidth)
    const H = Math.max(1, window.innerHeight)
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
    canvas.style.width = `${W}px`
    canvas.style.height = `${H}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    app.className = `theme-${s.theme}${W < 380 || H < 260 ? ' small' : ''}`
    title.hidden = !s.title
    title.textContent = s.title

    if (!table) {
      view = null
      legend.replaceChildren()
      footer.replaceChildren()
      timeline.hidden = true
      showMessage(loadError || 'Loading planets…')
      return
    }
    const res = P.points(table, s)
    if (res.missing.length) {
      view = null
      legend.replaceChildren()
      timeline.hidden = true
      showMessage(`The dataset “${table.name}” has no ${res.missing.join(' or ')} column. Add it to the dataset’s query, or choose other axes.`)
      drawFooter(s, res)
      return
    }
    showMessage(res.plottable ? '' : 'No planets have both of these values.')

    const solar = s.solarSystem ? P.solarSystemPoints(s) : []
    const legendMode = s.color === 'none' ? null : W >= 520 ? 'side' : 'below'
    const legendH = legendMode !== 'below' ? 0 : s.color === 'year' ? 22 : legendRows(res.methods.map(m => m.method), W - 24)
    const L = layout(W, H, s, legendMode, legendH)
    const xDomain = P.extent(res.xValues.concat(solar.map(p => p.x)), s.xLog)
    const yDomain = P.extent(res.yValues.concat(solar.map(p => p.y)), s.yLog)
    const sx = P.scale(xDomain, [L.x0, L.x1], s.xLog, { plain: s.x === 'year' })
    const sy = P.scale(yDomain, [L.y1, L.y0], s.yLog, { plain: s.y === 'year' })
    const years = P.yearRange(table) || [1992, new Date().getUTCFullYear()]

    drawAxes(L, sx, sy, s, theme)

    // The planets, a color at a time, the commonest first so rarer ones sit on top
    const colorOf = p => (s.color === 'method' ? P.methodColor(p.method, s.theme)
      : s.color === 'year' ? P.yearColor(p.year === null ? 0 : (p.year - years[0]) / Math.max(1, years[1] - years[0]), s.theme)
        : s.theme === 'dark' ? '#7fb8ff' : '#2563eb')
    const groups = new Map()
    for (const p of res.points) {
      const c = colorOf(p)
      if (!groups.has(c)) groups.set(c, [])
      groups.get(c).push(p)
    }
    const order = [...groups.keys()].sort((a, b) => groups.get(b).length - groups.get(a).length)
    const r = s.pointSize
    ctx.save()
    ctx.beginPath()
    ctx.rect(L.x0, L.y0, L.x1 - L.x0, L.y1 - L.y0)
    ctx.clip()
    ctx.globalAlpha = 0.78
    for (const c of order) {
      ctx.fillStyle = c
      ctx.beginPath()
      for (const p of groups.get(c)) {
        const x = sx.map(p.x)
        const y = sy.map(p.y)
        ctx.moveTo(x + r, y)
        ctx.arc(x, y, r, 0, Math.PI * 2)
      }
      ctx.fill()
    }
    ctx.globalAlpha = 1

    // Planets whose names hold the highlight, ringed, and the Solar System.
    // Names go where they miss every dot and ring here; the Solar System's
    // first, since an unnamed ring still reads as the highlight but an
    // unnamed yellow dot reads as nothing.
    const needle = s.highlight.toLowerCase()
    const matches = needle ? res.points.filter(p => p.name.toLowerCase().includes(needle)) : []
    const placed = []
    const keepClear = (x, y, radius) => placed.push({ x0: x - radius, x1: x + radius, y0: y - radius, y1: y + radius })
    ctx.strokeStyle = theme.ring
    ctx.lineWidth = 1.5
    for (const p of matches) {
      const x = sx.map(p.x)
      const y = sy.map(p.y)
      ctx.beginPath()
      ctx.arc(x, y, r + 3, 0, Math.PI * 2)
      ctx.stroke()
      keepClear(x, y, r + 4)
    }
    for (const p of solar) {
      const x = sx.map(p.x)
      const y = sy.map(p.y)
      ctx.beginPath()
      ctx.arc(x, y, r + 2, 0, Math.PI * 2)
      ctx.fillStyle = theme.solar
      ctx.fill()
      ctx.lineWidth = 1.25
      ctx.strokeStyle = theme.solarEdge
      ctx.stroke()
      keepClear(x, y, r + 2)
    }
    ctx.font = `${L.font - 1}px ${FONT}`
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.fillStyle = theme.text
    for (const p of solar) label(p.name, sx.map(p.x), sy.map(p.y), r + 2, L, placed)
    if (matches.length <= 8) for (const p of matches) label(p.name, sx.map(p.x), sy.map(p.y), r + 3, L, placed)

    if (hovered) {
      ctx.beginPath()
      ctx.arc(sx.map(hovered.x), sy.map(hovered.y), r + 4, 0, Math.PI * 2)
      ctx.strokeStyle = theme.ring
      ctx.lineWidth = 2
      ctx.stroke()
    }
    ctx.restore()

    view = { s, sx, sy, points: res.points, solar, L }
    canvas.setAttribute('aria-label', `${P.FIELDS[s.y].label} against ${P.FIELDS[s.x].label.toLowerCase()} for ${count(res.points.length)} planets`)
    drawLegend(s, res, L, legendMode, years)
    drawTimeline(s, L, years)
    drawFooter(s, res)
  }

  function drawAxes(L, sx, sy, s, theme) {
    ctx.font = `${L.font}px ${FONT}`
    ctx.lineWidth = 1
    // Vertical gridlines and the x labels, skipping labels that would collide
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    let lastRight = -Infinity
    for (const t of sx.ticks()) {
      const x = Math.round(sx.map(t.v)) + 0.5
      if (x < L.x0 - 0.5 || x > L.x1 + 0.5) continue
      if (t.major) line(x, L.y0, x, L.y1, theme.grid)
      line(x, L.y1, x, L.y1 + (t.major ? 5 : 3), theme.axis)
      if (!t.label) continue
      const w = ctx.measureText(t.label).width
      if (x - w / 2 < lastRight + 6) continue
      ctx.fillStyle = theme.muted
      ctx.fillText(t.label, x, L.y1 + 7)
      lastRight = x + w / 2
    }
    // Horizontal gridlines and the y labels
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    let lastTop = Infinity
    for (const t of sy.ticks()) {
      const y = Math.round(sy.map(t.v)) + 0.5
      if (y < L.y0 - 0.5 || y > L.y1 + 0.5) continue
      if (t.major) line(L.x0, y, L.x1, y, theme.grid)
      line(L.x0 - (t.major ? 5 : 3), y, L.x0, y, theme.axis)
      if (!t.label || y + L.font / 2 > lastTop - 3) continue
      ctx.fillStyle = theme.muted
      ctx.fillText(t.label, L.x0 - 8, y)
      lastTop = y - L.font / 2
    }
    line(L.x0 + 0.5, L.y0, L.x0 + 0.5, L.y1 + 0.5, theme.axis)
    line(L.x0, L.y1 + 0.5, L.x1, L.y1 + 0.5, theme.axis)
    // Axis titles
    ctx.fillStyle = theme.text
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(axisTitle(s.x), (L.x0 + L.x1) / 2, L.y1 + L.font + 13)
    ctx.save()
    ctx.translate(13, (L.y0 + L.y1) / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.textBaseline = 'middle'
    ctx.fillText(axisTitle(s.y), 0, 0)
    ctx.restore()
  }

  // Writes a point's name beside it: to its right, else its left, above,
  // below or at a corner, wherever it misses the names already written
  // (placed) and stays in the plot; nowhere, when every spot is taken
  function label(text, x, y, r, L, placed) {
    const w = ctx.measureText(text).width
    const h = L.font
    const d = r + 3
    const spots = [[x + r + 5, y], [x - r - 5 - w, y], [x - w / 2, y - r - h / 2 - 3], [x - w / 2, y + r + h / 2 + 3],
      [x + d, y - d - h / 2], [x + d, y + d + h / 2], [x - d - w, y - d - h / 2], [x - d - w, y + d + h / 2]]
    for (const [left, mid] of spots) {
      const box = { x0: left - 1, x1: left + w + 1, y0: mid - h / 2, y1: mid + h / 2 }
      if (box.x0 < L.x0 || box.x1 > L.x1 || box.y0 < L.y0 || box.y1 > L.y1) continue
      if (placed.some(b => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) continue
      placed.push(box)
      ctx.fillText(text, left, mid)
      return
    }
  }

  function line(x1, y1, x2, y2, color) {
    ctx.strokeStyle = color
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }

  function showMessage(text) {
    message.hidden = !text
    message.textContent = text
  }

  function drawLegend(s, res, L, mode, years) {
    legend.replaceChildren()
    legend.hidden = !mode
    if (!mode) return
    const side = mode === 'side'
    legend.className = side ? 'legend' : 'legend below'
    Object.assign(legend.style, side
      ? { left: `${L.x1 + 14}px`, top: `${L.y0}px`, width: `${L.legendW - 18}px`, right: '' }
      : { left: '12px', top: `${L.legendTop}px`, width: '', right: '12px' })
    if (s.color === 'year') {
      const stops = P.YEAR_STOPS[s.theme]
      const ramp = el('div', { class: 'ramp', style: `background: linear-gradient(to right, ${stops.join(', ')})` })
      legend.append(side
        ? el('div', {}, el('div', { class: 'heading', text: 'Discovery year' }), ramp, el('div', { class: 'ends' }, el('span', { text: String(years[0]) }), el('span', { text: String(years[1]) })))
        : el('div', { class: 'years' }, el('span', { text: `Discovered ${years[0]}` }), ramp, el('span', { text: String(years[1]) })))
      return
    }
    const hidden = new Set(s.hiddenMethods)
    if (side) legend.append(el('div', { class: 'heading', text: 'Discovery method' }))
    for (const { method, count: n } of res.methods) {
      const shown = !hidden.has(method)
      legend.append(el('button', {
        type: 'button', 'aria-pressed': String(shown), title: `${shown ? 'Hide' : 'Show'} ${method} (${count(n)})`,
        onclick: () => save({ hiddenMethods: shown ? [...s.hiddenMethods, method] : s.hiddenMethods.filter(m => m !== method) }),
      }, el('span', { class: 'swatch', style: `background: ${P.methodColor(method, s.theme)}` }), el('span', { class: 'name', text: method }), el('span', { class: 'count', text: count(n) })))
    }
  }

  function drawFooter(s, res) {
    const source = table.source === 'dataset'
      ? `dataset “${table.name}”${table.asOf ? `, ${formatDate(table.asOf)}` : ''}`
      : `NASA Exoplanet Archive, ${formatDate(table.asOf)}`
    const parts = [res.plottable ? `${count(res.points.length)} of ${count(res.plottable)} planets` : '', source].filter(Boolean)
    footer.replaceChildren(...(note ? [el('span', { class: 'note', text: `${note} · ` })] : []), parts.join(' · '))
  }

  function drawTimeline(s, L, years) {
    timeline.hidden = !s.timeline
    if (!s.timeline) return
    timeline.style.top = `${L.timelineTop}px`
    yearInput.min = String(years[0])
    yearInput.max = String(years[1])
    const through = s.throughYear === null ? years[1] : Math.min(years[1], Math.max(years[0], s.throughYear))
    if (document.activeElement !== yearInput || playing) yearInput.value = String(through)
    yearLabel.textContent = `Discovered through ${through}`
    playButton.innerHTML = playing ? PAUSE : PLAY
    playButton.setAttribute('aria-label', playing ? 'Pause' : 'Play the discoveries year by year')
  }

  // --- Hover cards ---

  canvas.addEventListener('pointermove', e => {
    if (!view) return
    const rect = canvas.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const { sx, sy, points: list, solar, L } = view
    const inside = px >= L.x0 && px <= L.x1 && py >= L.y0 && py <= L.y1
    const solarHit = inside ? P.nearest(solar, sx.map, sy.map, px, py, 10) : null
    const hit = solarHit ? Object.assign({ solar: true }, solarHit) : inside ? P.nearest(list, sx.map, sy.map, px, py, 10) : null
    if (hit !== hovered && !(hit && hovered && hit.name === hovered.name && hit.x === hovered.x)) {
      hovered = hit
      draw()
    }
    showCard(hit, px, py)
  })
  canvas.addEventListener('pointerleave', () => {
    card.hidden = true
    if (hovered) { hovered = null; draw() }
  })

  function showCard(p, px, py) {
    if (!p) { card.hidden = true; return }
    const s = view.s
    const rows = [[s.x, p.x], [s.y, p.y]].map(([key, value]) => {
      const f = P.FIELDS[key]
      return el('div', { class: 'row' }, el('span', { text: f.label }), el('span', { text: key === 'year' ? String(value) : `${P.formatNumber(value)}${f.unit ? ` ${f.unit}` : ''}` }))
    })
    const sub = p.solar ? 'Solar System' : [p.method, p.year].filter(Boolean).join(' · ')
    card.replaceChildren(el('strong', { text: p.name || 'Unnamed planet' }), el('div', { class: 'sub', text: sub }), ...rows)
    card.hidden = false
    const W = window.innerWidth
    const H = window.innerHeight
    const w = card.offsetWidth
    const h = card.offsetHeight
    card.style.left = `${px + 14 + w > W ? Math.max(4, px - 14 - w) : px + 14}px`
    card.style.top = `${py + 14 + h > H ? Math.max(4, py - 14 - h) : py + 14}px`
  }

  // --- The year slider ---

  const throughFrom = value => {
    const years = table && P.yearRange(table)
    return years && value >= years[1] ? null : value
  }
  yearInput.addEventListener('input', () => {
    stopPlaying()
    data = Object.assign({}, data, { throughYear: throughFrom(Number(yearInput.value)) })
    draw()
  })
  yearInput.addEventListener('change', () => save({ throughYear: throughFrom(Number(yearInput.value)) }))
  playButton.addEventListener('click', () => {
    if (playing) return stopPlaying()
    const years = table && P.yearRange(table)
    if (!years) return
    const s = P.settings(data)
    let year = s.throughYear === null || s.throughYear >= years[1] ? years[0] : s.throughYear
    const step = () => {
      data = Object.assign({}, data, { throughYear: year >= years[1] ? null : year })
      draw()
      if (year >= years[1]) return stopPlaying()
      year += 1
    }
    playing = setInterval(step, 280)
    step()
  })
  function stopPlaying() {
    if (!playing) return
    clearInterval(playing)
    playing = null
    draw()
  }

  // --- Settings ---

  gear.addEventListener('click', () => (panel.hidden ? openPanel() : closePanel()))
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) closePanel() })
  panel.addEventListener('submit', e => { e.preventDefault(); closePanel() })

  function closePanel() {
    panel.hidden = true
    gear.setAttribute('aria-expanded', 'false')
    gear.focus()
  }

  async function openPanel() {
    let datasets = []
    if (host.datasets) {
      try { datasets = (await host.datasets.list()) || [] } catch { datasets = [] }
    }
    let snapshotDate = ''
    try { snapshotDate = formatDate((await readSnapshot()).asOf) } catch { /* no snapshot here */ }
    buildPanel(P.settings(data), datasets, snapshotDate)
    panel.hidden = false
    gear.setAttribute('aria-expanded', 'true')
    panel.querySelector('select')?.focus()
  }

  function select(options, value, onchange, label) {
    const node = el('select', { 'aria-label': label, onchange: e => onchange(e.target.value) })
    for (const [v, text] of options) node.append(el('option', { value: v, text, selected: v === value }))
    return node
  }

  function buildPanel(s, datasets, snapshotDate) {
    const fields = P.FIELD_KEYS.map(k => [k, axisTitle(k)])
    const axis = (which, label) => {
      const key = s[which]
      const logKey = `${which}Log`
      return el('div', { class: 'pair' },
        el('label', {}, label, select(fields, key, v => { save({ [which]: v, [logKey]: null }); rebuild() }, `${label} axis`)),
        el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: s[logKey], disabled: key === 'year', onchange: e => save({ [logKey]: e.target.checked }) }), 'Log'))
    }
    const check = (key, label) => el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: s[key], onchange: e => save({ [key]: e.target.checked }) }), label)
    const text = (key, label, placeholder) => el('label', {}, label, el('input', { type: 'text', value: s[key], placeholder, onchange: e => save({ [key]: e.target.value }) }))
    const sources = [['', `Built-in snapshot${snapshotDate ? ` (${snapshotDate})` : ''}`], ...datasets.map(d => [d.name, `Deck dataset: ${d.name}`])]
    if (s.dataset && !datasets.some(d => d.name === s.dataset)) sources.push([s.dataset, `Deck dataset: ${s.dataset} (not here)`])
    panel.replaceChildren(
      el('h2', { text: 'Plot settings' }),
      el('label', {}, 'Data', select(sources, s.dataset, v => save({ dataset: v }), 'Data')),
      axis('x', 'Horizontal'),
      axis('y', 'Vertical'),
      el('label', {}, 'Color by', select(P.COLORINGS.map(c => [c, COLOR_NAMES[c]]), s.color, v => save({ color: v }), 'Color by')),
      text('highlight', 'Highlight planets named', 'TRAPPIST-1'),
      check('solarSystem', 'Show the Solar System'),
      // Without its slider, a year it was left at would hide planets unseen
      el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: s.timeline, onchange: e => save(e.target.checked ? { timeline: true } : { timeline: false, throughYear: null }) }), 'Show a year slider'),
      el('label', {}, 'Text', select([['dark', 'Light, for dark slides'], ['light', 'Dark, for light slides']], s.theme, v => save({ theme: v }), 'Text')),
      text('title', 'Title', 'Optional'),
      el('label', {}, 'Point size', el('input', { type: 'range', min: '1', max: '8', step: '0.5', value: String(s.pointSize), onchange: e => save({ pointSize: Number(e.target.value) }) })),
      el('p', { class: 'credit', text: 'Data: NASA Exoplanet Archive, Planetary Systems Composite Parameters. A deck dataset needs the archive’s column names, such as pl_orbper and pl_bmasse.' }),
      el('button', { class: 'done', type: 'submit', text: 'Done' }),
    )
    function rebuild() { buildPanel(P.settings(data), datasets, snapshotDate) }
  }

  // --- Keeping up ---

  function refresh() {
    load(P.settings(data))
    draw()
  }
  if (host.onDataChanged) host.onDataChanged(d => { data = d || {}; refresh() })
  if (host.onResize) host.onResize(() => draw())
  window.addEventListener('resize', () => draw())
  refresh()
})()
