"use client"

import { useEffect, useRef } from "react"

/**
 * One fixed canvas behind the landing: a cloud of particles that holds a shape, twinkles, and
 * morphs as you scroll.
 *
 * This follows the reference's actual approach, which is not what a first look suggested. Its form
 * is not a wireframe — it is a POINT CLOUD sampled over the surface of a mesh, drawn with a points
 * shader. From its bundle:
 *
 *   ig = { star: im, diamond: im, adn: ... }
 *   ix(count, "star") -> { i0, i1, i2, baryU, baryV }   // barycentric samples on triangles
 *   vBrightness = brightness * clamp(sizeScale, 0.72, 1.22)
 *
 * Particles distributed over triangles by barycentric coordinates, each with its own size,
 * brightness and twinkle. An earlier version here drew a twelve-vertex wireframe with dust as a
 * separate layer; the reference has one thing, and the dust IS the shape. This does that.
 *
 * Identity is stable across shapes, which is what makes the morph clean: every particle keeps a
 * fixed (triangle-pick, u, v) tuple and each shape maps that tuple through its own triangle list,
 * so particle i lands in the corresponding region of whatever shape is current.
 *
 * PAINT ORDER. The canvas is `position: fixed; z-index: 2`. An unpositioned section paints its
 * background in the block layer, below positioned elements, so the canvas shows through the plum
 * and peach bands. Content is lifted to `z-index: 3` by `.band-inner`. Giving a band
 * `position: relative` would hide the whole scene — that is the one edit that breaks this.
 *
 * Atmosphere, not information, so the usual box: reduced-motion draws one static frame and never
 * loops, the loop stops when nothing is in view and when the tab is hidden, the count scales with
 * viewport area, `pointer-events: none` and `aria-hidden`.
 */

const AREA_PER_PARTICLE = 1_500
const MAX_PARTICLES = 1_100
const CURSOR_RADIUS = 150
const CURSOR_PUSH = 1.6
const MORPH_EASE = 0.02

type V3 = [number, number, number]
type Tri = [V3, V3, V3]

/** A closed 2D outline, fan-triangulated from the origin and given depth in z. */
function extrude(outline: Array<[number, number]>, depth: number): Tri[] {
  const tris: Tri[] = []
  const zf = depth / 2
  const zb = -depth / 2
  for (let i = 0; i < outline.length; i++) {
    const [ax, ay] = outline[i]
    const [bx, by] = outline[(i + 1) % outline.length]
    tris.push([[0, 0, zf], [ax, ay, zf], [bx, by, zf]])
    tris.push([[0, 0, zb], [ax, ay, zb], [bx, by, zb]])
    tris.push([[ax, ay, zf], [bx, by, zf], [ax, ay, zb]])
    tris.push([[bx, by, zf], [bx, by, zb], [ax, ay, zb]])
  }
  return tris
}

/** A star outline: `spikes` tips at `outer`, valleys at `inner`. */
function starOutline(spikes: number, outer: number, inner: number): Array<[number, number]> {
  const pts: Array<[number, number]> = []
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outer : inner
    const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2
    pts.push([Math.cos(a) * r, Math.sin(a) * r])
  }
  return pts
}

const SHAPES: Record<string, Tri[]> = {
  /** Five spikes: the reference's hero form. */
  star: extrude(starOutline(5, 1.5, 0.6), 0.34),
  /** A four-point rhombus, taller than wide. */
  diamond: extrude([[0, 1.62], [0.62, 0], [0, -1.62], [-0.62, 0]], 0.3),
  /** A twelve-sided plate: reads as a ring seen near edge-on. */
  ring: extrude(starOutline(12, 1.32, 1.1), 0.16),
  /** Six spikes, softer than the hero star. */
  bloom: extrude(starOutline(6, 1.4, 0.76), 0.28),
}

const DEFAULT_SHAPE = "star"

/*
 * The particle colour has to change with the surface under it. One fixed canvas crosses opposite
 * backgrounds and a single colour cannot serve both: Cream reads 8.84:1 on the plum bands but
 * disappears on the light page, where deep bronze is the one that carries.
 */
const TONE_RGB: Record<string, [number, number, number]> = {
  chrome: [226, 232, 192],
  light: [143, 92, 47],
}
const DEFAULT_TONE = "light"

type Particle = {
  pick: number
  u: number
  v: number
  x: number
  y: number
  z: number
  tx: number
  ty: number
  tz: number
  ox: number
  oy: number
  size: number
  bright: number
  phase: number
}

/** Cumulative triangle areas, for area-weighted sampling. */
function areas(tris: Tri[]) {
  const cum: number[] = []
  let total = 0
  for (const [a, b, c] of tris) {
    const ux = b[0] - a[0]
    const uy = b[1] - a[1]
    const uz = b[2] - a[2]
    const vx = c[0] - a[0]
    const vy = c[1] - a[1]
    const vz = c[2] - a[2]
    total += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2
    cum.push(total)
  }
  return { cum, total }
}

const SHAPE_AREAS: Record<string, ReturnType<typeof areas>> = Object.fromEntries(
  Object.entries(SHAPES).map(([k, v]) => [k, areas(v)]),
)

/** Where particle `p` sits on shape `name`, from its stable identity. */
function sample(name: string, p: Particle): V3 {
  const tris = SHAPES[name] ?? SHAPES[DEFAULT_SHAPE]
  const { cum, total } = SHAPE_AREAS[name] ?? SHAPE_AREAS[DEFAULT_SHAPE]
  const want = p.pick * total
  let idx = cum.findIndex((c) => c >= want)
  if (idx < 0) idx = tris.length - 1
  const [a, b, c] = tris[idx]
  let u = p.u
  let v = p.v
  if (u + v > 1) {
    u = 1 - u
    v = 1 - v
  }
  const wgt = 1 - u - v
  return [
    a[0] * wgt + b[0] * u + c[0] * v,
    a[1] * wgt + b[1] * u + c[1] * v,
    a[2] * wgt + b[2] * u + c[2] * v,
  ]
}

export function SceneCanvas() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    let parts: Particle[] = []
    let w = 0
    let h = 0
    let raf = 0
    let running = false
    let t = 0
    let shape = DEFAULT_SHAPE
    const rgb: [number, number, number] = [...TONE_RGB[DEFAULT_TONE]] as [number, number, number]
    let rgbTarget: [number, number, number] = [...rgb] as [number, number, number]
    const cursor = { x: -9999, y: -9999, nx: 0, ny: 0 }

    function retarget() {
      for (const p of parts) {
        const [x, y, z] = sample(shape, p)
        p.tx = x
        p.ty = y
        p.tz = z
      }
    }

    function seed() {
      w = window.innerWidth
      h = window.innerHeight
      canvas!.width = Math.round(w * dpr)
      canvas!.height = Math.round(h * dpr)
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)

      const count = Math.min(MAX_PARTICLES, Math.round((w * h) / AREA_PER_PARTICLE))
      parts = Array.from({ length: count }, () => {
        const p: Particle = {
          pick: Math.random(),
          u: Math.random(),
          v: Math.random(),
          x: 0, y: 0, z: 0,
          tx: 0, ty: 0, tz: 0,
          ox: 0, oy: 0,
          size: 0.7 + Math.random() * 1.15,
          bright: 0.3 + Math.random() * 0.7,
          phase: Math.random() * Math.PI * 2,
        }
        const [x, y, z] = sample(shape, p)
        p.x = p.tx = x
        p.y = p.ty = y
        p.z = p.tz = z
        return p
      })
    }

    function draw() {
      ctx!.clearRect(0, 0, w, h)
      const cxp = w / 2
      const cyp = h / 2
      const scale = Math.min(w, h) * 0.28
      const ry = t * 0.00019 + cursor.nx * 0.4
      const rx = Math.sin(t * 0.00012) * 0.3 + cursor.ny * 0.28
      const cy = Math.cos(ry)
      const sy = Math.sin(ry)
      const cx = Math.cos(rx)
      const sx = Math.sin(rx)

      for (const p of parts) {
        const xr = p.x * cy + p.z * sy
        let zr = -p.x * sy + p.z * cy
        const yr = p.y * cx - zr * sx
        zr = p.y * sx + zr * cx

        const k = 6 / (6 + zr)
        const sxp = cxp + xr * scale * k + p.ox
        const syp = cyp + yr * scale * k + p.oy

        // Twinkle. The reference clamps its size scale to 0.72..1.22; this stays in that band.
        const tw = 0.97 + Math.sin(t * 0.0016 + p.phase) * 0.25
        const size = Math.max(0.5, p.size * k * tw)
        const alpha = Math.max(0, Math.min(1, (k - 0.68) * 1.9)) * p.bright * 0.6
        if (alpha <= 0.012) continue

        ctx!.fillStyle = `rgba(${rgb[0] | 0}, ${rgb[1] | 0}, ${rgb[2] | 0}, ${alpha})`
        ctx!.fillRect(sxp, syp, size, size)
      }
    }

    function step(now: number) {
      t = now
      for (let i = 0; i < rgb.length; i++) rgb[i] += (rgbTarget[i] - rgb[i]) * MORPH_EASE

      const scale = Math.min(w, h) * 0.28
      for (const p of parts) {
        p.x += (p.tx - p.x) * MORPH_EASE
        p.y += (p.ty - p.y) * MORPH_EASE
        p.z += (p.tz - p.z) * MORPH_EASE

        // The cursor pushes the PROJECTED position and the push decays. Displacing the target
        // instead would permanently deform the shape.
        const px = w / 2 + p.x * scale + p.ox
        const py = h / 2 + p.y * scale + p.oy
        const dx = px - cursor.x
        const dy = py - cursor.y
        const d2 = dx * dx + dy * dy
        if (d2 < CURSOR_RADIUS * CURSOR_RADIUS && d2 > 0.01) {
          const d = Math.sqrt(d2)
          const force = (1 - d / CURSOR_RADIUS) * CURSOR_PUSH
          p.ox += (dx / d) * force
          p.oy += (dy / d) * force
        }
        p.ox *= 0.93
        p.oy *= 0.93
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
     * Which section owns the scene: the one with the largest visible AREA. Comparing intersection
     * ratios lets a short fully-visible section outvote the tall one filling the screen, which
     * makes the shape flicker on a slow scroll.
     */
    const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-geometry]"))
    const visible = new Map<HTMLElement, number>()

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          visible.set(e.target as HTMLElement, e.isIntersecting ? e.intersectionRect.height : 0)
        }
        let best: HTMLElement | null = null
        let bestArea = 0
        for (const [el, area] of visible) {
          if (area > bestArea) {
            bestArea = area
            best = el
          }
        }
        const name = best?.dataset.geometry ?? DEFAULT_SHAPE
        if (SHAPES[name] && name !== shape) {
          shape = name
          retarget()
        }
        const tone = best?.dataset.geometryTone ?? DEFAULT_TONE
        rgbTarget = [...(TONE_RGB[tone] ?? TONE_RGB[DEFAULT_TONE])] as [number, number, number]

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
