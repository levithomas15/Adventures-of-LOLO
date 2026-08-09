/**
 * Bildschirmsperre verhindern, solange gespielt wird.
 *
 * Lolo ist ein Denkspiel: man schiebt eine Kiste, dann schaut man eine halbe
 * Minute auf den Bildschirm und überlegt. Genau dann dimmt das iPhone. Der
 * Wake Lock hält den Bildschirm an, aber nur währenddessen — pausiert oder im
 * Hintergrund wird er wieder freigegeben, damit der Akku nicht leidet.
 *
 * Safari kann das seit 16.4. Fehlt die API, passiert schlicht nichts.
 */

let sentinel: WakeLockSentinel | null = null;
let wanted = false;

export async function acquireWakeLock(): Promise<void> {
  wanted = true;
  if (!navigator.wakeLock || sentinel) return;

  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => {
      sentinel = null;
    });
  } catch {
    // Wird u. a. abgelehnt, wenn das Dokument gerade unsichtbar ist —
    // dann greift die Wiederherstellung unten beim Zurückkommen.
    sentinel = null;
  }
}

export async function releaseWakeLock(): Promise<void> {
  wanted = false;
  try {
    await sentinel?.release();
  } catch {
    /* Egal — er ist ohnehin weg. */
  }
  sentinel = null;
}

/**
 * Das System nimmt den Wake Lock beim Wegschalten von selbst zurück. Kommt
 * die App zurück und es wird noch gespielt, holen wir ihn uns wieder.
 */
export function watchWakeLock(): void {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wanted && !sentinel) {
      void acquireWakeLock();
    }
  });
}
