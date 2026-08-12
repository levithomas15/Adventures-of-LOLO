/**
 * Baut ein winziges, aber echtes Game-Boy-ROM für die Tests.
 *
 * Damit braucht kein einziger Test eine urheberrechtlich geschützte Datei —
 * und das Repo bleibt sauber.
 *
 * Das Programm schaltet den Bildschirm ein und lässt danach die
 * Hintergrundpalette durchlaufen. Zwei Dinge werden dadurch prüfbar:
 * Der Zustand ändert sich fortlaufend (ein Schnappschuss muss ihn einfrieren,
 * und nach dem Laden muss exakt derselbe Wert wieder dastehen), und das Bild
 * ändert sichtbar seine Farbe — der End-zu-End-Test kann also am Canvas
 * ablesen, ob wirklich etwas emuliert wird.
 */

export const NINTENDO_LOGO = Uint8Array.from([
  0xce, 0xed, 0x66, 0x66, 0xcc, 0x0d, 0x00, 0x0b, 0x03, 0x73, 0x00, 0x83, 0x00, 0x0c, 0x00, 0x0d,
  0x00, 0x08, 0x11, 0x1f, 0x88, 0x89, 0x00, 0x0e, 0xdc, 0xcc, 0x6e, 0xe6, 0xdd, 0xdd, 0xd9, 0x99,
  0xbb, 0xbb, 0x67, 0x63, 0x6e, 0x0e, 0xec, 0xcc, 0xdd, 0x1c, 0x3e, 0x42, 0xb9, 0xa5, 0xb9, 0xa5,
]);

/** Register der Hintergrundpalette — das Testprogramm lässt es durchlaufen. */
export const BGP_ADDRESS = 0xff47;

/**
 * Ein Test-ROM, dessen Bildschirmfarbe unmittelbar am Joypad hängt.
 *
 * Es liest in einer Schleife das Joypad-Register und schreibt die gedrückten
 * Tasten direkt in die Hintergrundpalette. Ohne Tastendruck ist der Bildschirm
 * einfarbig; sobald A oder B gehalten wird, wechselt der Ton sichtbar.
 *
 * Damit lässt sich prüfen, was lange unbemerkt kaputt war: Eingaben landeten
 * zwar in der Anzeige des Gehäuses, erreichten den Emulator aber nie, weil
 * der Joypad-Callback von binjgb nicht angemeldet war. Ein Test, der nur auf
 * die Knopf-Hervorhebung schaut, hätte das nie bemerkt — dieser schon.
 */
export function buildJoypadRom() {
  const rom = buildFakeRom({ title: 'JOYPAD' });

  // 0x150  3E 91      LD A,$91
  // 0x152  EA 40 FF   LD ($FF40),A   ; Bildschirm einschalten
  // 0x155  3E 10      LD A,$10       ; Aktionstasten auswählen   <- Schleife
  // 0x157  E0 00      LDH ($00),A
  // 0x159  F0 00      LDH A,($00)    ; zweimal lesen, wie die Hardware es will
  // 0x15B  F0 00      LDH A,($00)
  // 0x15D  2F         CPL            ; gedrückt = 1
  // 0x15E  E6 0F      AND $0F
  // 0x160  E0 47      LDH ($47),A    ; in die Hintergrundpalette
  // 0x162  18 F1      JR -15         ; zurück zu 0x155
  rom.set(
    [
      0x3e, 0x91, 0xea, 0x40, 0xff, 0x3e, 0x10, 0xe0, 0x00, 0xf0, 0x00, 0xf0, 0x00, 0x2f, 0xe6,
      0x0f, 0xe0, 0x47, 0x18, 0xf1,
    ],
    0x150,
  );

  // Titel und Programm haben sich geändert — Prüfsumme neu bilden.
  let checksum = 0;
  for (let address = 0x134; address <= 0x14c; address++) {
    checksum = (checksum - rom[address] - 1) & 0xff;
  }
  rom[0x14d] = checksum;

  return rom;
}

/**
 * Ein ROM, das nach kurzer Zeit absichtlich in einen ungültigen Befehl läuft.
 *
 * Bildet den Fall nach, der die App im Spiel komplett einfrieren ließ: Der
 * Emulator meldete ein Ereignis, das die Schleife nicht behandelte, brach ab,
 * ohne das Zeitziel zu erreichen — und der Rückstand wurde in die nächste
 * Runde übernommen. Das Ziel wuchs mit jedem Bild, bis ein einzelner Frame
 * Millionen Zyklen am Stück abarbeiten sollte und der Hauptthread stand.
 *
 * Ein Test damit hängt sich auf, wenn der Fehler zurückkehrt — genau das
 * soll er.
 */
export function buildInvalidOpcodeRom() {
  const rom = buildFakeRom({ title: 'BADOP' });

  // 0x150  3E 91        LD A,$91
  // 0x152  EA 40 FF     LD ($FF40),A     ; Bildschirm an
  // 0x155  01 00 40     LD BC,$4000      ; rund zwei Bilder Vorlauf
  // 0x158  0B           DEC BC           <- Schleife
  // 0x159  78           LD A,B
  // 0x15A  B1           OR C
  // 0x15B  20 FB        JR NZ,-5
  // 0x15D  DD           ungültiger Befehl
  rom.set(
    [0x3e, 0x91, 0xea, 0x40, 0xff, 0x01, 0x00, 0x40, 0x0b, 0x78, 0xb1, 0x20, 0xfb, 0xdd],
    0x150,
  );

  let checksum = 0;
  for (let address = 0x134; address <= 0x14c; address++) {
    checksum = (checksum - rom[address] - 1) & 0xff;
  }
  rom[0x14d] = checksum;

  return rom;
}

/**
 * Eine NES-Attrappe: nur der iNES-Kopf und Füllbytes, kein lauffähiges
 * Programm. Mehr braucht es nicht — geprüft wird ausschließlich, dass die
 * App sie als Fremdsystem erkennt und das auch sagt, statt bloß "nichts
 * gefunden" zu melden.
 */
export function buildFakeNesRom({ prgBanks = 2, chrBanks = 4 } = {}) {
  const rom = new Uint8Array(16 + prgBanks * 16384 + chrBanks * 8192);
  rom.set([0x4e, 0x45, 0x53, 0x1a], 0); // "NES\x1A"
  rom[4] = prgBanks;
  rom[5] = chrBanks;
  rom[6] = 0x10; // Mapper 1 (MMC1), wie bei Adventures of Lolo
  return rom;
}

export function buildFakeRom({ title = 'TESTROM', cartridgeType = 0x00 } = {}) {
  const rom = new Uint8Array(0x8000); // 32 KiB, die kleinste gültige Größe

  // Einsprungpunkt: NOP, dann Sprung zum Programm bei 0x0150.
  rom[0x100] = 0x00; // NOP
  rom[0x101] = 0xc3; // JP nn
  rom[0x102] = 0x50;
  rom[0x103] = 0x01;

  rom.set(NINTENDO_LOGO, 0x104);

  // Titel, in Großbuchstaben und mit Nullbytes aufgefüllt.
  const upper = title.toUpperCase().slice(0, 15);
  for (let i = 0; i < upper.length; i++) rom[0x134 + i] = upper.charCodeAt(i);

  rom[0x147] = cartridgeType;
  rom[0x148] = 0x00; // ROM-Größe: 32 KiB
  rom[0x149] = cartridgeType === 0x00 ? 0x00 : 0x02; // RAM-Größe: keins bzw. 8 KiB

  // 0x150  3E 91        LD A, 0x91        ; LCD an, Hintergrund an
  // 0x152  EA 40 FF     LD (0xFF40), A    ; nach LCDC
  // 0x155  21 47 FF     LD HL, 0xFF47     ; Zeiger auf die Hintergrundpalette
  // 0x158  34           INC (HL)          ; Palette weiterdrehen  <- Schleife
  // 0x159  06 00        LD B, 0x00
  // 0x15B  05           DEC B             ; kurze Verzögerung      <- Warte
  // 0x15C  20 FD        JR NZ, -3         ; zurück zu 0x15B
  // 0x15E  18 F8        JR -8             ; zurück zu 0x158
  rom.set(
    [0x3e, 0x91, 0xea, 0x40, 0xff, 0x21, 0x47, 0xff, 0x34, 0x06, 0x00, 0x05, 0x20, 0xfd, 0x18, 0xf8],
    0x150,
  );

  // Header-Prüfsumme über 0x134…0x14C.
  let checksum = 0;
  for (let address = 0x134; address <= 0x14c; address++) {
    checksum = (checksum - rom[address] - 1) & 0xff;
  }
  rom[0x14d] = checksum;

  return rom;
}
