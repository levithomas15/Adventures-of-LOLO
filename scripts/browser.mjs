/**
 * Gemeinsamer Chromium-Start für Icon-Erzeugung und E2E-Tests.
 *
 * Die Umgebung bringt Chromium schon mit (PLAYWRIGHT_BROWSERS_PATH), aber
 * unter einer anderen Build-Nummer, als das npm-Paket erwartet — ohne
 * `executablePath` sucht Playwright einen Ordner, den es nicht gibt, und
 * verlangt einen Download. Hier wird einmal das vorhandene Binary gesucht.
 */
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const BROWSER_ROOT = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';

export function findChromium() {
  if (!existsSync(BROWSER_ROOT)) return undefined;

  const candidates = readdirSync(BROWSER_ROOT)
    // Die volle Chromium-Variante, nicht die headless-shell: Letztere kann
    // keine Screenshots mit vollständigem Rendering liefern.
    .filter((name) => /^chromium(-\d+)?$/.test(name))
    .sort()
    .reverse();

  for (const name of candidates) {
    const path = join(BROWSER_ROOT, name, 'chrome-linux', 'chrome');
    if (existsSync(path)) return path;
  }
  return undefined;
}

export function launchOptions(extra = {}) {
  const executablePath = findChromium();
  return {
    ...(executablePath ? { executablePath } : {}),
    // Ohne eigenen Kernel-Namespace fehlt dem Sandbox-Helfer die Berechtigung.
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    ...extra,
  };
}
