import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
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

  async writeWatchlists(input: unknown): Promise<WatchlistsConfig> {
    const watchlists = parseWatchlistsConfig(input);
    const yaml = YAML.stringify(watchlists);
    const tempPath = path.join(
      this.paths.configDir,
      `.watchlists.yaml.${process.pid}.${Date.now()}.tmp`,
    );

    await mkdir(this.paths.configDir, { recursive: true });

    try {
      await writeFile(tempPath, yaml, "utf8");

      if (await pathExists(this.paths.watchlistsPath)) {
        await copyFile(this.paths.watchlistsPath, this.paths.watchlistsBackupPath);
      }

      await rename(tempPath, this.paths.watchlistsPath);
    } catch (error) {
      await rm(tempPath, { force: true });
      throw error;
    }

    return watchlists;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
