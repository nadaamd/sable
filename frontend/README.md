# Sable terminal

A read-only window onto a live Sable market on COTI testnet.

The point of this interface is what it *cannot* show you. It fetches the entire order book
with public `view` calls — no wallet, no signature, no permission — and renders it sealed,
because that is what the chain stores. Unlock one desk's key and that desk's rows resolve
into numbers while every other row stays █.

## Panels

- **Order book** — every order in the batch: trader and index public, side/limit/size as
  ciphertexts. A short ciphertext fingerprint sits next to each row, so it is visible that
  there is real data there and that it is opaque.
- **The cross** — the only two numbers that ever become public: clearing price and matched
  volume. Plus the public price grid with the clearing tick marked, and a commit countdown.
- **RFQ channel** — the encrypted pre-trade messages between desks. Sender and recipient can
  each decrypt; nobody else can. An IOI carries a side and a size and deliberately no price.
- **View as desk** — load AES keys. Inactive by default, so the terminal opens on the honest
  view.

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

## Notes for whoever styles this next

Design is deliberately thin — function first. Everything visual is a handful of CSS
variables at the top of `app/globals.css` (`--bg`, `--panel`, `--line`, `--ink`, `--dim`,
`--seal`, `--buy`, `--sell`, `--accent`) plus the `.sealed` and `.panel` classes. Tailwind 4
is available and used for layout only.

Two things worth preserving through a redesign:

1. **Sealed values must read as sealed** — not as missing, and not as a loading state.
   `--seal` sits close to the panel background but stays legible as a block.
2. **The default view is fully sealed.** Unlocking is an explicit action, because the first
   impression should be the unreadable book.

## Known gaps

- Read-only. Submitting from the browser needs MetaMask plus COTI AES onboarding plus an
  ERC-20 approval; the desks do it from the CLI today.
- Polls every 8s rather than subscribing to events.
- Reads one hardcoded market; there is no registry.
- A decrypted value is trusted when it is *structurally possible* (boolean in {0,1}, limit on
  the grid, fill ≤ size). A wrong key returns noise rather than an error, so this heuristic is
  what stops the terminal confidently rendering garbage — it is not a cryptographic check.
