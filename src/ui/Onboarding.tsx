import { useRef, useState } from 'preact/hooks';
import { readRomCandidates, type DumpGuete, type RomCandidate } from '../import/archive';
import { parseRomHeader } from '../emulator/rom';
import { isIos, isStandalone } from '../platform/persist';

/**
 * Der Bildschirm, den man genau einmal sieht.
 *
 * Er muss zwei Dinge leisten: erklären, warum hier kein Spiel mitgeliefert
 * wird, und den Import so einfach machen, dass er auf einem Telefon in zwei
 * Tipps erledigt ist — Archiv inklusive.
 */

const GUETE_BESCHRIFTUNG: Record<DumpGuete, string> = {
  geprueft: 'Geprüfter Abzug',
  normal: '',
  uebersetzung: 'Übersetzung',
  problematisch: 'Beschädigter Abzug',
};

/**
 * Ein Eintrag der Auswahlliste.
 *
 * Zeigt außer dem Dateinamen den Titel aus dem Cartridge-Header und die
 * Größe. In einem ROM-Satz unterscheiden sich die Dateinamen oft nur um ein
 * Kürzel in Klammern — der interne Titel sagt dagegen, was man wirklich
 * lädt.
 */
function KandidatenKnopf({
  candidate,
  disabled,
  onWaehlen,
}: {
  candidate: RomCandidate;
  disabled: boolean;
  onWaehlen: () => void;
}) {
  let untertitel = `${Math.round(candidate.data.length / 1024)} KB`;
  try {
    const header = parseRomHeader(candidate.data);
    if (header.title) untertitel = `${header.title} · ${untertitel}`;
    if (!header.checksumValid) untertitel += ' · Prüfsumme falsch';
  } catch {
    // Kein lesbarer Header — dann bleibt es bei der Größe.
  }

  const marke = GUETE_BESCHRIFTUNG[candidate.guete];

  return (
    <button
      type="button"
      class="knopf kandidat"
      disabled={disabled}
      onClick={onWaehlen}
      data-guete={candidate.guete}
    >
      <span class="kandidat-name">{candidate.name}</span>
      <span class="kandidat-info">
        {marke ? `${marke} · ` : ''}
        {untertitel}
      </span>
    </button>
  );
}

interface Props {
  onImport: (candidate: RomCandidate) => Promise<void>;
  onRestoreBackup: (file: File) => Promise<void>;
}

export function Onboarding({ onImport, onRestoreBackup }: Props) {
  const romInput = useRef<HTMLInputElement | null>(null);
  const backupInput = useRef<HTMLInputElement | null>(null);

  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [auswahl, setAuswahl] = useState<RomCandidate[] | null>(null);
  const [zeigeAlle, setZeigeAlle] = useState(false);

  const zeigeInstallhinweis = isIos() && !isStandalone();

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setFehler(null);
    setBusy(true);
    try {
      const candidates = await readRomCandidates(file);
      if (candidates.length === 1) {
        await onImport(candidates[0]);
      } else {
        // Mehrere ROMs im Archiv — dann muss der Nutzer entscheiden.
        setAuswahl(candidates);
      }
    } catch (error) {
      setFehler(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleBackup(file: File | undefined) {
    if (!file) return;
    setFehler(null);
    setBusy(true);
    try {
      await onRestoreBackup(file);
    } catch (error) {
      setFehler(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  if (auswahl) {
    const brauchbar = auswahl.filter((k) => k.guete !== 'problematisch');
    const kaputt = auswahl.filter((k) => k.guete === 'problematisch');
    const sichtbar = zeigeAlle ? [...brauchbar, ...kaputt] : brauchbar;

    return (
      <div class="overlay">
        <div class="blatt">
          <h2>Welches Spiel?</h2>
          <p>
            Im Archiv stecken {auswahl.length} ROMs.
            {kaputt.length > 0
              ? ` ${kaputt.length} davon sind als beschädigt gekennzeichnet und zunächst ausgeblendet.`
              : ''}
          </p>

          {sichtbar.map((candidate) => (
            <KandidatenKnopf
              key={candidate.name}
              candidate={candidate}
              disabled={busy}
              onWaehlen={async () => {
                setBusy(true);
                try {
                  await onImport(candidate);
                } catch (error) {
                  setFehler(error instanceof Error ? error.message : String(error));
                  setBusy(false);
                }
              }}
            />
          ))}

          {kaputt.length > 0 && !zeigeAlle ? (
            <button type="button" class="knopf" onClick={() => setZeigeAlle(true)}>
              Auch beschädigte Dumps anzeigen ({kaputt.length})
            </button>
          ) : null}

          {zeigeAlle && kaputt.length > 0 ? (
            <div class="hinweis">
              Einträge mit <strong>[b…]</strong>, <strong>[o…]</strong> oder{' '}
              <strong>[h…]</strong> sind unvollständige, zu große oder veränderte
              Abzüge. Sie starten oft gar nicht oder hängen sich mitten im Spiel
              auf — nimm sie nur, wenn nichts anderes da ist.
            </div>
          ) : null}

          <button type="button" class="knopf" onClick={() => setAuswahl(null)}>
            Zurück
          </button>
          {fehler ? <div class="hinweis">{fehler}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div class="overlay">
      <div class="blatt">
        <h2>Spiel laden</h2>
        <p>
          Diese App ist der Game Boy — das Spiel bringst du selbst mit. Aus
          urheberrechtlichen Gründen liegt hier kein ROM bei.
        </p>

        <button
          type="button"
          class="knopf wichtig"
          disabled={busy}
          onClick={() => romInput.current?.click()}
        >
          {busy ? 'Einen Moment …' : 'Datei auswählen'}
        </button>

        <input
          ref={romInput}
          type="file"
          class="versteckt"
          accept=".gb,.gbc,.zip,.7z,application/x-7z-compressed,application/zip"
          onChange={(event) => {
            const input = event.currentTarget;
            void handleFile(input.files?.[0]);
            // Zurücksetzen, damit dieselbe Datei erneut gewählt werden kann.
            input.value = '';
          }}
        />

        <div class="hinweis">
          <strong>.7z und .zip gehen direkt.</strong> Die App packt selbst aus —
          praktisch, weil die iPhone-Dateien-App zwar ZIP öffnen kann, 7z aber
          nicht. Einfach das Archiv auswählen.
        </div>

        {zeigeInstallhinweis ? (
          <div class="hinweis">
            <strong>Wichtig fürs iPhone:</strong> Lege die Seite über „Teilen →
            Zum Home-Bildschirm“ ab. Sonst löscht Safari nach sieben Tagen ohne
            Besuch alle Spielstände — installiert passiert das nicht.
          </div>
        ) : null}

        {fehler ? <div class="hinweis">{fehler}</div> : null}

        <h3>Schon einmal gesichert?</h3>
        <button
          type="button"
          class="knopf"
          disabled={busy}
          onClick={() => backupInput.current?.click()}
        >
          Sicherung einspielen
        </button>
        <input
          ref={backupInput}
          type="file"
          class="versteckt"
          accept=".json,application/json"
          onChange={(event) => {
            const input = event.currentTarget;
            void handleBackup(input.files?.[0]);
            input.value = '';
          }}
        />
      </div>
    </div>
  );
}
