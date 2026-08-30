# Demo video — shot list and narration

**2:15 (135 s).** X caps uploads from a non-Premium account at **2:20**, which leaves five
seconds of margin. With Premium the same script stretches to 2:30 without changing a word —
see "Budget and cuts" below.

**Two movements.**
**A. The landing, scrolled (0:00 → 1:15)** — the problem, then the mechanism.
**B. The terminal, live (1:15 → 2:08)** — the same claims, on chain.
**Close (2:08 → 2:15).**

Everything here is filmable from the already-deployed market. **No transaction is required
on camera**, which is deliberate: the testnet RPC measured 4/10 availability during one
outage, and a live `clear()` is a single irreplaceable shot. Every number quoted is already
on chain and already verified.

The rule that holds the whole thing together: **the voice never reads the text on screen.**
It says what the text does not, while the text is legible. A viewer who hears exactly what
they are reading processes it twice and leaves.

*Version française, pour filmer : `SCRIPT-VIDEO.md` (hors dépôt).*

---

## Before recording

```bash
npm run preflight          # read-only, zero gas — GO / NO-GO in ~10 s
cd frontend && npm run dev
```

Wait for **READY TO RECORD**. If it reports RPC below 90%, the terminal will still render
(it retries each call four times) but expect a stall — reshoot rather than ship a hang.

`preflight` samples RPC availability, confirms the terminal opens on a populated batch, and
checks that the desk keys on disk actually unlock rows in *that* batch. The last one is the
trap: keys from a previous market fail silently, and you only discover it when clicking a
desk on camera reveals nothing.

### Setup

| | |
|---|---|
| Tabs | `localhost:3000` **and** `localhost:3000/terminal`, nothing else |
| Browser | Full screen, **bookmarks bar hidden** (`Cmd+Shift+B`) |
| Zoom | `Cmd+0` |
| Start on | The landing, **scrolled to the top** |
| Capture | `Cmd+Shift+5` → *Record Selected Portion* → the Chrome window only |
| Resolution | 1920×1080, or 1280×720 if the upload needs to be smaller |
| Audio | Microphone **off** if you are laying the voice down afterwards |

Leave **two seconds of silence** before moving the mouse — you will cut it in the edit, and
it saves your opening frames. Stop with ⏹ in the menu bar, or `Cmd+Ctrl+Esc`.

### Must not appear on screen

- `frontend/.env.local`, `.env`, or the **AES key** input field with anything typed in it.
  The terminal shows only `0x…` prefixes and loads the desks automatically — never use the
  manual add form on camera.
- Any wallet private key, any faucet page with a key visible, any editor tab holding `.env`.

These are testnet keys, so nothing is at stake financially — but a judge who sees key
material on screen learns something about the author, not about the product.

### How to scroll

The landing animates on scroll: the four-step section **pins** its lede while the steps
travel past, each lit by its distance to the focal line. **A jerky scroll destroys the
effect.**

- Trackpad, **two fingers, one continuous slow push** — never a notched wheel
- Aim for roughly **one screen height every 4 seconds**
- **Stop completely** while a sentence lands. Movement resumes between sentences.

---

# Part A — the landing

### A1 — 0:00 → 0:15 · The hero  *(15 s)*

**Screen.** Top of page. The title *"A market that cannot read its own book."*, the globe,
the two buttons. **Still** for the full fifteen seconds.

> "This is Sable, built for the COTI Vibe Code Challenge. A market that cannot read its own
> book — and that is not a slogan. Orders arrive encrypted, and the clearing price is
> computed without decrypting a single one of them."

**The entry is named in the first sentence, not in a title card.** A separate intro shot
would spend ten seconds of housekeeping on the only seconds where a scrolling viewer
decides whether to stay. Folded in, it identifies the work and hooks at the same time.

**Why open here.** Your structure explains before it proves, which is clearer but asks a
scrolling viewer for seventy seconds of patience. This frame has to earn them on its own:
the title is the hook, so let it sit.

### A2 — 0:15 → 0:37 · The problem  *(22 s)*

**Screen.** Scroll to *"Being seen is what costs you."* and its two columns. Frame both,
then stop.

> "Being seen is what costs you. On a transparent venue your order is readable before it
> settles, so the price moves against you first. Traditional finance answered with dark
> pools — and traded one problem for another. A dark pool hides your order from the market,
> but not from its operator. Barclays and Credit Suisse both settled with the SEC over
> exactly that."

**Why.** It sets the stakes with a checkable fact rather than a promise. Two names and a
regulator: nobody argues with it in the replies.

### A3 — 0:37 → 1:05 · The four steps  *(28 s)* ⭐ the teaching core

**Screen.** Scroll into *"Four steps, none of them readable."* The left panel pins, the four
steps travel past on the right, lighting one at a time.

**Pace.** One step every 7 seconds. Land each sentence on the step that lights — this is the
one place in the film where picture and voice advance together.

> "Four steps, none of them readable. Desks negotiate first, over encrypted messages
> carrying a side and a size — deliberately never a price. Then they commit: side, limit and
> size, all ciphertext. At the close, any address can trigger clearing, and the contract
> finds the price that maximises matched volume — computing entirely on garbled values.
> Finally, each desk decrypts exactly one number: its own fill."

### A4 — 1:05 → 1:15 · The notation  *(10 s)*

**Screen.** *"What a row looks like"* — the Atlas row in blocks on the left, resolved to
`BUY 103 37` on the right. Hard stop on it.

> "And this is the notation you are about to see. A block is not a redaction by this page.
> It is a ciphertext, stored on chain."

**This shot is the hinge.** It teaches the viewer to read the next screen. Without it the
terminal looks like a page that redacted its own data. Never cut it.

---

# Part B — the terminal

> **Transition.** Click **"Open the terminal"** on screen rather than switching tabs. The
> move is visible, and it shows the two pages are one product.

### B1 — 1:15 → 1:27 · The book, live  *(12 s)*

**Screen.** `/terminal`, at the top. The blotter full of blocks, `0 of 6 readable with the
keys you hold`, and **CLEARING PRICE 101 · MATCHED VOLUME 65**. Still.

> "So here it is, live. Six real orders on COTI testnet. Every field a block. And the market
> still cleared — at one hundred and one, for sixty-five units."

### B2 — 1:27 → 1:50 · The reveal  *(23 s)* ⭐ the shot that decides it

**Screen.** Click **Cygnus**, and only Cygnus. Its three rows resolve, the other three stay
blocks, the counter moves to `3 of 6`.

**Mouse.** Approach on *"watch what a key does"*, click on *"I hold one desk's"*, then take
your hand away. Eight full seconds on the revealed frame.

> "Now watch what a key does. I hold one desk's — Cygnus. Its three orders resolve. The
> other three stay sealed, and no key I could add would change what the operator sees —
> because there is no operator. Clearing is permissionless, and there is no admin key
> anywhere in the contract."

**Do not unlock all three desks.** Holding every key is normal in a three-desk demo, but
opening them all reveals the whole book and destroys the only contrast that matters.
`preflight` names which single desk gives the strongest frame.

### B3 — 1:50 → 2:08 · The negotiation, and the number  *(18 s)*

**Screen.** Scroll to **Pre-trade negotiation**. `no key held` on the messages that do not
involve Cygnus, `wants to buy 70` and `wants to sell 65` on the ones that do.

> "The negotiation is on chain too. Atlas wanted seventy units, but could only see sixty-five
> of supply — so it committed sixty-five, and locked five hundred and eleven fewer units of
> collateral, with no loss of fill. Encrypted, because announcing 'I need seventy' in the
> clear would simply raise the price against you."

**This is the beat judges remember**: confidentiality with a number attached, not an
adjective.

---

### Close — 2:08 → 2:15  *(7 s)*

**Screen.** Hold on the half-revealed book, still. Then the end card.

> "Price discovery is a public good. Nobody should have to show their hand to produce it."

```
sable-cross.vercel.app
github.com/nadaamd/sable
@COTINetwork
```

One second of silence before the last line, and let it finish before you cut. Hold the card
four seconds.

---

## After the shoot

| Step | Tool |
|---|---|
| Voice | **ElevenLabs** — paste the eight blocks in order — or your own |
| Edit | **Descript** — edit the video by editing the transcript |
| **Burnt-in captions** | **mandatory** — X autoplays muted |
| Export | ≤ 140 s, MP4, 1080p |

**Without captions the argument does not exist** for someone scrolling X in silence.

---

## Budget and cuts

346 words ≈ 138 s at 150 wpm, or 132 s at 1.05× — under the 140 s cap with margin.

The intro cost eleven words. They were paid for by dropping B2's closing line ("a desk that
tries to read another's fill gets noise, not a number"): the shot already proves it on
screen, "no operator, no admin key" is the stronger half, and B3 supplies a number anyway.

**Over time:** shorten **A2** — keep the two bank names, drop the sentence about relays.
**Never cut** A4 (without the notation B1 is unreadable), B2, or the last line.

**With X Premium, at 2:30:** stretch A1 to 18 s, A3 to 34 s, B2 to 28 s. Those three gain
from breathing. Not a word changes.

---

## If the RPC degrades mid-take

Symptom: the blotter stops updating, or a panel blanks. The page retries four times per call,
so a brief wobble self-heals within one 8-second poll.

- **Wobble** — cut the dead seconds in the edit; the state is already correct on screen.
- **Sustained** — stop. Re-run `npm run preflight`. Recording against a degraded RPC produces
  a video where the product looks broken and the network is to blame, which no viewer will
  parse correctly.

Because nothing in this cut needs a transaction, a bad RPC day costs you a reshoot and nothing
else.

---

## Draft X post

> Sable — a sealed-bid auction whose matching engine runs on encrypted orders.
>
> Six live orders on @COTINetwork testnet. The clearing price is public: 101, 65 units. Every
> order stays sealed forever — including from us.
>
> Three autonomous desks negotiate over encrypted messages, then commit blind. One of them
> shrinks its own order and frees 511 units of capital because the encrypted RFQ told it the
> other side was thin.
>
> No operator. No admin key. Clearing is permissionless, and 32 orders clear in 55% of a
> block — measured, not modelled.
>
> Built with garbled circuits on COTI's gcEVM.
>
> app: <URL>
> code: <URL>

Trim to fit; the first two lines are the ones that have to survive.

---

## Still outstanding before posting

- [x] Make the repository public — <https://github.com/nadaamd/sable>
- [x] Deploy the frontend — <https://sable-cross.vercel.app>
- [ ] Record, cut to ≤140 s, burn in captions
- [ ] Post on X tagging **@COTINetwork**, then complete the submission form

The live site opens on a fully sealed book and **cannot be unlocked by a visitor**: the desk AES
keys live only in `.env.local` and were deliberately not deployed. The primer at the top teaches
the notation regardless, which is why it is a labelled legend rather than live data.

To make the reveal interactive for visitors, and accepting that it publishes the three demo
desks' keys into the client bundle where anyone can read them:

```bash
npm run frontend:config                      # writes frontend/.env.local
cd frontend
grep NEXT_PUBLIC_DEMO_DESKS .env.local | cut -d= -f2- \
  | npx vercel env add NEXT_PUBLIC_DEMO_DESKS production
npx vercel --prod --yes
npx vercel alias set <new-deployment-url> sable-cross.vercel.app
```

Testnet desks with no value, so the exposure is a demo choice rather than a risk — but it is a
choice, and the sealed default is the honest one.
