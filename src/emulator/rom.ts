/**
 * Game-Boy-Cartridge-Header lesen und prüfen.
 *
 * Reine Logik, kein DOM — damit in Node testbar (siehe test/rom.test.js).
 *
 * Der Header liegt bei 0x0100–0x014F. Wir lesen ihn aus zwei Gründen:
 *  1. Um früh zu erkennen, ob die importierte Datei überhaupt ein GB-ROM ist
 *     (statt den Nutzer auf einen schwarzen Bildschirm starren zu lassen).
 *  2. Um den Titel anzuzeigen und zu wissen, ob die Cartridge eine Batterie
 *     hat. Adventures of Lolo hat keine — das Spiel kann den Fortschritt also
 *     gar nicht selbst sichern, und die App muss auf Save States hinweisen.
 */

/** Die 48 Bytes bei 0x0104. Das Boot-ROM prüft sie; ohne sie startet nichts. */
export const NINTENDO_LOGO = Uint8Array.from([
  0xce, 0xed, 0x66, 0x66, 0xcc, 0x0d, 0x00, 0x0b, 0x03, 0x73, 0x00, 0x83, 0x00, 0x0c, 0x00, 0x0d,
  0x00, 0x08, 0x11, 0x1f, 0x88, 0x89, 0x00, 0x0e, 0xdc, 0xcc, 0x6e, 0xe6, 0xdd, 0xdd, 0xd9, 0x99,
  0xbb, 0xbb, 0x67, 0x63, 0x6e, 0x0e, 0xec, 0xcc, 0xdd, 0x1c, 0x3e, 0x42, 0xb9, 0xa5, 0xb9, 0xa5,
]);

const LOGO_OFFSET = 0x0104;
const TITLE_OFFSET = 0x0134;
const CGB_FLAG_OFFSET = 0x0143;
const CARTRIDGE_TYPE_OFFSET = 0x0147;
const ROM_SIZE_OFFSET = 0x0148;
const RAM_SIZE_OFFSET = 0x0149;
const HEADER_CHECKSUM_OFFSET = 0x014d;

/** Kleinstmögliches ROM: 32 KiB. Alles darunter kann kein gültiges Spiel sein. */
const MIN_ROM_SIZE = 0x8000;

/** Cartridge-Typen mit Batteriepuffer — nur die können selbst speichern. */
const BATTERY_TYPES = new Set([
  0x03, 0x06, 0x09, 0x0d, 0x0f, 0x10, 0x13, 0x1b, 0x1e, 0x22, 0xff,
]);

const CARTRIDGE_TYPE_NAMES: Record<number, string> = {
  0x00: 'ROM ONLY',
  0x01: 'MBC1',
  0x02: 'MBC1+RAM',
  0x03: 'MBC1+RAM+BATTERY',
  0x05: 'MBC2',
  0x06: 'MBC2+BATTERY',
  0x08: 'ROM+RAM',
  0x09: 'ROM+RAM+BATTERY',
  0x0b: 'MMM01',
  0x0c: 'MMM01+RAM',
  0x0d: 'MMM01+RAM+BATTERY',
  0x0f: 'MBC3+TIMER+BATTERY',
  0x10: 'MBC3+TIMER+RAM+BATTERY',
  0x11: 'MBC3',
  0x12: 'MBC3+RAM',
  0x13: 'MBC3+RAM+BATTERY',
  0x19: 'MBC5',
  0x1a: 'MBC5+RAM',
  0x1b: 'MBC5+RAM+BATTERY',
  0x1c: 'MBC5+RUMBLE',
  0x1d: 'MBC5+RUMBLE+RAM',
  0x1e: 'MBC5+RUMBLE+RAM+BATTERY',
  0x20: 'MBC6',
  0x22: 'MBC7+SENSOR+RUMBLE+RAM+BATTERY',
  0xfc: 'POCKET CAMERA',
  0xfd: 'BANDAI TAMA5',
  0xfe: 'HuC3',
  0xff: 'HuC1+RAM+BATTERY',
};

/** RAM-Größe in Bytes, indiziert über das Byte bei 0x0149. */
const RAM_SIZES = [0, 2048, 8192, 32768, 131072, 65536];

export interface RomHeader {
  /** Titel aus 0x0134, z. B. "ADVENTURES OF LOLO". */
  title: string;
  cartridgeType: number;
  cartridgeTypeName: string;
  romSize: number;
  ramSize: number;
  /** Kann die Cartridge selbst speichern? Bei Lolo: nein. */
  hasBattery: boolean;
  /** Game Boy Color: 0x80 = unterstützt, 0xc0 = nur CGB. */
  isColor: boolean;
  /** Nintendo-Logo an der richtigen Stelle? */
  logoValid: boolean;
  /** Header-Prüfsumme korrekt? Warnung, kein Ausschlusskriterium. */
  checksumValid: boolean;
}

/**
 * Header-Prüfsumme nach Pan Docs: von 0x0134 bis 0x014C
 * fortlaufend `x = x - byte - 1`, Ergebnis muss 0x014D entsprechen.
 */
export function computeHeaderChecksum(rom: Uint8Array): number {
  let checksum = 0;
  for (let address = TITLE_OFFSET; address <= 0x014c; address++) {
    checksum = (checksum - rom[address] - 1) & 0xff;
  }
  return checksum;
}

function readTitle(rom: Uint8Array): string {
  // Der Titel ist 16 Bytes; bei neueren Cartridges belegen Hersteller-Code und
  // CGB-Flag die letzten vier. Wir lesen defensiv bis 0x0143 und schneiden am
  // ersten Nullbyte ab — das deckt beide Varianten ab.
  const bytes = rom.subarray(TITLE_OFFSET, CGB_FLAG_OFFSET);
  let text = '';
  for (const byte of bytes) {
    if (byte === 0x00) break;
    // Nur druckbares ASCII; Schrott aus kaputten Dumps fliegt raus.
    if (byte >= 0x20 && byte < 0x7f) text += String.fromCharCode(byte);
  }
  return text.trim();
}

/** Liest den Header. Wirft nicht — `logoValid` sagt, ob man dem Ergebnis trauen darf. */
export function parseRomHeader(rom: Uint8Array): RomHeader {
  if (rom.length < MIN_ROM_SIZE) {
    throw new Error(
      `Datei ist mit ${rom.length} Bytes zu klein für ein Game-Boy-ROM (mindestens ${MIN_ROM_SIZE}).`,
    );
  }

  let logoValid = true;
  for (let i = 0; i < NINTENDO_LOGO.length; i++) {
    if (rom[LOGO_OFFSET + i] !== NINTENDO_LOGO[i]) {
      logoValid = false;
      break;
    }
  }

  const cartridgeType = rom[CARTRIDGE_TYPE_OFFSET];
  const cgbFlag = rom[CGB_FLAG_OFFSET];
  const ramSizeCode = rom[RAM_SIZE_OFFSET];

  return {
    title: readTitle(rom),
    cartridgeType,
    cartridgeTypeName: CARTRIDGE_TYPE_NAMES[cartridgeType] ?? `Unbekannt (0x${cartridgeType.toString(16)})`,
    romSize: 0x8000 << rom[ROM_SIZE_OFFSET],
    ramSize: RAM_SIZES[ramSizeCode] ?? 0,
    hasBattery: BATTERY_TYPES.has(cartridgeType),
    isColor: cgbFlag === 0x80 || cgbFlag === 0xc0,
    logoValid,
    checksumValid: computeHeaderChecksum(rom) === rom[HEADER_CHECKSUM_OFFSET],
  };
}

/**
 * So viele Logo-Bytes müssen stimmen, damit eine Datei als Game-Boy-ROM gilt.
 *
 * Nicht alle 48, sondern 24 — dieselbe Schwelle, die auch das Boot-ROM des
 * Game Boy Color anlegt. Nur das ältere DMG-Boot-ROM vergleicht das Logo
 * vollständig.
 *
 * Der Anlass war eine echte Datei: 256 KB, MBC1, Header-Prüfsumme korrekt,
 * im Emulator einwandfrei spielbar — aber die letzten 7 der 48 Logo-Bytes
 * wichen ab. Die strenge Prüfung hätte sie abgewiesen, obwohl binjgb sie
 * problemlos startet (es führt gar kein Boot-ROM aus, sondern beginnt direkt
 * bei 0x100). Die Schleuse war strenger als der Emulator dahinter.
 */
const LOGO_PRUEFUMFANG = 24;

/**
 * Schnelltest ohne Ausnahmen — dient dem Archiv-Import dazu, unter mehreren
 * Dateien die eine herauszufischen, die wirklich ein ROM ist.
 *
 * Bewusst nachsichtig beim Logo (siehe oben), aber nicht beliebig: Größe und
 * Cartridge-Typ müssen zusätzlich plausibel sein, sonst rutschte in einem
 * Archiv irgendeine Binärdatei durch.
 */
export function looksLikeGameBoyRom(data: Uint8Array): boolean {
  if (data.length < MIN_ROM_SIZE) return false;

  for (let i = 0; i < LOGO_PRUEFUMFANG; i++) {
    if (data[LOGO_OFFSET + i] !== NINTENDO_LOGO[i]) return false;
  }

  return CARTRIDGE_TYPE_NAMES[data[CARTRIDGE_TYPE_OFFSET]] !== undefined;
}

/**
 * Erkennt ROMs *anderer* Systeme.
 *
 * Anlass war ein Archiv namens "Adventures of Lolo", das 22 NES-ROMs enthielt
 * und keine einzige Game-Boy-Datei. Die App wusste das bereits — sie hatte die
 * Dateien entpackt und geprüft — sagte aber nur "keine Game-Boy-ROM-Datei".
 * Damit sucht man den Fehler beim Emulator statt bei der Datei.
 *
 * Das Spiel gibt es nämlich zweimal: NES (1989) und Game Boy (1994), mit
 * eigenen Leveln. Wer das nicht weiß, kommt von allein nicht darauf.
 *
 * Gibt den Systemnamen zurück oder `null`, wenn nichts Bekanntes erkannt wird.
 */
export function erkenneFremdsystem(data: Uint8Array, dateiname = ''): string | null {
  // NES: der iNES-Header ist eindeutig und steht ganz vorn.
  if (
    data.length >= 16 &&
    data[0] === 0x4e && // N
    data[1] === 0x45 && // E
    data[2] === 0x53 && // S
    data[3] === 0x1a
  ) {
    return 'NES';
  }

  // Für die übrigen Systeme genügt die Endung. Ihre Kopfdaten sicher zu
  // erkennen wäre deutlich aufwendiger, und der Zweck ist ohnehin nur, dem
  // Nutzer zu sagen, woran es liegt — nicht, die Datei zu verarbeiten.
  const endung = dateiname.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  switch (endung) {
    case 'nes':
    case 'unf':
    case 'unif':
      return 'NES';
    case 'gba':
      return 'Game Boy Advance';
    case 'smc':
    case 'sfc':
    case 'swc':
      return 'Super Nintendo';
    case 'n64':
    case 'z64':
    case 'v64':
      return 'Nintendo 64';
    case 'md':
    case 'gen':
    case 'smd':
      return 'Mega Drive';
    case 'nds':
      return 'Nintendo DS';
    case 'sms':
      return 'Master System';
    default:
      return null;
  }
}

/** SHA-1 als stabile ROM-Identität (erkennt Re-Importe derselben Datei). */
export async function romFingerprint(rom: Uint8Array): Promise<string> {
  // Eigener ArrayBuffer, weil `rom` ein View auf einen größeren Puffer sein kann.
  const copy = rom.slice();
  const digest = await crypto.subtle.digest('SHA-1', copy);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
