import {
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  type EmulatorCore,
  type EmulatorSnapshot,
  type JoypadState,
} from './core';

/**
 * Emulator-Kern auf Basis von binjgb (MIT, Ben Smith).
 *
 * Gewählt nach einem gescheiterten Anlauf mit WasmBoy: Dessen `saveState()`
 * liefert im Hauptthread eine Kopie des Speichers vom Ladezeitpunkt, weil der
 * Abgleich mit dem Worker nicht greift. Gemessen: Der Emulator lief mit 60
 * Bildern je Sekunde und veränderte 59 153 Bytes, während jeder
 * Speicherstand unverändert blieb. Für eine App, deren Kern das Speichern
 * ist, war das die falsche Grundlage.
 *
 * binjgb rechnet im Hauptthread, und ein Speicherstand ist schlicht ein
 * Byte-Feld, das synchron aus dem WASM-Speicher gelesen wird — es gibt keinen
 * Zwischenspeicher, der veralten könnte.
 */

export const BINJGB_CORE_NAME = 'binjgb-1';

/** Rückgabewerte von `emulator_run_until_f64` (Bitmaske). */
const EVENT_NEW_FRAME = 1;
const EVENT_AUDIO_BUFFER_FULL = 2;
const EVENT_UNTIL_TICKS = 4;
const EVENT_BREAKPOINT = 8;
const EVENT_INVALID_OPCODE = 16;

/**
 * Obergrenze für Durchläufe je Bild.
 *
 * Ein Bild braucht normalerweise eine Handvoll Durchläufe. Diese Schranke
 * greift nur, wenn etwas grundlegend schiefgeht — und sorgt dafür, dass ein
 * einzelnes Bild niemals den Hauptthread festhält. Der Emulator rechnet hier
 * ohne Worker; eine Endlosschleife friert die ganze Seite ein, Menü und
 * Knöpfe inbegriffen.
 */
const MAX_DURCHLAEUFE_JE_BILD = 512;

const CPU_TICKS_PER_SECOND = 4194304;
/** Höchstens fünf Bilder pro Durchlauf nachholen. */
const MAX_UPDATE_SEC = 5 / 60;
const AUDIO_FRAMES = 4096;
const AUDIO_LATENCY_SEC = 0.1;
/** Weiter als so darf der eingeplante Ton der Echtzeit nicht vorauseilen. */
const AUDIO_MAX_VORLAUF_SEC = 0.5;
/** Farbkurve für GBC-Titel: 2 entspricht Gambatte. */
const CGB_COLOR_CURVE = 2;

/**
 * Die vier Grautöne, die der Game Boy darstellen kann — hier als echte Farben.
 *
 * Nicht über binjgbs eingebaute Palettentabelle: Deren 84 Einträge sind die
 * Farbschemata des Game Boy *Color*, mit denen dieser DMG-Spiele einfärbt.
 * Sie geben Hintergrund und Sprites unterschiedliche Farben, weshalb das Bild
 * bunt wird — hübsch, aber eben kein Game Boy. Wer ein grünes Gehäuse mit
 * grünem Bildschirm erwartet, bekäme Rosa und Türkis.
 *
 * `emulator_set_bw_palette_simple` nimmt dagegen vier Farben je Palettentyp
 * entgegen. Setzt man allen drei Typen dieselben vier Töne, entsteht genau
 * das Bild eines echten DMG — und die Werte stimmen mit `--lcd-*` in
 * styles.css überein, sodass Bildschirm und Gehäuse zusammenpassen.
 */
/** RGBA als u32 in der Reihenfolge 0xAABBGGRR — so liegt es im Canvas-Puffer. */
function rgba(hex: string): number {
  const wert = parseInt(hex.slice(1), 16);
  const r = (wert >> 16) & 0xff;
  const g = (wert >> 8) & 0xff;
  const b = wert & 0xff;
  return ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

/** Je vier Töne von hell nach dunkel. */
export const PALETTEN: Record<string, readonly [string, string, string, string]> = {
  // Das originale DMG-Grün.
  dmg: ['#9bbc0f', '#8bac0f', '#306230', '#0f380f'],
  // Game Boy Pocket: neutrales Grau.
  pocket: ['#c4cfa1', '#8b956d', '#4d533c', '#1f1f1f'],
  // Game Boy Light: kühles Blaugrün.
  light: ['#92d1c8', '#5aa79c', '#2c6a63', '#0d3b36'],
};

/**
 * Sonderfall: die Farben, die das Spiel selbst vorgibt.
 *
 * Adventures of Lolo unterstützt den Super Game Boy (Flag 0x03 im Header) und
 * schickt beim Start eigene Farbpaletten. binjgb setzt diese Paletten dann
 * über unsere — im Ergebnis erscheint das Titelbild rosa und türkis statt
 * grün. Das ist keine Fehlfunktion, sondern genau das Bild, das die Cartridge
 * an einem Super Game Boy erzeugt hätte, und es sieht ausgesprochen gut aus.
 *
 * Nur passt es nicht zu einem Gehäuse mit grünem Bildschirm. Deshalb ist es
 * eine eigene Auswahl statt eine stille Überraschung.
 */
export const PALETTE_SPIELFARBEN = 'spiel';

interface BinjgbModule {
  HEAP8: { buffer: ArrayBuffer };
  _malloc(size: number): number;
  _free(ptr: number): void;
  _emulator_new_simple(
    romPtr: number,
    romSize: number,
    sampleRate: number,
    audioFrames: number,
    colorCurve: number,
  ): number;
  _emulator_delete(e: number): void;
  _joypad_new(): number;
  _joypad_delete(ptr: number): void;
  _emulator_set_default_joypad_callback(e: number, joypadBuffer: number): void;
  _emulator_run_until_f64(e: number, ticks: number): number;
  _emulator_get_ticks_f64(e: number): number;
  _get_frame_buffer_ptr(e: number): number;
  _get_frame_buffer_size(e: number): number;
  _get_audio_buffer_ptr(e: number): number;
  _get_audio_buffer_capacity(e: number): number;
  _state_file_data_new(e: number): number;
  _ext_ram_file_data_new(e: number): number;
  _get_file_data_ptr(ptr: number): number;
  _get_file_data_size(ptr: number): number;
  _file_data_delete(ptr: number): void;
  _emulator_write_state(e: number, ptr: number): number;
  _emulator_read_state(e: number, ptr: number): number;
  _emulator_write_ext_ram(e: number, ptr: number): number;
  _emulator_read_ext_ram(e: number, ptr: number): number;
  _emulator_was_ext_ram_updated(e: number): number;
  _set_joyp_up(e: number, on: boolean): void;
  _set_joyp_down(e: number, on: boolean): void;
  _set_joyp_left(e: number, on: boolean): void;
  _set_joyp_right(e: number, on: boolean): void;
  _set_joyp_A(e: number, on: boolean): void;
  _set_joyp_B(e: number, on: boolean): void;
  _set_joyp_start(e: number, on: boolean): void;
  _set_joyp_select(e: number, on: boolean): void;
}

declare global {
  interface Window {
    Binjgb?: (options: { locateFile: (path: string) => string }) => Promise<BinjgbModule>;
  }
}

const VENDOR_BASE = `${import.meta.env.BASE_URL}vendor/binjgb/`;

let modulePromise: Promise<BinjgbModule> | null = null;

/**
 * Lädt binjgb nach. Die Datei ist ein klassisches Skript (UMD), kein
 * ES-Modul — deshalb per <script>-Tag statt import().
 */
function loadBinjgb(): Promise<BinjgbModule> {
  if (modulePromise) return modulePromise;

  modulePromise = new Promise<BinjgbModule>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${VENDOR_BASE}binjgb.js`;
    script.async = true;
    script.onerror = () => reject(new Error('binjgb.js konnte nicht geladen werden.'));
    script.onload = () => {
      const factory = window.Binjgb;
      if (!factory) {
        reject(new Error('binjgb.js wurde geladen, stellt aber kein Modul bereit.'));
        return;
      }
      // Ohne locateFile sucht Emscripten das WASM neben dem aufrufenden
      // Skript — nach dem Bündeln wäre das der falsche Ort.
      factory({ locateFile: (path) => `${VENDOR_BASE}${path}` }).then(resolve, reject);
    };
    document.head.appendChild(script);
  });

  return modulePromise;
}

/** Sicht auf einen Ausschnitt des WASM-Speichers. Nur kurzlebig verwenden. */
function wasmView(module: BinjgbModule, ptr: number, size: number): Uint8Array {
  return new Uint8Array(module.HEAP8.buffer, ptr, size);
}

export class BinjgbCore implements EmulatorCore {
  readonly name = BINJGB_CORE_NAME;

  /**
   * Wird gerufen, wenn der Emulator anhalten musste. Ohne diesen Weg nach
   * oben stünde das Bild einfach still, ohne dass jemand erführe, warum.
   */
  onProblem: ((meldung: string) => void) | null = null;

  #module: BinjgbModule | null = null;
  #emulator = 0;
  #romPtr = 0;
  /** Puffer des Joypad-Callbacks; ohne ihn erreicht keine Eingabe das Spiel. */
  #joypadPtr = 0;
  /** Eigene Kopie des ROMs — reset() legt daraus einen frischen Emulator an. */
  #rom: Uint8Array | null = null;

  #context: CanvasRenderingContext2D | null = null;
  #imageData: ImageData | null = null;
  #frameBuffer: Uint8Array | null = null;

  #rafId: number | null = null;
  #lastFrameSec = 0;
  #leftoverTicks = 0;

  #audioContext: AudioContext | null = null;
  #audioBuffer: Uint8Array | null = null;
  #audioStartSec = 0;
  #audioEnabled = true;
  #audioUnlocked = false;

  #paletteId = 'dmg';
  /** Helligkeit (0…255) → fertiger RGBA-Wert. `null` = Spielfarben unverändert. */
  #farbtabelle: Uint32Array | null = null;

  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.#module = await loadBinjgb();

    canvas.width = SCREEN_WIDTH;
    canvas.height = SCREEN_HEIGHT;

    // Bewusst Canvas2D statt WebGL: Auf iPhones skaliert Safari
    // WebGL-Canvas nicht mit `image-rendering: pixelated` hoch
    // (WebKit-Fehler 193895) — das Bild würde verwaschen. Bei 160×144 ist
    // putImageData ohnehin vernachlässigbar.
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Der 2D-Kontext des Bildschirms ließ sich nicht anlegen.');

    this.#context = context;
    this.#imageData = context.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
  }

  async loadRom(rom: Uint8Array): Promise<void> {
    const module = this.#module;
    if (!module) throw new Error('init() muss vor loadRom() laufen.');

    this.#teardownEmulator();
    this.#rom = rom.slice();

    // binjgb erwartet die ROM-Größe auf 32 KiB aufgerundet.
    const size = (rom.byteLength + 0x7fff) & ~0x7fff;
    this.#romPtr = module._malloc(size);
    wasmView(module, this.#romPtr, size).fill(0).set(rom);

    const sampleRate = this.#ensureAudioContext().sampleRate;
    this.#emulator = module._emulator_new_simple(
      this.#romPtr,
      size,
      sampleRate,
      AUDIO_FRAMES,
      CGB_COLOR_CURVE,
    );

    if (this.#emulator === 0) {
      module._free(this.#romPtr);
      this.#romPtr = 0;
      throw new Error('binjgb hat die Datei nicht als gültiges Game-Boy-ROM angenommen.');
    }

    // Ohne diese Anmeldung bleibt das Spiel taub.
    //
    // `set_joyp_*` schreibt nur in eine statische Struktur im WASM-Modul;
    // in den Emulator gelangt sie erst über `default_joypad_callback`, und
    // der muss eigens angemeldet werden. In binjgbs Beispiel steckt der
    // Aufruf mitten im Rewind-Teil — übernimmt man den nicht, drückt man
    // Knöpfe ins Leere. Genau so war es: Die Anzeige im Gehäuse leuchtete
    // auf, das Spiel bekam davon nie etwas mit.
    this.#joypadPtr = module._joypad_new();
    module._emulator_set_default_joypad_callback(this.#emulator, this.#joypadPtr);

    this.#frameBuffer = wasmView(
      module,
      module._get_frame_buffer_ptr(this.#emulator),
      module._get_frame_buffer_size(this.#emulator),
    );
    this.#audioBuffer = wasmView(
      module,
      module._get_audio_buffer_ptr(this.#emulator),
      module._get_audio_buffer_capacity(this.#emulator),
    );

    this.setPalette(this.#paletteId);
    this.#lastFrameSec = 0;
    this.#leftoverTicks = 0;
    this.#renderFrame();
  }

  async play(): Promise<void> {
    if (!this.#emulator || this.#rafId !== null) return;
    this.#lastFrameSec = 0;
    if (this.#audioEnabled && this.#audioUnlocked) void this.#audioContext?.resume();
    this.#rafId = requestAnimationFrame(this.#tick);
  }

  async pause(): Promise<void> {
    if (this.#rafId === null) return;
    cancelAnimationFrame(this.#rafId);
    this.#rafId = null;
    this.#audioStartSec = 0;
    void this.#audioContext?.suspend();
  }

  async reset(): Promise<void> {
    if (!this.#emulator || !this.#rom) return;

    // binjgb kennt kein reset(); ein frisch angelegter Emulator auf demselben
    // ROM ist exakt derselbe Ausgangszustand — und spart einen Sonderweg.
    const running = this.isRunning();
    await this.pause();
    await this.loadRom(this.#rom);
    if (running) await this.play();
  }

  isRunning(): boolean {
    return this.#rafId !== null;
  }

  /**
   * Ein Speicherstand ist hier ein einfaches Byte-Feld, synchron aus dem
   * WASM-Speicher gelesen. `slice()` löst es davon los, damit es nicht
   * weiterläuft, sobald das Spiel weiterläuft.
   */
  async snapshot(): Promise<EmulatorSnapshot> {
    const module = this.#module;
    if (!module || !this.#emulator) {
      throw new Error('Ohne geladenes ROM gibt es nichts zu sichern.');
    }

    const filePtr = module._state_file_data_new(this.#emulator);
    try {
      module._emulator_write_state(this.#emulator, filePtr);
      const data = wasmView(
        module,
        module._get_file_data_ptr(filePtr),
        module._get_file_data_size(filePtr),
      ).slice();
      return { core: this.name, data };
    } finally {
      module._file_data_delete(filePtr);
    }
  }

  async restore(snapshot: EmulatorSnapshot): Promise<void> {
    const module = this.#module;
    if (!module || !this.#emulator) {
      throw new Error('Erst das ROM laden, dann den Stand einspielen.');
    }
    if (snapshot.core !== this.name) {
      throw new Error(
        `Dieser Speicherstand stammt von "${snapshot.core}" und passt nicht zu "${this.name}".`,
      );
    }

    const data = snapshot.data as Uint8Array;
    const filePtr = module._state_file_data_new(this.#emulator);
    try {
      const ziel = wasmView(
        module,
        module._get_file_data_ptr(filePtr),
        module._get_file_data_size(filePtr),
      );
      if (ziel.byteLength !== data.byteLength) {
        throw new Error(
          `Der Speicherstand hat ${data.byteLength} Bytes, erwartet werden ${ziel.byteLength}. ` +
            'Vermutlich gehört er zu einem anderen Spiel.',
        );
      }
      ziel.set(data);
      module._emulator_read_state(this.#emulator, filePtr);
    } finally {
      module._file_data_delete(filePtr);
    }

    // Zeitbasis zurücksetzen, sonst holt die Schleife die Pause als
    // Rückstand auf und spult sichtbar vor.
    this.#lastFrameSec = 0;
    this.#leftoverTicks = 0;
    this.#renderFrame();
  }

  /** Batteriegepufferter Cartridge-Speicher, falls das Spiel einen hat. */
  readExtRam(): Uint8Array | null {
    const module = this.#module;
    if (!module || !this.#emulator) return null;

    const filePtr = module._ext_ram_file_data_new(this.#emulator);
    try {
      const size = module._get_file_data_size(filePtr);
      if (size === 0) return null;
      module._emulator_write_ext_ram(this.#emulator, filePtr);
      return wasmView(module, module._get_file_data_ptr(filePtr), size).slice();
    } finally {
      module._file_data_delete(filePtr);
    }
  }

  writeExtRam(data: Uint8Array): void {
    const module = this.#module;
    if (!module || !this.#emulator || data.byteLength === 0) return;

    const filePtr = module._ext_ram_file_data_new(this.#emulator);
    try {
      const ziel = wasmView(
        module,
        module._get_file_data_ptr(filePtr),
        module._get_file_data_size(filePtr),
      );
      if (ziel.byteLength !== data.byteLength) return;
      ziel.set(data);
      module._emulator_read_ext_ram(this.#emulator, filePtr);
    } finally {
      module._file_data_delete(filePtr);
    }
  }

  setJoypad(state: JoypadState): void {
    const module = this.#module;
    if (!module || !this.#emulator) return;

    const e = this.#emulator;
    module._set_joyp_up(e, state.UP);
    module._set_joyp_down(e, state.DOWN);
    module._set_joyp_left(e, state.LEFT);
    module._set_joyp_right(e, state.RIGHT);
    module._set_joyp_A(e, state.A);
    module._set_joyp_B(e, state.B);
    module._set_joyp_start(e, state.START);
    module._set_joyp_select(e, state.SELECT);
  }

  setPalette(paletteId: string): void {
    this.#paletteId = paletteId;
    this.#wendePaletteAn();
    this.#renderFrame();
  }

  /**
   * Baut die Zuordnung Helligkeit → Game-Boy-Ton.
   *
   * Warum nicht einfach `emulator_set_bw_palette_simple`? Weil das bei
   * Spielen mit Super-Game-Boy-Unterstützung wirkungslos bleibt: In diesem
   * Modus zeichnet binjgb aus `SGB.screen_pal` und sieht `color_to_rgba` gar
   * nicht an. Adventures of Lolo gehört dazu — das Titelbild kam rosa und
   * türkis heraus, egal was man einstellte. Ein `force_dmg` gäbe es im Kern
   * zwar, `emulator_new_simple` reicht es aber nicht durch.
   *
   * Also wird das fertige Bild umgesetzt: Helligkeit ausrechnen, auf vier
   * Stufen runden, den passenden Ton einsetzen. Das ergibt für jedes Spiel
   * denselben verlässlichen Game-Boy-Look — mit oder ohne SGB.
   */
  #baueFarbtabelle(): void {
    if (this.#paletteId === PALETTE_SPIELFARBEN) {
      this.#farbtabelle = null;
      return;
    }

    // Reihenfolge in PALETTEN ist hell → dunkel, die Helligkeit läuft
    // andersherum; deshalb von hinten indizieren.
    const toene = (PALETTEN[this.#paletteId] ?? PALETTEN.dmg).map(rgba);
    const tabelle = new Uint32Array(256);
    for (let helligkeit = 0; helligkeit < 256; helligkeit++) {
      const stufe = helligkeit >> 6; // 0 = dunkel … 3 = hell
      tabelle[helligkeit] = toene[3 - stufe];
    }
    this.#farbtabelle = tabelle;
  }

  #wendePaletteAn(): void {
    this.#baueFarbtabelle();
  }

  async unlockAudio(): Promise<void> {
    const context = this.#ensureAudioContext();
    try {
      await context.resume();
      this.#audioUnlocked = true;
    } catch {
      // Ohne echte Nutzerberührung lehnt iOS das ab — dann eben beim nächsten Tippen.
    }
  }

  async setAudioEnabled(enabled: boolean): Promise<void> {
    this.#audioEnabled = enabled;
    if (!enabled) {
      this.#audioStartSec = 0;
      await this.#audioContext?.suspend();
    } else if (this.#audioUnlocked && this.isRunning()) {
      await this.#audioContext?.resume();
    }
  }

  destroy(): void {
    void this.pause();
    this.#teardownEmulator();
  }

  // --------------------------------------------------------------- Interna

  #teardownEmulator(): void {
    const module = this.#module;
    if (!module) return;

    if (this.#emulator) {
      module._emulator_delete(this.#emulator);
      this.#emulator = 0;
    }
    if (this.#joypadPtr) {
      module._joypad_delete(this.#joypadPtr);
      this.#joypadPtr = 0;
    }
    if (this.#romPtr) {
      module._free(this.#romPtr);
      this.#romPtr = 0;
    }
    this.#frameBuffer = null;
    this.#audioBuffer = null;
  }

  #ensureAudioContext(): AudioContext {
    if (!this.#audioContext) {
      this.#audioContext = new AudioContext();
      // Startet auf iOS grundsätzlich angehalten; unlockAudio() weckt ihn.
      void this.#audioContext.suspend();
    }
    return this.#audioContext;
  }

  #tick = (nowMs: number): void => {
    this.#rafId = requestAnimationFrame(this.#tick);

    const nowSec = nowMs / 1000;
    const deltaSec = Math.max(nowSec - (this.#lastFrameSec || nowSec), 0);
    this.#lastFrameSec = nowSec;

    const module = this.#module;
    if (!module || !this.#emulator) return;

    // Nach einer langen Pause (App im Hintergrund) nicht die gesamte
    // verstrichene Zeit nachholen — sonst spult das Spiel sichtbar vor.
    const deltaTicks = Math.min(deltaSec, MAX_UPDATE_SEC) * CPU_TICKS_PER_SECOND;
    const runUntil = module._emulator_get_ticks_f64(this.#emulator) + deltaTicks - this.#leftoverTicks;

    const zielErreicht = this.#runUntil(runUntil);

    // Nur ein *Überschuss* darf übernommen werden, niemals ein Rückstand.
    // Ein negativer Wert würde oben abgezogen, das Ziel also vergrößern —
    // und sich Bild für Bild aufschaukeln, bis der Hauptthread steht.
    // Zusätzlich gedeckelt, damit ein einzelner Ausreißer folgenlos bleibt.
    if (zielErreicht) {
      const ueberschuss = module._emulator_get_ticks_f64(this.#emulator) - runUntil;
      this.#leftoverTicks = Math.min(Math.max(ueberschuss, 0), CPU_TICKS_PER_SECOND / 60) | 0;
    } else {
      this.#leftoverTicks = 0;
    }

    // Nach dem Rechnen, vor dem Zeichnen: Hat das Spiel per Super Game Boy
    // eigene Farben gesetzt, werden sie hier wieder überschrieben — sonst
    // hätte die Einstellung im Menü bei solchen Spielen keine Wirkung.
    this.#wendePaletteAn();
    this.#renderFrame();
  };

  /**
   * Rechnet bis zum Zielzeitpunkt. Gibt zurück, ob er erreicht wurde.
   *
   * Der Rückgabewert ist wichtiger, als er aussieht: Wird das Ziel *nicht*
   * erreicht, darf der Rückstand nicht in die nächste Runde übernommen
   * werden — sonst wächst das Ziel mit jedem Bild weiter, und irgendwann
   * soll ein einzelnes Bild Millionen Zyklen am Stück abarbeiten. Genau so
   * fror die Seite mitten im Spiel komplett ein.
   */
  #runUntil(ticks: number): boolean {
    const module = this.#module;
    if (!module || !this.#emulator) return false;

    for (let durchlauf = 0; durchlauf < MAX_DURCHLAEUFE_JE_BILD; durchlauf++) {
      const event = module._emulator_run_until_f64(this.#emulator, ticks);

      if (event & EVENT_AUDIO_BUFFER_FULL) this.#pushAudio();
      if (event & EVENT_UNTIL_TICKS) return true;

      // Ein ungültiger Befehl bedeutet, dass der Prozessor in Daten gelaufen
      // ist — meist ein unvollständiger Abzug. Weiterrechnen bringt nichts
      // und wäre nur eine stumme Endlosschleife.
      if (event & (EVENT_INVALID_OPCODE | EVENT_BREAKPOINT)) {
        this.#melde(
          event & EVENT_INVALID_OPCODE
            ? 'Das Spiel ist auf einen ungültigen Befehl gelaufen und wurde angehalten. Lade einen Speicherstand, um weiterzuspielen. Tritt das immer an derselben Stelle auf, ist der ROM-Abzug vermutlich unvollständig.'
            : 'Der Emulator ist an einem Haltepunkt stehengeblieben und wurde angehalten.',
        );
        return false;
      }

      // Kein bekanntes Ereignis: nicht weiterdrehen, sonst droht Stillstand.
      if (!(event & (EVENT_NEW_FRAME | EVENT_AUDIO_BUFFER_FULL))) return false;
    }

    // Obergrenze erreicht. Kein Fehler, aber auch kein erreichtes Ziel —
    // der Rückstand wird verworfen statt aufgeschaukelt.
    return false;
  }

  /** Meldet ein Problem nach oben und hält den Emulator an. */
  #melde(meldung: string): void {
    void this.pause();
    this.onProblem?.(meldung);
  }

  #renderFrame(): void {
    const context = this.#context;
    const imageData = this.#imageData;
    const frameBuffer = this.#frameBuffer;
    if (!context || !imageData || !frameBuffer) return;

    const tabelle = this.#farbtabelle;
    if (!tabelle) {
      // Spielfarben: unverändert durchreichen.
      imageData.data.set(frameBuffer);
    } else {
      // 23 040 Pixel je Bild — als 32-Bit-Wörter geschrieben, damit es auch
      // auf einem älteren iPhone nicht ins Gewicht fällt.
      const ziel = new Uint32Array(imageData.data.buffer);
      for (let i = 0, p = 0; i < frameBuffer.length; i += 4, p++) {
        // Wahrgenommene Helligkeit, ganzzahlig (entspricht 0,299/0,587/0,114).
        const helligkeit =
          (frameBuffer[i] * 77 + frameBuffer[i + 1] * 150 + frameBuffer[i + 2] * 29) >> 8;
        ziel[p] = tabelle[helligkeit];
      }
    }

    context.putImageData(imageData, 0, 0);
  }

  #pushAudio(): void {
    const context = this.#audioContext;
    const buffer = this.#audioBuffer;
    if (!context || !buffer || !this.#audioEnabled || !this.#audioUnlocked) return;
    if (context.state !== 'running') return;

    const nowSec = context.currentTime;
    const frueheste = nowSec + AUDIO_LATENCY_SEC;
    if (!this.#audioStartSec || this.#audioStartSec < nowSec) {
      this.#audioStartSec = frueheste;
    }

    // Obergrenze für den Vorlauf.
    //
    // Rechnet der Emulator auch nur geringfügig schneller als die Echtzeit —
    // was beim Aufholen nach jedem Ruckler passiert —, wandert der
    // Startzeitpunkt immer weiter in die Zukunft. Ohne Schranke wachsen die
    // eingeplanten Puffer unbegrenzt: je 32 KB, mehrmals pro Sekunde, über
    // Minuten hinweg. Auf einem iPhone endet das in Speicherdruck und einer
    // Seite, die irgendwann steht. Liegt der Ton zu weit vorn, wird dieser
    // Puffer verworfen statt zusätzlich eingeplant.
    if (this.#audioStartSec - nowSec > AUDIO_MAX_VORLAUF_SEC) return;

    const audio = context.createBuffer(2, AUDIO_FRAMES, context.sampleRate);
    const links = audio.getChannelData(0);
    const rechts = audio.getChannelData(1);
    for (let i = 0; i < AUDIO_FRAMES; i++) {
      // binjgb liefert 8-Bit-Stereo, verschachtelt.
      links[i] = (buffer[2 * i] - 128) / 128;
      rechts[i] = (buffer[2 * i + 1] - 128) / 128;
    }

    const quelle = context.createBufferSource();
    quelle.buffer = audio;
    quelle.connect(context.destination);
    quelle.start(this.#audioStartSec);
    this.#audioStartSec += AUDIO_FRAMES / context.sampleRate;
  }
}
