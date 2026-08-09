/**
 * Erzeugt die App-Icons aus einem SVG.
 *
 * Auf dem Gerät ist das Icon die halbe Miete: Es ist das, was nach "Zum
 * Home-Bildschirm" bleibt. Ein pixeliges Herz auf grünem LCD liest sich auch
 * bei 60 Pixeln noch eindeutig — feinere Zeichnungen verschwinden dort.
 *
 * Gerendert wird mit dem Chromium der Umgebung, weil keine Bildwerkzeuge
 * installiert sind.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchOptions } from './browser.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'icons');

const HERZ = [
  '.XX.XX.',
  'XXXXXXX',
  'XXXXXXX',
  '.XXXXX.',
  '..XXX..',
  '...X...',
];

/**
 * @param {{ maskable?: boolean }} options
 */
function buildSvg({ maskable = false } = {}) {
  // Maskable-Icons werden vom System beschnitten — der Inhalt muss deshalb
  // in der inneren Sicherheitszone bleiben und der Hintergrund randlos sein.
  const scale = maskable ? 0.62 : 0.82;
  const size = 512;
  const inner = size * scale;
  const offset = (size - inner) / 2;

  const zellen = [];
  const pixel = inner / 12;
  const herzBreite = HERZ[0].length * pixel;
  const herzHoehe = HERZ.length * pixel;
  const herzX = offset + (inner - herzBreite) / 2;
  const herzY = offset + (inner - herzHoehe) / 2;

  HERZ.forEach((zeile, y) => {
    [...zeile].forEach((zeichen, x) => {
      if (zeichen !== 'X') return;
      zellen.push(
        `<rect x="${herzX + x * pixel}" y="${herzY + y * pixel}" width="${pixel * 0.92}" height="${pixel * 0.92}" fill="#0f380f" rx="${pixel * 0.12}"/>`,
      );
    });
  });

  const radius = maskable ? 0 : size * 0.22;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="#2c2c36"/>
  <rect x="${offset}" y="${offset}" width="${inner}" height="${inner}"
        rx="${inner * 0.08}" fill="#9bbc0f"/>
  <rect x="${offset}" y="${offset}" width="${inner}" height="${inner}"
        rx="${inner * 0.08}" fill="none" stroke="#5b5b66" stroke-width="${size * 0.028}"/>
  ${zellen.join('\n  ')}
</svg>`;
}

const SIZES = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
  // iOS nimmt genau diese Datei für den Home-Bildschirm.
  { file: 'apple-touch-icon.png', size: 180, maskable: false },
];

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'icon.svg'), buildSvg());

const browser = await chromium.launch(launchOptions());
try {
  for (const { file, size, maskable } of SIZES) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    const svg = buildSvg({ maskable });
    await page.setContent(
      `<style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    );
    await page.screenshot({ path: join(outDir, file), omitBackground: true });
    await page.close();
    console.log(`icon → public/icons/${file} (${size}×${size})`);
  }
} finally {
  await browser.close();
}
