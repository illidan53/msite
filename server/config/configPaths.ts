import path from "node:path";

export interface ConfigPaths {
  configDir: string;
  settingsPath: string;
  watchlistsBackupPath: string;
  watchlistsPath: string;
}

export function defaultConfigDir(): string {
  return path.join(process.cwd(), "config");
}

export function resolveConfigPaths(configDir = defaultConfigDir()): ConfigPaths {
  const resolvedConfigDir = path.resolve(configDir);

  return {
    configDir: resolvedConfigDir,
    settingsPath: path.join(resolvedConfigDir, "settings.yaml"),
    watchlistsBackupPath: path.join(resolvedConfigDir, "watchlists.yaml.bak"),
    watchlistsPath: path.join(resolvedConfigDir, "watchlists.yaml"),
  };
}
