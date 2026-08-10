import { erkenneFremdsystem, looksLikeGameBoyRom } from '../emulator/rom';

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

/**
 * Einstufung nach der GoodTools-Benennung, wie sie in ROM-Sammlungen üblich
 * ist. Sie steht in eckigen Klammern hinter dem Namen.
 *
 * Warum das mehr als Kosmetik ist: In einem typischen Satz sind die meisten
 * Dateien Varianten desselben Spiels, und ein großer Teil davon ist kaputt.
 * Im Archiv, das diese Funktion ausgelöst hat, waren von 22 Dateien nur 2
 * geprüfte Dumps und 15 defekt. Wer wahllos greift, erwischt mit hoher
 * Wahrscheinlichkeit eine beschädigte Datei — und hält dann den Emulator
 * für schuld.
 */
export type DumpGuete = 'geprueft' | 'normal' | 'uebersetzung' | 'problematisch';

/** Reihenfolge in der Auswahlliste. */
const GUETE_RANG: Record<DumpGuete, number> = {
  geprueft: 0,
  normal: 1,
  uebersetzung: 2,
  problematisch: 3,
};

export interface RomCandidate {
  name: string;
  data: Uint8Array;
  guete: DumpGuete;
}

const ROM_EXTENSIONS = /\.(gb|gbc)$/i;
const ARCHIVE_EXTENSIONS = /\.(7z|zip|rar|tar|gz|tgz|bz2|xz)$/i;

export function isArchiveName(name: string): boolean {
  return ARCHIVE_EXTENSIONS.test(name);
}

/**
 * Stuft einen Dateinamen ein. Reine Funktion, damit testbar.
 *
 * `[!]` geprüfter Dump · `[T+xxx]`/`[T-xxx]` Übersetzung ·
 * `[b…]` schlechter Dump · `[o…]` Überdump · `[h…]` Hack ·
 * `[a…]` Alternativversion · `[f…]` nachgebessert
 */
export function bewerteDump(name: string): DumpGuete {
  if (/\[!\]/.test(name)) return 'geprueft';
  // Vor der Übersetzungsprüfung: Ein kaputter Dump bleibt kaputt, auch wenn
  // er zusätzlich übersetzt wurde (etwa "[o1][T+Ger]").
  //
  // Der Zähler läuft über 9 hinaus mit Buchstaben weiter — [b9], [ba], [bb],
  // [bc]. Prüfte man nur auf Ziffern, rutschten genau diese als "normal"
  // durch und landeten ungewarnt in der empfohlenen Liste.
  if (/\[[bohaf][0-9a-z]*\]/i.test(name)) return 'problematisch';
  if (/\[T[+-]/i.test(name)) return 'uebersetzung';
  return 'normal';
}

/** Gute zuerst, kaputte zuletzt; innerhalb einer Stufe alphabetisch. */
export function sortiereKandidaten<T extends { name: string; guete: DumpGuete }>(
  kandidaten: T[],
): T[] {
  return [...kandidaten].sort((a, b) => {
    const rang = GUETE_RANG[a.guete] - GUETE_RANG[b.guete];
    return rang !== 0 ? rang : a.name.localeCompare(b.name, 'de');
  });
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

export interface ArchivInhalt {
  roms: RomCandidate[];
  /** Gefundene ROMs anderer Systeme, nach Systemname gezählt. */
  fremdsysteme: Map<string, number>;
}

/**
 * Holt alle plausiblen ROMs aus einem Archiv.
 *
 * Gefiltert wird nicht nach Dateiendung, sondern über das Nintendo-Logo im
 * Header. Das erwischt auch ROMs, die als `.bin` oder ganz ohne Endung im
 * Archiv liegen, und sortiert Beipack wie `readme.txt` von selbst aus.
 *
 * Nebenbei wird gezählt, was an ROMs *anderer* Systeme darin liegt. Nur die
 * Anzahl, nicht die Daten — bei 22 NES-ROMs will man die nicht im Speicher
 * behalten, nur um eine Fehlermeldung zu formulieren.
 */
export async function extractRomsFromArchive(file: File): Promise<ArchivInhalt> {
  const { Archive } = await loadArchiveLib();

  const reader = await Archive.open(file);
  try {
    if (await reader.hasEncryptedData()) {
      throw new Error(
        'Das Archiv ist passwortgeschützt. Bitte entpacke es vorher und wähle die .gb-Datei direkt aus.',
      );
    }

    const extracted = await reader.extractFiles();
    const roms: RomCandidate[] = [];
    const fremdsysteme = new Map<string, number>();

    // extractFiles() liefert die Verzeichnisstruktur als verschachteltes
    // Objekt; Blätter sind File-Objekte.
    const walk = async (node: unknown, path: string): Promise<void> => {
      if (node instanceof File) {
        const name = path || node.name;
        const data = new Uint8Array(await node.arrayBuffer());

        if (looksLikeGameBoyRom(data)) {
          roms.push({ name, data, guete: bewerteDump(name) });
          return;
        }

        const fremd = erkenneFremdsystem(data, name);
        if (fremd) fremdsysteme.set(fremd, (fremdsysteme.get(fremd) ?? 0) + 1);
        return;
      }
      if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
          await walk(value, path ? `${path}/${key}` : key);
        }
      }
    };

    await walk(extracted, '');
    return { roms: sortiereKandidaten(roms), fremdsysteme };
  } finally {
    // Der Worker hält das entpackte Archiv im Speicher — auf einem iPhone
    // will man den nicht offen stehen lassen.
    await reader.close();
  }
}

/** "22 NES-ROMs" bzw. "3 NES- und 1 Mega-Drive-ROM". */
function beschreibeFremdsysteme(fremdsysteme: Map<string, number>): string {
  const teile = [...fremdsysteme.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([system, anzahl]) => `${anzahl} ${system}-ROM${anzahl === 1 ? '' : 's'}`);

  if (teile.length === 1) return teile[0];
  return `${teile.slice(0, -1).join(', ')} und ${teile[teile.length - 1]}`;
}

/**
 * Der Hinweis, der beim NES-Fall wirklich weiterhilft: benennen, was da ist,
 * und sagen, was stattdessen gebraucht wird.
 */
function fremdsystemFehler(beschreibung: string, imArchiv: boolean): Error {
  const wo = imArchiv ? 'Dieses Archiv enthält' : 'Das ist';
  const nesHinweis = /NES/.test(beschreibung)
    ? ' Adventures of Lolo gibt es für beide Systeme — die NES-Fassung von 1989 und die Game-Boy-Fassung von 1994, mit jeweils eigenen Leveln.'
    : '';

  return new Error(
    `${wo} ${beschreibung}, aber kein Game-Boy-Spiel.${nesHinweis} Diese App emuliert einen Game Boy; du brauchst also eine .gb- oder .gbc-Datei.`,
  );
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
    return [{ name: file.name, data, guete: bewerteDump(file.name) }];
  }

  // Vor allen anderen Meldungen: Ist es ein ROM für ein anderes System?
  // Das ist die häufigste Verwechslung und die einzige, bei der man ohne
  // Hinweis nicht von allein darauf kommt.
  const fremd = erkenneFremdsystem(data, file.name);
  if (fremd) throw fremdsystemFehler(`ein ${fremd}-ROM`, false);

  if (isArchiveName(file.name)) {
    const { roms, fremdsysteme } = await extractRomsFromArchive(file);
    if (roms.length > 0) return roms;

    if (fremdsysteme.size > 0) {
      throw fremdsystemFehler(beschreibeFremdsysteme(fremdsysteme), true);
    }
    throw new Error(
      'In diesem Archiv steckt keine Game-Boy-ROM-Datei. Erwartet wird eine .gb- oder .gbc-Datei.',
    );
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
