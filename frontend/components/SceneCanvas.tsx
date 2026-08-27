"use client"

import { useEffect, useRef } from "react"

/**
 * One fixed canvas behind the whole landing: a wireframe form that morphs as you scroll, over a
 * field of dust that belongs to the hero.
 *
 * The reference does this with a full-screen three.js "rig" whose geometry is chosen by the
 * section in view (`data-geometry="star"` on its hero, `"diamond"` on the next). Same idea here,
 * hand-rolled in canvas 2D: sections declare `data-geometry`, an IntersectionObserver picks the
 * most visible one, and the vertices ease toward that target.
 *
 * Every form has TWELVE vertices, derived from the same icosahedron. That is what makes morphing
 * trivial: interpolate vertex i to vertex i, no topology to reconcile, and the edge list never
 * changes.
 *
 * PAINT ORDER, which is the fiddly part. The canvas is `position: fixed` at `z-index: 2`. An
 * unpositioned section paints its background in the block layer, below positioned elements, so
 * the canvas sits above the plum and peach bands. Section CONTENT is lifted to `z-index: 3` by
 * `.band-inner` so it stays above the canvas. Give a band `position: relative` and it will hide
 * the scene — that is the one edit that breaks this.
 *
 * Atmosphere, not information, so the usual box: reduced-motion draws one static frame and never
 * loops, the loop stops when nothing is in view and when the tab is hidden, counts scale with
 * viewport area, `pointer-events: none` and `aria-hidden`.
 */

const AREA_PER_MOTE = 14_000
const MAX_MOTES = 90
const CURSOR_RADIUS = 130
const CURSOR_PUSH = 0.28
/** Per-frame fraction of the remaining distance to the target shape. Slow on purpose. */
const MORPH_EASE = 0.022

type V3 = [number, number, number]

const PHI = (1 + Math.sqrt(5)) / 2
const ICO: V3[] = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
  [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
  [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
]

/** Edges of the icosahedron: vertex pairs at the edge length 2. Fixed for every form. */
const EDGES: Array<[number, number]> = (() => {
  const out: Array<[number, number]> = []
  for (let i = 0; i < ICO.length; i++) {
    for (let j = i + 1; j < ICO.length; j++) {
      const d = Math.hypot(ICO[i][0] - ICO[j][0], ICO[i][1] - ICO[j][1], ICO[i][2] - ICO[j][2])
      if (Math.abs(d - 2) < 0.001) out.push([i, j])
    }
  }
  return out
})()

/**
 * The forms, all twelve vertices, all transformations of the same solid.
 *
 * Building them this way rather than authoring separate meshes is what guarantees a clean morph:
 * vertex i always means the same corner.
 */
const GEOMETRIES: Record<string, V3[]> = {
  ico: ICO,
  /** Alternating vertices pushed out: spiky. */
  star: ICO.map(([x, y, z], i) => {
    const k = i % 2 === 0 ? 1.55 : 0.62
    return [x * k, y * k, z * k] as V3
  }),
  /** Stretched on Y, pinched on X and Z: a bipyramid read. */
  diamond: ICO.map(([x, y, z]) => [x * 0.52, y * 1.72, z * 0.52] as V3),
  /** Flattened on Y, spread outward: a ring seen almost edge-on. */
  ring: ICO.map(([x, y, z]) => [x * 1.34, y * 0.22, z * 1.34] as V3),
}

const DEFAULT_GEOMETRY = "ico"

/*
 * The stroke has to change with the surface under it.
 *
 * One fixed canvas crosses opposite backgrounds, and a single colour cannot serve both: Light
 * Bronze reads 4.79:1 on the plum bands but 2.11:1 on the light page, and deep bronze is the
 * mirror image (2.01:1 on plum, 5.03:1 on light). So sections declare a tone and the stroke eases
 * between the two along with the geometry.
 */
const TONE_STROKE: Record<string, [number, number, number]> = {
  chrome: [206, 160, 126],
  light: [143, 92, 47],
}
const DEFAULT_TONE = "light"

type Mote = { x: number; y: number; vx: number; vy: number; r: number; a: number }

export function SceneCanvas() {
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
    /** Live vertices, eased toward `target` every frame. */
    const current: V3[] = GEOMETRIES[DEFAULT_GEOMETRY].map((v) => [...v] as V3)
    let target: V3[] = current.map((v) => [...v] as V3)
    /** 1 while the hero fills the viewport, 0 once it has left: fades the dust out with it. */
    let heroVisible = 1
    const stroke: [number, number, number] = [...TONE_STROKE[DEFAULT_TONE]] as [number, number, number]
    let strokeTarget: [number, number, number] = [...stroke] as [number, number, number]
    const cursor = { x: -9999, y: -9999, nx: 0, ny: 0 }

    const hero = document.querySelector<HTMLElement>("[data-geometry-hero]")

    function seed() {
      w = window.innerWidth
      h = window.innerHeight
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

    function project(v: V3, ry: number, rx: number, scale: number) {
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
      const cxp = w / 2
      const cyp = h / 2
      const scale = Math.min(w, h) * 0.13
      const ry = t * 0.00022 + cursor.nx * 0.35
      const rx = Math.sin(t * 0.00013) * 0.35 + cursor.ny * 0.25
      const pts = current.map((v) => project(v, ry, rx, scale))

      ctx!.lineWidth = 1
      for (const [i, j] of EDGES) {
        const a = pts[i]
        const b = pts[j]
        const near = (a.k + b.k) / 2
        const alpha = Math.max(0, Math.min(1, (near - 0.72) * 1.6)) * 0.42
        if (alpha <= 0.01) continue
        ctx!.strokeStyle = `rgba(${Math.round(stroke[0])}, ${Math.round(stroke[1])}, ${Math.round(stroke[2])}, ${alpha})`
        ctx!.beginPath()
        ctx!.moveTo(cxp + a.x, cyp + a.y)
        ctx!.lineTo(cxp + b.x, cyp + b.y)
        ctx!.stroke()
      }

      for (const p of pts) {
        const alpha = Math.max(0, Math.min(1, (p.k - 0.72) * 1.6)) * 0.5
        if (alpha <= 0.01) continue
        ctx!.fillStyle = `rgba(${Math.round(stroke[0])}, ${Math.round(stroke[1])}, ${Math.round(stroke[2])}, ${alpha})`
        ctx!.beginPath()
        ctx!.arc(cxp + p.x, cyp + p.y, 1.6, 0, Math.PI * 2)
        ctx!.fill()
      }
    }

    function drawDust() {
      if (heroVisible <= 0.01) return
      for (const m of motes) {
        ctx!.beginPath()
        ctx!.arc(m.x, m.y, m.r, 0, Math.PI * 2)
        ctx!.fillStyle = `rgba(226, 232, 192, ${m.a * heroVisible})`
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

      for (let i = 0; i < current.length; i++) {
        for (let k = 0; k < 3; k++) {
          current[i][k] += (target[i][k] - current[i][k]) * MORPH_EASE
        }
      }
      for (let k = 0; k < 3; k++) {
        stroke[k] += (strokeTarget[k] - stroke[k]) * MORPH_EASE
      }

      if (hero) {
        const r = hero.getBoundingClientRect()
        heroVisible = Math.max(0, Math.min(1, (r.bottom - 0) / Math.max(1, r.height)))
      }

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

    /*
     * Which section owns the scene: the one with the largest visible area. Comparing ratios alone
     * lets a short section that happens to be fully visible outvote the tall one filling the
     * screen, which makes the form flicker between shapes on a slow scroll.
     */
    const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-geometry]"))
    const visible = new Map<HTMLElement, number>()

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const el = e.target as HTMLElement
          visible.set(el, e.isIntersecting ? e.intersectionRect.height : 0)
        }
        let best: HTMLElement | null = null
        let bestArea = 0
        for (const [el, area] of visible) {
          if (area > bestArea) {
            bestArea = area
            best = el
          }
        }
        const name = best?.dataset.geometry ?? DEFAULT_GEOMETRY
        const next = GEOMETRIES[name] ?? GEOMETRIES[DEFAULT_GEOMETRY]
        target = next.map((v) => [...v] as V3)

        const tone = best?.dataset.geometryTone ?? DEFAULT_TONE
        strokeTarget = [...(TONE_STROKE[tone] ?? TONE_STROKE[DEFAULT_TONE])] as [number, number, number]

        if (bestArea > 0 && !document.hidden) start()
        else stop()
      },
      { threshold: [0, 0.15, 0.3, 0.5, 0.75, 1] },
    )
    sections.forEach((s) => io.observe(s))

    const onResize = () => {
      seed()
      draw()
    }
    const onMove = (e: PointerEvent) => {
      cursor.x = e.clientX
      cursor.y = e.clientY
      cursor.nx = (e.clientX / window.innerWidth - 0.5) * 2
      cursor.ny = (e.clientY / window.innerHeight - 0.5) * 2
    }
    const onLeave = () => {
      cursor.x = -9999
      cursor.y = -9999
      cursor.nx = 0
      cursor.ny = 0
    }
    const onVisibility = () => (document.hidden ? stop() : start())

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
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: 2,
        pointerEvents: "none",
      }}
    />
  )
}
