import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeHeaderChecksum,
  looksLikeGameBoyRom,
  parseRomHeader,
  romFingerprint,
} from '../src/emulator/rom.ts';
import { buildFakeRom } from './helpers/fake-rom.mjs';

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

  rom[0x104] = 0x00;
  assert.equal(looksLikeGameBoyRom(rom), false);
  assert.equal(parseRomHeader(rom).logoValid, false);
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

test('Fingerabdruck stimmt auch für einen View auf einen größeren Puffer', async () => {
  // So kommen ROMs aus dem Archiv-Entpacker: als Ausschnitt eines größeren
  // Puffers. Würde slice() fehlen, hashte man den ganzen Puffer.
  const rom = buildFakeRom();
  const padded = new Uint8Array(rom.length + 512);
  padded.set(rom, 256);
  const view = padded.subarray(256, 256 + rom.length);

  assert.equal(await romFingerprint(view), await romFingerprint(rom));
});
