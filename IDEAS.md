# IDEAS — Parking lot

_Anything out of scope for the ASK v2.0 brief lands here instead of in code
(brief §7 L6). Nothing in this file is a commitment. Some product-roadmap
material is maintained privately outside the repo._

## D11 out-of-scope list (logged, not built)

- Fees / monetization of any kind (protocol stays fee-free forever — D2)
- Envelope / Boost / overlay modes
- Profiles and social features
- Recurring payments
- Multi-token support
- Mobile native apps
- Custodial anything
- Fiat on-ramps
- Minimum-ask filters
- "Claimable inbox for people not yet on the app"

## Later entries

- **Shareable Onboarding Card** — **PROMOTED & SHIPPED 2026-08-05 in a
  wallet-only scope** (share card PNG + QR encoding `/ask?to=<addr>`,
  copy-link, paste-ready posts, composer ?to= prefill — see PROGRESS).
- **Sender-side "refunded back" total** (parked 2026-08-04, alongside
  the shipped recipient-side "Earned" widget): running total of TKAS
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
  documented in TRUST.md.
- **Verified-sender identity via KNS in the envelope spec** (parked
  2026-08-04): the project holds kaskly.kas (KNS inscription #96310),
  and an ask envelope COULD carry a claimed KNS name that clients verify
  against the KNS owner address (sender identity display, anti-phishing).
  Envelope/spec change → explicitly out of current scope; revisit with
  the Kasia team conversation or a v2 spec discussion.
- **Trending / Top Earners homepage card** (banked 2026-08-05; NOT part of
  the current security work — record only, build after the honest tag).
  Rank with the EXISTING Earned computation, but **hide the KAS amount** —
  show presence ("trending"), not income. Hiding the number is what removes
  the financial-exposure objection, so it is load-bearing, not styling.
  - **Opt-in only, from v1.** A wallet appears only if its owner chose to
    be public. This is a **consent** decision, not an anti-gaming one:
    never auto-list a real person — especially a featured dev — without
    them choosing it. Keep it in v1 even though it looks skippable; it is
    one flag check now and awkward to retrofit once a board exists.
  - **Rolling ~48h window** so the homepage feels live. The window is for
    **freshness only** — it is NOT an anti-gaming measure and does not
    defend against farming.
  - **Anti-gaming DEFERRED.** Distinct-sender ranking (so self-dealing
    from alt wallets cannot farm the board) is the known answer, but it is
    premature with no real users. Revisit if/when someone is actually
    farming it.
  - **Provenance caveat.** Earned is derived through the REST indexer read
    path, so a leaderboard inherits **OPW-2** — a hostile indexer could
    influence ranking. Acceptable for a testnet showcase; must be stated
    if it ships, and re-assessed before anything with real money.
  - Placeholder copy until built: *"Trending experts coming soon — make
    your Kaskly public to appear here."*

- **Tagline bank** (2026-08-05): *"Attention monetization without the
  ads."* Candidate site tagline; recorded here as the taglines home until
  there is a dedicated copy doc.
