import os from 'node:os';
import path from 'node:path';

export type AppConfig = {
  baseDir: string;
  port: number;
  bindHost?: string; // if undefined, auto-bind to tailscale IP
  cookieSecret: string;
  authFile: string;
  cacheDir: string;
  reportsDir: string;
  stagingDir: string;
  reviewStateFile: string;
  cacheFreshMs: number;
};

export function loadConfig(): AppConfig {
  const home = os.homedir();
  const baseDir = process.env.HK_BASE_DIR || path.join(home, 'HisabKitab');

  const port = Number(process.env.HK_PORT || 8787);
  const cookieSecret = process.env.HK_COOKIE_SECRET || '';
  if (!cookieSecret || cookieSecret.length < 16) {
    throw new Error('HK_COOKIE_SECRET missing or too short (need >=16 chars)');
  }

  return {
    baseDir,
    port,
    bindHost: process.env.HK_BIND_HOST,
    cookieSecret,
    authFile: process.env.HK_AUTH_FILE || path.join(baseDir, 'web', 'auth.json'),
    cacheDir: path.join(baseDir, 'cache'),
    reportsDir: path.join(baseDir, 'reports'),
    stagingDir: path.join(baseDir, 'staging'),
    reviewStateFile: path.join(baseDir, 'review_state.json'),
    cacheFreshMs: Number(process.env.HK_CACHE_FRESH_MS || 5 * 60 * 1000)
  };
}
