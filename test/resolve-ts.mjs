/**
 * Auflösungs-Hook für die Tests.
 *
 * Der Quellcode importiert wie in Vite-Projekten üblich ohne Endung
 * ("./core"). Node kennt diese Bündler-Konvention nicht und sucht die Datei
 * buchstäblich. Der Hook hängt die Endung an, damit `node --test` dieselben
 * Dateien laden kann, die auch der Bündler sieht — ohne den Quellcode für
 * die Tests zu verbiegen.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CANDIDATES = ['.ts', '.tsx', '/index.ts'];

export async function resolve(specifier, context, next) {
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
  const hasExtension = /\.[cm]?[jt]sx?$/.test(specifier);

  if (isRelative && !hasExtension && context.parentURL) {
    const base = new URL(specifier, context.parentURL);
    for (const extension of CANDIDATES) {
      const candidate = new URL(base.href + extension);
      if (existsSync(fileURLToPath(candidate))) {
        return next(candidate.href, context);
      }
    }
  }

  return next(specifier, context);
}
