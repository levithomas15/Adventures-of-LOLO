import { useEffect, useState } from 'preact/hooks';
import { MANUAL_SLOT_COUNT, type Settings, type StoredRom, type StoredSave } from '../storage/db';
import { deleteSave, listSaves, manualSlots } from '../storage/saves';
import { formatBytes, isIos, isStandalone, storageStatus, type StorageStatus } from '../platform/persist';

/**
 * Pausenmenü: Speicherplätze, Einstellungen, Sicherung.
 *
 * Die Speicherplätze stehen absichtlich ganz oben. Bei einem Spiel ohne
 * eigene Speicherfunktion sind sie der meistgenutzte Teil der App.
 */

type Reiter = 'speichern' | 'laden';

interface Props {
  rom: StoredRom;
  settings: Settings;
  playtimeMs: number;
  lastAutoSaveAt: number | null;
  onClose: () => void;
  onSaveSlot: (slot: number) => Promise<void>;
  onLoadSave: (save: StoredSave) => Promise<void>;
  onSettings: (patch: Partial<Settings>) => Promise<void>;
  onExport: () => Promise<void>;
  onImportBackup: (file: File) => Promise<void>;
  onReset: () => Promise<void>;
  onChangeRom: () => void;
}

export function formatPlaytime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min`;
  return `${total} s`;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function PauseMenu(props: Props) {
  const {
    rom,
    settings,
    playtimeMs,
    lastAutoSaveAt,
    onClose,
    onSaveSlot,
    onLoadSave,
    onSettings,
    onExport,
    onImportBackup,
    onReset,
    onChangeRom,
  } = props;

  const [reiter, setReiter] = useState<Reiter>('speichern');
  const [slots, setSlots] = useState<(StoredSave | null)[]>(
    new Array(MANUAL_SLOT_COUNT).fill(null),
  );
  const [autoSaves, setAutoSaves] = useState<StoredSave[]>([]);
  const [speicher, setSpeicher] = useState<StorageStatus | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [manual, alle, status] = await Promise.all([
      manualSlots(rom.id),
      listSaves(rom.id),
      storageStatus(),
    ]);
    setSlots(manual);
    setAutoSaves(alle.filter((s) => s.kind === 'auto').sort((a, b) => b.createdAt - a.createdAt));
    setSpeicher(status);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rom.id, lastAutoSaveAt]);

  async function handleSlot(index: number) {
    const belegt = slots[index];
    setBusy(true);
    try {
      if (reiter === 'laden') {
        if (belegt) await onLoadSave(belegt);
      } else {
        if (belegt && !confirm(`Platz ${index + 1} überschreiben?`)) return;
        await onSaveSlot(index);
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="overlay">
      <div class="blatt">
        <h2>{rom.title}</h2>
        <p>
          Gespielt: {formatPlaytime(playtimeMs)}
          {lastAutoSaveAt ? ` · zuletzt automatisch gesichert ${formatTime(lastAutoSaveAt)}` : ''}
        </p>

        <button type="button" class="knopf wichtig" onClick={onClose}>
          Weiterspielen
        </button>

        {!rom.header.hasBattery ? (
          <div class="hinweis">
            <strong>Dieses Spiel speichert nicht selbst.</strong> Die Cartridge
            hat keine Batterie — im Original arbeitet es mit Passwörtern. Dein
            Fortschritt hängt deshalb an den Plätzen hier. Automatisch wird
            zusätzlich alle 30 Sekunden und bei jeder Pause gesichert.
          </div>
        ) : null}

        <h3>Speicherplätze</h3>
        <div class="knopf-reihe">
          <button
            type="button"
            class={`knopf${reiter === 'speichern' ? ' wichtig' : ''}`}
            onClick={() => setReiter('speichern')}
          >
            Speichern
          </button>
          <button
            type="button"
            class={`knopf${reiter === 'laden' ? ' wichtig' : ''}`}
            onClick={() => setReiter('laden')}
          >
            Laden
          </button>
        </div>

        <div class="plaetze">
          {slots.map((save, index) => (
            <button
              key={index}
              type="button"
              class="platz"
              data-belegt={String(Boolean(save))}
              disabled={busy || (reiter === 'laden' && !save)}
              onClick={() => void handleSlot(index)}
            >
              {save?.thumbnail ? (
                <img src={save.thumbnail} alt="" />
              ) : (
                <span class="platz-leer">{reiter === 'speichern' ? '+' : '–'}</span>
              )}
              <span class="platz-name">Platz {index + 1}</span>
              <span class="platz-zeit">
                {save ? formatTime(save.createdAt) : 'frei'}
              </span>
            </button>
          ))}
        </div>

        {reiter === 'speichern' && slots.some(Boolean) ? (
          <button
            type="button"
            class="knopf gefahr"
            disabled={busy}
            onClick={async () => {
              if (!confirm('Alle manuellen Speicherplätze löschen?')) return;
              setBusy(true);
              try {
                for (const save of slots) if (save) await deleteSave(save.id);
                await refresh();
              } finally {
                setBusy(false);
              }
            }}
          >
            Alle Plätze leeren
          </button>
        ) : null}

        {autoSaves.length > 0 ? (
          <>
            <h3>Automatisch gesichert</h3>
            <p>
              {autoSaves.length === 1
                ? 'Der letzte Stand — praktisch, wenn ein Zug danebenging.'
                : `Die letzten ${autoSaves.length} Stände — praktisch, wenn ein Zug danebenging.`}
            </p>
            <div class="plaetze">
              {autoSaves.map((save) => (
                <button
                  key={save.id}
                  type="button"
                  class="platz"
                  data-belegt="true"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await onLoadSave(save);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {save.thumbnail ? <img src={save.thumbnail} alt="" /> : <span class="platz-leer">–</span>}
                  <span class="platz-name">Auto</span>
                  <span class="platz-zeit">{formatTime(save.createdAt)}</span>
                </button>
              ))}
            </div>
          </>
        ) : null}

        <h3>Einstellungen</h3>

        <label class="feld">
          Bildschirmfarbe
          <select
            value={settings.paletteId}
            onChange={(event) =>
              void onSettings({ paletteId: (event.target as HTMLSelectElement).value })
            }
          >
            <option value="dmg">Grün (Original)</option>
            <option value="pocket">Grau (Pocket)</option>
            <option value="light">Blaugrün (Light)</option>
          </select>
        </label>

        <div class="feld">
          Ton
          <button
            type="button"
            class="schalter"
            data-an={String(settings.audioEnabled)}
            aria-label="Ton umschalten"
            onClick={() => void onSettings({ audioEnabled: !settings.audioEnabled })}
          />
        </div>

        <div class="feld">
          LCD-Raster
          <button
            type="button"
            class="schalter"
            data-an={String(settings.scanlines)}
            aria-label="Raster umschalten"
            onClick={() => void onSettings({ scanlines: !settings.scanlines })}
          />
        </div>

        {settings.audioEnabled && isIos() ? (
          <div class="hinweis">
            Kein Ton? Auf dem iPhone gilt für Web-Audio der{' '}
            <strong>seitliche Stummschalter</strong> — auch wenn andere Apps
            klingen.
          </div>
        ) : null}

        <h3>Sicherung</h3>
        <p>
          Schreibt ROM, Speicherstände und Einstellungen in eine Datei. Sinnvoll,
          bevor Safari aufräumt.
        </p>
        <div class="knopf-reihe">
          <button type="button" class="knopf" disabled={busy} onClick={() => void onExport()}>
            Exportieren
          </button>
          <label class="knopf" style="cursor: pointer">
            Einspielen
            <input
              type="file"
              class="versteckt"
              accept=".json,application/json"
              onChange={(event) => {
                const input = event.currentTarget;
                const file = input.files?.[0];
                input.value = '';
                if (file) void onImportBackup(file).then(refresh);
              }}
            />
          </label>
        </div>

        {speicher ? (
          <div class="hinweis">
            Belegt: {speicher.usageBytes !== null ? formatBytes(speicher.usageBytes) : '–'}
            {speicher.quotaBytes !== null ? ` von ${formatBytes(speicher.quotaBytes)}` : ''}
            {' · '}
            {speicher.persisted
              ? 'dauerhaft gesichert'
              : 'nicht als dauerhaft markiert'}
            {isIos() && !isStandalone()
              ? ' — lege die App über „Teilen → Zum Home-Bildschirm“ ab, damit Safari die Daten nicht nach sieben Tagen löscht.'
              : ''}
          </div>
        ) : null}

        <h3>Spiel</h3>
        <div class="knopf-reihe">
          <button
            type="button"
            class="knopf"
            disabled={busy}
            onClick={async () => {
              if (!confirm('Spiel neu starten? Der laufende Stand geht verloren.')) return;
              await onReset();
              onClose();
            }}
          >
            Neu starten
          </button>
          <button type="button" class="knopf" onClick={onChangeRom}>
            Anderes ROM
          </button>
        </div>
      </div>
    </div>
  );
}
