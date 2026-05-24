# Stock Workbench

Stock Workbench is a local Vite React and Express app for watching stock lists from YAML config, pausing collapsed rows, viewing quote tables and charts, and creating watchlists from recommended candidates.

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

In production, set `APP_ADMIN_TOKEN`. Config write routes require the `x-admin-token` header outside development and test.

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
- Runtime: Node.js 22 with systemd `msite.service`
- Public proxy/TLS: Caddy on ports `80` and `443`
- Runtime secrets: SSM SecureString parameters under `/msite/finance/`
- Release artifact: private S3 bucket `msite-finance-deploy-612153676415-us-east-1`

Wave-theory analysis remains documented in the MVP spec and is not implemented in this MVP.
