// Provider CLIs are often installed into user-owned bin directories that a
// long-running web server did not inherit (or that did not exist when it
// started). Keep the inherited PATH first so existing command precedence is
// unchanged, then append the standard install locations used by Claude Code,
// Codex, OpenCode, and common package managers.

import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

type CliPathOptions = {
  home?: string;
  execPath?: string;
  platform?: NodeJS.Platform;
};

type PathEnvironment = Readonly<Record<string, string | undefined>>;

function currentPath(env: PathEnvironment): string {
  if (env.PATH) return env.PATH;
  const key = Object.keys(env).find(name => name.toLowerCase() === 'path');
  return key ? (env[key] ?? '') : '';
}

/** Build a PATH that can discover provider CLIs installed after server start. */
export function providerCliPath(
  env: PathEnvironment = process.env,
  options: CliPathOptions = {},
): string {
  const home = options.home ?? homedir();
  const execPath = options.execPath ?? process.execPath;
  const platform = options.platform ?? process.platform;
  const inherited = currentPath(env).split(delimiter).filter(Boolean);
  const userBins = [
    dirname(execPath),
    join(home, '.local', 'bin'),
    join(home, '.opencode', 'bin'),
    join(home, '.npm-global', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, '.volta', 'bin'),
    join(home, '.local', 'share', 'pnpm'),
  ];
  const candidates =
    platform === 'win32'
      ? [
          ...userBins,
          env.APPDATA ? join(env.APPDATA, 'npm') : '',
          env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links') : '',
        ]
      : [...userBins, join(home, 'Library', 'pnpm'), '/opt/homebrew/bin', '/usr/local/bin'];

  return [...new Set([...inherited, ...candidates.filter(Boolean)])].join(delimiter);
}

/** Minimal environment fragment for a provider spawn built by an adapter. */
export function providerCliEnv(extra: Record<string, string> = {}): Record<string, string> {
  return { ...extra, PATH: providerCliPath() };
}

/** Full process environment for workers that may spawn a provider later. */
export function withProviderCliPath(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...env, PATH: providerCliPath(env) };
}
