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

- **Archive/dismiss for Inbox+Sent (v1.1, volume solution)** (parked
  2026-08-04, gate finding F9 — demoted after the card-collapse fix made
  it non-urgent). Design as specified at the gate: dismiss moves cards to
  a collapsed always-recoverable "Archived" section — NEVER delete (Asks
  are chain state and must not be silently hidable while money is
  claimable); settled Asks (answered/refunded/expired) dismiss freely;
  LIVE Asks require a confirm showing amount + deadline; dismissals are
  localStorage view-state only (rebuild-from-chain restores data, may
  respect dismissals); consider auto-collapsing settled Asks.
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
