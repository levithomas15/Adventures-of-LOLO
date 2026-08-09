import { getDb, type StoredRom } from './db';
import { parseRomHeader, romFingerprint } from '../emulator/rom';

/**
 * ROM-Verwaltung. Einmal importiert, bleibt das Spiel auf dem Gerät —
 * genau das ist der Unterschied zwischen "Website" und "immer spielbar".
 */

export async function listRoms(): Promise<StoredRom[]> {
  const db = await getDb();
  const roms = await db.getAll('roms');
  return roms.sort((a, b) => b.addedAt - a.addedAt);
}

export async function getRom(id: string): Promise<StoredRom | undefined> {
  const db = await getDb();
  return db.get('roms', id);
}

/**
 * Legt ein ROM ab. Ist dieselbe Datei schon da (gleicher SHA-1), wird der
 * vorhandene Eintrag zurückgegeben — samt aller Speicherstände, die daran
 * hängen. Ein versehentlicher zweiter Import kostet also nichts.
 */
export async function importRom(data: Uint8Array, fileName: string): Promise<StoredRom> {
  const header = parseRomHeader(data);
  const id = await romFingerprint(data);

  const db = await getDb();
  const existing = await db.get('roms', id);
  if (existing) return existing;

  const rom: StoredRom = {
    id,
    fileName,
    title: header.title || fileName.replace(/\.[^.]+$/, ''),
    // slice() erzwingt einen eigenen ArrayBuffer — `data` kann ein View auf
    // einen größeren Puffer des Entpackers sein, und den wollen wir nicht
    // vollständig in die Datenbank schreiben.
    data: data.slice().buffer,
    header,
    addedAt: Date.now(),
  };

  await db.put('roms', rom);
  return rom;
}

/** Löscht ein ROM samt aller zugehörigen Speicherstände. */
export async function deleteRom(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['roms', 'saves'], 'readwrite');
  const saveKeys = await tx.objectStore('saves').index('byRom').getAllKeys(id);
  await Promise.all([
    tx.objectStore('roms').delete(id),
    ...saveKeys.map((key) => tx.objectStore('saves').delete(key)),
  ]);
  await tx.done;
}
