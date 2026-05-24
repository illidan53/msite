import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { parseSettingsConfig, parseWatchlistsConfig } from "../../shared/schemas";
import type { SettingsConfig, WatchlistsConfig } from "../../shared/types";
import { resolveConfigPaths } from "./configPaths";

export interface ConfigRepositoryOptions {
  configDir?: string;
}

export interface StockWorkbenchConfig {
  settings: SettingsConfig;
  watchlists: WatchlistsConfig;
}

export class ConfigRepository {
  private readonly paths: ReturnType<typeof resolveConfigPaths>;

  constructor(options: ConfigRepositoryOptions = {}) {
    this.paths = resolveConfigPaths(options.configDir);
  }

  async readConfig(): Promise<StockWorkbenchConfig> {
    const [watchlists, settings] = await Promise.all([this.readWatchlists(), this.readSettings()]);

    return { watchlists, settings };
  }

  async readWatchlists(): Promise<WatchlistsConfig> {
    const content = await readFile(this.paths.watchlistsPath, "utf8");

    return parseWatchlistsConfig(YAML.parse(content));
  }

  async readSettings(): Promise<SettingsConfig> {
    const content = await readFile(this.paths.settingsPath, "utf8");

    return parseSettingsConfig(YAML.parse(content));
  }
}
