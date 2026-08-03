# /spike — Phase 1 covenant feasibility scripts

Throwaway-quality scripts (brief §9 Phase 1). NOT part of the app; excluded
from the Next.js build and type-check. Run with plain Node:

    node spike/00-connect.cjs
    node spike/01-keys.cjs      # generates spike/.keys.json (gitignored)
    ...

Purpose: answer ONE question on the covenant testnet — can the ASK spend
rules ("spendable by key R with an attached reply payload, OR by key S after
deadline") be expressed and executed with current tooling?

`spike/.keys.json` holds throwaway TESTNET keys only. It is gitignored;
never fund these keys on mainnet, never commit them (brief L5).
