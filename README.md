# Stock Workbench

Stock Workbench is a local Vite React and Express app for watching file-backed sector stock lists from YAML config, viewing quote tables and charts, and comparing market data across popular sectors.

## Setup

```bash
npm install
export POLYGON_API_KEY="your_polygon_api_key"
npm run dev
```

Do not print, commit, or place `POLYGON_API_KEY` in frontend code. The key is read by the Express API only.

Open the app at `http://127.0.0.1:5173`.

## Configuration

- `config/watchlists.yaml` stores watchlists, rows, pinned symbols, row defaults, descriptions, and themes.
- `config/settings.yaml` stores Polygon rate-plan settings.

The default settings use the paid `stocks-starter` plan. Market data can still be delayed depending on Polygon plan behavior, symbol coverage, and exchange entitlements; the UI labels snapshot timeframe values returned by the API.

Watchlists are loaded from `config/watchlists.yaml`.

**Sub-sectors.** A watchlist may define `subsectors`: popular, overlapping themes such as Optical modules or Networking. Each has an `id`, `name`, optional `description` and `symbols` drawn from the list's rows; an unknown symbol or duplicate id fails config validation. They appear as a sliding bar between the table controls and the quote table. Selecting an option filters and paginates the table to that theme, and the caption gives its count and definition. The ‹ › buttons, or ←/→ on a focused option, step to the neighbouring theme. Each option shows the equal-weight daily change of its members, calculated like the watchlist badge. Sub-sectors are display-only: rows still define segments and Quant System classes, and sub-sectors never change the config hash. Only Semiconductors, Software & SaaS and AI Cloud & Infrastructure have them, because those lists exceed one 20-row page, mix unrelated trades, and have popular themes that cut across their segments. The other lists fit on one page, and their segments already match the usual split. Chinese labels live in `src/shared/messages.ts`.

The app does not create or delete whole watchlists, but stocks can be added to or removed from a watchlist at any time:

- **Who can edit.** Only visitors on the research IP allowlist (`RESEARCH_ALLOWED_IPS`) see **Edit list** in the watchlist toolbar. Everyone else sees the lists read-only.
- **Adding a stock.** Choose a symbol, a segment (row), and optionally a business note and sub-sector tags. The sub-sector being viewed is pre-checked. The server checks the ticker against Polygon reference data first. Unknown tickers are rejected, and a failed lookup leaves the list unchanged.
- **Removing a stock.** Use the × beside the symbol. **Undo** puts a YAML symbol back in its original position. A watchlist always keeps at least one symbol.
- **Where edits live.** Edits are stored as an overlay in `RESEARCH_DATA_DIR/watchlist-edits.json` (production `/var/lib/msite/research`), so they survive deploys. They are merged over the YAML on every read; the YAML file itself is never rewritten. A symbol later added to the YAML is not duplicated, and an addition whose row disappears from the YAML moves to the list's last row. To make an edit permanent in Git, copy it into `config/watchlists.yaml`. To discard all runtime edits, delete the overlay file.
- **API.** `POST /api/watchlists/:watchlistId/symbols` with `{"symbol","rowId","description?","subsectors?"}` and `DELETE /api/watchlists/:watchlistId/symbols/:symbol` use the same gate as the Quant System POSTs: allowlisted IP, same-site, and JSON for POST. DELETE is always CORS-preflighted. Errors: `403 RESEARCH_IP_FORBIDDEN`, `403 CROSS_SITE_REQUEST`, `400 INVALID_WATCHLIST_EDIT`, `400 WATCHLIST_ROW_NOT_FOUND`, `400 WATCHLIST_SUBSECTOR_NOT_FOUND`, `404 WATCHLIST_NOT_FOUND`, `404 UNKNOWN_SYMBOL`, `404 WATCHLIST_SYMBOL_NOT_FOUND`, `409 WATCHLIST_SYMBOL_EXISTS`, `409 WATCHLIST_LAST_SYMBOL`, `409 WATCHLIST_ADD_LIMIT` (100 additions per list) and `502 SYMBOL_LOOKUP_FAILED`.
- **Effect on other pages.** Every consumer reads the merged lists. The Quant System stock book uses the edits at its next run: added symbols join their list's class, and removed holdings exit with reason `removed`. Each edit changes the config hash, so paper ledgers log a `config` event and the next weekly backtest counts as a new trial. Analytics → Models includes added symbols from the next scan onward.

## Verification

```bash
npm run lint
npm test
npm run test:e2e
npm run build
```

Playwright and unit tests mock Polygon-facing flows and should not consume real API capacity.

To verify a deployed public instance without starting the local dev server:

```bash
MSITE_PUBLIC_BASE_URL=https://finance.nphunter.net npx playwright test tests/e2e/public-smoke.spec.ts
```

## Deployment

`finance.nphunter.net` is deployed on AWS EC2 in `us-east-1`.

- EC2 instance: tagged `Project=msite`, `App=msite-finance`, `Name=msite-finance-web`
- Public entry: Elastic IP routed by Route53 `finance.nphunter.net`
- Runtime: Docker container managed by systemd `msite.service`
- Public proxy/TLS: Caddy on ports `80` and `443`
- Runtime secrets: SSM SecureString parameters under `/msite/finance/`
- Container registry: ECR repository `msite-finance`; the instance keeps only the three newest images (pruned on every deploy)
- Host: t3.micro (912 MB RAM) with an 8 GB root volume, a 1 GiB `/swapfile` in `/etc/fstab` (`vm.swappiness=10`) and journald capped at 200 MB (`/etc/systemd/journald.conf.d/90-msite.conf`). These host settings are not managed by the deploy workflow; recreate them on a new instance

Production infrastructure lives in `infra/` as Pulumi code. The Pulumi stack
creates the ECR repository, the GitHub Actions OIDC deploy role, the EC2 role
policy that allows the instance to pull from ECR, and the SES identity, DKIM
records and send policy for Quant System alerts (see Quant System → Email).

Deployments are automated by `.github/workflows/deploy.yml`. Every push to
`main` runs verification, builds a Docker image, pushes both the commit SHA tag
and `latest` to ECR, sends an SSM command to the finance EC2 instance, and
updates `msite.service` to run the pulled image.

Infrastructure setup:

```bash
cd infra
npm install
pulumi stack select prod
pulumi up
```

After a deployment workflow completes, verify the public deployment:

```bash
MSITE_PUBLIC_BASE_URL=https://finance.nphunter.net npx playwright test tests/e2e/public-smoke.spec.ts
```

Wave-theory analysis remains documented in the MVP spec and is not implemented in this MVP.

## Dig Deep research

Analytics → Dig Deep provides on-demand research. Run creates a durable background job; the browser polls progress and saved reports can be reopened. Module refreshes create a new snapshot while retaining the other modules' data timestamps. AI interpretation is invalidated and regenerated whenever evidence changes.

- Quantitative calculations use completed, split-adjusted daily bars (up to five years, with a one-year fallback when access is denied). These are **price returns, not dividend-inclusive total returns**. The current New York trading day is excluded. The UI documents lookbacks, benchmark alignment and the zero risk-free-rate assumption. Missing history or zero denominators produce unavailable values.
- Profile/news data comes from Polygon / Massive. News covers up to 20 articles from the previous 30 days, with source links and publication dates. Financial statements and ratios use `/stocks/financials/v1/` endpoints and may require additional entitlement. Stocks and ETFs use separate templates. ETF holdings, NAV, expenses and AUM need an additional feed; unavailable fields are labeled explicitly. Historical valuation percentiles, ROIC, cash-flow growth, spreads and ETF tracking error are not currently calculated.
- Optional AI uses the OpenAI Responses API with server-only `OPENAI_API_KEY`. The selected model is `gpt-5.6-sol` (the application default and the production `OPENAI_MODEL` setting), using low reasoning effort and a 6,000-token output ceiling including reasoning. The key must be configured to enable it. No model credentials are needed for quantitative/news analysis. The model receives the displayed evidence, not account information, and cannot execute tools. Responses are not stored by the API (`store: false`); the resulting report is saved locally. No AI request is retried automatically.
- My Quant runs four pre-registered pullback-and-rebound event studies on the same daily bars: EMA200 ±3% touch (20-session primary test), SMA50 ±2% touch inside an SMA50 > SMA200 uptrend (10), Connors RSI(2) < 10 above SMA200 (5), and a close below the 20-day 2σ Bollinger band above SMA200 (10). Each compares events with same-regime background days using a 42-session block bootstrap, and reports path outcomes, a rule exit and parameter sensitivity. Model definitions live in `server/research/ema200.ts` and `server/research/pullback.ts`; bump `QUANT_MODELS_VERSION` in `shared/research.ts` whenever a pullback rule or its output changes so saved reports are recalculated when an allowed IP opens them. Models are descriptive and are not part of the buy/sell score.
- Analytics → Models runs the same four My Quant models across every symbol on the site: all watchlist symbols plus the Sectors & ETFs catalog, deduplicated. A model dropdown selects the model; the page shows its fit distribution, a sample chart (the best-fit symbol by default; any row can be shown) and a sortable fit list with list, symbol, tier and today's-signal filters. Fit tiers follow each model's own evidence status (High = positive status; Moderate = inconclusive with fit score ≥ 1 and a positive event mean; Contrary = negative; Insufficient = below the sample gates). The two touch models (EMA200, SMA50) also record support breakdowns: a close below the zone's lower edge (prior line × 0.97 / × 0.98) during the touch session or the next 20 that has not closed back at the line when that window ends. Returns still enter at the next open, so a gap through support can show a gain from the lower entry; the breakdown rate records that the line did not hold. For touch models, High also requires at most `MAX_BREAKDOWN_RATE` (25%) breakdowns, otherwise a significant result is shown as Moderate. Breakdown events are red dots on the charts and are listed in Dig Deep's event tables. Fit score = primary-horizon advantage ÷ bootstrap standard error (95% interval width ÷ 3.92). The page states how many High results chance alone would produce at a 95% interval. The scan is a background job in `server/research/modelScan.ts` (4 concurrent history requests, one 429 retry, 5-year bars with the 1-year fallback) and is saved as `model-scan.json` in `RESEARCH_DATA_DIR`, with each symbol's latest 252-session chart served by `GET /api/models/charts/:symbol`. Viewing is public. Starting a scan (`POST /api/models/scan`) uses the research IP allowlist, runs one job at a time, and is limited to 4 starts/hour and 12/day. The first scan starts automatically when an allowed IP opens the page and no current scan exists; later rescans are manual, and the previous results remain visible while a rescan runs or after it fails. Saved scans with a different `MODEL_SCAN_VERSION` or `QUANT_MODELS_VERSION` are ignored, so bump `MODEL_SCAN_VERSION` in `shared/research.ts` when the universe, fit definition or stored shape changes.
- Runtime configuration is read from `/etc/msite/msite.env` by the existing deployment. Configure model variables there when ready, then restart the service. Never put secrets in frontend code, Git or report content.
- Reports are stored atomically in `RESEARCH_DATA_DIR` (local default `data/research`). Production binds `/var/lib/msite/research` into the container, preserving the last 100 reports across deployment. In-flight jobs interrupted by a restart are marked failed and can be retried. This job runner is intended for the current single-instance deployment; multiple replicas need a shared job queue/store.
- Research execution (`POST /api/research`, including all module refreshes) is restricted to the exact `RESEARCH_ALLOWED_IPS` list. Production currently allows only `70.111.76.119`; missing configuration denies all runs. `GET /api/research/access` reports the visitor’s permission and detected IP. Viewing saved reports remains public. The UI disables execution for unauthorized visitors; the backend enforces it independently.
- Caddy is the sole public proxy; Docker publishes the app only on `127.0.0.1:8787`. Deployment discovers the Docker bridge gateway and sets it as the sole `RESEARCH_TRUSTED_PROXY_IPS` entry. Only that peer may supply a single `X-Forwarded-For` address. Other peers’ headers are ignored; missing, malformed or multi-hop headers from the trusted proxy fail closed. Caddy must retain its default behavior of replacing untrusted incoming forwarding headers. Public smoke tests check that spoofed headers do not change authorization. If adding a CDN or another proxy, update and verify this trust boundary first.
- The research API has a global limit of two concurrent jobs, 12 new runs/hour and 60/day, persisted through report history. Identical runs are coalesced for 60 seconds. Saved market research is visible to all site visitors. Dig Deep research is never started automatically or on a schedule; the Quant System's scheduled jobs (below) are separate and have their own limits.

Official interface references: [OpenAI Responses quickstart](https://developers.openai.com/api/docs/quickstart), [Massive financial ratios](https://massive.com/docs/rest/stocks/fundamentals/ratios), [income statements](https://massive.com/docs/rest/stocks/fundamentals/income-statements), [news](https://massive.com/docs/rest/stocks/news).

## Quant System

Analytics → Quant System (量化系统) runs one pre-registered, volatility-targeted portfolio system and produces daily signals, forward paper trading, a weekly backtest report and email alerts. The design is `docs/superpowers/specs/2026-10-08-afts-quant-system-design.md`; the engine is in `server/strategy/`, API types in `shared/strategy.ts`, the rule catalog in `shared/strategyRules.ts`, and every tunable in `config/strategy.yaml` (validated by `server/strategy/config.ts`).

- **Source and why.** Robert Carver, *Advanced Futures Trading Strategies* (Harriman House, 2023; "AFTS"), the newest complete book in his Systematic Trading (2015) → Leveraged Trading (2019) → AFTS line; his unleveraged shares/ETF book (due 1 Dec 2026) is not yet available. AFTS specifies every stage (continuous forecasts, scaling, combination, vol targeting, diversification multipliers, buffering, cost-based rule selection, risk overlay) with published constants, so nothing is fitted to this site's data. Constants were cross-checked against Carver's pysystemtrade (`rob_system` config) and the book's chapter code. The futures system is adapted to long-only daily US stock/ETF bars in a cash account. It replaces choosing per-symbol "fit" models, which is a multiple-testing trap.
- **Rules and weights** (percent of the combined forecast before redistribution; scalars are the book's published values unless pooled). Absolute trend **45%**: EWMAC 8/32, 16/64, 32/128, 64/256 (5% each; Strategies 7–9), breakout 40/80/160/320 (5% each; Strategy 21), acceleration 32/64 (2.5% each; Strategy 23). Sector trend **25%**: assettrend 16/32/64 on the class index of median vol-normalised returns, broadcast to members (8.33% each; Strategy 18). Relative momentum **20%**: relmom 40/80, the symbol's cumulative normalised return against its class index (10% each; Strategy 19; relmom20 is excluded for short-term reversal). Trend-gated mean reversion **10%**: mr5 (EWMA com 5) and mr20 (SMA20, the Bollinger successor), each zeroed when its sign disagrees with EWMAC 16/64 (5% each; Strategies 26–27). mr20 has no published scalar: it uses a pooled expanding scalar, 10 ÷ the mean daily cross-sectional median |raw|, available after 256 dates and never backfilled.
- **Framework.** *Vol* (Strategy 3, one estimator everywhere): EW std of daily returns (span 32) × 16, blended 70% current / 30% long-run mean (≤ 2,560 sessions), floored at 5%. *Scaling*: raw × scalar, capped at ±20 (target average |f| = 10); a rule votes only after its warm-up. *Combination*: weights of unavailable rules (warm-up, missing, cost-filtered) are redistributed within the family first, then across families. FDM = min(2.5, 1/√(wᵀHw)), with H the pooled weekly forecast correlation (negatives floored at 0, refit monthly), smoothed with an EWMA of span 125. The combined forecast is capped at ±20. *Sizing* (Strategies 4/7): instrument weights are equal across classes with an eligible symbol, then rows, then symbols, recomputed every session. IDM = min(2.5, 1/√(wᵀHw)) from span-25-week EW correlations of weekly normalised returns (missing pairs 0.99, refit monthly, smoothed span 125). Average weight = IDM·w·τ/σ, target = average × forecast/10, capped per name. *Overlay* (Part Six): all targets are scaled by m ≤ 1 so that gross ≤ 1, normal risk ≤ 1.75τ, correlation-shock risk ≤ 4τ and jump risk ≤ 4τ; the binding limit is recorded. *Buffering* (Strategy 8): trade only outside target ± 10% of the average position, to the band edge; trades under $25 are skipped. *Costs*: one-way tier by 60-session median dollar volume (≥ $500M 3 bps, ≥ $100M 5, ≥ $10M 10, else 30) plus the SEC fee on sells. *Speed limits* (Strategy 9): a rule is dropped for a symbol for the month when cost-in-SR × its pooled turnover > 0.15; a symbol whose cost exceeds 0.01 SR per trade is ineligible. Eligibility also needs a bar that day, 256 valid vol values and fewer than 5 zero returns in the last 10 sessions; each ineligible symbol shows a reason. *Long-only deviation*: AFTS trades both ways; here a negative combined forecast is floored at 0 only at sizing (never before combination), so a bearish forecast means a full exit, not a short. `long_short` is reported as a variant.
- **Books and classes.** `stocks`: every watchlist symbol (226) in 12 classes. A symbol's class is the first list in YAML order other than `close-watch`; overrides map ETN, XYL and EQPT to industrials-defense and TECK to energy. A symbol that is only on `close-watch` and has no override (for example one added there at runtime) has no class and is left out of the book. Rows within a class follow that list's rows, plus `other` for override symbols. Risk target τ = 20%, at most 10% per name, $100,000. `sectors`: the 11 SPDR sector ETFs as one class, τ = 15%, at most 25% per name, $100,000. SPY, QQQ, IWM and the industry/theme ETFs are not traded. SPY is the benchmark, and its completed sessions are the master calendar. Risk targets were set once (expected gross about 0.8–1.0 at the average long-only forecast) and are never re-tuned on results.
- **Legacy event studies.** The four My Quant models (EMA200, SMA50, RSI(2), Bollinger) stay unchanged on Models and in Dig Deep as research diagnostics, with **weight 0** in the system: binary, sparse events break forecast scaling and the FDM. Their information is carried by slow trend and by mr5/mr20. They count as four trials in the deflated Sharpe.
- **Backtest** (`server/strategy/backtest.ts`, `stats.ts`, `ruleCurves.ts`). *Variants*: `core` (live), `long_short`, `trend_filter` (Strategy 5: 10 when EWMA64 ≥ EWMA256, else 0), `vol_attenuation` (Strategy 13), `whole_shares` (lot 1), and `without_<family>` × 4. *Benchmarks*: `spy_buy_hold`; `equal_weight_buy_hold` (monthly rebalance, same costs); `risk_parity_buy_hold` (constant forecast 10 through the same sizing, overlay and execution; Strategy 4). Alpha is judged against risk parity. *Statistics* follow Carver: mean × 256, std × 16, rf = 0. They cover Sharpe and its standard error, Sortino, max/average drawdown, Calmar, monthly skew, tail ratios, hit rate, turnover, annual cost and cost Sharpe, average gross, overlay binding share, alpha/beta against risk parity and SPY, and calendar-year returns. *Tests*: Sharpe differences of core against each benchmark use a paired 42-session block bootstrap 95% interval (1,000 resamples) plus the Jobson–Korkie/Memmel z. *Family admission* is core − `without_<family>`: adds / neutral / detracts by the interval, insufficient under 252 sessions. Admission is reported only and never changes live weights. The **deflated Sharpe** (Bailey & López de Prado) and **PBO** via CSCV (10 blocks, 252 splits) are **not from AFTS**. The trial count is the distinct (book, variant, config hash) entries in the persistent trial log plus the four legacy studies. Reports also carry rule diagnostics, class and symbol attribution, data quality and warnings (`forecast_scale`, `cost_budget`, `short_window`, `data_failures`, `price_jumps`, `family_detracts`).
- **Evaluation window and execution.** Bars are up to five years, completed and split-adjusted (shared fetcher `server/research/barFetch.ts`: one 429 retry, 1-year fallback). Warm-ups run up to 320 sessions (breakout 320, acceleration 64) and vol needs 256. The evaluation starts at the first session ≥ 320 where ≥ 80% of the book's symbols with bars are eligible; equity is flat before that. Decisions are made after the close; orders fill at the next open (sells first, buys scaled to available cash, one session's wait for a missing bar, then cancelled). Positions are sized on current equity, so returns compound; idle cash earns 0. A one-session move above +300% or below −80% is treated as a different security (Polygon splices pre-rename listings into META before 2022-06-09, COHR before 2022-09-08 and CORZ before 2024-01-24), so history before it is dropped and reported under data quality.
- **Disclosures.** *Survivorship*: the universe is today's curated list, so history includes only names that are on the site now. Every report shows `equal_weight_buy_hold` (about 38%/year price return over 2023–2026) and judges alpha against `risk_parity_buy_hold`. *Price only*: split-adjusted closes without dividends understate total return, most for income-heavy names and sector ETFs. Nothing here is investment advice.
- **Schedule.** Only `server/index.ts` creates the scheduler, and only when `STRATEGY_SCHEDULER=on` (set by `deploy.yml`; never in tests or `npm run dev` unless exported). It ticks every 60 s in America/New_York. The **daily run at 07:00 ET** processes the previous, now final, session and emits orders for the next open. It retries every 30 minutes until 12:00, then records a failure and sends at most one failure email that day. A scheduled run in which any book symbol fails to fetch counts as failed and retries, because dropping a symbol reweights its classmates; only when the next retry would fall at or after 12:00 does it proceed without those symbols. A symbol with no usable history does not trigger retries. Manual runs always proceed, and the run message names the unavailable symbols. A day with no new SPY session is recorded as skipped and sends nothing, unless `latest.json` or a book's charts are missing or from another engine version; those are then rebuilt without trading or email. The **weekly backtest runs Saturday 09:00 ET** and catches up after downtime. It has three attempts per weekly slot; after the third failure, a failure email names the next slot. Times, retries and email switches live in `config/strategy.yaml` (`schedule`, `email`).
- **Paper trading.** Each book has a ledger that starts with its capital in cash at the first run's newest session. A ledger is only created by a run before the next session's 09:30 New York open, so its first orders are published before they fill. A catch-up run later in the day (for example right after a deploy) is recorded as skipped with `INCEPTION_WAITS_FOR_PRE_OPEN`, and the next 07:00 ET run starts the ledger. Each run replays every session after the ledger's last one with the same `server/strategy/execution.ts` rules as the backtest. Held symbols are first checked for splits: a stored close vs refetched close outside ±0.5% rescales shares and average cost and logs a `split` event. Each pending order stores its decision-session close and is rescaled the same way, held or not. Then pending orders fill at the open, positions are marked at the close, and orders are decided. Orders decided at the newest session are the signals: entry, add, trim or exit, with the top three non-zero rule drivers. Missed intermediate sessions fill silently. A book symbol missing from one run's data (for example a failed fetch) is held at its last mark, not sold. A pending order for it waits one session for a bar and is then cancelled. A held symbol with no bar for 10 sessions (halted or delisted while still listed) exits at its last close. Symbols removed from the book exit with reason `removed`. Shares are fractional (0.0001). A parity test checks that replaying a ledger reproduces the simulator's fills, holdings and equity. Ledgers are append-only, never recomputed from history, and survive config and engine changes with a `config` event.
- **Storage.** Files live under `RESEARCH_DATA_DIR/strategy/` (production `/var/lib/msite/research/strategy`), written atomically with mode 0600; a missing or corrupt file counts as empty. They are `scheduler.json`, `latest.json`, `charts-<book>.json` (latest 252 sessions), `signals.json` (newest 5,000), `paper-<book>.json`, `reports/index.json` with `reports/<id>.json` (newest 26), `outbox.json` (newest 200, no addresses) and `trials.json`. A daily run writes in this order: signals, charts, `latest.json`, the digest, and the paper ledgers last. A run interrupted before its ledgers are saved replays the same sessions on retry. The signal log dedupes the repeated signal ids, so at worst the digest is sent twice. A book whose ledger was already saved keeps its logged signals and is left out of the retry's digest.
- **API** (`server/routes/strategyRoutes.ts`, `Cache-Control: no-store`). Public: `GET /api/strategy/state`, `/latest` (404 `STRATEGY_NOT_RUN` before the first run), `/charts/:book/:symbol`, `/signals?limit=&book=` (≤ 1,000, newest first; `book` filters the whole log), `/paper/:book` (fills trimmed to 500), `/reports`, `/reports/:id`, `/outbox`. `latest.json` and the charts are parsed once per process and replaced in memory when a run writes them. Gated by the research IP allowlist (`RESEARCH_ALLOWED_IPS`): `POST /api/strategy/run` with `{"job":"daily"|"backtest"}` (one job at a time, 6/hour and 24/day) and `POST /api/strategy/test-email` with `{}` (1 per 10 minutes). Both POSTs need `Content-Type: application/json`, which forces a CORS preflight on cross-site callers. Both also refuse `Sec-Fetch-Site: cross-site` and an `Origin` whose host differs from `Host`, so the IP gate cannot be used from another site through the owner's browser. Errors are `403 RESEARCH_IP_FORBIDDEN`, `403 CROSS_SITE_REQUEST`, `415 UNSUPPORTED_MEDIA_TYPE`, `409 STRATEGY_BUSY` and `429 STRATEGY_RUN_LIMIT`. The page shows Run daily, Run backtest and Send test email only to allowed IPs.
- **Versioning.** Bump `STRATEGY_ENGINE_VERSION` in `shared/strategy.ts` when any rule, sizing, execution rule or stored shape changes. Stored files with another version are ignored and rebuilt on the next run, except paper ledgers, which continue with a `config` event. The config hash covers the engine version, signal-relevant YAML, the rule catalog and book classes (not `schedule` or `email`). It is shown on reports, ledgers and emails, so YAML changes are visible without a bump. Any change made after seeing results is a new trial and raises the deflated-Sharpe hurdle.

### Email

Recipient addresses and credentials never appear in plaintext in Git, `config/strategy.yaml` or API responses; the API reports only whether email is configured and which transport is used. Runtime settings go in `/etc/msite/msite.env` on the instance (`aws ssm start-session --target i-0fa217e019960b606`). Docker's `--env-file` takes values literally: do not add quotes.

| Variable | Meaning |
|---|---|
| `MAIL_TRANSPORT` | `ses` (instance role) or `smtp`; unset disables sending, and messages are still logged to the outbox as `disabled` |
| `ALERT_EMAIL_TO` | Comma-separated recipients |
| `SMTP_URL` | SMTP transport only, for example `smtps://user%40gmail.com:APP_PASSWORD@smtp.gmail.com:465` |
| `MAIL_FROM` | Default `msite signals <signals@finance.nphunter.net>`; with SES the address must stay `signals@finance.nphunter.net` |
| `PUBLIC_BASE_URL` | Link target in emails; default `https://finance.nphunter.net` |

`deploy.yml` already passes `AWS_REGION=us-east-1` and `STRATEGY_SCHEDULER=on`. Emails are Chinese by default (`email.locale`; tickers and numbers in English). The signal digest (`[量化信号] 2026-10-07 · 个股组合 3 / 板块 ETF 组合 1`) is sent when any book has signals. The weekly report, failure alerts and test messages are the other kinds. Each states the config hash, that returns are split-adjusted price returns, and that it is not investment advice.

SES setup (one-time):

1. Store the recipient as an encrypted Pulumi secret and apply the stack. This creates the `finance.nphunter.net` identity, its three Easy DKIM CNAMEs in the `nphunter.net` zone, a recipient identity for the SES sandbox, and an EC2-role policy allowing `ses:SendEmail`/`ses:SendRawEmail` only from `signals@finance.nphunter.net`. The secret is stored as `secure:` ciphertext in `infra/Pulumi.prod.yaml`. Keep that line (committed or local): a later `pulumi up` without it deletes the recipient identity.

   ```bash
   cd infra
   pulumi stack select prod
   pulumi config set --secret alertEmailRecipient you@example.com
   pulumi up
   ```

2. Click the verification link that AWS sends to the recipient. Wait for DKIM: `aws sesv2 get-email-identity --email-identity finance.nphunter.net --query 'DkimAttributes.Status'` should return `SUCCESS` (the `mailDkimStatus` stack output only changes on the next `pulumi refresh` followed by `pulumi up`).
3. Keep the sandbox or request production access. The sandbox delivers only to verified addresses (200 messages/day), which is enough for one recipient. To send to unverified recipients, request production access in the SES console (us-east-1 → Account dashboard → Request production access; mail type Transactional, website `https://finance.nphunter.net`). Check the result with `aws sesv2 get-account --query ProductionAccessEnabled`.
4. Let the container reach instance-role credentials. With IMDSv2, the Docker bridge adds a network hop, so the metadata hop limit must be at least 2:

   ```bash
   aws ec2 describe-instances --instance-ids i-0fa217e019960b606 \
     --query 'Reservations[].Instances[].MetadataOptions'
   # If HttpPutResponseHopLimit is 1:
   aws ec2 modify-instance-metadata-options --instance-id i-0fa217e019960b606 \
     --http-put-response-hop-limit 2 --http-tokens required --http-endpoint enabled
   ```

5. Add `MAIL_TRANSPORT=ses` and `ALERT_EMAIL_TO=you@example.com` to `/etc/msite/msite.env`, run `sudo systemctl restart msite.service`, then use Send test email from an allowed IP and check the outbox log on the Signals tab.

SMTP alternative (no Pulumi or IMDS changes): set `MAIL_TRANSPORT=smtp`, `ALERT_EMAIL_TO` and `SMTP_URL`. For Gmail, use an app password (it requires 2-Step Verification) and URL-encode the `@` in the username as `%40`. Set `MAIL_FROM` to the Gmail address, because Gmail rewrites other senders. Then restart `msite.service` and send a test email.
