/**
 * Kopiert die libarchive.js-Laufzeit nach public/vendor/libarchive/.
 *
 * Warum nicht einfach importieren? Der Worker sucht sein WASM über
 * `new URL("libarchive.wasm", import.meta.url)` — also relativ zu sich selbst.
 * Ließe man Vite die Dateien bündeln, bekämen sie getrennte Hash-Namen und
 * lägen nicht mehr nebeneinander; der Worker fände sein WASM nicht.
 *
 * In public/ liegen beide unangetastet im selben Verzeichnis, in dev wie build.
 * Deshalb sind sie nicht eingecheckt, sondern werden vor jedem Lauf erzeugt.
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', 'libarchive.js', 'dist');
const to = join(root, 'public', 'vendor', 'libarchive');

const FILES = ['worker-bundle.js', 'libarchive.wasm'];

await mkdir(to, { recursive: true });
for (const file of FILES) {
  await copyFile(join(from, file), join(to, file));
}
console.log(`libarchive → public/vendor/libarchive/ (${FILES.join(', ')})`);
