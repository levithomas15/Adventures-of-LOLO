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

const CPU_TICKS_PER_SECOND = 4194304;
/** Höchstens fünf Bilder pro Durchlauf nachholen. */
const MAX_UPDATE_SEC = 5 / 60;
const AUDIO_FRAMES = 4096;
const AUDIO_LATENCY_SEC = 0.1;
/** Farbkurve für GBC-Titel: 2 entspricht Gambatte. */
const CGB_COLOR_CURVE = 2;

/**
 * Nummern aus binjgbs eingebauter Palettentabelle (84 Stück).
 * Der Kern färbt damit direkt das Bild — echter als ein CSS-Filter.
 */
export const PALETTEN: Record<string, number> = {
  dmg: 79,
  pocket: 71,
  light: 27,
};

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
  _emulator_run_until_f64(e: number, ticks: number): number;
  _emulator_get_ticks_f64(e: number): number;
  _emulator_set_builtin_palette(e: number, palette: number): void;
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

  #module: BinjgbModule | null = null;
  #emulator = 0;
  #romPtr = 0;
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
    const module = this.#module;
    if (!module || !this.#emulator) return;
    module._emulator_set_builtin_palette(this.#emulator, PALETTEN[paletteId] ?? PALETTEN.dmg);
    this.#renderFrame();
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

    this.#runUntil(runUntil);
    this.#leftoverTicks = (module._emulator_get_ticks_f64(this.#emulator) - runUntil) | 0;

    this.#renderFrame();
  };

  #runUntil(ticks: number): void {
    const module = this.#module;
    if (!module || !this.#emulator) return;

    for (;;) {
      const event = module._emulator_run_until_f64(this.#emulator, ticks);
      if (event & EVENT_AUDIO_BUFFER_FULL) this.#pushAudio();
      if (event & EVENT_UNTIL_TICKS) break;
      if (!(event & (EVENT_NEW_FRAME | EVENT_AUDIO_BUFFER_FULL))) break;
    }
  }

  #renderFrame(): void {
    const context = this.#context;
    const imageData = this.#imageData;
    const frameBuffer = this.#frameBuffer;
    if (!context || !imageData || !frameBuffer) return;

    imageData.data.set(frameBuffer);
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
