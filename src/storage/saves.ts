import {
  AUTO_SLOT_COUNT,
  MANUAL_SLOT_COUNT,
  getDb,
  readSettings,
  saveId,
  writeSettings,
  type SaveKind,
  type StoredSave,
} from './db';
import type { EmulatorSnapshot } from '../emulator/core';

/**
 * Speicherstände.
 *
 * Warum das hier wichtiger ist als in den meisten Emulator-Frontends: die
 * Game-Boy-Fassung von Adventures of Lolo hat keinen Batteriepuffer, sondern
 * ein Passwortsystem. Das Spiel *kann* den Fortschritt nicht selbst sichern.
 * Ohne Save States hieße "kurz weglegen" jedes Mal: Level von vorn.
 */

export interface CreateSaveInput {
  romId: string;
  kind: SaveKind;
  slot: number;
  snapshot: EmulatorSnapshot;
  thumbnail: string;
  playtimeMs: number;
  label?: string;
}

function defaultLabel(kind: SaveKind, slot: number, createdAt: number): string {
  const when = new Date(createdAt).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  return kind === 'auto' ? `Automatisch · ${when}` : `Platz ${slot} · ${when}`;
}

export async function writeSave(input: CreateSaveInput): Promise<StoredSave> {
  const createdAt = Date.now();
  const save: StoredSave = {
    id: saveId(input.romId, input.kind, input.slot),
    romId: input.romId,
    kind: input.kind,
    slot: input.slot,
    label: input.label ?? defaultLabel(input.kind, input.slot, createdAt),
    thumbnail: input.thumbnail,
    createdAt,
    playtimeMs: input.playtimeMs,
    snapshot: input.snapshot,
  };

  const db = await getDb();
  await db.put('saves', save);
  return save;
}

/**
 * Schreibt den nächsten Auto-Stand und dreht den Ringzeiger weiter.
 *
 * Der Ring aus drei Plätzen ist Absicht: würde immer derselbe Platz
 * überschrieben, machte ein Auto-Speichern im ungünstigen Moment — mitten im
 * Bildschirmwechsel, kurz vor dem Tod — den einzigen Rettungsanker kaputt.
 * So bleiben immer zwei ältere Stände übrig.
 */
export async function writeAutoSave(
  romId: string,
  snapshot: EmulatorSnapshot,
  thumbnail: string,
  playtimeMs: number,
): Promise<StoredSave> {
  const settings = await readSettings();
  const slot = settings.autoSlotCursor % AUTO_SLOT_COUNT;

  const save = await writeSave({ romId, kind: 'auto', slot, snapshot, thumbnail, playtimeMs });
  await writeSettings({ autoSlotCursor: (slot + 1) % AUTO_SLOT_COUNT });
  return save;
}

export async function listSaves(romId: string): Promise<StoredSave[]> {
  const db = await getDb();
  return db.getAllFromIndex('saves', 'byRom', romId);
}

export async function getSave(
  romId: string,
  kind: SaveKind,
  slot: number,
): Promise<StoredSave | undefined> {
  const db = await getDb();
  return db.get('saves', saveId(romId, kind, slot));
}

/** Der jüngste Auto-Stand — das, was hinter "Fortsetzen" steckt. */
export async function latestAutoSave(romId: string): Promise<StoredSave | undefined> {
  const saves = await listSaves(romId);
  return saves
    .filter((save) => save.kind === 'auto')
    .sort((a, b) => b.createdAt - a.createdAt)[0];
}

/** Der jüngste Stand überhaupt, egal ob automatisch oder manuell. */
export async function latestSave(romId: string): Promise<StoredSave | undefined> {
  const saves = await listSaves(romId);
  return saves.sort((a, b) => b.createdAt - a.createdAt)[0];
}

/**
 * Die manuellen Plätze als Liste fester Länge — belegte als Eintrag,
 * freie als `null`. Die UI kann so stumpf darüber iterieren.
 */
export async function manualSlots(romId: string): Promise<(StoredSave | null)[]> {
  const saves = await listSaves(romId);
  const slots: (StoredSave | null)[] = new Array(MANUAL_SLOT_COUNT).fill(null);
  for (const save of saves) {
    if (save.kind === 'manual' && save.slot >= 0 && save.slot < MANUAL_SLOT_COUNT) {
      slots[save.slot] = save;
    }
  }
  return slots;
}

export async function deleteSave(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('saves', id);
}
