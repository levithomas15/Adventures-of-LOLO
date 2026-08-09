import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { JoypadState } from '../emulator/core';
import type { TouchController, TouchRegionId } from '../input/touch';

/**
 * Das Gehäuse.
 *
 * Die Knöpfe sind hier reine Trefferflächen und Anzeige — gedrückt werden sie
 * nicht über eigene Ereignisse, sondern indirekt: `TouchController` wertet
 * alle aufliegenden Finger gegen ihre Rechtecke aus (siehe input/touch.ts).
 * `data-gedrueckt` spiegelt danach nur noch, was der Emulator wirklich sieht.
 */

interface Props {
  canvasRef: (canvas: HTMLCanvasElement | null) => void;
  controller: TouchController;
  joypad: JoypadState;
  running: boolean;
  scanlines: boolean;
  title: string;
  /** Einblendung im Bildschirm, solange kein Spiel läuft. */
  screenOverlay?: ComponentChildren;
  onMenu: () => void;
  onTogglePause: () => void;
  canPause: boolean;
}

/** Meldet ein Element beim Controller an und wieder ab. */
function useRegion(controller: TouchController, id: TouchRegionId) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    controller.registerRegion(id, element);
    return () => controller.unregisterRegion(id);
  }, [controller, id]);

  return ref;
}

export function GameBoy(props: Props) {
  const {
    canvasRef,
    controller,
    joypad,
    running,
    scanlines,
    title,
    screenOverlay,
    onMenu,
    onTogglePause,
    canPause,
  } = props;

  const gehaeuseRef = useRef<HTMLDivElement | null>(null);

  const kreuzRef = useRegion(controller, 'dpad');
  const aRef = useRegion(controller, 'a');
  const bRef = useRegion(controller, 'b');
  const startRef = useRegion(controller, 'start');
  const selectRef = useRegion(controller, 'select');

  useEffect(() => {
    const element = gehaeuseRef.current;
    if (!element) return;
    controller.attach(element);
    // Erst nach dem Layout messen, sonst sind alle Rechtecke 0×0.
    requestAnimationFrame(() => controller.measure());
    return () => controller.detach();
  }, [controller]);

  return (
    <div class="geraet">
      <div class="gehaeuse" ref={gehaeuseRef}>
        <div class="rahmen">
          <div class="rahmen-oben">DOT MATRIX MIT STEREO-SOUND</div>

          <div class="betrieb">
            <span class="led" data-an={String(running)} />
            <span>BETRIEB</span>
          </div>

          <div class="bildschirm" data-raster={String(scanlines)}>
            <canvas ref={canvasRef} width={160} height={144} />
            {screenOverlay ? <div class="bildschirm-hinweis">{screenOverlay}</div> : null}
          </div>
        </div>

        <div class="wortmarke">
          {title}
          <span>POCKET</span>
        </div>

        <div class="bedienung">
          {/* Eine Fläche, keine vier: Richtung kommt aus der Geometrie. */}
          <div class="kreuz" ref={kreuzRef as never}>
            <div class="kreuz-arm waagerecht" />
            <div class="kreuz-arm senkrecht" />
            <div class="kreuz-pfeil oben" data-aktiv={String(joypad.UP)} />
            <div class="kreuz-pfeil unten" data-aktiv={String(joypad.DOWN)} />
            <div class="kreuz-pfeil links" data-aktiv={String(joypad.LEFT)} />
            <div class="kreuz-pfeil rechts" data-aktiv={String(joypad.RIGHT)} />
            <div class="kreuz-mitte" />
          </div>

          <div class="ab">
            <button
              type="button"
              class="rundknopf"
              data-marke="B"
              data-gedrueckt={String(joypad.B)}
              ref={bRef as never}
              aria-label="B"
            />
            <button
              type="button"
              class="rundknopf"
              data-marke="A"
              data-gedrueckt={String(joypad.A)}
              ref={aRef as never}
              aria-label="A"
            />
          </div>

          <div class="mitte">
            <button
              type="button"
              class="pille"
              data-marke="SELECT"
              data-gedrueckt={String(joypad.SELECT)}
              ref={selectRef as never}
              aria-label="Select"
            />
            <button
              type="button"
              class="pille"
              data-marke="START"
              data-gedrueckt={String(joypad.START)}
              ref={startRef as never}
              aria-label="Start"
            />
          </div>
        </div>

        <div class="lautsprecher" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>

        <div class="leiste">
          <button type="button" class="leiste-knopf" onClick={onTogglePause} disabled={!canPause}>
            {running ? 'Pause' : 'Weiter'}
          </button>
          <button type="button" class="leiste-knopf" onClick={onMenu}>
            Menü
          </button>
        </div>
      </div>
    </div>
  );
}
