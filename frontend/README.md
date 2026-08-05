# Sable terminal

A read-only window onto a live Sable market on COTI testnet.

The point of this interface is what it *cannot* show you. It fetches the entire order book
with public `view` calls — no wallet, no signature, no permission — and renders it sealed,
because that is what the chain stores. Unlock one desk's key and that desk's rows resolve
into numbers while every other row stays █.

## Layout

The page follows the market's own order rather than presenting a flat stack of equal-weight
panels, which said nothing about which control acted on which data.

**Header.** A sticky identity bar — mark, wordmark, live block, both contracts, and links out
to the code and the write-up — over the headline figures: clearing price, matched volume, batch
phase with its countdown, and order count. Those first two are the only values this market ever
makes public, so they are the page's headline; they used to sit in a side panel below the fold.
Each tile states whether its value is public or sealed, because that distinction is the entire
claim.

The bar must stay a **direct child** of `<main>`: `position: sticky` is bounded by the parent's
box, so wrapping it in a spacing div pins it to that div and it scrolls away.

**The sealed book.** The *View as desk* control sits inside this band, directly above the book
it acts on — keys listed but inactive, so the terminal opens on the honest view. Unlocking one
desk flashes exactly the rows that just became readable; that transition *is* the product and
it used to happen invisibly between two frames. Sealed cells vary in width, derived from the
ciphertext (which is public) — a uniform grid read as a loading placeholder. The batch picker
lives in this band's heading, where it belongs.

**Pre-trade negotiation.** The encrypted IOIs between desks. Sender and recipient can each
decrypt; nobody else can. An IOI carries a side and a size and deliberately no price.

**Market rules.** The public price grid with the clearing tick marked, beside the parameters and
the disclosure summary.

Wide tables scroll inside their own panel; the page never scrolls sideways.

## Palette

Five warm earth colours, each with one job. Contrast is against `--panel`:

| Hex | Name | Role | Ratio |
|---|---|---|---|
| `#443742` | Mauve Shadow | `--line`, structure | 1.47:1 |
| `#846C5B` | Olive Wood | `--seal`, sealed fields | 3.35:1 |
| `#CEA07E` | Light Bronze | `--dim`, secondary text | 7.02:1 |
| `#EDD9A3` | Soft Peach | `--accent`, highlights | 11.80:1 |
| `#E2E8C0` | Cream | `--ink`, data | 12.96:1 |

Two gaps in the set are closed in `globals.css` rather than fudged. It gives **no background** —
Mauve Shadow is its darkest colour but far too light for a page, so `--bg` and `--panel` are
derived plums beneath it and Mauve Shadow does what its luminance suits: borders. And it gives
**no signal colours**, so `--buy` (`#A9C177` sage) and `--sell` (`#D2765A` terracotta) are
additions in the same family; the BUY/SELL labels carry the meaning independently, so colour
reinforces rather than encodes.

Cream and Soft Peach sit 1.1x apart in luminance and cannot both carry text hierarchy — they are
separated by hue instead. Light Bronze at 1.85x below Cream is what splits primary from
secondary; keep it at 7:1 or above. The palette also governs `app/icon.svg`,
`app/opengraph-image.tsx` and the `themeColor` in `app/layout.tsx`.

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

## Notes for whoever restyles this

Everything visual is the CSS variables at the top of `app/globals.css` plus the `.sealed`,
`.panel` and `.panel-label` classes. Tailwind 4 is used for layout only.

Four things worth preserving through a redesign, each of them a defect that was fixed rather
than a preference:

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
