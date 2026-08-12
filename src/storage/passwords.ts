import { getDb, type StoredPassword } from './db';

/**
 * Notizblock für die Spiel-Passwörter.
 *
 * Adventures of Lolo hat keinen Batteriepuffer: Statt zu speichern, nennt es
 * am Ende eines Abschnitts ein Passwort, das man im Original auf Papier
 * schrieb. Die Speicherplätze dieser App ersetzen das im Alltag — aber ein
 * Passwort gilt geräteübergreifend und überlebt auch gelöschte Browserdaten.
 * Beides nebeneinander zu haben, ist kein Widerspruch.
 */

/**
 * Zeichen, die im Passwort vorkommen, aber auf keiner Tastatur liegen.
 *
 * Das Spiel zeigt sie als Herz, Dreieck, Raute und Kreuz. Ohne Schaltflächen
 * dafür müsste man sie umschreiben — und käme beim Eintippen ins Spiel
 * durcheinander, was bei einem Passwort fatal ist.
 */
export const SONDERZEICHEN = ['♥', '△', '◆', '✚'] as const;

export async function listPasswords(romId: string): Promise<StoredPassword[]> {
  const db = await getDb();
  const alle = await db.getAllFromIndex('passwoerter', 'byRom', romId);
  return alle.sort((a, b) => b.createdAt - a.createdAt);
}

export async function addPassword(
  romId: string,
  label: string,
  code: string,
): Promise<StoredPassword> {
  const eintrag: StoredPassword = {
    // Zeitstempel plus Zufall: zwei Einträge in derselben Millisekunde
    // sollen sich nicht gegenseitig überschreiben.
    id: `${romId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    romId,
    label: label.trim() || 'Ohne Bezeichnung',
    code: code.trim(),
    createdAt: Date.now(),
  };

  const db = await getDb();
  await db.put('passwoerter', eintrag);
  return eintrag;
}

export async function deletePassword(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('passwoerter', id);
}
