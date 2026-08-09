/**
 * Die Austausch-Grenze zum Emulator.
 *
 * Alles über dieser Zeile (UI, Speicherverwaltung, Steuerung) kennt nur dieses
 * Interface. Nur der jeweilige Kern-Adapter kennt den Emulator selbst.
 *
 * Diese Grenze hat sich bereits ausgezahlt: Der erste Anlauf lief auf WasmBoy,
 * dessen Speicherstände sich als unbrauchbar erwiesen (der Hauptthread bekam
 * nur eine Kopie vom Ladezeitpunkt, siehe binjgb-core.ts). Der Wechsel auf
 * binjgb kostete den Austausch einer Datei — UI, Datenbank und Steuerung
 * blieben unberührt.
 */

export const SCREEN_WIDTH = 160;
export const SCREEN_HEIGHT = 144;

export type GameBoyButton =
  | 'UP'
  | 'DOWN'
  | 'LEFT'
  | 'RIGHT'
  | 'A'
  | 'B'
  | 'START'
  | 'SELECT';

export const ALL_BUTTONS: readonly GameBoyButton[] = [
  'UP',
  'DOWN',
  'LEFT',
  'RIGHT',
  'A',
  'B',
  'START',
  'SELECT',
];

export type JoypadState = Record<GameBoyButton, boolean>;

export function emptyJoypadState(): JoypadState {
  return {
    UP: false,
    DOWN: false,
    LEFT: false,
    RIGHT: false,
    A: false,
    B: false,
    START: false,
    SELECT: false,
  };
}

/**
 * Ein Emulator-Schnappschuss, wie ihn *diese App* ablegt.
 *
 * Bewusst kernunabhängig: `core` sagt, wer ihn erzeugt hat, `data` ist der
 * rohe Zustand in kernspezifischer Form. Ein Kern erkennt daran, dass ein
 * Stand nicht von ihm stammt, und weist ihn mit klarer Meldung ab, statt
 * sich daran zu verschlucken.
 */
export interface EmulatorSnapshot {
  core: string;
  data: unknown;
}

export interface EmulatorCore {
  /** Kennung, die in jedem Schnappschuss landet. */
  readonly name: string;

  /** Einmalig: Worker starten, Canvas verbinden. */
  init(canvas: HTMLCanvasElement): Promise<void>;

  loadRom(rom: Uint8Array): Promise<void>;

  play(): Promise<void>;
  pause(): Promise<void>;
  reset(): Promise<void>;
  isRunning(): boolean;

  snapshot(): Promise<EmulatorSnapshot>;
  restore(snapshot: EmulatorSnapshot): Promise<void>;

  setJoypad(state: JoypadState): void;

  /**
   * Audio darf auf iOS erst nach einer echten Berührung starten.
   * Wird beim ersten Tippen aufgerufen.
   */
  unlockAudio(): Promise<void>;

  setAudioEnabled(enabled: boolean): Promise<void>;
}
