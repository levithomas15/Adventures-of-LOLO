import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeHeaderChecksum,
  erkenneFremdsystem,
  looksLikeGameBoyRom,
  parseRomHeader,
  romFingerprint,
} from '../src/emulator/rom.ts';
import { buildFakeNesRom, buildFakeRom } from './helpers/fake-rom.mjs';

test('liest Titel und Kenndaten aus dem Header', () => {
  const header = parseRomHeader(buildFakeRom({ title: 'TESTROM' }));

  assert.equal(header.title, 'TESTROM');
  assert.equal(header.logoValid, true);
  assert.equal(header.checksumValid, true);
  assert.equal(header.romSize, 0x8000);
  assert.equal(header.isColor, false);
});

test('erkennt Cartridges mit und ohne Batterie', () => {
  // 0x00 = ROM ONLY. So liegt der Fall bei Adventures of Lolo: kein
  // Batteriepuffer, das Spiel speichert per Passwort. Save States sind
  // deshalb der einzige Weg, mitten im Level aufzuhören.
  assert.equal(parseRomHeader(buildFakeRom({ cartridgeType: 0x00 })).hasBattery, false);

  // 0x13 = MBC3+RAM+BATTERY — hier kann die Cartridge selbst speichern.
  const battery = parseRomHeader(buildFakeRom({ cartridgeType: 0x13 }));
  assert.equal(battery.hasBattery, true);
  assert.equal(battery.cartridgeTypeName, 'MBC3+RAM+BATTERY');
  assert.equal(battery.ramSize, 8192);
});

test('Prüfsumme schlägt bei verändertem Header an', () => {
  const rom = buildFakeRom();
  assert.equal(parseRomHeader(rom).checksumValid, true);

  rom[0x134] = 0x5a; // ein Buchstabe im Titel gekippt
  assert.equal(parseRomHeader(rom).checksumValid, false);
  assert.notEqual(computeHeaderChecksum(rom), rom[0x14d]);
});

test('ohne Nintendo-Logo gilt die Datei nicht als ROM', () => {
  const rom = buildFakeRom();
  assert.equal(looksLikeGameBoyRom(rom), true);

  // Der Anfang des Logos ist die harte Grenze — hier wird abgewiesen.
  rom[0x104] = 0x00;
  assert.equal(looksLikeGameBoyRom(rom), false);
  assert.equal(parseRomHeader(rom).logoValid, false);
});

test('ein abweichendes Logo-Ende wird angenommen, aber gemeldet', () => {
  // Nachgebaut aus einer echten Datei: 256 KB, MBC1, Prüfsumme korrekt, im
  // Emulator spielbar — nur die letzten 7 der 48 Logo-Bytes wichen ab.
  // Die strenge Prüfung hätte sie abgewiesen, obwohl binjgb sie startet.
  const rom = buildFakeRom();
  for (let i = 41; i < 48; i++) rom[0x104 + i] = 0x5a;

  assert.equal(
    looksLikeGameBoyRom(rom),
    true,
    'die Schleuse darf nicht strenger sein als der Emulator dahinter',
  );
  assert.equal(
    parseRomHeader(rom).logoValid,
    false,
    'die Abweichung muss trotzdem sichtbar bleiben',
  );
});

test('eine Binärdatei mit zufälligem Inhalt rutscht nicht durch', () => {
  // Nachsichtig beim Logo heißt nicht beliebig: Ohne gültigen Cartridge-Typ
  // und ohne Logo-Anfang bleibt es draußen.
  const muell = new Uint8Array(0x8000);
  muell.fill(0xa5);
  assert.equal(looksLikeGameBoyRom(muell), false);
});

test('unbekannter Cartridge-Typ wird abgewiesen', () => {
  const rom = buildFakeRom();
  rom[0x147] = 0x77; // gibt es nicht
  assert.equal(looksLikeGameBoyRom(rom), false);
});

test('zu kleine Dateien werden abgewiesen, nicht halb gelesen', () => {
  assert.equal(looksLikeGameBoyRom(new Uint8Array(1024)), false);
  assert.throws(() => parseRomHeader(new Uint8Array(1024)), /zu klein/);
});

test('Fingerabdruck ist stabil und unterscheidet ROMs', async () => {
  const a = await romFingerprint(buildFakeRom({ title: 'EINS' }));
  const b = await romFingerprint(buildFakeRom({ title: 'EINS' }));
  const c = await romFingerprint(buildFakeRom({ title: 'ZWEI' }));

  assert.equal(a, b, 'gleiche Datei muss gleiche Kennung ergeben');
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{40}$/);
});

test('erkennt NES-ROMs am iNES-Header', () => {
  // Der Fall, der das ausgelöst hat: ein Archiv "Adventures of Lolo" voller
  // NES-ROMs. Ohne diese Erkennung sagt die App nur, sie habe nichts
  // gefunden — und man sucht den Fehler beim Emulator.
  const nes = buildFakeNesRom();
  assert.equal(erkenneFremdsystem(nes, 'Adventures of Lolo (U) [!].nes'), 'NES');
  assert.equal(looksLikeGameBoyRom(nes), false, 'darf nicht als Game Boy durchgehen');

  // Auch ohne sprechenden Dateinamen, allein am Kopf.
  assert.equal(erkenneFremdsystem(nes, 'spiel.bin'), 'NES');
});

test('erkennt weitere Systeme an der Endung', () => {
  const leer = new Uint8Array(64);
  assert.equal(erkenneFremdsystem(leer, 'spiel.gba'), 'Game Boy Advance');
  assert.equal(erkenneFremdsystem(leer, 'spiel.sfc'), 'Super Nintendo');
  assert.equal(erkenneFremdsystem(leer, 'spiel.z64'), 'Nintendo 64');
  assert.equal(erkenneFremdsystem(leer, 'spiel.md'), 'Mega Drive');
});

test('ein echtes Game-Boy-ROM gilt nicht als Fremdsystem', () => {
  const gb = buildFakeRom();
  assert.equal(erkenneFremdsystem(gb, 'Adventures of Lolo (U) [!].gb'), null);
  assert.equal(erkenneFremdsystem(gb, 'liesmich.txt'), null);
});

test('Fingerabdruck stimmt auch für einen View auf einen größeren Puffer', async () => {
  // So kommen ROMs aus dem Archiv-Entpacker: als Ausschnitt eines größeren
  // Puffers. Würde slice() fehlen, hashte man den ganzen Puffer.
  const rom = buildFakeRom();
  const padded = new Uint8Array(rom.length + 512);
  padded.set(rom, 256);
  const view = padded.subarray(256, 256 + rom.length);

  assert.equal(await romFingerprint(view), await romFingerprint(rom));
});
