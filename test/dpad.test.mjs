import { test } from 'node:test';
import assert from 'node:assert/strict';

import { directionsFromAngle } from '../src/input/touch.ts';

/**
 * Bildschirmkoordinaten: 0° = rechts, 90° = unten, 180° = links, 270° = oben.
 *
 * Diese Tests halten die Sektorbreite fest. Lolo läuft auf einem Raster und
 * kennt nur vier Richtungen — eine versehentliche Diagonale kostet dort einen
 * Zug. Die Hauptrichtungen bekommen deshalb je 60°, die Diagonalen nur 30°.
 */

test('die vier Hauptrichtungen liegen genau richtig', () => {
  assert.deepEqual(directionsFromAngle(0), ['RIGHT']);
  assert.deepEqual(directionsFromAngle(90), ['DOWN']);
  assert.deepEqual(directionsFromAngle(180), ['LEFT']);
  assert.deepEqual(directionsFromAngle(270), ['UP']);
});

test('Hauptrichtungen halten bis 30° Abweichung durch', () => {
  // Genau der Punkt, an dem ein zittriger Daumen sonst diagonal auslöste.
  assert.deepEqual(directionsFromAngle(29), ['RIGHT']);
  assert.deepEqual(directionsFromAngle(331), ['RIGHT']);
  assert.deepEqual(directionsFromAngle(61), ['DOWN']);
  assert.deepEqual(directionsFromAngle(119), ['DOWN']);
});

test('der Bereich um 0° reicht über den Nulldurchgang hinweg', () => {
  // Rechnet man den Winkelabstand naiv, bricht genau hier die Erkennung.
  assert.deepEqual(directionsFromAngle(359), ['RIGHT']);
  assert.deepEqual(directionsFromAngle(1), ['RIGHT']);
  assert.deepEqual(directionsFromAngle(350), ['RIGHT']);
});

test('Diagonalen gibt es weiterhin — nur schmaler', () => {
  assert.deepEqual(directionsFromAngle(45), ['RIGHT', 'DOWN']);
  assert.deepEqual(directionsFromAngle(135), ['DOWN', 'LEFT']);
  assert.deepEqual(directionsFromAngle(225), ['LEFT', 'UP']);
  assert.deepEqual(directionsFromAngle(315), ['UP', 'RIGHT']);
});

test('jeder Winkel liefert eine gültige Richtung', () => {
  const valid = new Set(['UP', 'DOWN', 'LEFT', 'RIGHT']);
  for (let degrees = 0; degrees < 360; degrees += 0.5) {
    const directions = directionsFromAngle(degrees);
    assert.ok(
      directions.length === 1 || directions.length === 2,
      `${degrees}° ergab ${directions.length} Richtungen`,
    );
    for (const direction of directions) assert.ok(valid.has(direction));

    // Gegensätze dürfen nie zusammen auftreten — das Joypad-Register des
    // Game Boy kann sie zwar darstellen, kein Spiel rechnet damit.
    assert.ok(!(directions.includes('UP') && directions.includes('DOWN')));
    assert.ok(!(directions.includes('LEFT') && directions.includes('RIGHT')));
  }
});

test('Hauptrichtungen decken zwei Drittel des Kreises ab', () => {
  let cardinal = 0;
  let diagonal = 0;
  for (let degrees = 0; degrees < 360; degrees += 0.1) {
    if (directionsFromAngle(degrees).length === 1) cardinal++;
    else diagonal++;
  }
  const share = cardinal / (cardinal + diagonal);
  // 4 × 60° von 360° = zwei Drittel.
  assert.ok(share > 0.66 && share < 0.68, `Anteil war ${share.toFixed(3)}`);
});
