import {
  getDb,
  readSettings,
  type StoredPassword,
  type StoredRom,
  type StoredSave,
} from './db';

/**
 * Sicherung aller Daten in eine Datei — und zurück.
 *
 * Das ist keine Spielerei, sondern die Versicherung gegen iOS: Safari löscht
 * Website-Daten nach sieben Tagen ohne Besuch. Auf dem Home-Bildschirm
 * installiert passiert das nicht, aber wer die Seite nur im Browser offen
 * hatte, verlöre sonst irgendwann alles. Eine exportierte Datei liegt in
 * iCloud und ist davon unberührt.
 */

const BACKUP_FORMAT = 'adventures-of-lolo-backup';
/** 2 seit dem Passwort-Notizblock. Ältere Dateien lassen sich weiterhin einlesen. */
const BACKUP_VERSION = 2;

/** Base64 in Blöcken — `fromCharCode(...millionen)` sprengt den Stack. */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * JSON kennt keine Binärdaten, und Speicherstände bestehen fast nur daraus.
 * Typed Arrays und ArrayBuffer bekommen deshalb eine Markierung, damit beim
 * Einlesen wieder derselbe Typ herauskommt und nicht ein Objekt mit
 * Zahlenschlüsseln — woran der Emulator wortlos scheitern würde.
 */
function encode(value: unknown): unknown {
  if (value instanceof Uint8Array) return { $u8: toBase64(value) };
  if (value instanceof ArrayBuffer) return { $ab: toBase64(new Uint8Array(value)) };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = encode(item);
    return out;
  }
  return value;
}

function decode(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.$u8 === 'string') return fromBase64(record.$u8);
    if (typeof record.$ab === 'string') return fromBase64(record.$ab).buffer;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) out[key] = decode(item);
    return out;
  }
  if (Array.isArray(value)) return value.map(decode);
  return value;
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: number;
  roms: unknown[];
  saves: unknown[];
  settings: unknown;
  /** Seit Version 2. Bei älteren Sicherungen schlicht nicht vorhanden. */
  passwoerter?: unknown[];
}

export async function exportBackup(): Promise<Blob> {
  const db = await getDb();
  const [roms, saves, settings, passwoerter] = await Promise.all([
    db.getAll('roms'),
    db.getAll('saves'),
    readSettings(),
    db.getAll('passwoerter'),
  ]);

  const backup: BackupFile = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: Date.now(),
    roms: roms.map(encode),
    saves: saves.map(encode),
    settings: encode(settings),
    // Notierte Passwörter gehören dazu — sie sind der Teil, der auch ohne
    // diese App noch etwas wert ist.
    passwoerter: passwoerter.map(encode),
  };

  return new Blob([JSON.stringify(backup)], { type: 'application/json' });
}

export function backupFileName(): string {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return `lolo-sicherung-${stamp}.json`;
}

export interface ImportResult {
  roms: number;
  saves: number;
  passwoerter: number;
}

/**
 * Spielt eine Sicherung ein. Vorhandene Einträge mit gleicher Kennung werden
 * überschrieben — die Datei gewinnt. Alles andere bleibt unangetastet, eine
 * Sicherung von einem anderen Gerät ergänzt also, statt zu löschen.
 */
export async function importBackup(file: File): Promise<ImportResult> {
  let parsed: BackupFile;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('Die Datei ist kein gültiges JSON.');
  }

  if (parsed?.format !== BACKUP_FORMAT) {
    throw new Error('Das ist keine Sicherungsdatei dieser App.');
  }
  if (parsed.version > BACKUP_VERSION) {
    throw new Error(
      `Die Sicherung stammt aus einer neueren Version (${parsed.version}). Bitte die App aktualisieren.`,
    );
  }

  const roms = (parsed.roms ?? []).map(decode) as StoredRom[];
  const saves = (parsed.saves ?? []).map(decode) as StoredSave[];
  // Fehlt in Sicherungen der Version 1 — dann bleibt die Liste eben leer.
  const passwoerter = (parsed.passwoerter ?? []).map(decode) as StoredPassword[];

  const db = await getDb();
  const tx = db.transaction(['roms', 'saves', 'passwoerter'], 'readwrite');
  await Promise.all([
    ...roms.map((rom) => tx.objectStore('roms').put(rom)),
    ...saves.map((save) => tx.objectStore('saves').put(save)),
    ...passwoerter.map((eintrag) => tx.objectStore('passwoerter').put(eintrag)),
  ]);
  await tx.done;

  return { roms: roms.length, saves: saves.length, passwoerter: passwoerter.length };
}
