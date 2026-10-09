import { createApp } from "./app";
import type { StrategyService } from "./strategy/service";

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const host = process.env.HOST ?? "127.0.0.1";

const app = createApp();

app.listen(port, host, () => {
  console.log(`Stock Workbench API listening on http://${host}:${port}`);
});

// Scheduled quant runs and emails are opt-in so dev, CI and tests never trigger them.
if (process.env.STRATEGY_SCHEDULER === "on")
  (app.locals.strategy as StrategyService)
    .startScheduler()
    .then(() => console.log("Quant system scheduler started"))
    .catch((error: unknown) =>
      console.error("Quant system scheduler failed to start", error),
    );
