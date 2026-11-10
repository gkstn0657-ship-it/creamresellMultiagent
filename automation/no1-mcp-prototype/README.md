# No1 visible-price MCP prototype

This is an unofficial local UI accessibility bridge, not a vendor API or an EXE patch. Original No1 files, account storage and the Cream loop are untouched.

## Current policy: no desktop popups

The user subsequently required background-only operation. The saved `no1` Codex registration and the pipeline runner use `--background-only`. `ui-policy.json` blocks all three UI tools before they launch a UI reader, including clients still supplying the old `--enable-live-ui` flag. The policy is checked on each call. Historical live instructions and results below are not authorization to re-enable UI operations.

2026-11-10: the registered server exposes four background diagnostics plus one product probe through [the background connector](../no1-background/README.md). Eight tools are registered, with the three legacy UI tools still blocked. Real Chrome-to-No1 relay authentication, Musinsa stock and coupon/point benefit queries succeeded. After the user logged KREAM in, the same product probe returned six KREAM size-price rows together with Musinsa stock and benefits in about 11 seconds. The latest observation again recorded zero new visible No1 windows and zero No1 focus changes. Profit-pipeline integration and independent market model/freshness/cost evidence remain pending. The product probe preserves partial successes without approving a purchase. Related tests: 121 passed. The observed product test created no visible No1 window and caused no No1 focus change. Current evidence: `../../kream-runs/no1-background-20261110/validation.json`.

On the last permitted UI recheck, market lookup succeeded. Stock data arrived but Musinsa login was required for benefits. The reader now distinguishes that state: stock may be returned with a null benefit price and `benefitStatus: login-required`. This change has unit coverage; its live rerun was stopped to honor the no-popup request. No login is initiated automatically.

## Local Codex registration verified (2026-11-09)

The `no1` stdio server is now enabled in this PC's Codex user configuration. It launches `server-stock.mjs --enable-live-ui` with the absolute Node and server paths. A configuration backup was saved next to `config.toml` before registration.

`test-registered-mcp.mjs` reads that saved registration using `codex mcp get no1 --json`, performs MCP initialization and tool discovery, and makes sequential live calls without a model invocation. Run it with `--live --out=<new-empty-directory>`; it preserves all earlier evidence.

The successful current-PC result is `../../kream-runs/no1-mcp-check-20261109-193502/registered-mcp-result.json`: all three tools discovered; matched KREAM 1120286 and Musinsa 7481180 queried; wrong stock model rejected; stock-to-market navigation verified. Observed stock was 40 and maximum-benefit estimate KRW 355280. Market data was stale and the estimate was not a verified checkout cost, so no sourcing candidate was approved.

The search tools now also navigate from the app's observed initial `seller-integration` page, using the same verified visible sidebar links. They do not operate login controls. No1 must be running, restored, and available on the interactive desktop during live calls. This verifies local Codex registration and direct MCP protocol calls; native discovery in an already-open chat and Dot cloud registration have not been verified.

## Files and use

Run stdio server: `node automation/no1-mcp-prototype/server.mjs --enable-live-ui`

The original server exposes only `no1_read_price_comparison`, with exactly `{ "kreamId": "280933", "model": "MM00313KM0307-P199" }`. The general search server is documented below.

Without the flag, live access is disabled. `--fixture` replays an explicitly labelled prior observation and cannot produce fresh evidence. Live mode reads the currently displayed No1 price table using Windows UI Automation; it does not search, navigate, click, start the app or modify a loop. Keep No1 open on the correct price-comparison item. It fails closed when identity, table or rows cannot be established.

Tests: `node --test automation/no1-mcp-prototype/server.test.mjs`

Approved one-item live comparison: `node automation/no1-mcp-prototype/test-live-280933.mjs`. This writes only `live-280933-result.json` in this prototype folder.

## Authentication, privacy and safety

No separate login, secret, cookie, .env or token is read or copied. The user signs in through No1 itself. Access is local stdio with no listening network port. Stdout carries MCP JSON only. No console logging of full app trees, account labels, network traffic or credentials. The reader selects the exact installed No1 process path and only returns the identified market table. UI stock comparison is deliberately excluded. Unknown tools, additional arguments and other IDs are rejected.

All output remains hold with stock and checkout-cost confirmation false and promotionAllowed false. Capture time is not the data's as-of time. The displayed label is retained and should be checked for staleness by the consuming pipeline. 30-day values are estimates as labelled by No1, not independently audited full trade totals.

## Limitations

Live table read for 280933 was tested. The general search entry point below was tested with 280933 and 756827. Local Codex registration was subsequently verified as described above; Dot cloud tool discovery remains unverified. Registering a local Codex MCP does not itself expose it in a Dot cloud session. No vendor plugin extension point was established; the bundled private IPC is not called. No original app code or security checks were modified. App updates, a locked/minimized desktop and UI accessibility changes can break reads. Restarting the application or loop is never performed by either server.

## Generalized UI search extension
Run `node automation/no1-mcp-prototype/server-general.mjs --enable-live-ui` from Cream.
This separate entry point preserves server.mjs and its original fixed-ID tool/tests. It exposes both `no1_read_price_comparison` and `no1_search_price_comparison`.
New tool input: `{ "kreamId": "756827", "model": "RCCMSS713A005086W103" }`.
Only the existing No1 KREAM search field and lookup button are operated. A displayed model TEXT node and exact KREAM hyperlink ValuePattern must match before any price rows are returned. The search input alone is never identity evidence. Missing/ambiguous controls, minimized windows and unavailable identity fail closed.
No1 must be restored and available on its price-comparison page. Do not interact concurrently. The reader does not activate, launch, install, log in, or refresh market data. UI layout and multi-result searches may fail closed rather than guessing a result.
Data remains hold even when identity is confirmed. `capturedAt` is screen read time; `uiAsOfLabel` is original UI text; `dataAsOf` is parsed using Asia/Seoul for the visible Today label. Both timestamps must be within 10 minutes and not future for `freshEvidence`; otherwise `NO1_STALE`. Fresh market evidence alone does not confirm source stock or checkout price or permit promotion. No automatic observation writes.
Access is **Windows CLI-mediated**, not native Dot MCP integration. No supported direct registration route was found in the current tool catalog; no settings changed or remote endpoint opened.
Authentication: existing No1 signed-in UI. No .env, account tokens, passwords or private APIs. JSON-RPC responses are stdout; child stderr is not logged; only requested sanitized test artifacts are saved.
Test command: `node --test automation/no1-mcp-prototype/server.test.mjs automation/no1-mcp-prototype/server-general.test.mjs` (18 pass).
Live command: `node automation/no1-mcp-prototype/test-live-general.mjs`. Latest live test passed after window restoration: actual search 280933 -> 756827 followed by wrong-ID request returned IDENTITY_MISMATCH_OR_NOT_VISIBLE. Earlier failed attempts are preserved separately. Inspect `passed` and individual responses. Both live products have stale data and remain hold. Never use fixture results as new evidence.

## Stock maximum-benefit estimate tool
Run `node automation/no1-mcp-prototype/server-stock.mjs --enable-live-ui` to expose all three tools, including `no1_search_stock_estimate`.
Input: `{ "productUrl":"https://www.musinsa.com/products/7481180", "model":"NBNPG41033", "color":"(19)BLACK", "option":"L(100)" }`.
Currently supports exact Musinsa canonical product URLs and the observed No1 stock-lookup layout. Open No1 stock lookup first, keep window restored and avoid simultaneous interaction. Prior tool files/tests remain unchanged.
The tool clears only the displayed old result, verifies its removal, submits a new URL lookup, waits for a new stock table and benefit price, checks result model/product number, copies the result URL to verify exact URL, binds the exact color group to its own option table and requires exact option text. The Copy link operation replaces clipboard contents with that product URL. No arbitrary clipboard content is read.
Only estimate price, stock and verbatim benefit breakdown are returned. No coupon/payment switches are changed. Benefit details are expanded through their supported UIA ExpandCollapse pattern. Current account selection is not changed or logged. Existing app login is reused; no credentials, .env or private APIs.
`capturedAt`, `queryStartedAt`, `queryCompletedAt` describe this new UI query. The upstream stock/price data timestamp is not displayed: `dataAsOf:null`, `upstreamFreshnessConfirmed:false`. This is an estimate-only hold, not fresh verified upstream data or checkout. Missing actual checkout price, conditional-benefit eligibility, seller identity and shipping cost require separate collection. A stale UI query, absent/ambiguous identity or mismatching option fails closed.
Verified test-only product: 7481180 / NBNPG41033 / (19)BLACK / L(100): 40 units; maximum-benefit estimate KRW 370280 at 2026-11-09T08:30:06.2399380Z. Full original conditions are in live-stock-result.json. Earlier old UI showed 41 units; it was not reused.
Actual wrong-model query returned STOCK_PRODUCT_IDENTITY_MISMATCH with no price/stock in live-stock-mismatch-result.json. 28 unit/regression tests passed. Commands: `node automation/no1-mcp-prototype/test-live-stock.mjs`, `node automation/no1-mcp-prototype/test-live-stock-mismatch.mjs`.
Windows CLI-mediated stdio MCP only, not native Dot registration. No daemon/loop connection, automatic observations or completed cycle-02 files changed.

## Bidirectional menu navigation (verified)
The generalized market and stock tools now navigate between price-comparison and stock-check through the visible sidebar links. They verify the current document route, exact menu label and route, invoke the UI link, and verify the new document route before lookup. Returned `navigation` reports from/to/changed/verified. Original fixed-ID current-screen tool remains unchanged.
Transition errors are explicit: SCREEN_TRANSITION_DOCUMENT_AMBIGUOUS, ROUTE_UNAVAILABLE, UNEXPECTED_ORIGIN, UNSUPPORTED_START, MENU_AMBIGUOUS, MENU_URL_MISMATCH, INVOKE_UNAVAILABLE, INVOKE_FAILED or TIMEOUT (all prefixed SCREEN_TRANSITION_). Neither app routes nor internal APIs are invoked directly. Minimized windows still fail closed.
Actual test completed 2026-11-09T08:33:32.579Z: stock -> market(280933) -> stock(7481180) -> market(280933), passed. File live-navigation-result.json preserves requests and responses. Run test-live-navigation.mjs to reproduce; 32 regression/evidence assertions pass.
The no1-first fields productUrl, option, stockQuantity, maximumBenefitPriceKrw and benefitConditionsVerbatim retain their types. Pipeline code was not edited. Returned price/stock remain estimates and hold.
No1 manual purchase-price inputs, default 50000 and displayed margin are not read into returned market or stock results, and are never used for profit. Both generalized tools return manualPurchasePriceUsed:false and no1DisplayedMarginUsed:false; no profit/margin amount is returned.
