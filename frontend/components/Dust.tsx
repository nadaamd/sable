"use client"

import { useEffect, useRef } from "react"

/**
 * A drifting dust field behind the hero, and the only decoration on the site.
 *
 * The reference achieves its ambience with two radial gradients whose background-position drifts
 * over 20s. Those are rules 24 and 25 of the slop catalogue, so this does the same job with
 * particles instead: motes that drift, and part around the cursor.
 *
 * It is atmosphere, not information, which is the opposite of the discipline the rest of the site
 * follows. So it is boxed in tightly:
 *
 *  - The only client component the landing loads. The page stays a Server Component; just this
 *    canvas ships JavaScript.
 *  - `prefers-reduced-motion` draws one static frame and never starts the loop.
 *  - The loop stops when the hero scrolls out of view and when the tab is hidden, so it costs
 *    nothing while someone reads the rest of the page.
 *  - Particle count scales with viewport area and is capped, so a large monitor does not turn
 *    into a space heater.
 *  - `pointer-events: none` and `aria-hidden`: it can never intercept a click or reach a screen
 *    reader.
 */

/** One mote per this many device-independent pixels of viewport, capped. */
const AREA_PER_MOTE = 14_000
const MAX_MOTES = 90
/** Cursor influence radius, and how hard motes are pushed out of it. */
const CURSOR_RADIUS = 130
const CURSOR_PUSH = 0.28

type Mote = { x: number; y: number; vx: number; vy: number; r: number; a: number }

export function Dust() {
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
    const cursor = { x: -9999, y: -9999 }

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
        // Slow, and biased upward, so it reads as settling dust rather than snow.
        vx: (Math.random() - 0.5) * 0.14,
        vy: -0.05 - Math.random() * 0.12,
        r: 0.6 + Math.random() * 1.5,
        a: 0.14 + Math.random() * 0.4,
      }))
    }

    function draw() {
      ctx!.clearRect(0, 0, w, h)
      for (const m of motes) {
        ctx!.beginPath()
        ctx!.arc(m.x, m.y, m.r, 0, Math.PI * 2)
        // Cream, the palette's light. Alpha carries the depth rather than a second colour.
        ctx!.fillStyle = `rgba(226, 232, 192, ${m.a})`
        ctx!.fill()
      }
    }

    function step() {
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

        // Wrap rather than respawn, so the field never thins out.
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
    }
    const onLeave = () => {
      cursor.x = -9999
      cursor.y = -9999
    }
    const onVisibility = () => (document.hidden ? stop() : start())

    // Only run while the hero is actually on screen.
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
