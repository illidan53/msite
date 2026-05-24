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

Wave-theory analysis and deployment follow-up remain documented in the MVP spec and are not implemented in this MVP.
