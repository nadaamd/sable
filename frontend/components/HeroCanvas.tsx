"use client"

import { useEffect, useRef } from "react"

/**
 * The hero's background: a slowly turning wireframe form, centre stage, in a field of dust.
 *
 * The reference runs two full-screen WebGL canvases for this — a "rig" scene whose geometry
 * changes per section (a star on the hero, a diamond on the next) plus a GL gradient, and a grain
 * overlay above everything. That is three.js work. This gets the same read in canvas 2D with no
 * library: an icosahedron projected by hand, rotating on two axes, tilting toward the cursor.
 *
 * Both layers share ONE canvas and ONE requestAnimationFrame loop. Two components would mean two
 * loops competing for the same frame budget to draw into the same corner of the screen.
 *
 * This is atmosphere, not information, so it is boxed in exactly as the dust was:
 *
 *  - `prefers-reduced-motion` draws a single static frame and never starts the loop.
 *  - The loop stops when the hero leaves the viewport and when the tab is hidden.
 *  - Counts scale with viewport area and are capped.
 *  - `pointer-events: none` and `aria-hidden`: it cannot intercept a click or reach a reader.
 *  - Landing only. The terminal has none of it.
 */

const AREA_PER_MOTE = 14_000
const MAX_MOTES = 90
const CURSOR_RADIUS = 130
const CURSOR_PUSH = 0.28

/** Icosahedron vertices, from the golden ratio. Unit-ish scale; the draw step sizes them. */
const PHI = (1 + Math.sqrt(5)) / 2
const VERTS: Array<[number, number, number]> = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
  [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
  [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
]

/** Edges: every vertex pair at the icosahedron's edge length (2), within a tolerance. */
const EDGES: Array<[number, number]> = (() => {
  const out: Array<[number, number]> = []
  for (let i = 0; i < VERTS.length; i++) {
    for (let j = i + 1; j < VERTS.length; j++) {
      const [ax, ay, az] = VERTS[i]
      const [bx, by, bz] = VERTS[j]
      const d = Math.hypot(ax - bx, ay - by, az - bz)
      if (Math.abs(d - 2) < 0.001) out.push([i, j])
    }
  }
  return out
})()

type Mote = { x: number; y: number; vx: number; vy: number; r: number; a: number }

export function HeroCanvas() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    let motes: Mote[] = []
    let w = 0
    let h = 0
    let raf = 0
    let running = false
    let t = 0
    const cursor = { x: -9999, y: -9999, nx: 0, ny: 0 }

    function seed() {
      const rect = canvas!.getBoundingClientRect()
      w = rect.width
      h = rect.height
      canvas!.width = Math.round(w * dpr)
      canvas!.height = Math.round(h * dpr)
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)

      const count = Math.min(MAX_MOTES, Math.round((w * h) / AREA_PER_MOTE))
      motes = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.14,
        vy: -0.05 - Math.random() * 0.12,
        r: 0.6 + Math.random() * 1.5,
        a: 0.14 + Math.random() * 0.4,
      }))
    }

    /** Rotate a point on Y then X, then project with a perspective divide. */
    function project(v: [number, number, number], ry: number, rx: number, scale: number) {
      const [x0, y0, z0] = v
      const cy = Math.cos(ry)
      const sy = Math.sin(ry)
      const x = x0 * cy + z0 * sy
      let z = -x0 * sy + z0 * cy
      const cx = Math.cos(rx)
      const sx = Math.sin(rx)
      const y = y0 * cx - z * sx
      z = y0 * sx + z * cx

      const depth = 6
      const k = depth / (depth + z)
      return { x: x * scale * k, y: y * scale * k, k }
    }

    function drawForm() {
      // Centre of the hero, sized off the smaller dimension so it never crowds the text.
      const cxp = w / 2
      const cyp = h / 2
      const scale = Math.min(w, h) * 0.13

      // Cursor tilts the form rather than spinning it: a small parallax, not a toy.
      const ry = t * 0.00022 + cursor.nx * 0.35
      const rx = Math.sin(t * 0.00013) * 0.35 + cursor.ny * 0.25

      const pts = VERTS.map((v) => project(v, ry, rx, scale))

      ctx!.lineWidth = 1
      for (const [i, j] of EDGES) {
        const a = pts[i]
        const b = pts[j]
        // Nearer edges are brighter, which is what sells the depth without shading faces.
        const near = (a.k + b.k) / 2
        const alpha = Math.max(0, Math.min(1, (near - 0.72) * 1.6)) * 0.5
        if (alpha <= 0.01) continue
        ctx!.strokeStyle = `rgba(206, 160, 126, ${alpha})`
        ctx!.beginPath()
        ctx!.moveTo(cxp + a.x, cyp + a.y)
        ctx!.lineTo(cxp + b.x, cyp + b.y)
        ctx!.stroke()
      }

      for (const p of pts) {
        const alpha = Math.max(0, Math.min(1, (p.k - 0.72) * 1.6)) * 0.75
        if (alpha <= 0.01) continue
        ctx!.fillStyle = `rgba(237, 217, 163, ${alpha})`
        ctx!.beginPath()
        ctx!.arc(cxp + p.x, cyp + p.y, 1.6, 0, Math.PI * 2)
        ctx!.fill()
      }
    }

    function drawDust() {
      for (const m of motes) {
        ctx!.beginPath()
        ctx!.arc(m.x, m.y, m.r, 0, Math.PI * 2)
        ctx!.fillStyle = `rgba(226, 232, 192, ${m.a})`
        ctx!.fill()
      }
    }

    function draw() {
      ctx!.clearRect(0, 0, w, h)
      drawForm()
      drawDust()
    }

    function step(now: number) {
      t = now
      for (const m of motes) {
        m.x += m.vx
        m.y += m.vy

        const dx = m.x - cursor.x
        const dy = m.y - cursor.y
        const d2 = dx * dx + dy * dy
        if (d2 < CURSOR_RADIUS * CURSOR_RADIUS && d2 > 0.01) {
          const d = Math.sqrt(d2)
          const force = (1 - d / CURSOR_RADIUS) * CURSOR_PUSH
          m.x += (dx / d) * force
          m.y += (dy / d) * force
        }

        if (m.y < -4) m.y = h + 4
        if (m.y > h + 4) m.y = -4
        if (m.x < -4) m.x = w + 4
        if (m.x > w + 4) m.x = -4
      }
      draw()
      raf = requestAnimationFrame(step)
    }

    function start() {
      if (running || reduced) return
      running = true
      raf = requestAnimationFrame(step)
    }

    function stop() {
      running = false
      cancelAnimationFrame(raf)
    }

    seed()
    draw()

    const onResize = () => {
      seed()
      draw()
    }
    const onMove = (e: PointerEvent) => {
      const rect = canvas!.getBoundingClientRect()
      cursor.x = e.clientX - rect.left
      cursor.y = e.clientY - rect.top
      cursor.nx = (cursor.x / rect.width - 0.5) * 2
      cursor.ny = (cursor.y / rect.height - 0.5) * 2
    }
    const onLeave = () => {
      cursor.x = -9999
      cursor.y = -9999
      cursor.nx = 0
      cursor.ny = 0
    }
    const onVisibility = () => (document.hidden ? stop() : start())

    const io = new IntersectionObserver(
      ([entry]) => (entry.isIntersecting && !document.hidden ? start() : stop()),
      { threshold: 0 },
    )
    io.observe(canvas)

    window.addEventListener("resize", onResize)
    window.addEventListener("pointermove", onMove, { passive: true })
    window.addEventListener("pointerleave", onLeave)
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      stop()
      io.disconnect()
      window.removeEventListener("resize", onResize)
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerleave", onLeave)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [])

  return (
    <canvas
      ref={ref}
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
    />
  )
}
