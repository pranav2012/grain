// Spike B benchmark: load + fast-scroll metrics for each diff renderer on real PR patches.
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:4173'
const prs = (process.argv[3] ?? 'small,medium,large').split(',')
const libs = ['pierre', 'gdv']
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-precise-memory-info'] })
const rows = []

for (const pr of prs) {
  for (const lib of libs) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    const start = Date.now()
    await page.goto(`${base}/?lib=${lib}&pr=${pr}`)
    try {
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 180_000 })
    } catch {
      rows.push({ pr, lib, error: `not ready after ${(Date.now() - start) / 1000}s ${errors[0] ?? ''}` })
      await page.close()
      continue
    }
    await page.waitForTimeout(1500)
    const load = await page.evaluate(() => {
      const countNodes = (root) => {
        let n = 0
        for (const el of root.querySelectorAll('*')) {
          n++
          if (el.shadowRoot) n += countNodes(el.shadowRoot)
        }
        return n
      }
      return { ...window.__bench, heapMB: performance.memory.usedJSHeapSize / 1e6, domNodes: countNodes(document) }
    })
    const scroll = await page.evaluate(async () => {
      const scroller = [...document.querySelectorAll('*')]
        .filter((e) => e.scrollHeight > e.clientHeight + 10 && /(auto|scroll)/.test(getComputedStyle(e).overflowY))
        .sort((a, b) => b.scrollHeight - a.scrollHeight)[0]
      if (!scroller) return { error: 'no scroller' }
      const deltas = []
      let last = performance.now()
      for (let i = 0; i < 300; i++) {
        scroller.scrollTop = (scroller.scrollTop + 1200) % Math.max(1, scroller.scrollHeight - scroller.clientHeight)
        await new Promise((r) => requestAnimationFrame(r))
        const now = performance.now()
        deltas.push(now - last)
        last = now
      }
      deltas.sort((a, b) => a - b)
      const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length
      return {
        scrollHeightPx: scroller.scrollHeight,
        fps: Math.round(1000 / avg),
        p95FrameMs: Math.round(deltas[Math.floor(deltas.length * 0.95)]),
        framesOver50ms: deltas.filter((d) => d > 50).length,
        heapAfterScrollMB: Math.round(performance.memory.usedJSHeapSize / 1e6),
      }
    })
    rows.push({
      pr,
      lib,
      files: load.files,
      parseMs: Math.round(load.parseMs),
      firstPaintMs: Math.round(load.firstPaintMs),
      blockingMs: Math.round(load.longTasksMs),
      heapMB: Math.round(load.heapMB),
      domNodes: load.domNodes,
      ...scroll,
      errors: errors.length,
    })
    await page.close()
  }
}
await browser.close()
console.table(rows)
