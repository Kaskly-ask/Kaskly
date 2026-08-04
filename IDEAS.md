# IDEAS — Parking lot

_Anything out of scope for the ASK v2.0 brief lands here instead of in code
(brief §7 L6). Nothing in this file is a commitment._

## DROPS v1.0 material (superseded by this brief; future work)

- **Envelope** — the original DROPS gifting/attachment mode.
- **Boost** — paid amplification/priority mode.
- **Overlay** — the DROPS social overlay layer.
- **Profiles** — user profiles.
- **Explore** — public discovery/explore surface.

## D11 out-of-scope list (logged, not built)

- Fees / monetization of any kind (protocol stays fee-free forever — D2; any
  monetization thinking stays in this file)
- Envelope / Boost / overlay modes (see above)
- Profiles and social features
- Recurring payments
- Multi-token support
- Mobile native apps
- Custodial anything
- Fiat on-ramps
- Minimum-ask filters
- "Claimable inbox for people not yet on the app"

## Later entries

_(add below as they come up)_

- **Shareable Onboarding Card** (logged 2026-08-05, post-beta growth
  hook): on wallet/profile setup completion, auto-generate a
  downloadable share card — canvas-rendered PNG sized for X — with the
  username/handle, a kaskly.app profile link + QR (NOT a raw address),
  and a CTA blurb on the tagline ("I'm on Kaskly — Just Ask Me. Send me
  a question with KAS attached and I'll answer."), in the app's dark
  near-black + teal glass aesthetic. The hook: the moment onboarding
  ends, a ready-to-post asset is in hand. **Prerequisite:** a
  profile/handle layer (the client is wallet-only today), so the scope
  includes lightweight profiles. Out of v1 — log only.
- **Crowd-Funded Community Question Board** (logged 2026-08-05,
  post-beta, MAJOR feature): a public board where anyone submits
  questions aimed at a creator; the community contributes KAS toward
  questions they want answered; a live leaderboard ranks by pooled
  total, and top questions become high-value Asks. Cold-outreach
  onboarding hook: send the funded question link to a target with NO
  Kaskly wallet — they see the pot, answer, claim via a client-side
  auto-generated wallet, and are onboarded already funded. Design notes
  for future scoping:
  1. Pooled escrow needs PROTOCOL design — likely N per-contributor
     covenant locks with individual deadline refunds, preserving the
     non-custodial + refund guarantees (never app-pooled custody);
  2. Longer default deadlines + clear all-refund messaging, since
     targets don't know the question exists;
  3. A moderation stance is REQUIRED before any public, money-attached
     question board exists (harassment vector).
  Log only — no build.
- **Sender-side "refunded back" total** (parked 2026-08-04, alongside
  the queued recipient-side "Earned" widget): running total of TKAS
  returned to the connected wallet by refunds. Lower priority than
  Earned (a refund is relief, not reward); if built, same rules:
  chain-derived, rebuild-consistent.
- **Hide live Asks with confirm (v1.1)** (2026-08-04, gate finding F9;
  the settled-only hide/unhide version SHIPPED in Phase 3). Remaining
  future scope: allowing LIVE Asks (claimable funds) to be hidden behind
  a confirm showing amount + deadline — never delete, always
  recoverable. Also: consider auto-collapsing settled Asks by age.
- **Unified Activity feed (v1.1)** (parked 2026-08-04, gate design note):
  replies currently surface on Sent, which buries the product's payoff
  moment (near-term mitigation: the Sent unread badge). Evolution: one
  reverse-chronological Activity feed — Asks received / replies received /
  refunds landed — deep-linking to the cards; Inbox stays strictly "needs
  your action", Activity becomes "what happened".
- **Browser push notifications (v1.1)** (parked 2026-08-04, from Phase 3
  gate finding F8): Notification API + service worker so an open-but-
  backgrounded Kaskly can alert on new Asks/replies/refunds. Phase 3
  shipped the small version (nav unread badges + document-title count).
- **Closed-app notifications** (parked 2026-08-04): true offline alerts
  need a WATCHER SERVICE that knows which address to watch — a real
  tension with the non-custodial/no-server-knowledge posture (D4/D8).
  If ever built: strictly opt-in, watch-only (address, never keys), and
  documented in TRUST.md. Better framing: this is a NATURAL KACHAT/KASIA
  INTEGRATION ARGUMENT — a resident messenger app already watches the
  chain for its user and gets ASK notifications for free. Belongs in the
  PITCH.md adoption story.
- **Verified-sender identity via KNS in the envelope spec** (parked
  2026-08-04): the project now holds kaskly.kas (KNS inscription #96310),
  and an ask envelope COULD carry a claimed KNS name that clients verify
  against the KNS owner address (sender identity display, anti-phishing).
  Envelope/spec change → explicitly out of current scope; revisit with
  the Kasia team conversation or a v2 spec discussion.
