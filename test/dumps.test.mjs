import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bewerteDump, sortiereKandidaten } from '../src/import/archive.ts';

/**
 * Einstufung nach GoodTools-Benennung.
 *
 * Anlass war ein echtes Archiv mit 22 Dateien, von denen nur 2 geprüfte
 * Abzüge waren und 15 beschädigt. Ohne Vorsortierung greift man dort mit
 * hoher Wahrscheinlichkeit daneben und hält den Emulator für kaputt.
 */

test('erkennt geprüfte Abzüge', () => {
  assert.equal(bewerteDump('Adventures of Lolo (U) [!].gb'), 'geprueft');
  assert.equal(bewerteDump('Adventures of Lolo (E) [!].gb'), 'geprueft');
});

test('erkennt Übersetzungen', () => {
  assert.equal(bewerteDump('Adventures of Lolo (U) [T+Ger].gb'), 'uebersetzung');
  assert.equal(bewerteDump('Adventures of Lolo (U) [T-Fre].gb'), 'uebersetzung');
});

test('erkennt beschädigte Abzüge, Überdumps und Hacks', () => {
  for (const name of [
    'Adventures of Lolo (U) [b1].gb',
    'Adventures of Lolo (U) [b].gb',
    'Adventures of Lolo (U) [o1].gb',
    'Adventures of Lolo (U) [h3].gb',
    'Adventures of Lolo (U) [a1].gb',
    'Adventures of Lolo (U) [f1].gb',
  ]) {
    assert.equal(bewerteDump(name), 'problematisch', name);
  }
});

test('ein kaputter Abzug bleibt kaputt, auch wenn er übersetzt wurde', () => {
  // Genau diese Kombination kam im echten Archiv vor. Würde die
  // Übersetzungsprüfung zuerst greifen, landete eine Überdump-Datei
  // ungewarnt in der empfohlenen Liste.
  assert.equal(bewerteDump('Adventures of Lolo (U) [o1][T+Ger].nes'), 'problematisch');
});

test('Dateien ohne Kennzeichen gelten als normal', () => {
  assert.equal(bewerteDump('Adventures of Lolo.gb'), 'normal');
  assert.equal(bewerteDump('lolo.gb'), 'normal');
});

test('sortiert gute nach oben und kaputte nach unten', () => {
  const kandidaten = [
    { name: 'Lolo [b1].gb', guete: bewerteDump('Lolo [b1].gb') },
    { name: 'Lolo [T+Ger].gb', guete: bewerteDump('Lolo [T+Ger].gb') },
    { name: 'Lolo.gb', guete: bewerteDump('Lolo.gb') },
    { name: 'Lolo [!].gb', guete: bewerteDump('Lolo [!].gb') },
  ];

  assert.deepEqual(
    sortiereKandidaten(kandidaten).map((k) => k.name),
    ['Lolo [!].gb', 'Lolo.gb', 'Lolo [T+Ger].gb', 'Lolo [b1].gb'],
  );
});

test('ein Satz wie das echte Archiv wird richtig aufgeteilt', () => {
  // Nachgebaut aus den tatsächlichen 22 Dateinamen.
  const namen = [
    'Adventures of Lolo (E) [!].gb',
    'Adventures of Lolo (U) [!].gb',
    ...['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9', 'ba', 'bb', 'bc'].map(
      (t) => `Adventures of Lolo (U) [${t}].gb`,
    ),
    ...['o1', 'o2', 'o3'].map((t) => `Adventures of Lolo (U) [${t}].gb`),
    'Adventures of Lolo (U) [o1][T+Ger].gb',
    'Adventures of Lolo (U) [T+Fre].gb',
    'Adventures of Lolo (U) [T+Ger].gb',
    'Adventures of Lolo (U) [T+Ita1.0b_Dark_Schneider].gb',
    'Adventures of Lolo (U) [T+Swe1.0_TheTranslator].gb',
  ];

  const kandidaten = namen.map((name) => ({ name, guete: bewerteDump(name) }));
  const brauchbar = kandidaten.filter((k) => k.guete !== 'problematisch');
  const kaputt = kandidaten.filter((k) => k.guete === 'problematisch');

  assert.equal(namen.length, 22);
  assert.equal(brauchbar.length, 6, 'zwei geprüfte plus vier reine Übersetzungen');
  assert.equal(kaputt.length, 16, 'zwölf schlechte, drei Überdumps, eine Kombination');

  // Die beiden geprüften Abzüge müssen ganz oben stehen.
  const sortiert = sortiereKandidaten(kandidaten);
  assert.equal(sortiert[0].guete, 'geprueft');
  assert.equal(sortiert[1].guete, 'geprueft');
  assert.equal(sortiert[sortiert.length - 1].guete, 'problematisch');
});
