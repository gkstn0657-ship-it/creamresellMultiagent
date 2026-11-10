# User working preferences

- Validate work proactively, without waiting for the user to request tests. This is an explicit user preference recorded on 2026-11-10 (Asia/Seoul).
- For code and integration changes, run relevant checks and, where available within the authorized scope, verify actual behavior. Fix discovered failures and rerun the affected checks before reporting completion.
- Match verification to the change. Do not treat static inspection, mocked tests, or a healthy server endpoint as proof that an authenticated end-to-end workflow works.
- Report what was tested, the result, and any unverified behavior or concrete blocker. Do not claim completion based only on a proposed approach.
- No1 must not pop up, take focus, or require desktop UI automation. Preserve the background-only policy. Never fall back to UI control to make a test pass.
- During work, communicate concise progress in Korean and continue independently wherever the existing authorization permits.
- The user values speed. Keep the active scope focused, front-load connection prerequisites, and bundle any unavoidable user setup steps. After relevant checks pass, do not broaden or repeat tests without a new change, failure, or concrete unresolved concern.
- Product discovery uses a fixed deterministic plan, not a runtime AI exploration agent. Preserve the saved popularity-feed position, category rotation, and cross-request deduplication when the user repeatedly asks for N products. Keep the existing per-product profitability and independent-review AI roles. Dot starts and monitors the work; the PC loop executes the confirmed N scope. Do not silently restore AI-driven candidate selection.

## Musinsa ranking source

- Musinsa ranking requests use `automation/no1-background/ranking-policy.json` and `no1_background_ranking_feed` (CLI: `node automation/no1-background/read-ranking.mjs`). Read the current No1 Ranking Analysis category/period/gender/age settings; query section `all` and process numeric rank ascending. Do not substitute NEW, rising, keyword results or the general KREAM discovery feed.
- Ranking feed previews do not advance the general discovery cursor or consume a work order. The existing `cream_explore_start` remains the general KREAM runner, not a Musinsa ranking runner. Keep ranking provenance and any future traversal state separate. Do not claim a ranking preview has run downstream profitability judgments.
- If the No1 ranking settings cannot be read, report the explicit failure; never silently replace the selected category with all categories. No1 operations remain background-only.
