/**
 * Erzeugt die Testdateien: ein selbstgebautes Game-Boy-ROM, einmal roh,
 * einmal in ein .7z verpackt.
 *
 * Das .7z ist der eigentliche Prüfstein — es ist der Fall, für den die App
 * überhaupt einen Entpacker mitbringt (iOS kann 7z nicht öffnen).
 * Gepackt wird mit py7zr, weil im Container kein 7z-Kommando liegt.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildFakeNesRom,
  buildFakeRom,
  buildInvalidOpcodeRom,
  buildJoypadRom,
} from './helpers/fake-rom.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = join(here, 'fixtures', 'generated');
export const ROM_PATH = join(FIXTURE_DIR, 'testrom.gb');
/** ROM, dessen Bildschirmfarbe am Joypad hängt — prüft, ob Eingaben ankommen. */
export const JOYPAD_ROM_PATH = join(FIXTURE_DIR, 'joypad.gb');
/** ROM, das absichtlich in einen ungültigen Befehl läuft. */
export const BADOP_ROM_PATH = join(FIXTURE_DIR, 'badop.gb');
export const ARCHIVE_PATH = join(FIXTURE_DIR, 'testrom.7z');
/** Archiv mit ausschließlich NES-ROMs — der Fall aus der Praxis. */
export const NES_ARCHIVE_PATH = join(FIXTURE_DIR, 'nur-nes.7z');
/** Archiv mit mehreren Game-Boy-Abzügen unterschiedlicher Güte. */
export const MIXED_ARCHIVE_PATH = join(FIXTURE_DIR, 'gemischte-dumps.7z');

/** Packt Dateien mit py7zr — im Container gibt es kein 7z-Kommando. */
function packe7z(ziel, dateien) {
  execFileSync('python3', [
    '-c',
    `import py7zr, sys
ziel = sys.argv[1]
paare = sys.argv[2:]
with py7zr.SevenZipFile(ziel, 'w') as a:
    for i in range(0, len(paare), 2):
        a.write(paare[i], paare[i + 1])
`,
    ziel,
    ...dateien.flatMap(({ pfad, name }) => [pfad, name]),
  ]);
}

export function makeFixtures() {
  mkdirSync(FIXTURE_DIR, { recursive: true });

  const rom = buildFakeRom({ title: 'TESTROM' });
  writeFileSync(ROM_PATH, rom);
  writeFileSync(JOYPAD_ROM_PATH, buildJoypadRom());
  writeFileSync(BADOP_ROM_PATH, buildInvalidOpcodeRom());

  // Zusätzlich eine Textdatei ins Archiv, damit der Import beweisen muss,
  // dass er anhand des Headers filtert und nicht einfach die erste Datei nimmt.
  const readme = join(FIXTURE_DIR, 'liesmich.txt');
  writeFileSync(readme, 'Kein ROM. Muss beim Import übersprungen werden.\n');

  packe7z(ARCHIVE_PATH, [
    { pfad: readme, name: 'liesmich.txt' },
    { pfad: ROM_PATH, name: 'Adventures of Lolo (Test).gb' },
  ]);

  // Ein Archiv, das nur NES-ROMs enthält — genau der Fall, an dem die App
  // vorher nur "nichts gefunden" meldete, statt zu sagen, was drin liegt.
  const nesPfad = join(FIXTURE_DIR, 'nes-attrappe.nes');
  writeFileSync(nesPfad, buildFakeNesRom());
  packe7z(
    NES_ARCHIVE_PATH,
    ['(E) [!]', '(U) [!]', '(U) [b1]'].map((tag) => ({
      pfad: nesPfad,
      name: `Adventures of Lolo ${tag}.nes`,
    })),
  );

  // Mehrere Game-Boy-Abzüge unterschiedlicher Güte. Die Auswahlliste muss
  // die beschädigten ausblenden, bis man sie ausdrücklich anfordert.
  packe7z(MIXED_ARCHIVE_PATH, [
    { pfad: ROM_PATH, name: 'Adventures of Lolo (U) [!].gb' },
    { pfad: ROM_PATH, name: 'Adventures of Lolo (U) [T+Ger].gb' },
    { pfad: ROM_PATH, name: 'Adventures of Lolo (U) [b1].gb' },
    { pfad: ROM_PATH, name: 'Adventures of Lolo (U) [bc].gb' },
    { pfad: ROM_PATH, name: 'Adventures of Lolo (U) [o1].gb' },
  ]);

  return {
    romPath: ROM_PATH,
    joypadRomPath: JOYPAD_ROM_PATH,
    badopRomPath: BADOP_ROM_PATH,
    archivePath: ARCHIVE_PATH,
    nesArchivePath: NES_ARCHIVE_PATH,
    mixedArchivePath: MIXED_ARCHIVE_PATH,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pfade = makeFixtures();
  for (const [name, pfad] of Object.entries(pfade)) {
    console.log(`${name.padEnd(18)} → ${pfad}`);
  }
}
