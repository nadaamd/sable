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

/*
 * Density. The reference's cloud reads as a solid shape, which needs far more particles than the
 * first pass used (1,100). Affording 4,200 meant fixing the draw loop first: see ALPHA_BUCKETS.
 */
const AREA_PER_PARTICLE = 520
const MAX_PARTICLES = 4_200
/*
 * Particles are drawn in alpha buckets, not one by one.
 *
 * Assigning `fillStyle` per particle means building and parsing one rgba() string per particle per
 * frame, and that — not the geometry — was the ceiling. Quantising alpha into buckets collapses
 * 4,200 style assignments into 14, with one path and one fill each, so density costs arithmetic
 * instead of string work.
 */
const ALPHA_BUCKETS = 14
/*
 * The brightest a particle ever gets: bright (max 1) x 0.85. Buckets are scaled to THIS, not to 1.
 * Spreading 14 buckets over 0..1 when nothing exceeds 0.6 wastes five of them and drops the
 * effective resolution to nine, which shows as banding in the twinkle.
 */
const MAX_ALPHA = 0.85
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

/**
 * A UV sphere, as triangles, for the particle sampler to scatter over.
 *
 * Sampling a sphere's SURFACE is what makes it read as a globe rather than as a disc: the
 * projection of a uniformly-sampled sphere is denser at the limb, because near the silhouette the
 * surface runs edge-on to the view and more of it falls into the same pixels. The rim draws
 * itself; nothing here fakes it.
 */
function sphere(rings: number, segs: number, r: number): Tri[] {
  const at = (i: number, j: number): V3 => {
    const phi = (i / rings) * Math.PI
    const th = (j / segs) * Math.PI * 2
    return [r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th)]
  }
  const tris: Tri[] = []
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = at(i, j)
      const b = at(i + 1, j)
      const c = at(i + 1, j + 1)
      const d = at(i, j + 1)
      tris.push([a, b, c], [a, c, d])
    }
  }
  return tris
}

/** The globe's radius in model units, which the arcs and nodes share. */
const GLOBE_R = 1.24

const SHAPES: Record<string, Tri[]> = {
  /** The hero form: a planet of dust, with a network drawn over it. See the GLOBE section. */
  globe: sphere(22, 34, GLOBE_R),
  /** A four-point rhombus, taller than wide. */
  diamond: extrude([[0, 1.62], [0.62, 0], [0, -1.62], [-0.62, 0]], 0.3),
  /** A twelve-sided plate: reads as a ring seen near edge-on. */
  ring: extrude(starOutline(12, 1.32, 1.1), 0.16),
  /** Six spikes, softer than the hero star. */
  bloom: extrude(starOutline(6, 1.4, 0.76), 0.28),
}

const DEFAULT_SHAPE = "globe"

/*
 * ------------------------------------------------------------------ globe ---
 *
 * A triangulated net over the planet, a thinner shell around it, and traffic walking the net.
 *
 * This is a SECOND LAYER, not more particles. The cloud is sampled from a triangle list and
 * morphs between shapes on scroll, which is the wrong machinery for a fixed graph — the mesh has
 * to hold its shape while the cloud behind it turns. So the graph is its own geometry, drawn in
 * the same rotation frame and faded in and out with `globeMix`.
 *
 * The net is an ICOSPHERE: an icosahedron subdivided and pushed out to the sphere. That
 * construction is what gives the even triangular weave — every vertex has five or six neighbours
 * and every edge is close to the same length, at every point on the sphere. A latitude/longitude
 * grid cannot do this; its cells shrink to nothing at the poles and the weave visibly crowds
 * there.
 */
const GLOBE_SUB = 3
const SHELL_SUB = 3
/** The shell's radius, as a multiple of the globe's. */
const SHELL_R = 1.2

type Mesh = { verts: V3[]; edges: Array<[number, number]>; adj: number[][] }

function icosphere(sub: number): Mesh {
  const t = (1 + Math.sqrt(5)) / 2
  let verts: V3[] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ]
  let faces: Array<[number, number, number]> = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ]

  for (let s = 0; s < sub; s++) {
    // Midpoints are cached by edge key, or the shared edges tear into duplicate vertices.
    const mid = new Map<string, number>()
    const midpoint = (a: number, b: number) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`
      const hit = mid.get(key)
      if (hit !== undefined) return hit
      const va = verts[a]
      const vb = verts[b]
      verts.push([(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2])
      const idx = verts.length - 1
      mid.set(key, idx)
      return idx
    }
    const next: typeof faces = []
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b)
      const bc = midpoint(b, c)
      const ca = midpoint(c, a)
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca])
    }
    faces = next
  }

  verts = verts.map(([x, y, z]) => {
    const m = Math.hypot(x, y, z) || 1
    return [x / m, y / m, z / m] as V3
  })

  const seen = new Set<string>()
  const edges: Array<[number, number]> = []
  const adj: number[][] = verts.map(() => [])
  for (const f of faces) {
    for (let k = 0; k < 3; k++) {
      const a = f[k]
      const b = f[(k + 1) % 3]
      const key = a < b ? `${a}_${b}` : `${b}_${a}`
      if (seen.has(key)) continue
      seen.add(key)
      const e = edges.length
      edges.push([a, b])
      adj[a].push(e)
      adj[b].push(e)
    }
  }
  return { verts, edges, adj }
}

const NET = icosphere(GLOBE_SUB)
const SHELL = icosphere(SHELL_SUB)

/*
 * Traffic, as a random walk over the net rather than a loop on a fixed path.
 *
 * A dot that shuttles back and forth on one edge reads as an animation; a dot that arrives at a
 * junction and leaves by a different edge reads as something being routed. At each vertex a
 * walker picks any incident edge except the one it came in on, so it never doubles back and it
 * never repeats a route.
 */
type Walker = { edge: number; from: number; u: number; speed: number }
const WALKERS = 54
/** Head plus three trailing samples, spaced along the edge behind it. */
const FLOW_TAIL = 4
const FLOW_GAP = 0.09

/** Alpha buckets for the network, for the same reason the particles have them. */
const LINE_BUCKETS = 6
const NET_MAX_ALPHA = 0.3
const DOT_BUCKETS = 6
const DOT_MAX_ALPHA = 0.95

/*
 * The particle colour has to change with the surface under it. One fixed canvas crosses opposite
 * backgrounds and a single colour cannot serve both: Cream reads 8.84:1 on the plum bands but
 * disappears on the light page, where deep bronze is the one that carries.
 */
const TONE_RGB: Record<string, [number, number, number]> = {
  /** Cream, on the Mauve Shadow bands. */
  chrome: [226, 232, 192],
  /** Light Bronze, on the navy page: warm dust rather than white stars. */
  dark: [206, 160, 126],
  /** Deep bronze, on the one Soft Peach band — the only light surface the canvas crosses. */
  light: [143, 92, 47],
}
const DEFAULT_TONE = "dark"

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
  // Binary search: a linear scan here is O(particles x triangles) on every reseed and morph,
  // which at 4,200 particles and up to 96 triangles is a visible hitch.
  let lo = 0
  let hi = cum.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cum[mid] >= want) hi = mid
    else lo = mid + 1
  }
  const idx = lo
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
    /** Reused across frames: flat [x, y, size] triples per alpha bucket, no per-frame allocation. */
    const buckets: number[][] = Array.from({ length: ALPHA_BUCKETS }, () => [])
    /** The network's own buckets: [x1, y1, x2, y2] per segment, [x, y, r] per dot. */
    const lineBuckets: number[][] = Array.from({ length: LINE_BUCKETS }, () => [])
    const dotBuckets: number[][] = Array.from({ length: DOT_BUCKETS }, () => [])
    /*
     * How present the network is. The cloud morphs to the next shape on scroll; the graph has no
     * next shape, so it fades instead of deforming — a set of fixed cities cannot meaningfully
     * become a diamond.
     */
    let globeMix = shape === "globe" ? 1 : 0
    /* Vertices are projected ONCE per frame; edges and walkers read back from these. Projecting
       per edge instead would cost 960 rotations a frame for 162 distinct points. */
    const netProj = new Float32Array(NET.verts.length * 3)
    const shellProj = new Float32Array(SHELL.verts.length * 3)
    const walkers: Walker[] = Array.from({ length: WALKERS }, () => {
      const edge = (Math.random() * NET.edges.length) | 0
      return {
        edge,
        from: NET.edges[edge][(Math.random() * 2) | 0],
        u: Math.random(),
        speed: 0.00035 + Math.random() * 0.0005,
      }
    })
    let last = 0

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
          size: 0.7 + Math.random() * 1.2,
          bright: 0.5 + Math.random() * 0.5,
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

      /*
       * The bloom the globe sits in, painted first so everything else lands on top of it.
       *
       * The reference's globe is lit from inside; a flat net on a flat ground is a diagram. One
       * radial gradient does the whole job, and it has to be scaled by globeMix or the halo would
       * still be sitting there over the peach band four sections down.
       */
      if (globeMix > 0.012) {
        const gr = Math.max(1, scale * GLOBE_R * 1.9)
        const glow = ctx!.createRadialGradient(cxp, cyp, scale * GLOBE_R * 0.1, cxp, cyp, gr)
        const gc = `${rgb[0] | 0}, ${rgb[1] | 0}, ${rgb[2] | 0}`
        glow.addColorStop(0, `rgba(${gc}, ${(0.07 * globeMix).toFixed(3)})`)
        glow.addColorStop(0.5, `rgba(${gc}, ${(0.035 * globeMix).toFixed(3)})`)
        glow.addColorStop(1, `rgba(${gc}, 0)`)
        ctx!.fillStyle = glow
        ctx!.beginPath()
        ctx!.arc(cxp, cyp, gr, 0, Math.PI * 2)
        ctx!.fill()
      }

      for (const b of buckets) b.length = 0

      for (const p of parts) {
        const xr = p.x * cy + p.z * sy
        let zr = -p.x * sy + p.z * cy
        const yr = p.y * cx - zr * sx
        zr = p.y * sx + zr * cx

        const k = 6 / (6 + zr)
        // Twinkle. The reference clamps its size scale to 0.72..1.22; this stays in that band.
        const tw = 0.97 + Math.sin(t * 0.0016 + p.phase) * 0.25
        // Depth fade compressed to 0.55..1: the old floor left the far side barely there.
        const alpha = (0.55 + Math.max(0, Math.min(1, (k - 0.8) * 2.4)) * 0.45) * p.bright * MAX_ALPHA
        if (alpha <= 0.012) continue

        const bucket = Math.min(ALPHA_BUCKETS - 1, ((alpha / MAX_ALPHA) * ALPHA_BUCKETS) | 0)
        const arr = buckets[bucket]
        arr.push(cxp + xr * scale * k + p.ox, cyp + yr * scale * k + p.oy, Math.max(0.5, p.size * k * tw))
      }

      const r = rgb[0] | 0
      const g = rgb[1] | 0
      const b2 = rgb[2] | 0
      for (let i = 0; i < ALPHA_BUCKETS; i++) {
        const arr = buckets[i]
        if (arr.length === 0) continue
        // One style assignment and one fill for the whole bucket.
        ctx!.fillStyle = `rgba(${r}, ${g}, ${b2}, ${(((i + 0.5) / ALPHA_BUCKETS) * MAX_ALPHA).toFixed(3)})`
        ctx!.beginPath()
        for (let j = 0; j < arr.length; j += 3) {
          ctx!.rect(arr[j], arr[j + 1], arr[j + 2], arr[j + 2])
        }
        ctx!.fill()
      }

      // ------------------------------------------------------------ the network --
      if (globeMix <= 0.012) return

      for (const bk of lineBuckets) bk.length = 0
      for (const bk of dotBuckets) bk.length = 0

      /** Rotate a model point into view and project it. Writes into `pt`, allocating nothing. */
      const pt = { x: 0, y: 0, k: 0 }
      const project = (x: number, y: number, z: number) => {
        const xr = x * cy + z * sy
        let zr = -x * sy + z * cy
        const yr = y * cx - zr * sx
        zr = y * sx + zr * cx
        const k = 6 / (6 + zr)
        pt.x = cxp + xr * scale * k
        pt.y = cyp + yr * scale * k
        pt.k = k
      }

      const projectInto = (verts: V3[], out: Float32Array, radius: number) => {
        for (let i = 0; i < verts.length; i++) {
          const v = verts[i]
          project(v[0] * radius, v[1] * radius, v[2] * radius)
          out[i * 3] = pt.x
          out[i * 3 + 1] = pt.y
          out[i * 3 + 2] = pt.k
        }
      }
      projectInto(NET.verts, netProj, GLOBE_R)
      projectInto(SHELL.verts, shellProj, GLOBE_R * SHELL_R)

      /*
       * Edges, with alpha per EDGE from its depth.
       *
       * Culling the far half would leave a net that stops dead at the silhouette; drawing it flat
       * would stop the sphere reading as a sphere. Depth per edge is what makes the back legible
       * AS the back — the weave you see through the planet is most of what says it is round.
       */
      const strand = (
        mesh: Mesh,
        proj: Float32Array,
        base: number,
        gain: number,
        vertBase: number,
        vertGain: number,
        vertSize: number,
        withEdges = true,
      ) => {
        for (const [a, b] of withEdges ? mesh.edges : []) {
          const d = Math.max(0, Math.min(1, ((proj[a * 3 + 2] + proj[b * 3 + 2]) * 0.5 - 0.84) * 3.2))
          const al = (base + d * gain) * globeMix
          if (al <= 0.012) continue
          const bi = Math.min(LINE_BUCKETS - 1, ((al / NET_MAX_ALPHA) * LINE_BUCKETS) | 0)
          lineBuckets[bi].push(proj[a * 3], proj[a * 3 + 1], proj[b * 3], proj[b * 3 + 1])
        }
        for (let i = 0; i < mesh.verts.length; i++) {
          const k = proj[i * 3 + 2]
          const d = Math.max(0, Math.min(1, (k - 0.84) * 3.2))
          const al = (vertBase + d * vertGain) * globeMix
          if (al <= 0.02) continue
          const bi = Math.min(DOT_BUCKETS - 1, ((al / DOT_MAX_ALPHA) * DOT_BUCKETS) | 0)
          dotBuckets[bi].push(proj[i * 3], proj[i * 3 + 1], (vertSize + d * vertSize) * k)
        }
      }

      /*
       * The shell is DOTS ONLY, and that is the correction that made it work.
       *
       * Drawn with its edges it read as a second, faceted cage around the planet — long straight
       * chords hanging in space, which is a polyhedron, not an atmosphere. Stripped to its
       * vertices at a third of the net's brightness it becomes what it is meant to be: a fine
       * scatter standing off the surface.
       */
      strand(SHELL, shellProj, 0, 0, 0.04, 0.2, 0.45, false)
      strand(NET, netProj, 0.028, 0.24, 0.1, 0.6, 0.7)

      /*
       * What is in transit. Interpolated in SCREEN space along the already-projected edge, which
       * is exact enough at this edge length and saves re-rotating a point per tail sample.
       */
      for (const wk of walkers) {
        const [ea, eb] = NET.edges[wk.edge]
        const from = wk.from === ea ? ea : eb
        const to = from === ea ? eb : ea
        const fx = netProj[from * 3]
        const fy = netProj[from * 3 + 1]
        const fk = netProj[from * 3 + 2]
        const dx = netProj[to * 3] - fx
        const dy = netProj[to * 3 + 1] - fy
        const dk = netProj[to * 3 + 2] - fk
        for (let n = 0; n < FLOW_TAIL; n++) {
          const u = wk.u - n * FLOW_GAP
          if (u < 0) continue
          const k = fk + dk * u
          const d = Math.max(0, Math.min(1, (k - 0.84) * 3.2))
          const taper = 1 - n / FLOW_TAIL
          const al = (0.1 + d * 0.85) * taper * taper * globeMix
          if (al <= 0.03) continue
          const bi = Math.min(DOT_BUCKETS - 1, ((al / DOT_MAX_ALPHA) * DOT_BUCKETS) | 0)
          dotBuckets[bi].push(fx + dx * u, fy + dy * u, (0.8 + d * 1.4) * taper * k)
        }
      }

      ctx!.lineWidth = 1
      for (let i = 0; i < LINE_BUCKETS; i++) {
        const arr = lineBuckets[i]
        if (arr.length === 0) continue
        const al = ((i + 0.5) / LINE_BUCKETS) * NET_MAX_ALPHA
        ctx!.strokeStyle = `rgba(${r}, ${g}, ${b2}, ${al.toFixed(3)})`
        ctx!.beginPath()
        for (let j = 0; j < arr.length; j += 4) {
          ctx!.moveTo(arr[j], arr[j + 1])
          ctx!.lineTo(arr[j + 2], arr[j + 3])
        }
        ctx!.stroke()
      }

      for (let i = 0; i < DOT_BUCKETS; i++) {
        const arr = dotBuckets[i]
        if (arr.length === 0) continue
        const al = ((i + 0.5) / DOT_BUCKETS) * DOT_MAX_ALPHA
        ctx!.fillStyle = `rgba(${r}, ${g}, ${b2}, ${al.toFixed(3)})`
        ctx!.beginPath()
        for (let j = 0; j < arr.length; j += 3) {
          // moveTo before each arc, or the sub-paths join up into one scribble.
          ctx!.moveTo(arr[j] + arr[j + 2], arr[j + 1])
          ctx!.arc(arr[j], arr[j + 1], arr[j + 2], 0, Math.PI * 2)
        }
        ctx!.fill()
      }
    }

    function step(now: number) {
      t = now
      for (let i = 0; i < rgb.length; i++) rgb[i] += (rgbTarget[i] - rgb[i]) * MORPH_EASE
      globeMix += ((shape === "globe" ? 1 : 0) - globeMix) * MORPH_EASE * 3

      /*
       * Route the traffic. On arriving at a vertex a walker leaves by any incident edge except
       * the one it came in on, so it never doubles back — which is the whole difference between
       * something being routed and something bouncing.
       */
      const dt = Math.min(64, now - last || 16)
      last = now
      if (globeMix > 0.012) {
        for (const wk of walkers) {
          wk.u += wk.speed * dt
          while (wk.u >= 1) {
            const [ea, eb] = NET.edges[wk.edge]
            const to = wk.from === ea ? eb : ea
            const opts = NET.adj[to]
            let next = opts[(Math.random() * opts.length) | 0]
            for (let guard = 0; next === wk.edge && opts.length > 1 && guard < 5; guard++) {
              next = opts[(Math.random() * opts.length) | 0]
            }
            wk.u -= 1
            wk.edge = next
            wk.from = to
          }
        }
      }

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
