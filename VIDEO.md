# Demo video — shot list and narration

The submission requires "a link to your app & a video demo on X.com, tagging @COTINetwork".
X gives no length rule; **X itself does**: uploads from a non-Premium account are capped at
**2:20 (140 s)**. That is the real constraint, so this is cut for **135 s** with a little
headroom. If the account has Premium, record the same beats and let them breathe to ~3 min —
the order does not change.

Everything below is filmable from the already-deployed market. **No transaction is required
on camera**, which is deliberate: the testnet RPC measured 4/10 availability during one
outage, and a live `clear()` is a single irreplaceable shot. Every number quoted is already on
chain and already verified.

---

## Before recording

```bash
npm run preflight          # read-only, zero gas — GO / NO-GO in ~10 s
cd frontend && npm run dev
```

`preflight` samples RPC availability, confirms the terminal opens on a populated batch, and
checks that the desk keys on disk actually unlock rows in *that* batch. The last one is the
trap: keys from a previous market fail silently, and you only discover it when clicking a desk
on camera reveals nothing.

Wait for **READY TO RECORD**. If it reports RPC below 90%, the terminal will still render (it
retries each call four times) but expect a stall — reshoot rather than ship a hang.

### Setup

| | |
|---|---|
| Capture | `Cmd+Shift+5` → *Record Selected Portion*, or QuickTime → New Screen Recording |
| Resolution | 1920×1080, or 1280×720 if the upload needs to be smaller |
| Browser | Full screen, **hide the bookmarks bar**, no other tabs, no extensions visible |
| Terminal font | 18–20 pt. Anything smaller is unreadable on a phone, which is where X plays |
| Audio | Voiceover if you are comfortable; otherwise record silent and burn in the captions below — X autoplays **muted**, so the captions matter more than the voice |

### Must not appear on screen

- `frontend/.env.local`, `.env`, or the **AES key** input field with anything typed in it. The
  terminal shows only `0x…` prefixes and loads the desks automatically — never use the manual
  add form on camera.
- Any wallet private key, any faucet page with a key visible, any editor tab holding `.env`.

These are testnet keys, so nothing is at stake financially — but a judge who sees key material
on screen learns something about the author, not about the product.

---

## The 135-second cut

Timings are targets, not marks to hit exactly. Narration is written to be spoken at a normal
pace (~150 wpm); each block is sized to its slot.

### 0:00–0:12 — Open on the sealed book

**Screen.** `localhost:3000`, untouched. The blotter is full of solid blocks. Do not move the
mouse for the first three seconds — let the frame land.

> "This is a live order book on a public blockchain. Six real orders. Every field — side,
> price, size — is a solid block, because that is genuinely what the chain stores."

**Why first.** It is the one image that cannot be mistaken for a mockup, and it poses the
question the rest of the video answers.

### 0:12–0:24 — Name the thing

**Screen.** Slow scroll to show the price grid and the batch header (price 101, volume 65).

> "Sable is a sealed-bid auction whose matching engine runs on encrypted orders. It found this
> price — 101, for 65 units — without ever decrypting a single one of them."

### 0:24–0:50 — The reveal

**Screen.** Click **one** desk key — Cygnus. Its three rows resolve into numbers. The other
three stay blocks. Hold the frame. Then hover the still-sealed rows to make clear they are not
placeholders.

> "I hold one desk's key. Its own three orders resolve. The other three do not, and no key I
> could add would change what the operator sees — because there is no operator. Clearing is
> permissionless, and there is no admin key anywhere in the contract."

**Do not unlock all three desks.** Holding every key is normal in a three-desk demo, but
opening them all reveals the whole book and destroys the only contrast that matters.
`preflight` names which single desk gives the strongest frame.

### 0:50–1:12 — The agents, and why the privacy pays

**Screen.** Cut to the RFQ panel: six encrypted messages. Then the terminal, showing the
`STAGE=submit` output from the verified run (scroll back, or keep it in a second pane).

> "Before committing, three autonomous desks negotiate over encrypted on-chain messages —
> side and size, deliberately no price. Atlas wanted seventy units, but could only see
> sixty-five of supply, so it committed sixty-five and locked six-six-three-nine of collateral
> instead of seven-one-five-zero. Five hundred and eleven units of capital freed, with no loss
> of fill. That only works if the message is encrypted — announcing 'I need seventy' in the
> clear is just telling the market to reprice against you."

**This is the beat judges remember**: confidentiality with a number attached, not an adjective.

### 1:12–1:32 — The proof

**Screen.** Terminal, the privacy assertion from the run, then the gas line.

> "We tested this rather than claiming it. One desk tried to decrypt another's fill of
> thirty-seven and got noise — three point three times ten to the thirty-eighth. With no keys
> you read zero of six orders. With one desk's key, exactly its own. And this is not a toy:
> clearing thirty-two orders — the contract's own maximum — costs sixty-six point six million
> gas, fifty-five percent of a block, measured, with both sides conserving exactly."

### 1:32–1:52 — Why it could not exist before, and close

**Screen.** Back to the book, half-revealed. Then a final frame: repo URL + live app URL.

> "Zero-knowledge proofs let you prove something about your own data. A clearing price is a
> function of everyone's orders at once — the party you would normally trust to compute it is
> the party who must not see it. That needs multi-party computation, and until COTI's garbled
> circuits ran inside EVM execution, this mechanism had no implementation. Price discovery is
> a public good. Nobody has to show their hand to produce it."

**End card.** Hold 3 s, legible: repository, live app, `@COTINetwork`.

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

- [ ] Deploy the frontend — the post needs a live app link
- [ ] Make the repository public (`gh repo edit nadaamd/sable --visibility public`)
- [ ] Record, cut to ≤140 s, burn in captions
- [ ] Post on X tagging **@COTINetwork**, then complete the submission form
