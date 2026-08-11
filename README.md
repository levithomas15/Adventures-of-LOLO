# Adventures of LOLO

Ein Game Boy fürs iPhone — als Website, die du auf den Home-Bildschirm legst.
Gehäuse, Steuerkreuz, A/B, Start/Select. Jederzeit anhalten, jederzeit
weiterspielen: Die App speichert automatisch, und zusätzlich gibt es sechs
Speicherplätze mit Vorschaubild.

**→ https://levithomas15.github.io/Adventures-of-LOLO/**

---

## Das Spiel bringst du selbst mit

Hier liegt **kein ROM** bei. *Adventures of Lolo* gehört HAL Laboratory und
Nintendo; diese App ist nur der Emulator. Du importierst deine eigene Datei —
einmal, danach bleibt sie auf dem Gerät.

**`.7z` und `.zip` kannst du direkt auswählen.** Die App packt selbst aus.
Das ist kein Beiwerk: Die iPhone-Dateien-App öffnet zwar ZIP, aber **kein 7z** —
ohne den eingebauten Entpacker kämst du auf dem Telefon gar nicht an die
`.gb`-Datei heran.

Erkannt wird das ROM am Nintendo-Logo im Cartridge-Header, nicht an der
Dateiendung. Beipack wie `liesmich.txt` im Archiv wird übersprungen, und
liegen mehrere Spiele darin, fragt die App nach.

**ROMs anderer Systeme werden benannt.** Enthält das Archiv etwa NES-Dateien,
sagt die App das auch — statt nur „nichts gefunden" zu melden. *Adventures of
Lolo* gibt es nämlich zweimal: NES (1989) und Game Boy (1994), mit jeweils
eigenen Leveln. Diese App emuliert einen Game Boy und braucht deshalb die
Fassung von 1994.

**Beschädigte Abzüge sind ausgeblendet.** In ROM-Sammlungen steckt die Güte
im Dateinamen: `[!]` geprüft, `[T+Ger]` übersetzt, `[b1]`/`[o1]`/`[h1]`
beschädigt, überdumpt oder verändert. Die Auswahl zeigt die brauchbaren zuerst
und klappt den Rest weg — in einem typischen Satz ist die Mehrheit der Dateien
defekt, und ohne Vorsortierung greift man leicht daneben und hält dann den
Emulator für schuld. Jeder Eintrag nennt zusätzlich den Titel aus dem
Cartridge-Header, weil sich die Dateinamen oft nur um ein Kürzel unterscheiden.

## Einrichten auf dem iPhone

1. Die Seite in **Safari** öffnen.
2. **Teilen → Zum Home-Bildschirm.**
3. Aus dem neuen Symbol starten, **Datei auswählen** tippen, dein Archiv wählen.

Schritt 2 ist nicht Kosmetik. Safari löscht Website-Daten nach **sieben Tagen
ohne Besuch** (Intelligent Tracking Prevention) — Spielstände inklusive. Für
eine App auf dem Home-Bildschirm gilt das nicht. Zusätzlich bittet die App um
dauerhaften Speicher und kann über **Menü → Sicherung → Exportieren** alles in
eine Datei schreiben, die du in iCloud legen kannst.

## Speichern

Die Game-Boy-Fassung von Lolo hat **keinen Batteriepuffer** — im Original
arbeitet sie mit Passwörtern. Das Spiel kann deinen Fortschritt also gar nicht
selbst sichern. Deshalb steht das Speichern hier im Mittelpunkt:

- **Automatisch** alle 30 Sekunden, bei jeder Pause und sobald du die App
  wegschaltest oder den Bildschirm sperrst. Drei Stände rotieren, damit ein
  ungünstiger Moment nicht den einzigen Rettungsanker überschreibt.
- **Sechs Plätze** von Hand, jeder mit Vorschaubild und Zeitstempel.
- **Fortsetzen** beim Start lädt den jüngsten automatischen Stand.
- **Export/Import** aller Daten als eine `.json`-Datei.

Die App erkennt am Cartridge-Header, ob ein Spiel selbst speichern kann, und
weist im Menü darauf hin, wenn nicht.

## Steuerung

Das Steuerkreuz ist **eine** Fläche; die Richtung ergibt sich aus der Lage
deines Daumens zur Mitte. Dadurch funktioniert das Durchziehen von einer
Richtung in die nächste, ohne dass eine Eingabe hängenbleibt — der übliche
Fehler bei Vier-Knöpfe-Lösungen.

Die vier Hauptrichtungen bekommen je 60°, die Diagonalen nur 30°. Das ist
bewusst auf dieses Spiel zugeschnitten: Lolo läuft auf einem Raster und kennt
nur vier Richtungen, eine versehentliche Diagonale kostet dort einen Zug.

Am Rechner: Pfeiltasten oder WASD, `X` = A, `Y`/`Z` = B, Enter = Start,
Umschalt = Select.

## Bildschirmfarbe

Standard ist das originale DMG-Grün. Unter **Menü → Einstellungen →
Bildschirmfarbe** gibt es außerdem Pocket-Grau, Light-Blaugrün und
**Spielfarben**.

Letzteres lohnt sich bei Adventures of Lolo: Das Spiel unterstützt den
**Super Game Boy** (Flag `0x03` im Header) und bringt eigene Farbpaletten mit
— Titelbild in Rosa und Türkis statt Grün. Das ist genau das Bild, das die
Cartridge an einem Super Game Boy erzeugt hätte.

Technisch setzt die App die vier Töne nicht über die Palettenfunktion des
Emulators, sondern rechnet das fertige Bild um: Helligkeit bestimmen, auf vier
Stufen runden, Ton einsetzen. Der Grund ist, dass binjgb im SGB-Modus aus
`SGB.screen_pal` zeichnet und eine gesetzte Schwarzweiß-Palette gar nicht
ansieht — die Einstellung wäre bei genau den Spielen wirkungslos, bei denen
sie am ehesten auffällt.

## Kein Ton?

Auf dem iPhone gilt für Web-Audio der **seitliche Stummschalter** — auch dann,
wenn andere Apps klingen. Außerdem startet der Ton erst nach der ersten
Berührung; das verlangt iOS so.

## Entwicklung

```bash
npm install
npm run dev        # http://localhost:5173/Adventures-of-LOLO/
npm run build
npm test           # Header-Auswertung und Steuerkreuz-Geometrie
npm run test:e2e   # kompletter Weg im Browser (setzt npm run build voraus)
```

Der End-zu-End-Test spielt den echten Ablauf durch: `.7z` auswählen →
entpacken → booten → spielen → speichern → Seite neu laden → weiterspielen.
Er benutzt ein **selbstgebautes Test-ROM** (`test/helpers/fake-rom.mjs`), das
den Bildschirm einfärbt — es wird kein fremdes Spiel gebraucht, und dein ROM
taucht nirgends im Repo auf.

### Aufbau

```
src/emulator/   core.ts (Schnittstelle) · binjgb-core.ts · rom.ts (Header)
src/storage/    IndexedDB: ROMs, Speicherstände, Sicherung
src/import/     Archive entpacken (libarchive.js, erst bei Bedarf geladen)
src/input/      Multitouch-Auswertung fürs Steuerkreuz
src/platform/   Dauerspeicher, Wake Lock
src/ui/         Gehäuse, Pausenmenü, Startbildschirm
src/session.ts  Emulator, Spielzeit und Auto-Speicherung
```

`src/emulator/core.ts` ist eine bewusste Trennlinie: Nur der Adapter dahinter
kennt den Emulator. Das hat sich schon bezahlt gemacht — siehe unten.

### Warum binjgb und nicht WasmBoy

Der erste Anlauf lief auf [WasmBoy](https://github.com/torch2424/wasmboy).
Es stellte sich heraus, dass dessen `saveState()` im Hauptthread nur eine
**Kopie des Speichers vom Ladezeitpunkt** zurückgibt: Gemessen lief der
Emulator mit 60 Bildern je Sekunde und veränderte 59 153 Bytes, während jeder
Speicherstand unverändert blieb. Nichts stürzte ab, nichts wurde rot — man
hätte es erst gemerkt, wenn man nach einer Woche fortsetzen will.

Für eine App, deren Kern das Speichern ist, war das die falsche Grundlage.
[binjgb](https://github.com/binji/binjgb) (MIT, Ben Smith) rechnet im
Hauptthread, und ein Speicherstand ist dort schlicht ein Byte-Feld, das
synchron aus dem WASM-Speicher gelesen wird — kein Zwischenspeicher, der
veralten kann. Nebenbei: genauer, aktiv gepflegt, und das Bündel schrumpfte
von 410 kB auf 54 kB.

Der Wechsel kostete den Austausch **einer** Datei. Ein Prüfstand
(`test/fixtures/roundtrip.html`) hält das jetzt fest: Stände müssen sich
unterscheiden, unverändert bleiben, byte-genau zurückkommen und mehrfach
ladbar sein.

## Lizenz

MIT — siehe [LICENSE](LICENSE). Enthält binjgb (MIT, Ben Smith) unter
`public/vendor/binjgb/`. Keinerlei Spieldaten.
