/**
 * Dauerhafter Speicher.
 *
 * iOS löscht per Intelligent Tracking Prevention alle Website-Daten, wenn eine
 * Seite sieben Tage lang nicht besucht wurde. Für eine App, deren ganzer Zweck
 * "jederzeit weiterspielen" ist, wäre das fatal.
 *
 * Zwei Dinge helfen dagegen, und nur zusammen:
 *  1. `navigator.storage.persist()` — bittet den Browser, die Daten zu
 *     verschonen. Safari gewährt das eher, wenn die Seite installiert ist.
 *  2. Die Installation auf dem Home-Bildschirm. Ein so gestarteter Web-App
 *     unterliegt der Sieben-Tage-Regel nicht.
 *
 * Deshalb weist das Onboarding aktiv auf "Zum Home-Bildschirm" hin, statt es
 * dem Zufall zu überlassen.
 */

export interface StorageStatus {
  persisted: boolean;
  usageBytes: number | null;
  quotaBytes: number | null;
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function storageStatus(): Promise<StorageStatus> {
  const status: StorageStatus = { persisted: false, usageBytes: null, quotaBytes: null };
  if (!navigator.storage) return status;

  try {
    status.persisted = (await navigator.storage.persisted?.()) ?? false;
    const estimate = await navigator.storage.estimate?.();
    status.usageBytes = estimate?.usage ?? null;
    status.quotaBytes = estimate?.quota ?? null;
  } catch {
    /* Nicht alle Browser liefern das; dann bleibt es bei den Standardwerten. */
  }
  return status;
}

/** Läuft die App vom Home-Bildschirm statt im Browser-Tab? */
export function isStandalone(): boolean {
  // `navigator.standalone` ist Safaris eigener, nicht standardisierter Weg.
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia('(display-mode: standalone)').matches;
}

export function isIos(): boolean {
  // iPadOS meldet sich seit Version 13 als Macintosh — der Touch-Test trennt beide.
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
