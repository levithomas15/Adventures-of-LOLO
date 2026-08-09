/**
 * End-zu-End-Test des tatsächlichen Nutzerwegs.
 *
 * Geprüft wird die Kette, auf die es ankommt und die sich mit Unit-Tests
 * nicht abbilden lässt:
 *
 *   .7z auswählen → entpacken → ROM erkennen → booten → spielen →
 *   speichern → Seite neu laden → an derselben Stelle weiter
 *
 * Läuft gegen den gebauten Stand (`vite preview`), nicht gegen den
 * Dev-Server — damit auch der Basis-Pfad und die mitgelieferten
 * WASM-Dateien so geprüft werden, wie sie später auf GitHub Pages liegen.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchOptions } from '../scripts/browser.mjs';
import { makeFixtures } from './make-fixtures.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4173;
const BASIS = `http://127.0.0.1:${PORT}/Adventures-of-LOLO/`;

const ergebnisse = [];
const pruefe = (name, bestanden, detail = '') => {
  ergebnisse.push({ name, bestanden, detail });
  console.log(`${bestanden ? 'PASS  ' : 'FAIL  '}${name}${detail ? `  — ${detail}` : ''}`);
};

if (!existsSync(join(root, 'dist', 'index.html'))) {
  console.error('dist/ fehlt — bitte zuerst `npm run build` ausführen.');
  process.exit(1);
}

const { archivePath } = makeFixtures();

const server = spawn(
  'npx',
  ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1'],
  { cwd: root, stdio: 'ignore' },
);

/** Wartet, bis der Server antwortet — statt blind zu schlafen. */
async function warteAufServer(versuche = 40) {
  for (let i = 0; i < versuche; i++) {
    try {
      const antwort = await fetch(BASIS);
      if (antwort.ok) return;
    } catch {
      /* noch nicht oben */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Der Vorschau-Server kam nicht hoch.');
}

/** Anteil nicht-transparenter, nicht-einfarbiger Pixel auf dem Bildschirm. */
const CANVAS_SIGNATUR = () => {
  const canvas = document.querySelector('.bildschirm canvas');
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let summe = 0;
  for (let i = 0; i < data.length; i += 4) summe += data[i] + data[i + 1] + data[i + 2];
  return summe;
};

let browser;
try {
  await warteAufServer();

  browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    locale: 'de-DE',
  });
  const page = await context.newPage();

  const fehler = [];
  page.on('pageerror', (e) => fehler.push(String(e.message)));
  page.on('console', (m) => {
    if (m.type() === 'error') fehler.push(m.text());
  });

  await page.goto(BASIS, { waitUntil: 'networkidle' });

  // --- Import ------------------------------------------------------------

  await page.waitForSelector('input[type=file][accept*=".7z"]', { state: 'attached', timeout: 15000 });
  pruefe('Startbildschirm fragt nach einem ROM', await page.locator('text=Spiel laden').isVisible());

  await page.setInputFiles('input[type=file][accept*=".7z"]', archivePath);

  // Der Titel aus dem Cartridge-Header erscheint erst, wenn das Archiv
  // entpackt, das ROM erkannt und geladen wurde.
  await page.waitForSelector('text=TESTROM', { timeout: 30000 });
  pruefe('.7z entpackt und ROM erkannt', true, 'Titel aus dem Header: TESTROM');

  // --- Emulation ---------------------------------------------------------

  await page.waitForTimeout(1200);
  const bild1 = await page.evaluate(CANVAS_SIGNATUR);
  await page.waitForTimeout(1200);
  const bild2 = await page.evaluate(CANVAS_SIGNATUR);

  pruefe('Bildschirm zeigt etwas an', bild1 !== null && bild1 > 0, `Signatur ${bild1}`);
  pruefe(
    'Bild verändert sich, das Spiel läuft also',
    bild1 !== bild2,
    `${bild1} → ${bild2}`,
  );

  await page.screenshot({ path: join(root, 'test', 'fixtures', 'generated', 'shot-spiel.png') });

  // --- Steuerung ---------------------------------------------------------

  const kreuz = page.locator('.kreuz');
  const kasten = await kreuz.boundingBox();
  // Auf die rechte Hälfte des Steuerkreuzes tippen und halten.
  await page.touchscreen.tap(kasten.x + kasten.width * 0.85, kasten.y + kasten.height / 2);
  await page.waitForTimeout(150);
  pruefe('Steuerkreuz nimmt Berührungen an', true, 'ohne Ausnahme ausgelöst');

  // --- Speichern ---------------------------------------------------------

  await page.locator('.leiste-knopf', { hasText: 'Menü' }).click();
  await page.waitForSelector('text=Speicherplätze', { timeout: 10000 });
  pruefe('Menü öffnet und pausiert', true);

  const plaetze = page.locator('.plaetze').first().locator('.platz');
  await plaetze.nth(0).click();
  await page.waitForTimeout(800);

  const belegt = await plaetze.nth(0).getAttribute('data-belegt');
  pruefe('Speicherplatz 1 ist danach belegt', belegt === 'true', `data-belegt=${belegt}`);

  const hatVorschau = await plaetze.nth(0).locator('img').count();
  pruefe('Speicherplatz zeigt ein Vorschaubild', hatVorschau > 0);

  // --- Neu laden und fortsetzen -----------------------------------------

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  const titelDa = await page.locator('text=TESTROM').count();
  pruefe('ROM überlebt das Neuladen', titelDa > 0, 'kein erneuter Import nötig');

  const weiter = page.locator('button', { hasText: /Weiterspielen|Starten/ }).first();
  pruefe('Fortsetzen wird angeboten', await weiter.isVisible());

  await weiter.click();
  await page.waitForTimeout(1500);

  const bild3 = await page.evaluate(CANVAS_SIGNATUR);
  await page.waitForTimeout(1200);
  const bild4 = await page.evaluate(CANVAS_SIGNATUR);
  pruefe('Nach dem Neuladen läuft es weiter', bild3 !== bild4, `${bild3} → ${bild4}`);

  // --- Speicherstand nach dem Neuladen ----------------------------------

  await page.locator('.leiste-knopf', { hasText: 'Menü' }).click();
  await page.waitForSelector('text=Speicherplätze', { timeout: 10000 });
  const plaetze2 = page.locator('.plaetze').first().locator('.platz');
  pruefe(
    'Gespeicherter Platz ist noch da',
    (await plaetze2.nth(0).getAttribute('data-belegt')) === 'true',
  );

  // Laden aus dem Speicherplatz
  await page.locator('.knopf', { hasText: 'Laden' }).first().click();
  await plaetze2.nth(0).click();
  await page.waitForTimeout(1500);
  pruefe('Laden aus dem Speicherplatz löst keinen Fehler aus', true);

  await page.screenshot({ path: join(root, 'test', 'fixtures', 'generated', 'shot-menue.png') });

  // --- Konsolenfehler ----------------------------------------------------

  // Fehlende Favicon-Anfragen sind unerheblich.
  const echte = fehler.filter((f) => !/favicon/i.test(f));
  pruefe('Keine Konsolenfehler', echte.length === 0, echte.slice(0, 3).join(' | '));
} catch (fehler) {
  pruefe('Durchlauf ohne Ausnahme', false, String(fehler?.stack ?? fehler));
} finally {
  await browser?.close();
  server.kill();
}

const durchgefallen = ergebnisse.filter((e) => !e.bestanden);
console.log('---');
console.log(
  durchgefallen.length
    ? `${durchgefallen.length} von ${ergebnisse.length} fehlgeschlagen`
    : `alle ${ergebnisse.length} bestanden`,
);
process.exit(durchgefallen.length ? 1 : 0);
