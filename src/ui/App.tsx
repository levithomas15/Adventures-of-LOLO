import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { GameBoy } from './GameBoy';
import { Onboarding } from './Onboarding';
import { PauseMenu } from './PauseMenu';
import { GameSession, type SessionState } from '../session';
import { TouchController, attachKeyboard } from '../input/touch';
import { emptyJoypadState } from '../emulator/core';
import { readSettings, writeSettings, type Settings, type StoredRom, type StoredSave } from '../storage/db';
import { getRom, importRom, listRoms } from '../storage/roms';
import { latestAutoSave } from '../storage/saves';
import { backupFileName, exportBackup, importBackup } from '../storage/backup';
import { requestPersistentStorage } from '../platform/persist';
import type { RomCandidate } from '../import/archive';

type Meldung = { text: string; art: 'info' | 'fehler' } | null;

const LEER: SessionState = {
  phase: 'leer',
  rom: null,
  running: false,
  playtimeMs: 0,
  joypad: emptyJoypadState(),
  lastAutoSaveAt: null,
};

export function App() {
  // Genau eine Sitzung pro App-Leben — der Emulator-Worker verträgt keine
  // zweite Instanz, und ein Neu-Render darf ihn nicht neu starten.
  const session = useMemo(() => new GameSession(), []);
  const [zustand, setZustand] = useState<SessionState>(LEER);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [menuOffen, setMenuOffen] = useState(false);
  const [zeigeImport, setZeigeImport] = useState(false);
  const [bereit, setBereit] = useState(false);
  const [meldung, setMeldung] = useState<Meldung>(null);
  const [fortsetzbar, setFortsetzbar] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const angebunden = useRef(false);

  const controller = useMemo(
    () =>
      new TouchController(
        (state) => session.setJoypad(state),
        // Erste Berührung: Auf iOS darf der AudioContext erst jetzt starten.
        () => void session.unlockAudio(),
      ),
    [session],
  );

  const zeige = useCallback((text: string, art: 'info' | 'fehler' = 'info') => {
    setMeldung({ text, art });
    setTimeout(() => setMeldung(null), art === 'fehler' ? 6000 : 2600);
  }, []);

  useEffect(() => session.subscribe(setZustand), [session]);
  useEffect(() => attachKeyboard(controller), [controller]);

  // ---------------------------------------------------------------- Start

  const canvasAnbinden = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      canvasRef.current = canvas;
      if (!canvas || angebunden.current) return;
      angebunden.current = true;

      void (async () => {
        try {
          await session.attach(canvas);
          const gespeicherte = await readSettings();
          setSettings(gespeicherte);
          session.setPalette(gespeicherte.paletteId);

          // Zuletzt gespieltes ROM wiederfinden — sonst das einzige
          // vorhandene, damit man nach dem Import nicht erneut wählen muss.
          const roms = await listRoms();
          const letztes = gespeicherte.lastRomId
            ? await getRom(gespeicherte.lastRomId)
            : undefined;
          const rom = letztes ?? roms[0];

          if (rom) {
            await session.loadRom(rom);
            setFortsetzbar(Boolean(await latestAutoSave(rom.id)));
          } else {
            setZeigeImport(true);
          }
        } catch (error) {
          zeige(
            error instanceof Error ? error.message : 'Der Emulator ließ sich nicht starten.',
            'fehler',
          );
        } finally {
          setBereit(true);
        }
      })();
    },
    [session, zeige],
  );

  // Palette und Raster hängen am Wurzelelement, damit auch die Overlays passen.
  useEffect(() => {
    if (settings) document.documentElement.dataset.palette = settings.paletteId;
  }, [settings?.paletteId]);

  // --------------------------------------------------------------- Aktionen

  const romUebernehmen = useCallback(
    async (candidate: RomCandidate) => {
      const rom: StoredRom = await importRom(candidate.data, candidate.name);
      await writeSettings({ lastRomId: rom.id });
      setSettings(await readSettings());

      await session.loadRom(rom);
      setZeigeImport(false);
      setFortsetzbar(false);

      // Erst jetzt nach dauerhaftem Speicher fragen: Der Browser gewährt ihn
      // eher, wenn erkennbar echte Nutzung dahintersteht.
      void requestPersistentStorage();

      await session.play();

      if (!rom.header.logoValid) {
        // Kein Grund zur Sorge, aber erwähnenswert: Der Emulator startet
        // ohne Boot-ROM direkt bei 0x100, das Logo ist ihm also gleichgültig.
        // Auf einem echten Game Boy bliebe der Bildschirm dagegen leer.
        zeige(
          `${rom.title} geladen. Das Nintendo-Logo im Header weicht ab — im Emulator egal, auf echter Hardware startete die Cartridge nicht.`,
        );
      } else {
        zeige(`${rom.title} geladen.`);
      }
    },
    [session, zeige],
  );

  const sicherungEinspielen = useCallback(
    async (file: File) => {
      const ergebnis = await importBackup(file);
      const roms = await listRoms();
      if (roms[0]) {
        await session.loadRom(roms[0]);
        await writeSettings({ lastRomId: roms[0].id });
        setSettings(await readSettings());
        setFortsetzbar(Boolean(await latestAutoSave(roms[0].id)));
      }
      setZeigeImport(false);
      zeige(`Sicherung eingespielt: ${ergebnis.roms} ROM(s), ${ergebnis.saves} Stände.`);
    },
    [session, zeige],
  );

  const fortsetzen = useCallback(async () => {
    const rom = zustand.rom;
    if (!rom) return;
    const save = await latestAutoSave(rom.id);
    if (save) {
      await session.loadSave(save);
      zeige('Weiter, wo du aufgehört hast.');
    }
    await session.play();
  }, [session, zustand.rom, zeige]);

  const einstellungAendern = useCallback(
    async (patch: Partial<Settings>) => {
      const next = await writeSettings(patch);
      setSettings(next);
      if (patch.audioEnabled !== undefined) {
        await session.setAudioEnabled(patch.audioEnabled);
      }
      if (patch.paletteId !== undefined) {
        session.setPalette(patch.paletteId);
      }
    },
    [session],
  );

  const exportieren = useCallback(async () => {
    try {
      const blob = await exportBackup();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = backupFileName();
      link.click();
      // Erst nach dem Klick freigeben, sonst bricht der Download ab.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      zeige('Sicherung erstellt.');
    } catch (error) {
      zeige(error instanceof Error ? error.message : 'Export fehlgeschlagen.', 'fehler');
    }
  }, [zeige]);

  const menuOeffnen = useCallback(async () => {
    // Menü öffnen heißt pausieren — und Pausieren heißt sichern.
    if (zustand.running) await session.pause();
    setMenuOffen(true);
  }, [session, zustand.running]);

  const speichernAuf = useCallback(
    async (slot: number) => {
      try {
        await session.saveToSlot(slot);
        zeige(`Auf Platz ${slot + 1} gespeichert.`);
      } catch (error) {
        zeige(error instanceof Error ? error.message : 'Speichern fehlgeschlagen.', 'fehler');
      }
    },
    [session, zeige],
  );

  const standLaden = useCallback(
    async (save: StoredSave) => {
      try {
        await session.loadSave(save);
        setMenuOffen(false);
        await session.play();
        zeige('Stand geladen.');
      } catch (error) {
        zeige(error instanceof Error ? error.message : 'Laden fehlgeschlagen.', 'fehler');
      }
    },
    [session, zeige],
  );

  // ------------------------------------------------------------- Darstellung

  const hatSpiel = zustand.phase === 'bereit' && zustand.rom !== null;

  let bildschirmHinweis = null;
  if (!bereit) {
    bildschirmHinweis = <span>Startet …</span>;
  } else if (!hatSpiel) {
    bildschirmHinweis = <span>Kein Spiel geladen</span>;
  } else if (!zustand.running) {
    bildschirmHinweis = (
      <>
        <strong>{fortsetzbar ? 'Fortsetzen?' : 'Bereit'}</strong>
        <button
          type="button"
          class="knopf"
          style="max-width: 190px"
          onClick={() => void (fortsetzbar ? fortsetzen() : session.play())}
        >
          {fortsetzbar ? 'Weiterspielen' : 'Starten'}
        </button>
      </>
    );
  }

  return (
    <>
      <GameBoy
        canvasRef={canvasAnbinden}
        controller={controller}
        joypad={zustand.joypad}
        running={zustand.running}
        scanlines={settings?.scanlines ?? false}
        title={zustand.rom?.title ?? 'ADVENTURES OF LOLO'}
        screenOverlay={bildschirmHinweis}
        canPause={hatSpiel}
        onMenu={() => {
          if (hatSpiel) void menuOeffnen();
          else setZeigeImport(true);
        }}
        onTogglePause={() => void session.togglePause()}
      />

      {zeigeImport ? (
        <Onboarding onImport={romUebernehmen} onRestoreBackup={sicherungEinspielen} />
      ) : null}

      {menuOffen && zustand.rom && settings ? (
        <PauseMenu
          rom={zustand.rom}
          settings={settings}
          playtimeMs={zustand.playtimeMs}
          lastAutoSaveAt={zustand.lastAutoSaveAt}
          onClose={() => {
            setMenuOffen(false);
            void session.play();
          }}
          onSaveSlot={speichernAuf}
          onLoadSave={standLaden}
          onSettings={einstellungAendern}
          onExport={exportieren}
          onImportBackup={sicherungEinspielen}
          onReset={() => session.reset()}
          onChangeRom={() => {
            setMenuOffen(false);
            setZeigeImport(true);
          }}
        />
      ) : null}

      {meldung ? (
        <div class="meldung" data-art={meldung.art}>
          {meldung.text}
        </div>
      ) : null}
    </>
  );
}
