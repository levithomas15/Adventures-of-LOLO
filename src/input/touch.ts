import { emptyJoypadState, type GameBoyButton, type JoypadState } from '../emulator/core';

/**
 * Touch-Steuerung.
 *
 * Der naive Weg — pro Knopf ein `touchstart`/`touchend` — bricht in genau den
 * Momenten, in denen es zählt: Der Daumen rutscht von "links" nach "oben", das
 * `touchend` kommt nie an, und Lolo läuft weiter gegen die Wand. Oder man hält
 * A und will gleichzeitig laufen, und der zweite Finger wird verschluckt.
 *
 * Deshalb hier andersherum: ein Handler auf dem ganzen Gehäuse, und bei *jedem*
 * Ereignis wird der komplette Joypad-Zustand aus allen aktuell aufliegenden
 * Fingern neu berechnet. Kein Zustand, der hängenbleiben kann.
 */

/** Regionen, die die UI anmeldet. Das Steuerkreuz ist *eine* Region. */
export type TouchRegionId = 'dpad' | 'a' | 'b' | 'start' | 'select';

const REGION_BUTTONS: Record<Exclude<TouchRegionId, 'dpad'>, GameBoyButton> = {
  a: 'A',
  b: 'B',
  start: 'START',
  select: 'SELECT',
};

/**
 * Ab dieser Auslenkung aus der Mitte des Steuerkreuzes gilt eine Richtung als
 * gedrückt. Darunter: nichts — der Daumen liegt nur auf.
 */
const DPAD_DEAD_ZONE = 0.28;

/**
 * Halbe Breite eines Richtungssektors in Grad.
 *
 * 30° statt der geometrisch naheliegenden 22,5° ist eine bewusste Entscheidung
 * *für dieses Spiel*: Lolo bewegt sich auf einem Raster, ausschließlich in vier
 * Richtungen. Diagonalen bringen dort nichts, versehentliche Diagonalen aber
 * kosten Züge. Also bekommen die vier Hauptrichtungen je 60° und die
 * Diagonalen die verbleibenden 30° — für Spiele, die sie brauchen, sind sie
 * noch da, aber man trifft sie nicht mehr aus Versehen.
 */
const CARDINAL_HALF_ANGLE = 30;

interface Region {
  id: TouchRegionId;
  element: HTMLElement;
  rect: DOMRect;
}

const TOUCH_EVENTS = ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const;

/** Bildschirmkoordinaten: 0° = rechts, 90° = unten. */
function directionsFromAngle(degrees: number): GameBoyButton[] {
  const cardinals: Array<{ at: number; button: GameBoyButton }> = [
    { at: 0, button: 'RIGHT' },
    { at: 90, button: 'DOWN' },
    { at: 180, button: 'LEFT' },
    { at: 270, button: 'UP' },
  ];

  for (const { at, button } of cardinals) {
    // Abstand auf dem Kreis, also über 0°/360° hinweg gedacht:
    // ergibt für jedes Paar den kürzeren der beiden Wege, 0…180°.
    const delta = Math.abs(((degrees - at + 540) % 360) - 180);
    if (delta <= CARDINAL_HALF_ANGLE) return [button];
  }

  // Keine Hauptrichtung getroffen → Diagonale aus den beiden Nachbarn.
  const diagonals: Array<{ from: number; to: number; buttons: GameBoyButton[] }> = [
    { from: 0, to: 90, buttons: ['RIGHT', 'DOWN'] },
    { from: 90, to: 180, buttons: ['DOWN', 'LEFT'] },
    { from: 180, to: 270, buttons: ['LEFT', 'UP'] },
    { from: 270, to: 360, buttons: ['UP', 'RIGHT'] },
  ];
  const found = diagonals.find((d) => degrees >= d.from && degrees < d.to);
  return found ? [...found.buttons] : [];
}

export class TouchController {
  #regions = new Map<TouchRegionId, Region>();
  #state = emptyJoypadState();
  #onChange: (state: JoypadState) => void;
  #onFirstTouch: (() => void) | null;
  #container: HTMLElement | null = null;
  #resizeObserver: ResizeObserver | null = null;

  constructor(onChange: (state: JoypadState) => void, onFirstTouch?: () => void) {
    this.#onChange = onChange;
    this.#onFirstTouch = onFirstTouch ?? null;
  }

  attach(container: HTMLElement): void {
    this.#container = container;

    // `passive: false`, weil wir scrollen und Doppeltipp-Zoom unterbinden müssen.
    for (const type of TOUCH_EVENTS) {
      container.addEventListener(type, this.#listener, { passive: false });
    }

    // Die Rechtecke verschieben sich bei Drehung, Tastatur-Einblendung und
    // Adressleisten-Kollaps. Statt sie pro Ereignis neu zu messen (teuer und
    // ruckelt), horchen wir auf Größenänderungen.
    this.#resizeObserver = new ResizeObserver(() => this.measure());
    this.#resizeObserver.observe(container);
    window.addEventListener('orientationchange', this.measure);
    window.addEventListener('resize', this.measure);
  }

  detach(): void {
    const container = this.#container;
    if (container) {
      for (const type of TOUCH_EVENTS) {
        container.removeEventListener(type, this.#listener);
      }
    }
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    window.removeEventListener('orientationchange', this.measure);
    window.removeEventListener('resize', this.measure);
    this.#container = null;
  }

  registerRegion(id: TouchRegionId, element: HTMLElement): void {
    this.#regions.set(id, { id, element, rect: element.getBoundingClientRect() });
  }

  unregisterRegion(id: TouchRegionId): void {
    this.#regions.delete(id);
  }

  /** Rechtecke neu vermessen — nach Layoutänderungen. */
  measure = (): void => {
    for (const region of this.#regions.values()) {
      region.rect = region.element.getBoundingClientRect();
    }
  };

  /** Aktueller Zustand, damit die UI gedrückte Knöpfe hervorheben kann. */
  get state(): JoypadState {
    return this.#state;
  }

  /** Ein gemeinsamer Listener für alle vier Touch-Ereignisse. */
  #listener: EventListener = (event) => this.#handleTouch(event as TouchEvent);

  #handleTouch = (event: TouchEvent): void => {
    // Verhindert Scrollen, Gummiband-Effekt, Lupe und Doppeltipp-Zoom.
    event.preventDefault();

    if (event.type === 'touchstart' && this.#onFirstTouch) {
      // Audio darf auf iOS erst nach einer echten Berührung starten.
      this.#onFirstTouch();
      this.#onFirstTouch = null;
    }

    // Beim ersten Kontakt frisch vermessen: bis hierher kann sich das Layout
    // durch die ein- oder ausgefahrene Adressleiste verschoben haben.
    if (event.type === 'touchstart') this.measure();

    const next = emptyJoypadState();

    // `event.touches` enthält alle noch aufliegenden Finger — die gerade
    // beendeten sind bereits heraus. Genau deshalb kann hier nichts hängen
    // bleiben: der Zustand wird jedes Mal von Grund auf neu gebildet.
    for (let i = 0; i < event.touches.length; i++) {
      const touch = event.touches[i];
      for (const button of this.#buttonsAt(touch.clientX, touch.clientY)) {
        next[button] = true;
      }
    }

    this.#commit(next);
  };

  #buttonsAt(x: number, y: number): GameBoyButton[] {
    for (const region of this.#regions.values()) {
      const { rect } = region;
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;

      if (region.id !== 'dpad') return [REGION_BUTTONS[region.id]];

      // Steuerkreuz: Richtung aus der Lage zum Mittelpunkt bestimmen, statt
      // vier getrennte Trefferflächen zu prüfen. Nur so entstehen Diagonalen
      // und das Durchziehen des Daumens von einer Richtung in die nächste.
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const nx = (x - centerX) / (rect.width / 2);
      const ny = (y - centerY) / (rect.height / 2);

      if (Math.hypot(nx, ny) < DPAD_DEAD_ZONE) return [];

      const degrees = (Math.atan2(ny, nx) * (180 / Math.PI) + 360) % 360;
      return directionsFromAngle(degrees);
    }
    return [];
  }

  /** Tastatur — fürs Testen am Rechner und zum Spielen mit Bluetooth-Tastatur. */
  setButton(button: GameBoyButton, pressed: boolean): void {
    if (this.#state[button] === pressed) return;
    this.#commit({ ...this.#state, [button]: pressed });
  }

  #commit(next: JoypadState): void {
    let changed = false;
    for (const key of Object.keys(next) as GameBoyButton[]) {
      if (next[key] !== this.#state[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;

    this.#state = next;
    this.#onChange(next);
  }
}

const KEY_MAP: Record<string, GameBoyButton> = {
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  ArrowLeft: 'LEFT',
  ArrowRight: 'RIGHT',
  KeyW: 'UP',
  KeyS: 'DOWN',
  KeyA: 'LEFT',
  KeyD: 'RIGHT',
  KeyX: 'A',
  KeyY: 'B',
  KeyZ: 'B',
  Enter: 'START',
  ShiftRight: 'SELECT',
  ShiftLeft: 'SELECT',
  Backspace: 'SELECT',
};

/** Verbindet die Tastatur mit demselben Controller. Gibt eine Abmeldefunktion zurück. */
export function attachKeyboard(controller: TouchController): () => void {
  const down = (event: KeyboardEvent) => {
    const button = KEY_MAP[event.code];
    if (!button || event.repeat) return;
    event.preventDefault();
    controller.setButton(button, true);
  };
  const up = (event: KeyboardEvent) => {
    const button = KEY_MAP[event.code];
    if (!button) return;
    event.preventDefault();
    controller.setButton(button, false);
  };
  // Verliert das Fenster den Fokus, bleiben sonst Tasten "gedrückt".
  const blur = () => {
    for (const button of Object.values(KEY_MAP)) controller.setButton(button, false);
  };

  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', blur);

  return () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
    window.removeEventListener('blur', blur);
  };
}

export { directionsFromAngle, DPAD_DEAD_ZONE, CARDINAL_HALF_ANGLE };
