import { BinjgbCore } from './emulator/binjgb-core';
import { emptyJoypadState, type JoypadState } from './emulator/core';
import type { StoredRom, StoredSave } from './storage/db';
import { latestAutoSave, writeAutoSave, writeSave } from './storage/saves';
import { acquireWakeLock, releaseWakeLock, watchWakeLock } from './platform/wakelock';

/**
 * Hält den Emulator, die Spielzeit und die automatische Speicherung zusammen.
 *
 * Bewusst außerhalb von React: Das hier ist ein laufender Motor mit Timern,
 * Worker und Systemereignissen. In Effekt-Hooks gepresst würde jeder
 * Neu-Render zur Stolperfalle. React fragt nur nach dem Zustand und ruft
 * Methoden auf.
 */

/** Abstand der automatischen Speicherungen im laufenden Spiel. */
const AUTOSAVE_INTERVAL_MS = 30_000;

export type SessionPhase = 'leer' | 'laedt' | 'bereit';

export interface SessionState {
  phase: SessionPhase;
  rom: StoredRom | null;
  running: boolean;
  playtimeMs: number;
  joypad: JoypadState;
  lastAutoSaveAt: number | null;
}

type Listener = (state: SessionState) => void;

export class GameSession {
  #core = new BinjgbCore();
  #canvas: HTMLCanvasElement | null = null;
  #rom: StoredRom | null = null;

  #phase: SessionPhase = 'leer';
  #running = false;
  #joypad: JoypadState = emptyJoypadState();

  #playtimeMs = 0;
  #runningSince: number | null = null;
  #lastAutoSaveAt: number | null = null;

  #autosaveTimer: ReturnType<typeof setInterval> | null = null;
  #listeners = new Set<Listener>();
  #lifecycleBound = false;

  /**
   * Wird gerufen, wenn der Emulator von selbst anhalten musste — etwa nach
   * einem ungültigen Befehl. Die UI zeigt die Meldung an, statt den Nutzer
   * vor einem stehenden Bild raten zu lassen.
   */
  onProblem: ((meldung: string) => void) | null = null;

  // ------------------------------------------------------------ Abonnement

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    listener(this.state);
    return () => this.#listeners.delete(listener);
  }

  get state(): SessionState {
    return {
      phase: this.#phase,
      rom: this.#rom,
      running: this.#running,
      playtimeMs: this.playtimeMs,
      joypad: this.#joypad,
      lastAutoSaveAt: this.#lastAutoSaveAt,
    };
  }

  get playtimeMs(): number {
    const current = this.#runningSince !== null ? performance.now() - this.#runningSince : 0;
    return this.#playtimeMs + current;
  }

  #emit(): void {
    const snapshot = this.state;
    for (const listener of this.#listeners) listener(snapshot);
  }

  // --------------------------------------------------------------- Aufbau

  async attach(canvas: HTMLCanvasElement): Promise<void> {
    this.#canvas = canvas;
    this.#core.onProblem = (meldung) => {
      this.#running = false;
      this.#emit();
      this.onProblem?.(meldung);
    };
    await this.#core.init(canvas);
    this.#bindLifecycle();
  }

  /** Lädt ein ROM und stellt, wenn vorhanden, den letzten Auto-Stand her. */
  async loadRom(rom: StoredRom, options: { resume?: boolean } = {}): Promise<void> {
    this.#phase = 'laedt';
    this.#emit();

    await this.#core.loadRom(new Uint8Array(rom.data));
    this.#rom = rom;
    this.#playtimeMs = 0;
    this.#runningSince = null;

    if (options.resume) {
      const save = await latestAutoSave(rom.id);
      if (save) {
        await this.#core.restore(save.snapshot);
        this.#playtimeMs = save.playtimeMs;
      }
    }

    this.#phase = 'bereit';
    this.#emit();
  }

  // ------------------------------------------------------------- Steuerung

  async play(): Promise<void> {
    if (this.#phase !== 'bereit' || this.#running) return;

    await this.#core.play();
    this.#running = true;
    this.#runningSince = performance.now();
    this.#startAutosaveTimer();
    void acquireWakeLock();
    this.#emit();
  }

  async pause(options: { save?: boolean } = { save: true }): Promise<void> {
    if (!this.#running) return;

    await this.#core.pause();
    this.#running = false;

    if (this.#runningSince !== null) {
      this.#playtimeMs += performance.now() - this.#runningSince;
      this.#runningSince = null;
    }

    this.#stopAutosaveTimer();
    void releaseWakeLock();

    // Pausieren heißt immer auch sichern. Genau dafür drückt man es.
    if (options.save !== false) await this.autoSave();

    this.#emit();
  }

  async togglePause(): Promise<void> {
    if (this.#running) await this.pause();
    else await this.play();
  }

  async reset(): Promise<void> {
    await this.#core.reset();
    this.#playtimeMs = 0;
    this.#runningSince = this.#running ? performance.now() : null;
    this.#emit();
  }

  setJoypad(state: JoypadState): void {
    this.#joypad = state;
    this.#core.setJoypad(state);
    this.#emit();
  }

  unlockAudio(): Promise<void> {
    return this.#core.unlockAudio();
  }

  setAudioEnabled(enabled: boolean): Promise<void> {
    return this.#core.setAudioEnabled(enabled);
  }

  /**
   * Die Farbpalette färbt binjgb direkt ins Bild — anders als ein CSS-Filter
   * trifft das die vier Grautöne einzeln und sieht deshalb echt aus.
   */
  setPalette(paletteId: string): void {
    this.#core.setPalette(paletteId);
  }

  // ---------------------------------------------------------- Speicherung

  /**
   * Ein Standbild des Bildschirms als PNG-Data-URL.
   *
   * Ohne Vorschaubild sind sechs Speicherplätze sechs gleich aussehende
   * Zeilen mit Datumsangabe — man findet den richtigen nicht wieder.
   */
  captureThumbnail(): string {
    if (!this.#canvas) return '';
    try {
      return this.#canvas.toDataURL('image/png');
    } catch {
      return '';
    }
  }

  async autoSave(): Promise<StoredSave | null> {
    if (this.#phase !== 'bereit' || !this.#rom) return null;

    try {
      const snapshot = await this.#core.snapshot();
      const save = await writeAutoSave(
        this.#rom.id,
        snapshot,
        this.captureThumbnail(),
        this.playtimeMs,
      );
      this.#lastAutoSaveAt = save.createdAt;
      this.#emit();
      return save;
    } catch {
      // Ein fehlgeschlagener Auto-Stand darf das Spiel nicht anhalten.
      return null;
    }
  }

  async saveToSlot(slot: number, label?: string): Promise<StoredSave> {
    if (this.#phase !== 'bereit' || !this.#rom) {
      throw new Error('Es läuft gerade kein Spiel.');
    }

    const snapshot = await this.#core.snapshot();
    return writeSave({
      romId: this.#rom.id,
      kind: 'manual',
      slot,
      snapshot,
      thumbnail: this.captureThumbnail(),
      playtimeMs: this.playtimeMs,
      label,
    });
  }

  /** Spielt einen Stand ein. Lief das Spiel, läuft es danach weiter. */
  async loadSave(save: StoredSave): Promise<void> {
    const wasRunning = this.#running;
    if (wasRunning) await this.pause({ save: false });

    await this.#core.restore(save.snapshot);
    this.#playtimeMs = save.playtimeMs;
    this.#runningSince = null;

    if (wasRunning) await this.play();
    else this.#emit();
  }

  // ------------------------------------------------------------- Interna

  #startAutosaveTimer(): void {
    this.#stopAutosaveTimer();
    this.#autosaveTimer = setInterval(() => void this.autoSave(), AUTOSAVE_INTERVAL_MS);
  }

  #stopAutosaveTimer(): void {
    if (this.#autosaveTimer !== null) {
      clearInterval(this.#autosaveTimer);
      this.#autosaveTimer = null;
    }
  }

  /**
   * App wechseln, Bildschirm sperren, Telefonanruf — auf dem iPhone ist das
   * der Normalfall, nicht die Ausnahme.
   *
   * Ausgelöst wird über `visibilitychange` und nicht über `pagehide`: iOS
   * beendet Hintergrund-Tabs abrupt, und ein asynchroner Schreibvorgang in
   * IndexedDB kommt in `pagehide` oft nicht mehr durch. `visibilitychange`
   * feuert früher und zuverlässig. `pagehide` bleibt als zweiter Versuch,
   * aber die Sicherheit hängt nicht daran.
   */
  #bindLifecycle(): void {
    if (this.#lifecycleBound) return;
    this.#lifecycleBound = true;

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this.#running) {
        void this.pause();
      }
    });

    window.addEventListener('pagehide', () => {
      if (this.#running) void this.pause();
    });

    watchWakeLock();
  }
}
