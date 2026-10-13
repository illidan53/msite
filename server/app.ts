import express from "express";
import { ResearchService } from "./research/service";
import { ModelScanService, scanUniverse } from "./research/modelScan";
import { createResearchRoutes } from "./routes/researchRoutes";
import { createModelRoutes } from "./routes/modelRoutes";
import { createStrategyRoutes } from "./routes/strategyRoutes";
import { createMailer } from "./strategy/mailer";
import { StrategyService } from "./strategy/service";
import { ConfigRepository } from "./config/configRepository";
import type { Express } from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defaultConfigDir } from "./config/configPaths";
import { ApiError, apiErrorHandler } from "./http/apiError";
import { MarketDataProvider } from "./market/marketDataProvider";
import { PolygonClient } from "./market/polygonClient";
import { createConfigRoutes } from "./routes/configRoutes";
import { createAuth, type AuthOptions, type ProviderCredentials } from "./auth/oidc";
import { createMarketRoutes } from "./routes/marketRoutes";
import { createRateRoutes } from "./routes/rateRoutes";

export interface CreateAppOptions {
  /** Overrides for sign-in; by default read from the environment. */
  auth?: Partial<AuthOptions>;
  configDir?: string;
  nodeEnv?: string;
  polygonApiKey?: string;
  staticDir?: string;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  const configDir =
    options.configDir ?? process.env.CONFIG_DIR ?? defaultConfigDir();
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? "production";
  const polygonApiKey = options.polygonApiKey ?? process.env.POLYGON_API_KEY;
  const staticDir =
    options.staticDir ??
    process.env.STATIC_DIR ??
    resolve(process.cwd(), "dist");
  const marketDataProvider = new MarketDataProvider(
    new PolygonClient(polygonApiKey),
  );
  const indexHtml = resolve(staticDir, "index.html");
  const researchDir =
    process.env.RESEARCH_DATA_DIR ?? resolve(process.cwd(), "data/research");
  // Per-account watchlist edits live beside research data, which survives deploys.
  const configRepository = new ConfigRepository({
    configDir,
    dataDir: researchDir,
  });

  app.disable("x-powered-by");
  app.use(express.json());
  const publicBaseUrl =
    process.env.PUBLIC_BASE_URL?.trim() || "https://finance.nphunter.net";
  if (nodeEnv === "production" && publicBaseUrl.startsWith("https://"))
    // Sign-in cookies are Secure; keep browsers on HTTPS for this host only.
    app.use((_request, response, next) => {
      response.set("Strict-Transport-Security", "max-age=31536000");
      next();
    });

  const credentials = (prefix: string): ProviderCredentials | undefined => {
    const clientId = process.env[`${prefix}_CLIENT_ID`]?.trim();
    const clientSecret = process.env[`${prefix}_CLIENT_SECRET`]?.trim();
    return clientId && clientSecret ? { clientId, clientSecret } : undefined;
  };
  // Sign-in with Google (Gmail) and Microsoft (Outlook); each provider is on
  // only when its client id and secret are configured.
  const auth = createAuth({
    baseUrl: publicBaseUrl,
    dataDir: researchDir,
    google: credentials("GOOGLE"),
    microsoft: credentials("MICROSOFT"),
    deleteAccountData: (account) => configRepository.deleteAccountEdits(account),
    ...options.auth,
  });
  app.use("/api", auth.router);

  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true,
      service: "stock-workbench-api",
    });
  });

  app.use(
    "/api",
    createConfigRoutes({
      repository: configRepository,
      resolveAccount: auth.accountFor,
      lookupSymbol: async (symbol) => {
        try {
          const details = await marketDataProvider.getTickerDetails(symbol);
          return details.name
            ? { symbol: details.symbol, name: details.name }
            : null;
        } catch (error) {
          if (error instanceof ApiError && error.status === 404) return null;
          throw error;
        }
      },
    }),
  );
  app.use("/api", createRateRoutes());
  app.use(
    "/api",
    createResearchRoutes(
      new ResearchService(
        marketDataProvider,
        new PolygonClient(polygonApiKey),
        researchDir,
        process.env.OPENAI_API_KEY,
        process.env.OPENAI_MODEL?.trim() || "gpt-5.6-sol",
      ),
    ),
  );
  app.use(
    "/api",
    createModelRoutes(
      new ModelScanService(
        marketDataProvider,
        // Models and the Quant System use the YAML lists, never personal edits.
        async () => scanUniverse(await configRepository.readBaseWatchlists()),
        researchDir,
      ),
    ),
  );
  const strategy = new StrategyService({
    market: marketDataProvider,
    configDir,
    dataDir: researchDir,
    readWatchlists: () => configRepository.readBaseWatchlists(),
    mailer: createMailer(process.env),
    baseUrl: process.env.PUBLIC_BASE_URL?.trim() || "https://finance.nphunter.net",
  });
  // server/index.ts starts the scheduler; tests and other app instances never do.
  app.locals.strategy = strategy;
  app.use("/api", createStrategyRoutes(strategy));
  app.use("/api", createMarketRoutes(marketDataProvider));

  if (nodeEnv === "production" && existsSync(indexHtml)) {
    app.use(express.static(staticDir, { index: false }));
    app.get(/^(?!\/api(?:\/|$)).*/, (_request, response) => {
      response.sendFile(indexHtml);
    });
  }

  app.use(apiErrorHandler);

  return app;
}
