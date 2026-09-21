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

Watchlists are loaded from `config/watchlists.yaml`; the app does not expose watchlist creation or write APIs.

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
- Container registry: ECR repository `msite-finance`

Production infrastructure lives in `infra/` as Pulumi code. The Pulumi stack
creates the ECR repository, the GitHub Actions OIDC deploy role, and the EC2
role policy that allows the instance to pull from ECR.

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

## Stock / ETF research

Analytics → Stock / ETF provides on-demand research. Run creates a durable background job; the browser polls progress and saved reports can be reopened. Module refreshes create a new snapshot while retaining the other modules' data timestamps. AI interpretation is invalidated and regenerated whenever evidence changes.

- Quantitative calculations use completed, split-adjusted daily bars (up to five years, with a one-year fallback when access is denied). These are **price returns, not dividend-inclusive total returns**. The current New York trading day is excluded. The UI documents lookbacks, benchmark alignment and the zero risk-free-rate assumption. Missing history or zero denominators produce unavailable values.
- Profile/news data comes from Polygon / Massive. News covers up to 20 articles from the previous 30 days, with source links and publication dates. Financial statements and ratios use `/stocks/financials/v1/` endpoints and may require additional entitlement. Stocks and ETFs use separate templates. ETF holdings, NAV, expenses and AUM need an additional feed; unavailable fields are labeled explicitly. Historical valuation percentiles, ROIC, cash-flow growth, spreads and ETF tracking error are not currently calculated.
- Optional AI uses the OpenAI Responses API with server-only `OPENAI_API_KEY` **and** `OPENAI_MODEL`. Both must be configured to enable it. No model credentials are needed for quantitative/news analysis. The model receives the displayed evidence, not account information, and cannot execute tools. Responses are not stored by the API (`store: false`); the resulting report is saved locally. No AI request is retried automatically.
- Runtime configuration is read from `/etc/msite/msite.env` by the existing deployment. Configure model variables there when ready, then restart the service. Never put secrets in frontend code, Git or report content.
- Reports are stored atomically in `RESEARCH_DATA_DIR` (local default `data/research`). Production binds `/var/lib/msite/research` into the container, preserving the last 100 reports across deployment. In-flight jobs interrupted by a restart are marked failed and can be retried. This job runner is intended for the current single-instance deployment; multiple replicas need a shared job queue/store.
- The public research API has a global limit of two concurrent jobs, 12 new runs/hour and 60/day, persisted through report history. Identical runs are coalesced for 60 seconds. Saved market research is visible to all site visitors. No automatic or scheduled runs are performed.

Official interface references: [OpenAI Responses quickstart](https://developers.openai.com/api/docs/quickstart), [Massive financial ratios](https://massive.com/docs/rest/stocks/fundamentals/ratios), [income statements](https://massive.com/docs/rest/stocks/fundamentals/income-statements), [news](https://massive.com/docs/rest/stocks/news).
