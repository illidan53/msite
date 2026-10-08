# Quant System (Carver AFTS) — Design

Date: 2026-10-08. Status: approved for implementation.

## 1. Goal and source

Replace the site's per-symbol "fit" selection of four pullback event studies with one coherent, pre-registered portfolio system, based on Robert Carver, *Advanced Futures Trading Strategies* (Harriman House, April 2023, 1st and only edition; abbreviated **AFTS**).

AFTS is the most recent full systematic-trading book in Carver's line. The line runs Systematic Trading (2015) → Leveraged Trading (2019) → AFTS (2023); his unleveraged shares/ETF book is due 1 Dec 2026 and is not yet available.

The book's constants were cross-checked against Carver's open-source reference code, pysystemtrade (`systems/provided/rob_system/config.yaml`), and against the book's own chapter code.

The pipeline:

1. Each rule produces a continuous forecast.
2. Forecasts are scaled to an average |f| of 10 and capped at ±20.
3. Forecasts are combined with handcrafted weights and the forecast diversification multiplier (FDM).
4. Positions are volatility-targeted with the instrument diversification multiplier (IDM).
5. Trading is buffered.
6. Rules are selected by cost (speed limits).
7. Results are evaluated against vol-scaled buy-and-hold benchmarks.

On top of the system we build four things:

- A historical portfolio simulation with variants and statistical tests.
- Forward paper trading.
- A daily signal run and a weekly backtest report, both scheduled.
- Email alerts.

Research notes live in the gitignored `data/afts-research/`: per-topic formulas in `spec/T1..T8`, critic corrections in `spec/critique.json`, the book code in `afts/` and cached bars in `bars/`. Where this spec and those notes differ, **this spec wins**.

The existing four event studies (EMA200, SMA50, RSI(2), Bollinger) stay unchanged as research diagnostics on Analytics → Models and in Dig Deep. They carry **weight 0**: binary, sparse event rules break forecast scaling and the FDM. Their information survives as slow trend (EMA200/SMA50) and as trend-gated mean reversion (RSI(2)/Bollinger → `mr5`/`mr20`).

## 2. Data

- **Bars.** Every symbol's 5-year daily bars use `getHistory` with the existing one-retry-on-429 and 1-year-fallback logic, then `closedBars`. That fetch logic is extracted from `ModelScanService.bars` into `server/research/barFetch.ts` so the scan and the strategy share it. Prices are split-adjusted and price-only; there are no dividends.
- **Calendar.** The master calendar is the completed sessions of the benchmark `SPY`. Bars on dates outside it are dropped. A symbol missing a master date gets NaN on that date.
- **Session finality.** `closedBars` excludes the current New York date. The daily job therefore runs in the morning (07:00 ET), when the previous session is final. Its orders are for that day's open.
- **Universe.** Books come from `config/strategy.yaml` (see `server/strategy/config.ts` `resolveBooks`):
  - **stocks**: every watchlist symbol (226). Its class is the first list in YAML order that is not `close-watch`, unless overridden. Overrides: ETN, XYL and EQPT → industrials-defense; TECK → energy. This gives 12 classes. Rows inside a class come from that list's rows, plus an `other` row for override symbols.
  - **sectors**: the 11 SPDR sector ETFs, as one class.
  - SPY, QQQ, IWM and the industry/theme ETFs are not traded. SPY is the benchmark.
- **Survivorship.** The universe is today's curated list. Every report must show `equal_weight_buy_hold` and judge alpha against `risk_parity_buy_hold`. The UI states this bias explicitly. The 2023–2026 equal-weight price return was about 38% a year.

## 3. Engine (pure functions, `server/strategy/`)

All series are `Float64Array` aligned to `Panel.dates`, with NaN meaning "no value". Per-symbol computations run on the symbol's own valid sessions: the dates where it has a bar, in order. Results are written back to master positions. EWMAs follow **pandas `adjust=True`** semantics:

- weights are `(1-α)^age`;
- with `ignore_na=False`, time decay continues through NaN inputs;
- NaN inputs do not add an observation;
- the output at a NaN input position carries the previous mean.

`span s` means `α = 2/(s+1)` and `com c` means `α = 1/(1+c)`. EW std is the pandas bias-corrected `ewm(...).std()`.

### 3.1 Volatility (AFTS Strategy 3, one estimator everywhere)

- `r_t = C_t / C_{t-1} - 1` on the symbol's own sessions.
- `s_t = ewm(span=32, min_periods=10).std(r)`.
- `σ_t = 16·s_t`, the annualised fraction.
- `L_t = mean(σ_{t-k})` over the last ≤ 2560 valid σ values, including t.
- `σ_b,t = max(0.3·L_t + 0.7·σ_t, 0.05)`.
- `σ_p,t = C_t·σ_b,t / 16` is the daily price-unit volatility.
- **Eligibility** requires ≥ `eligibilitySessions` (256) valid σ values.
- **Normalised return** (Strategies 17–19): `z_t = r_t / (σ_b,{t-1}/16)`, clipped to ±6. Note σ is lagged one session.

### 3.2 Rules — catalog in `shared/strategyRules.ts`

Raw forecasts are computed first. The scaled forecast is `f = clip(scalar·raw, ±20)`. A rule votes only when the symbol has ≥ `warmup` own sessions and `f` is finite.

| id | raw | scalar | weight | notes |
|---|---|---|---|---|
| ewmac{8,16,32,64} | `(EWMA_L(C) − EWMA_4L(C)) / σ_p` | 5.95 / 4.10 / 2.79 / 1.91 | 5% each | Strategies 7–9 |
| breakout{40,80,160,320} | `H, L` = rolling max/min of the last N closes, including t, min_periods 1. `raw = 40·(C − (H+L)/2)/(H−L)`, NaN if H = L, then smoothed by EWMA with span N/4 | 0.70 / 0.73 / 0.74 / 0.74 | 5% each | Strategy 21. The scalar is applied after smoothing |
| accel{32,64} | `F̃_L = scalar_ewmacL·raw_ewmacL` (uncapped); `raw = F̃_L,t − F̃_L,t−L` | 1.98 / 2.05 | 2.5% each | Strategy 23. t−L is in own sessions |
| assettrend{16,32,64} | see the class index below. `raw = (EWMA_L(A) − EWMA_4L(A)) / v`, where v is the robust vol of ΔA | 3.55 / 2.34 / 1.55 | 8.33% each | Strategy 18. Broadcast to class members |
| relmom{40,80} | `O = N_i − A^{class}` (forward-filled on master dates; exact zeros → NaN). `M_t = (O_t − O_{t−H})/H`, then EWMA with span H/4 | 117.78 / 159.88 | 10% each | Strategy 19. relmom20 is dropped because of short-term reversal |
| mr5 | `E = ewm(com=5).mean(C)`; `raw = (E − C)/σ_p` | 9.3 | 5% | Strategy 26, made safe by Strategy 27 |
| mr20 | `E = SMA20(C)`; `raw = (E − C)/σ_p` | pooled | 5% | Bollinger successor |

**Trend gate for mr5 and mr20** (Strategy 27): `raw = 0` when `sign(raw) ≠ sign(raw_ewmac16)`. When `raw_ewmac16` is NaN, raw is NaN.

**Class index** (assettrend, relmom), computed on master dates:
- `Z^C_t` = the median of `z_i,t` over class members with a finite z that day. It is NaN when fewer than 5 members have one; for a class with fewer than 5 members in total, use every member, requiring at least 1.
- `A^C = cumsum(Z^C)`, with NaN treated as 0 once the index has started.
- `N_i = cumsum(z_i)` over the symbol's own sessions.
- Robust vol `v`: EW std of ΔA with span 35 and min 10, floored at its trailing 500-session 5% quantile (min 100 observations), then forward-filled.

**Pooled scalar** (mr20, and the diagnostics for every rule):
- On each date t, take `m_t` = the cross-sectional median of |raw| over symbols with finite raw, counting only nonzero values.
- `scalar_t = 10 / mean(m_{≤t})`.
- It is available once 256 dates have a value; before that the scalar is NaN, so the rule does not vote.
- There is no backfill: the scalar at t uses data up to t only.

### 3.3 Forecast turnover and the speed limit (AFTS Strategy 9)

- **Pooled expanding rule turnover:** `T_j,t = 256 · mean|Δf_j|/10`, using the signed capped forecasts of every symbol, NaN diffs dropped, over sessions ≤ t.
- **Per-symbol cost in SR units:**
  - `c_SR,i,t = (costBps_i,t / 1e4) / median(σ_b,i over the trailing 252 sessions)`;
  - `costBps` is the tier from the trailing 60-session median dollar volume.
- **Rule test**, re-evaluated on the first session of each month and held for the month:
  - the rule passes if `c_SR × T_j ≤ ruleCostLimitSharpe` (0.15);
  - a rule whose T is still NaN passes.
- **Instrument test:** the symbol is ineligible (reason `cost`) when `c_SR > instrumentCostLimitSharpe` (0.01).

### 3.4 Combination (AFTS Strategies 9/11)

- **Effective weights** `w_j` for symbol i at t start from `baseWeights` (catalog, or EngineOptions overrides). Rules that are unavailable (warm-up, NaN, cost-filtered) get 0. Their weight is redistributed:
  - first pro rata within the family, among the family's available rules;
  - if a whole family is unavailable, its weight is spread pro rata across the available families.
  - Weights then sum to 1. If nothing is available, the combined forecast is NaN.
- **Forecast correlation** H for the FDM:
  - Correlation of signed capped forecasts sampled on the last session of each ISO week, pooled across all book symbols (rows are symbol-weeks with both values finite).
  - Equal-weighted over all weeks before the refit date, with at least 20 weeks of pooled rows. Negative values are floored at 0.
  - Refit on the first session of each month, using weeks that ended before that session.
- **FDM:** `FDM_i,t = min(cap, 1/sqrt(wᵀHw))`, smoothed per symbol with EWMA span 125 over its own sessions. Before the first fit it is 1.
- **Combined forecast:** `F = clip(FDM·Σ w_j f_j, ±forecastCap)`.
- **Long-only floor:** `max(0, F)` is applied only in sizing, never before combination.
- **Vol attenuation** (variant `vol_attenuation`; AFTS Strategy 13):
  - `V = σ_b / mean(σ_b over the last ≤ 2500 own sessions)`.
  - `Q_t` = the share of earlier valid V values below `V_t`.
  - `M = EWMA_span10(2 − 1.5Q)`. M is 1 until 256 V values exist.
  - Multiply the raw forecasts of ewmac, breakout, assettrend and relmom by M before scaling.
- **Strategy 5 filter:** `trendFilter = 10` when `EWMA64(C) ≥ EWMA256(C)`, else 0. Needs ≥ 256 own sessions.

**Eligibility** at t requires every one of:
- a bar at t;
- ≥ 256 valid σ values;
- fewer than 5 zero returns in the last 10 sessions;
- passing the instrument cost test.

Each ineligible symbol records a reason code.

## 4. Portfolio (AFTS Strategies 4, 7 and Part Six)

- **Instrument weights** (handcrafted, top-down): equal across classes with ≥ 1 eligible symbol, then equal across rows, then equal across symbols. Recomputed every session over eligible symbols only.
- **IDM:**
  - Weekly sums (ISO weeks) of the normalised returns z.
  - EW correlation with span 25 weeks (α = 2/26, weight `(1−α)^age` by week age) over pairwise-complete weeks, requiring ≥ 20 overlapping weeks. Missing pairs count as 0.99, which is conservative. Negative values are floored at 0.
  - Refit on the first session of each month from weeks completed before it.
  - `IDM_t = min(cap, 1/sqrt(wᵀHw))` with the current instrument weights, smoothed with EWMA span 125; 1 before the first fit.
- **Sizing:**
  - Forecast `F⁺` is `max(0, F)` long-only, `F` long/short, `trendFilter` for the trend-filter variant, or the constant 10 for the risk-parity benchmark.
  - Average weight `a = IDM·w·τ/σ_b`; raw target `x = a·F⁺/10`.
  - Clip `|x| ≤ maxPositionWeight`.
- **Overlay multiplier:** `m = min(1, L_k/max(L_k, risk_k))` over four measures:
  - gross `Σ|x|` with limit `overlay.gross`;
  - normal risk `sqrt(xᵀΣx)` with limit `normalRisk·τ`, where `Σ = D H D`, H is the IDM correlation and D is diag(σ_b);
  - correlation shock `Σ|x_i|σ_i` with limit `correlationShock·τ`;
  - jump risk `sqrt(xᵀΣ_J x)` with limit `jumpRisk·τ`, where Σ_J uses each symbol's expanding 99th-percentile σ_b.
  - Final weights are `x·m` and `a·m`; record m and the binding limit.
- **Risk targets:** τ = 0.20 for stocks and 0.15 for sectors. These are chosen once so that expected gross at the long-only average forecast is about 0.8–1.0. They are never re-tuned on results.

## 5. Execution and simulation

`server/strategy/execution.ts` already defines and tests the shared semantics:

- **Decide** after the close using the equity marked at that close. Buffer at ±`buffer` × the average position and trade to the band edge. A zero target exits fully. Dust trades below `minTradeNotional` are skipped.
- **Fill** at the next open: sells first. A cash account scales buys down when cash runs short. An order with no bar waits one session, then is cancelled.
- **Costs** are tier bps plus the SEC fee on sells. **Fractional lot** is 0.0001; the `whole_shares` variant uses lot 1.

`simulate.ts` loops over sessions from `startIndex`, the evaluation start. At each session t:

1. Fill the pending orders at open t.
2. Mark to market at close t.
3. Record equity, the daily return, gross (Σ|value|/equity), costs and traded value.
4. Decide orders from `PortfolioFrame` at t. A symbol that has left the book or is ineligible gets `forced`.

Positions are sized on current equity, so returns compound. Idle cash earns 0, and this is disclosed.

**Evaluation window.** The start is the first session with index ≥ `evaluationMinSession` (320) where ≥ 80% of book symbols that have any bar by then are eligible. Equity before the start is flat at the book capital.

## 6. Backtest report (`backtest.ts`, `stats.ts`, `ruleCurves.ts`)

For each enabled book:

- **Variants** (via EngineOptions and PortfolioOptions): `core`, `long_short`, `trend_filter`, `vol_attenuation`, `whole_shares`, and `without_<family>` × 4 (that family's weights set to 0).
- **Benchmarks:**
  - `spy_buy_hold`: 100% SPY bought at the first evaluation open, never rebalanced.
  - `equal_weight_buy_hold`: equal weights over symbols eligible at each month's first session, rebalanced monthly at the open, same costs.
  - `risk_parity_buy_hold`: `constantForecast: 10` through the full sizing, overlay and execution path (AFTS Strategy 4).

**Statistics** (`PerformanceStats`; returns in %):

- Annual mean = mean daily × 256; vol = std(ddof=1) × 16; Sharpe uses rf = 0; `sharpeError = sqrt((1 + SR_d²/2)/T)·16`.
- Sortino uses the downside std of the negative days × 16. Max and average drawdown come from the compounded equity, with the high-water mark starting at 100. Calmar = CAGR ÷ max drawdown.
- Monthly skew is the pandas-G1 skew of summed calendar-month returns.
- Tail ratios: drop zero days, demean, take type-7 quantiles. `lower = (Q.01/Q.30)/4.4362`; `upper = (Q.99/Q.70)/4.4362`.
- Hit rate counts non-zero days only.
- Turnover = traded value per year ÷ average gross value. Annual cost = mean daily cost ÷ equity × 256; cost Sharpe = annual cost ÷ annual vol.
- Average gross and overlay-binding share.
- Alpha (×256), beta and correlation are daily OLS against `risk_parity_buy_hold` and against SPY.
- Yearly returns are compounded by calendar year.

**Tests:**

- Sharpe differences for `core` vs `risk_parity_buy_hold`, `core` vs `spy_buy_hold` and `core` vs `equal_weight_buy_hold`:
  - a paired 42-session block bootstrap (1000 resamples, seeded LCG as in `blockInterval`) of the annual SR difference gives the 95% interval;
  - the Jobson–Korkie/Memmel z and two-sided p use the daily SRs.
- **Family admission** (pre-registered): `core` − `without_<family>` Sharpe difference with a paired bootstrap 95% interval. The family "adds" if the interval is > 0, "detracts" if < 0, else "neutral". It is "insufficient" when < 252 evaluation sessions exist. Admission is **reported**; it never changes live weights automatically.
- **Deflated Sharpe** of `core`:
  - Trials N = the distinct (book, variant, configHash) entries in the persistent trial log, plus 4 legacy event studies.
  - ρ̄ = the mean pairwise correlation of the variants' daily returns; `N̂ = ρ̄ + (1−ρ̄)·N`.
  - V[SR] = the variance across variants of daily SRs.
  - `SR0 = sqrt(V)·((1−γ)Φ⁻¹(1−1/N̂) + γΦ⁻¹(1−1/(N̂e)))`.
  - `DSR = Φ((SR−SR0)·sqrt(T−1)/sqrt(1 − γ3·SR + (γ4−1)/4·SR²))`, using daily SRs and raw kurtosis γ4.
- **PBO** (CSCV) over the variants' daily returns: S = 10 contiguous blocks, C(10,5) = 252 splits; ω = OOS rank of the IS-best ÷ (N+1); PBO is the share of splits with logit ω ≤ 0.

**Rule diagnostics** (`ruleCurves.ts`), for each rule:

- `meanAbsForecast` (pooled realised), `turnover`, and `costPassRate` at the window end.
- Pooled rule account curve: for each symbol, `q_t = (f_t/10)·(0.2/σ_b,t)` (the signed fraction). The next session's return contribution is `q_t·(C_{t+1}/C_t − 1) − |Δq|·costBps/1e4`. Average over eligible symbols each day, then take the Sharpe. The long-only version uses `max(0, q)`.
- `correlationToTrend`: pooled weekly correlation with the mean of the four ewmac forecasts.

**Attribution:**
- **Per symbol:** summed daily P&L ÷ capital, average weight and trades, for `core`.
- **Per class:** the per-symbol figures summed by class.

**Warnings:**
- `forecast_scale`: any rule's mean |f| is outside 7–13.
- `cost_budget`: core cost Sharpe > core Sharpe / 3.
- `short_window`: < 504 evaluation sessions.
- `data_failures`, `price_jumps` (|r| > 40%).
- `family_detracts`.

**Size.** Curves are rounded to 2 decimals and daily. The report is stored under `strategy/reports/<id>.json` (newest 26 kept), plus `index.json` with summaries.

## 7. Daily signals and paper trading

`StrategyService.runDaily(trigger)`:

1. **Detect a new session.** Fetch SPY. If its latest completed session ≤ every book ledger's `lastSession`, record a `skipped` run and stop. No email.
2. **Fetch and compute.** Fetch all book symbols and build the panel. Compute `core` (system → portfolio) for each book.
3. **Replay the paper ledger** (`paper.ts`). It is created on the first run with `capital` in cash and `inception` = the newest session. For each session s after `lastSession`, up to the newest:
   1. Detect splits for held symbols: compare the ledger's stored close for `lastDate` with the newly fetched close for that date. A ratio outside 1 ± 0.5% rescales shares and average cost, and logs a `split` event.
   2. Fill the pending orders at open s, using execution.ts.
   3. Mark to market at close s.
   4. Decide orders at close s from that session's PortfolioFrame row. Book symbols missing from the frame, and symbols no longer in the book, are `forced` out with reason `removed`/`ineligible`.
   5. Orders decided at the newest session become **the signals**. Orders decided at intermediate replayed sessions fill silently; they are missed runs.
   
   The ledger keeps equity history with the SPY close, fills (newest 5000) and events. Ledger state is never recomputed from history.
4. **Build signals.** Signal action is: entry (0 → >0), exit (→ 0), add or trim. Drivers are the top 3 by |FDM·w·f|. Append to `signals.json` (newest 5000), keeping fill and cancel results updated on later runs.
5. **Write outputs.** Write `latest.json` (LatestSnapshot), and `charts-<book>.json` with each symbol's latest 252 sessions.
6. **Email.** Send the signal digest when any book has signals, or when `sendWhenNoSignals` is set. Mark the records emailed.

`runBacktest(trigger)`: fetch, run all variants and benchmarks, save the report, append the trial log, and email the weekly report (when `weeklyReport`).

**Jobs.** One job at a time. Manual runs are IP-gated (`researchAccess`) and limited to 6/hour and 24/day.

## 8. Scheduler (`scheduler.ts`)

The scheduler is created only from `server/index.ts` when `STRATEGY_SCHEDULER=on`. It never runs in createApp, tests or `npm run dev` unless that variable is set. It takes an injectable clock and timer, ticks every 60s, and exposes `stop()`.

- **Daily:** due when NY time ≥ `dailyAt` and no daily attempt has been recorded for today's NY date. On failure, it retries every `dailyRetryMinutes` until `dailyGiveUpAt`, then records failed and sends a failure email (at most 1 per day).
- **Weekly:** due when the last completed backtest is older than the most recent `weeklyDay` `weeklyAt` (NY). That rule also catches up after downtime.
- **State:** `strategy/scheduler.json` holds the last daily and backtest RunRecords and the attempt dates. It is written atomically.

## 9. Email (`mailer.ts`, `emails.ts`)

Transports are selected by environment only. Recipients and credentials are **never** in the repo or the API.

- `MAIL_TRANSPORT=ses`: nodemailer SES transport using `@aws-sdk/client-sesv2` with the instance-role credentials (`AWS_REGION`, default us-east-1).
- `MAIL_TRANSPORT=smtp` with `SMTP_URL`.
- Unset: disabled. Messages are still rendered and logged to the outbox with status `disabled`.
- `ALERT_EMAIL_TO` is a comma-separated recipient list. `MAIL_FROM` defaults to `msite signals <signals@finance.nphunter.net>`. `PUBLIC_BASE_URL` defaults to `https://finance.nphunter.net`.

Every send is recorded in `strategy/outbox.json` (newest 200) without addresses. Kinds are `signals`, `report`, `failure` and `test`.

Messages are plain text + HTML in `email.locale` (zh by default; English tickers and numbers). Each states that it is not investment advice, that prices are split-adjusted price returns, and the config hash.

- **Signal digest** subject: `[量化信号] 2026-10-07 · 个股 3 / 板块 1`. Per book it gives:
  - a table of action, symbol, class, shares (to 4 dp), approximate notional at the last close, weight from → to, forecast and drivers;
  - the paper summary;
  - a link to the Quant System page.
- **Weekly report:** core vs benchmarks Sharpe, CAGR and max drawdown per book, family admission, warnings and a link.
- **Failure:** the job, the message and the next retry.
- **Test:** a configuration check.

`POST /api/strategy/test-email` is IP-gated, 1 per 10 minutes.

## 10. Storage

Everything lives under `RESEARCH_DATA_DIR/strategy/`. Files are written atomically (tmp + rename, mode 0600). A missing or corrupt file counts as empty. Files carrying a different `STRATEGY_ENGINE_VERSION` are ignored, **except paper ledgers**: those are append-only forward records, kept across versions with a `config` event.

Files: `scheduler.json`, `latest.json`, `charts-<book>.json`, `signals.json`, `paper-<book>.json`, `reports/index.json`, `reports/<id>.json`, `outbox.json`, `trials.json`.

## 11. HTTP API (`server/routes/strategyRoutes.ts`; responses `no-store`)

Public:
- `GET /api/strategy/state` → StrategyState
- `GET /api/strategy/latest` → LatestSnapshot | 404 `STRATEGY_NOT_RUN`
- `GET /api/strategy/charts/:book/:symbol` → SymbolChart
- `GET /api/strategy/signals?limit=` → SignalRecord[] (≤ 1000)
- `GET /api/strategy/paper/:book` → PaperLedger (fills trimmed to 500)
- `GET /api/strategy/reports` → BacktestReportSummary[]
- `GET /api/strategy/reports/:id` → BacktestReport
- `GET /api/strategy/outbox` → OutboxEntry[]

IP-gated (`403 RESEARCH_IP_FORBIDDEN`, `429 STRATEGY_RUN_LIMIT`, `409 STRATEGY_BUSY`):
- `POST /api/strategy/run {job: "daily"|"backtest"}` → 202 StrategyState
- `POST /api/strategy/test-email` → 202 OutboxEntry

## 12. UI — Analytics → Quant System (量化系统)

A new rail button sits before "Models". Its eyebrow is `ANALYTICS / QUANT SYSTEM`. The page has a book switcher (Stocks / Sector ETFs) and five tabs:

1. **Overview**
   - Status: last daily run, next runs, email configured or not.
   - KPI tiles: core Sharpe, CAGR, max drawdown and vol against risk-parity and SPY.
   - An equity-curve SVG chart: core, risk_parity_buy_hold, spy_buy_hold and equal_weight_buy_hold.
   - Paper summary, and today's signals.
2. **Signals**: the latest orders, history with fill status, and the email outbox log.
3. **Positions**
   - The current rows table: symbol, class, forecast, family bars, target and held weight. It is sortable, with class and eligibility filters.
   - Selecting a row shows the symbol chart: close, combined forecast and the target weight panel.
4. **Backtest**
   - Report picker; variants × stats table; yearly returns.
   - Tests: Sharpe differences, family admission, DSR and PBO.
   - Rule diagnostics; class and symbol attribution; data quality; warnings.
5. **Rules**
   - A bilingual catalog grouped by family: formula, scalar, weight and AFTS source.
   - The framework: vol, combination, sizing, buffer, costs and overlay.
   - A note that the four event studies remain as research on Models.

Allowed IPs see "Run daily", "Run backtest" and "Send test email" buttons. While a job runs, the page polls state every 1.5s.

The page uses `fetch` directly, lazily, like Models. It has no global badge, so e2e catch-all mocks stay clean. Every string is bilingual. Charts are hand-rolled SVG with `ChartInspection`. There is no horizontal overflow at 390px.

## 13. Infra and deploy

- **Pulumi** (`infra/index.ts`):
  - An SES v2 email identity for `finance.nphunter.net`, with Easy DKIM CNAME records in the Route53 zone `nphunter.net`.
  - An optional recipient email identity from the secret config `alertEmailRecipient`, for the SES sandbox.
  - `ses:SendEmail` and `ses:SendRawEmail` on the EC2 role, restricted to `ses:FromAddress = signals@finance.nphunter.net`.
  - Applied manually with `pulumi up`.
- **deploy.yml**: add `-e STRATEGY_SCHEDULER=on` and `-e AWS_REGION=us-east-1` to `docker run`, keeping every substring that `shared/deployWorkflow.test.ts` asserts. Recipient and transport go in `/etc/msite/msite.env`.
- **Container credentials.** For SES from the container, the instance metadata hop limit must be ≥ 2. Check with `aws ec2 describe-instances --query 'Reservations[].Instances[].MetadataOptions'`. Fix with `aws ec2 modify-instance-metadata-options --instance-id … --http-put-response-hop-limit 2 --http-tokens required`.

## 14. Verification

- **Unit tests** with hand-computed vectors and pandas golden values for EWMA/EW-std/breakout/relmom. Generate them with the research venv in the scratchpad if available; otherwise check in literal expected arrays.
- **Causality test:** appending bars never changes any past forecast, weight or target.
- **Paper/backtest parity test:** replaying N sessions through paper.ts equals `simulate()` for the same frame.
- **Scheduler** tests with a fake clock; **mailer** tests with a fake transport.
- **Route** tests with supertest.
- **UI** tests with fixtures, plus e2e mocks for `/api/strategy/**`.
- A real-data simulation on the cached bars before deploying, with results reviewed for sanity: gross, vol close to τ, mean |f|, turnover and costs.
