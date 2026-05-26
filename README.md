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
