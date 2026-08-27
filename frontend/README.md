# Sable terminal

A read-only window onto a live Sable market on COTI testnet.

The point of this interface is what it *cannot* show you. It fetches the entire order book
with public `view` calls — no wallet, no signature, no permission — and renders it sealed,
because that is what the chain stores. Unlock one desk's key and that desk's rows resolve
into numbers while every other row stays █.

## Routes

| Route | What it is |
|---|---|
| `/` | Landing. A Server Component with no state and no chain reads, so it ships no JavaScript and has no loading frame. One screen: the claim, the sealed-versus-decrypted legend, and a button. |
| `/terminal` | The live book. Client-rendered, polls every 8s. |

Live data sits behind the button, which is the reason the button exists. Both routes render the
same `Primer` legend, so the notation a visitor learns on the landing is the notation they meet in
the book. `Primer` deliberately carries no `"use client"`: it holds no state and handles no
events, so the landing stays fully static.

`/terminal` is a client component and cannot export `metadata`, so the route has a thin server
`layout.tsx` that holds it.

## Terminal layout

The page follows the market's own order rather than presenting a flat stack of equal-weight
panels, which said nothing about which control acted on which data.

**Header.** A sticky identity bar (mark, wordmark, live block, both contracts, and links out to
the code and the write-up) over the batch readout: the clearing price and matched volume as the
two result figures, with batch phase and order count beside them at the scale of context. Those
first two are the only values this market ever makes public, so they are the page's headline;
they used to sit in a side panel below the fold. The disclosure is stated once beneath the
readout rather than captioned onto each figure.

The bar must stay a **direct child** of `<main>`: `position: sticky` is bounded by the parent's
box, so wrapping it in a spacing div pins it to that div and it scrolls away.

**The sealed book.** The *View as desk* control sits inside this band, directly above the book
it acts on — keys listed but inactive, so the terminal opens on the honest view. Unlocking one
desk flashes exactly the rows that just became readable; that transition *is* the product and
it used to happen invisibly between two frames. Sealed cells vary in width, derived from the
ciphertext (which is public) — a uniform grid read as a loading placeholder. The batch picker
lives in this band's heading, where it belongs.

**Pre-trade negotiation.** The encrypted IOIs between desks. Sender and recipient can each
decrypt; nobody else can. An IOI carries a side and a size and deliberately no price. The payload
is decoded for the reader (`IOI:B:70` renders as *wants to buy 70*) with the raw bytes beside it:
the 24-byte chunk limit is a reason the wire format is terse, not a reason to make a visitor parse
it.

**Market rules.** The public price grid with the clearing tick marked, beside the parameters and
the disclosure summary.

Wide tables scroll inside their own panel; the page never scrolls sideways.

### Text discipline

The page carries about 250 words. It used to carry 400, of which 293 sat in explanatory footers —
one paragraph under every panel, arguing the case. The argument is now made by the primer, which
shows it, so each footer is a single line and several are gone.

Anything longer belongs in [SABLE-EXPLAINED.md](../SABLE-EXPLAINED.md), which the header and the
footer both link to. The division: **the page shows, the explainer tells.** If a sentence here is
doing work a visitor could get from looking, cut it.

## Palette

A neutral paper page, with the palette carried by the chrome. Every given colour appears at full
strength:

| Hex | Name | Role | Contrast |
|---|---|---|---|
| `#443742` | Mauve Shadow | `--chrome` (header bar, panel heads) and `--ink` (body text) | 10.1:1 on page |
| `#E2E8C0` | Cream | `--chrome-ink`, text on chrome | 8.84:1 |
| `#CEA07E` | Light Bronze | `--accent`, accents and fills on chrome | 4.79:1 |
| `#EDD9A3` | Soft Peach | `--panel-hi`, a revealed row | 1.35:1 vs panel |
| `#846C5B` | Olive Wood | `--seal`, sealed fields | 4.42:1, fills |

Two derivations, for the roles that must carry text on a pale surface:

- `--dim` `#6C5545` — Olive Wood darkened
- `--accent-deep` `#7C4D2F` — Light Bronze darkened, used **only** off-chrome: body links, the
  clearing tick, focus rings. On chrome, use `--accent`.

`--buy` (`#41561C` sage) and `--sell` (`#85391F` terracotta) are additions: the palette has no
signal colours and a blotter needs buy and sell distinguishable. The BUY/SELL labels carry the
meaning independently, so colour reinforces rather than encodes.

### Three surfaces, and the mistake worth not repeating

There are **three** light surfaces here: the page, a panel, and a Soft Peach revealed row. The
page and the peach row are both darker than the panel.

An earlier version calibrated every text role against the panel alone. Five pairs then failed AA
on the other two surfaces, including the pitch and footer prose (which sit directly on the page)
and the BUY label on a revealed row, which is the most-looked-at cell in the demo. **Calibrate
against Soft Peach**, the darkest surface any body text touches; passing there passes everywhere.

Two versions before that, the page itself was Cream and every text role had been darkened until
it cleared AA against it. Contrast passed and the palette died: Light Bronze became `#7b4f22`,
Olive Wood `#5c4a3d`, and the page came out cream and mud. The fix was a **surface**, not a darker
text colour — putting the chrome on plum, where Cream, Soft Peach and Light Bronze all clear AA
untouched. Moving the page to a neutral off-white then did two more things: it gave the prose the
headroom it was missing, and it makes Soft Peach and Light Bronze read harder than they could on
cream, where each sat a shade from its own background.

The palette also governs `app/icon.svg`, `app/opengraph-image.tsx` and the `themeColor` in
`app/layout.tsx`.

## Running it

```bash
npm install
npm run dev
```

With no configuration it reads the deployment committed in `lib/deployment.ts` and shows the
book entirely sealed — which is the correct default, and the more interesting screenshot.

To decrypt, you need desk keys. Run an agent flow from the repo root, then:

```bash
cd ..                     # repo root
npm run frontend:config   # after a run — see the root README
```

That writes `frontend/.env.local` with the deployment addresses and the desks' AES keys.
`.env.local` is gitignored: **no key material enters the repository.** Keys are used only for
local decryption in the browser and are never transmitted.

## Verifying the chain layer

```bash
npm run verify
```

Exercises ABI decoding and browser-side decryption outside React, and checks the privacy
property directly — that holding a desk's key reveals exactly that desk's rows and nothing
else:

```
visibility by keys held:
  ok   no keys   reads 0/6 (owns 0)
  ok   Atlas     reads 2/6 (owns 2)
  ok   Borealis  reads 1/6 (owns 1)
  ok   Cygnus    reads 3/6 (owns 3)
```

## Typography

Two families, split by what the text *is*, not by where it sits.

**Prose, labels and chrome are sans.** A monospace was carrying the panel footers, and uniform
advance widths remove the word shapes a reader scans by; the cost landed hardest on exactly the
text carrying the argument.

**Data is monospaced.** Limits, sizes and fills have to align down a column, ciphertexts have to
be inspectable character by character, and the SABLE wordmark keeps the monospaced letterforms
because the wide tracking on them is the identity.

### Motion

All CSS. The landing is a Server Component that ships no JavaScript, and none of these effects is
worth giving that up for.

| Effect | Where | Driver |
|---|---|---|
| `.enter` | hero, on load | keyframes with a 40/130/220/310ms stagger |
| `.rise` | each band, on scroll | `animation-timeline: view()` |
| `.stagger` | steps, figures, lists | one `view()` timeline per child |
| `.decrypt` | the legend | sealed glyphs fade out, the value fades in out of blur |
| transitions | buttons, links | 200ms, matching the reference |

`.decrypt` is the one that carries meaning rather than polish: the legend performs the decryption
it describes, and the blur is what makes it read as illegible-resolving-into-legible rather than a
crossfade.

Two rules that must survive any edit:

- Every scroll-driven animation sits behind `@supports (animation-timeline: view())` **and**
  `prefers-reduced-motion: no-preference`. Where unsupported, nothing runs and the content is
  visible. A reveal that fails leaves sections at `opacity: 0`, and an invisible page is a worse
  failure than an unanimated one.
- `.decrypt > .sealed { opacity: 0 }` sits **outside** those guards. Both layers share one grid
  cell, so at full opacity the glyphs paint across the digits. The readable state is the default;
  the animation is what reveals the sealed layer, via `animation-fill-mode: both` applying the 0%
  keyframe before the scroll range begins.

The reference smooths the wheel itself with a library and floats an ambient background gradient on
a 20s loop. Neither is here: the first costs JavaScript on a static page (`scroll-behavior: smooth`
covers anchor jumps for free), and the second carries no information.

### Two registers

The landing and the terminal use different type on purpose. The landing is editorial and follows a
reference design (ricardochance.com): **Instrument Serif** display over **Red Hat Display** body,
its 11/16/20/24/32/48/80/140 scale, and scroll-driven reveals. The terminal is an instrument and
keeps **IBM Plex**.

One trap, which cost a deploy: **do not compose these variables on `:root`.**

`next/font` declares `--font-display-src` on the element carrying its generated class, which here
is `<main>`. A custom property is substituted where it is *declared*, so writing
`--font-display: var(--font-display-src), Georgia` at `:root` made that declaration invalid at
computed-value time — `--font-display` became guaranteed-invalid, inherited as invalid, and the
landing silently rendered in Plex. No error, no warning, the wrong typeface. The `.editorial`
rules reference `--font-*-src` directly instead, on the element that actually has it.

Two more things to know before touching it:

- Instrument Serif is named in the slop catalogue below as an overused face. Using it is a knowing
  trade for the reference look, taken deliberately, and it is confined to the landing.
- The display pair is declared in `app/page.tsx`, not the root layout. Declared in the layout it
  put all five font files on **every** route, so the terminal fetched a serif it never renders.
  Scoping the CSS with a class was not enough: the declaration decides what ships. The terminal
  references 3 font files, the landing 5.

Display sizes are fluid (`clamp`) rather than the reference's fixed pixels — a literal 140px hero
overflows a phone, which is the one detail of the reference worth not copying.

### The terminal's type

Both are **IBM Plex**, self-hosted by `next/font` (see `app/layout.tsx`). Plex was drawn by IBM
for technical interfaces and code, so it holds at 13px where a display face would not, and the
sans and mono are siblings: moving between prose and a column of figures does not change the
texture of the page.

Not Inter, Geist, Space Grotesk or Instrument Serif — the slop catalogue names those as the faces
that signal a generated site. The system stack stays as the fallback, with `adjustFontFallback`
matching its metrics so nothing shifts while Plex loads, and `next/font` downloads the files at
build time so there is no request to Google at runtime.

One cascade detail worth knowing before you touch it: Tailwind also defines `--font-sans` and
`--font-mono`, inside `@layer theme`. The definitions in `globals.css` are unlayered, and
unlayered styles beat layered ones regardless of order, so ours win by rule rather than by luck.

Use `.mono` and `.sans` to cross between them. `td` is monospaced by rule and `th` is not, since
a header is a label and a cell is a value.

`.prose` is justified and hyphenated, flush with its container's left edge, and **spans the full
container width** — there is no measure cap. That is a decided trade-off, not an oversight; see the
slop audit below. `line-height: 1.75` is the mitigation: leading is what makes a long line
recoverable, because the wider the measure, the more vertical separation the return sweep needs to
stay reliable. `hyphens: auto` is not optional either — justification without break points can only
stretch word spaces, which opens vertical rivers of white down the paragraph, and that is what rule
60 is about. Below 640px justification has nowhere to go, so it reverts to flush left.

## Slop audit

Checked against the catalogue at <https://impeccable.style/slop/>. Six patterns were present
and removed:

| Rule | What was there |
|---|---|
| Pulsing status dot | The network dot pulsed forever. It reports a static fact, so it now sits still. |
| Glassmorphism | The sticky bar was translucent with an 8px backdrop blur. Solid now, which is also easier to read against. |
| Hero metric layout | Four equal metric tiles, each a big number over tracked caps, with "public" repeated under two of them. Now two result figures, batch state and order count at the scale of context, and the disclosure stated once for the whole readout. |
| Em-dash overuse | 32 across the components. The ones left are the "no value" glyph, not punctuation. |
| Aphoristic-cadence copy | Manufactured contrasts: *"The market publishes a price. No participant reveals their hand."*, *"Nothing here is hidden by this interface; it is unreadable on chain."* Rewritten as plain statements. |
| Undersized text | Functional text sat at 11–12px. `.prose` is 14px and nothing is under 12px. (Line length: see the accepted hit below.) |

Uppercase labels were kept on **panel headers**, where they are conventional chrome in a trading
interface, but tracking dropped to 0.04em and size rose to 12px. Section headings became
sentence-case text rather than tiny tracked caps.

One flagged pattern is judged a false positive and kept: the four-rectangle SVG mark is a logo,
not shape-assembled hero art.

Rule 30, **cream/beige palette**, was briefly a live hit while the page background was Cream. The
page is a neutral off-white now, so the warm colours sit on the chrome and the data rather than
forming the surface, and the rule no longer applies.

Rule 40, **line length too long**, is a live hit and is accepted on the owner's instruction: prose
spans the container, about 185 characters at a 1400px page, against the under-80 the rule asks for.
It was fixed once with a 66ch cap and reverted, twice, in favour of the full width. `line-height:
1.75` is the mitigation for the return sweep, which is the actual cost of a long measure. Recorded
here as a decision rather than left to look like an oversight.

A third, **single font for everything**, was a fair hit and is now fixed by the type split
above.

## Notes for whoever restyles this

Everything visual is the CSS variables at the top of `app/globals.css` plus the `.sealed`,
`.panel`, `.panel-label` and `.prose` classes. Tailwind 4 is used for layout only.

Four things worth preserving through a redesign, each of them a defect that was fixed rather
than a preference:

0. **Sealed values must be inspectable.** They carry their ciphertext in a `title`, which nobody
   discovers by accident, so `.sealed` has a help cursor and a hover shift. That is the invitation
   to check that something real is underneath.
1. **Sealed values must read as sealed** — not as missing, and not as a loading state. `--seal`
   was once 1.45:1 against the panel, which made a sealed book look empty instead of opaque.
2. **The default view is fully sealed.** Unlocking is an explicit action, because the first
   impression should be the unreadable book.
3. **The reveal must be visible.** Rows that just became readable flash; without that, the one
   event the whole product exists to demonstrate happens invisibly between two frames.
4. **Nothing may make the page scroll sideways.** Wide content goes in a `.scroll-x` box. The
   blotter once made the `<body>` scroll, which reads as broken on a phone — where this link
   gets opened, because it is posted on X.

## Known gaps

- Read-only. Submitting from the browser needs MetaMask plus COTI AES onboarding plus an
  ERC-20 approval; the desks do it from the CLI today.
- Polls every 8s rather than subscribing to events.
- Reads one hardcoded market; there is no registry.
- A decrypted value is trusted when it is *structurally possible* (boolean in {0,1}, limit on
  the grid, fill ≤ size). A wrong key returns noise rather than an error, so this heuristic is
  what stops the terminal confidently rendering garbage — it is not a cryptographic check.
