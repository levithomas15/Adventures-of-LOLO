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
import { buildFakeRom } from './helpers/fake-rom.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = join(here, 'fixtures', 'generated');
export const ROM_PATH = join(FIXTURE_DIR, 'testrom.gb');
export const ARCHIVE_PATH = join(FIXTURE_DIR, 'testrom.7z');

export function makeFixtures() {
  mkdirSync(FIXTURE_DIR, { recursive: true });

  const rom = buildFakeRom({ title: 'TESTROM' });
  writeFileSync(ROM_PATH, rom);

  // Zusätzlich eine Textdatei ins Archiv, damit der Import beweisen muss,
  // dass er anhand des Headers filtert und nicht einfach die erste Datei nimmt.
  const readme = join(FIXTURE_DIR, 'liesmich.txt');
  writeFileSync(readme, 'Kein ROM. Muss beim Import übersprungen werden.\n');

  execFileSync('python3', [
    '-c',
    `import py7zr, sys
with py7zr.SevenZipFile(sys.argv[1], 'w') as a:
    a.write(sys.argv[2], 'liesmich.txt')
    a.write(sys.argv[3], 'Adventures of Lolo (Test).gb')
`,
    ARCHIVE_PATH,
    readme,
    ROM_PATH,
  ]);

  return { romPath: ROM_PATH, archivePath: ARCHIVE_PATH };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { romPath, archivePath } = makeFixtures();
  console.log('ROM     →', romPath);
  console.log('Archiv  →', archivePath);
}
