import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';


// GitHub Pages serviert das Projekt unter /Adventures-of-LOLO/.
// Scope und start_url im Manifest müssen dazu passen, sonst greift der
// Service Worker nicht und "Zum Home-Bildschirm" startet ins Leere.
export default defineConfig({
  base: '/Adventures-of-LOLO/',
  plugins: [preact()],
  build: {
    target: 'es2020',
    // libarchive.js lädt seinen Worker als eigene Datei nach.
    assetsInlineLimit: 0,
  },
  worker: {
    format: 'es',
  },
  server: {
    host: true,
    port: 5173,
  },
});
