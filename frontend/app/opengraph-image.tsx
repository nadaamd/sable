import { ImageResponse } from "next/og"

/**
 * The link preview.
 *
 * The submission is a post on X, so this image is what most people will actually see of the
 * project — a link with no card renders as a bare URL and reads as dead. It has to carry the
 * whole idea in one frame: a book that is visibly present and visibly unreadable, next to a
 * price that is public anyway.
 *
 * Sealed cells are drawn as solid rectangles rather than the █ glyph the app uses. Satori
 * falls back to a default sans font here, and U+2588 is not guaranteed to be in it — a
 * missing-glyph box would undo the whole point of the image.
 */
export const alt = "Sable — a sealed-bid auction whose matching engine runs on encrypted orders"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

const BG = "#0b080b"
const PANEL = "#241d24"
const LINE = "#443742"
const SEAL = "#846c5b"
const INK = "#e2e8c0"
const DIM = "#cea07e"
const ACCENT = "#edd9a3"
const BUY = "#a9c177"

/** A sealed field: present, addressable, unreadable. */
function Sealed({ w }: { w: number }) {
  return <div style={{ display: "flex", width: w, height: 13, background: SEAL, borderRadius: 2 }} />
}

function Row({ desk, revealed }: { desk: string; revealed?: [string, string, string] }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 20,
        padding: "9px 20px",
        borderTop: `1px solid ${LINE}`,
        background: revealed ? "#302732" : "transparent",
      }}
    >
      <div style={{ display: "flex", width: 96, color: revealed ? ACCENT : DIM, fontSize: 19 }}>{desk}</div>
      {revealed ? (
        <>
          <div style={{ display: "flex", width: 74, color: BUY, fontSize: 19 }}>{revealed[0]}</div>
          <div style={{ display: "flex", width: 62, color: INK, fontSize: 19 }}>{revealed[1]}</div>
          <div style={{ display: "flex", color: INK, fontSize: 19 }}>{revealed[2]}</div>
        </>
      ) : (
        <>
          <div style={{ display: "flex", width: 74 }}>
            <Sealed w={46} />
          </div>
          <div style={{ display: "flex", width: 62 }}>
            <Sealed w={40} />
          </div>
          <Sealed w={54} />
        </>
      )}
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", fontSize: 17, letterSpacing: 2, color: DIM }}>{label}</div>
      <div style={{ display: "flex", fontSize: 76, color, lineHeight: 1 }}>{value}</div>
    </div>
  )
}

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: BG,
          padding: 64,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", fontSize: 74, letterSpacing: 11, color: INK, lineHeight: 1 }}>
              SABLE
            </div>
            <div style={{ display: "flex", fontSize: 26, color: ACCENT }}>the confidential cross</div>
            <div style={{ display: "flex", fontSize: 21, color: DIM, lineHeight: 1.3 }}>
              A uniform-price auction that matches encrypted orders.
            </div>
          </div>

          <div style={{ display: "flex", gap: 52 }}>
            <Stat label="PRICE" value="101" color={ACCENT} />
            <Stat label="VOLUME" value="65" color={INK} />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", background: PANEL, border: `1px solid ${LINE}` }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "12px 20px",
              fontSize: 16,
              letterSpacing: 2,
              color: DIM,
            }}
          >
            <div style={{ display: "flex" }}>ORDER BOOK — BATCH 0</div>
            <div style={{ display: "flex" }}>1 OF 6 READABLE WITH ONE DESK KEY</div>
          </div>
          {/* The real batch 0, row for row: Atlas x2, Borealis x1, Cygnus x3. */}
          <Row desk="Atlas" revealed={["BUY", "103", "37"]} />
          <Row desk="Atlas" />
          <Row desk="Borealis" />
          <Row desk="Cygnus" />
          <Row desk="Cygnus" />
          <Row desk="Cygnus" />
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 20 }}>
          <div style={{ display: "flex", color: DIM }}>
            The price is public. Every order stays sealed — including from us.
          </div>
          <div style={{ display: "flex", color: DIM }}>garbled circuits on COTI gcEVM</div>
        </div>
      </div>
    ),
    size,
  )
}
