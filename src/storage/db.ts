import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { EmulatorSnapshot } from '../emulator/core';
import type { RomHeader } from '../emulator/rom';

/**
 * Die Datenbank der App. Alles, was einen Neustart überleben muss, liegt hier:
 * das importierte ROM, die Speicherstände, die Einstellungen.
 *
 * Wichtig fürs iPhone: Safari räumt Website-Daten nach sieben Tagen ohne
 * Besuch weg (Intelligent Tracking Prevention) — es sei denn, die Seite liegt
 * auf dem Home-Bildschirm. Deshalb bittet `platform/persist.ts` zusätzlich um
 * dauerhaften Speicher, und `backup.ts` kann alles als Datei exportieren.
 */

export type SaveKind = 'auto' | 'manual';

/** Auto-Stände rotieren über drei Plätze, damit ein kaputter nicht alles nimmt. */
export const AUTO_SLOT_COUNT = 3;
/** Manuelle Plätze, im Pausenmenü sichtbar. */
export const MANUAL_SLOT_COUNT = 6;

export interface StoredRom {
  /** SHA-1 des ROMs — gleiche Datei, gleiche Kennung, kein Doppel-Import. */
  id: string;
  /** Dateiname beim Import, z. B. "Adventures of Lolo.gb". */
  fileName: string;
  /** Titel aus dem Cartridge-Header, z. B. "ADVENTURES OF LOLO". */
  title: string;
  data: ArrayBuffer;
  header: RomHeader;
  addedAt: number;
}

export interface StoredSave {
  /** `${romId}:${kind}:${slot}` — Überschreiben ist damit ein simples put(). */
  id: string;
  romId: string;
  kind: SaveKind;
  slot: number;
  /** Vom Nutzer vergeben oder automatisch erzeugt. */
  label: string;
  /** PNG-Data-URL des Bildschirms im Moment des Speicherns. */
  thumbnail: string;
  createdAt: number;
  /** Gesamte Spielzeit bis zu diesem Stand, in Millisekunden. */
  playtimeMs: number;
  snapshot: EmulatorSnapshot;
}

export interface Settings {
  paletteId: string;
  audioEnabled: boolean;
  /** Zeiger auf den nächsten zu überschreibenden Auto-Platz. */
  autoSlotCursor: number;
  lastRomId: string | null;
  scanlines: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  paletteId: 'dmg',
  audioEnabled: true,
  autoSlotCursor: 0,
  lastRomId: null,
  scanlines: false,
};

interface LoloDB extends DBSchema {
  roms: {
    key: string;
    value: StoredRom;
  };
  saves: {
    key: string;
    value: StoredSave;
    indexes: { byRom: string };
  };
  settings: {
    key: string;
    value: unknown;
  };
}

const DB_NAME = 'adventures-of-lolo';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<LoloDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<LoloDB>> {
  if (!dbPromise) {
    dbPromise = openDB<LoloDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('roms')) {
          db.createObjectStore('roms', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('saves')) {
          const saves = db.createObjectStore('saves', { keyPath: 'id' });
          saves.createIndex('byRom', 'romId');
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings');
        }
      },
    });
  }
  return dbPromise;
}

export function saveId(romId: string, kind: SaveKind, slot: number): string {
  return `${romId}:${kind}:${slot}`;
}

export async function readSettings(): Promise<Settings> {
  const db = await getDb();
  const stored = (await db.get('settings', 'app')) as Partial<Settings> | undefined;
  // Zusammenführen statt ersetzen: neue Felder in künftigen Versionen
  // bekommen so ihren Standardwert, ohne Migration.
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
}

export async function writeSettings(patch: Partial<Settings>): Promise<Settings> {
  const db = await getDb();
  const next = { ...(await readSettings()), ...patch };
  await db.put('settings', next, 'app');
  return next;
}
