import { looksLikeGameBoyRom } from '../emulator/rom';

/**
 * ROM-Import, inklusive Archiven.
 *
 * Der Grund für den ganzen Aufwand: iOS entpackt in der Dateien-App zwar
 * `.zip`, aber **kein `.7z`**. Wer sein Spiel als 7z-Archiv hat, käme auf dem
 * iPhone ohne Zusatz-App gar nicht an die `.gb`-Datei heran. Also entpackt
 * die App selbst — dann genügt ein Tippen auf das Archiv.
 *
 * libarchive.js (~1,5 MB WASM) wird dabei **erst beim ersten Archiv** geladen.
 * Wer eine blanke `.gb` mitbringt, zahlt den Umweg nicht.
 */

export interface RomCandidate {
  name: string;
  data: Uint8Array;
}

const ROM_EXTENSIONS = /\.(gb|gbc)$/i;
const ARCHIVE_EXTENSIONS = /\.(7z|zip|rar|tar|gz|tgz|bz2|xz)$/i;

export function isArchiveName(name: string): boolean {
  return ARCHIVE_EXTENSIONS.test(name);
}

let archiveModule: Promise<typeof import('libarchive.js')> | null = null;

async function loadArchiveLib() {
  if (!archiveModule) {
    archiveModule = import('libarchive.js').then((mod) => {
      // Worker und WASM liegen unangetastet in public/ nebeneinander —
      // siehe scripts/vendor-libarchive.mjs.
      mod.Archive.init({
        workerUrl: `${import.meta.env.BASE_URL}vendor/libarchive/worker-bundle.js`,
      });
      return mod;
    });
  }
  return archiveModule;
}

/**
 * Holt alle plausiblen ROMs aus einem Archiv.
 *
 * Gefiltert wird nicht nach Dateiendung, sondern über das Nintendo-Logo im
 * Header. Das erwischt auch ROMs, die als `.bin` oder ganz ohne Endung im
 * Archiv liegen, und sortiert Beipack wie `readme.txt` von selbst aus.
 */
export async function extractRomsFromArchive(file: File): Promise<RomCandidate[]> {
  const { Archive } = await loadArchiveLib();

  const reader = await Archive.open(file);
  try {
    if (await reader.hasEncryptedData()) {
      throw new Error(
        'Das Archiv ist passwortgeschützt. Bitte entpacke es vorher und wähle die .gb-Datei direkt aus.',
      );
    }

    const extracted = await reader.extractFiles();
    const candidates: RomCandidate[] = [];

    // extractFiles() liefert die Verzeichnisstruktur als verschachteltes
    // Objekt; Blätter sind File-Objekte.
    const walk = async (node: unknown, path: string): Promise<void> => {
      if (node instanceof File) {
        const data = new Uint8Array(await node.arrayBuffer());
        if (looksLikeGameBoyRom(data)) {
          candidates.push({ name: path || node.name, data });
        }
        return;
      }
      if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
          await walk(value, path ? `${path}/${key}` : key);
        }
      }
    };

    await walk(extracted, '');
    return candidates;
  } finally {
    // Der Worker hält das entpackte Archiv im Speicher — auf einem iPhone
    // will man den nicht offen stehen lassen.
    await reader.close();
  }
}

/**
 * Nimmt entgegen, was der Datei-Picker liefert, und gibt die ROM-Kandidaten
 * zurück. Ein einzelner Treffer wird direkt importiert; bei mehreren fragt
 * die UI nach.
 */
export async function readRomCandidates(file: File): Promise<RomCandidate[]> {
  const data = new Uint8Array(await file.arrayBuffer());

  // Erst prüfen, ob es schon ein ROM ist — unabhängig von der Endung.
  // Manche Leute benennen ihre Dateien `.rom` oder gar nicht.
  if (looksLikeGameBoyRom(data)) {
    return [{ name: file.name, data }];
  }

  if (isArchiveName(file.name)) {
    const candidates = await extractRomsFromArchive(file);
    if (candidates.length === 0) {
      throw new Error(
        'In diesem Archiv steckt keine Game-Boy-ROM-Datei. Erwartet wird eine .gb- oder .gbc-Datei.',
      );
    }
    return candidates;
  }

  if (ROM_EXTENSIONS.test(file.name)) {
    throw new Error(
      'Die Datei sieht nicht wie ein Game-Boy-ROM aus — das Nintendo-Logo im Header fehlt. Ist der Dump vollständig?',
    );
  }

  throw new Error(
    `Mit "${file.name}" kann die App nichts anfangen. Erwartet werden .gb, .gbc oder ein Archiv (.7z, .zip).`,
  );
}
