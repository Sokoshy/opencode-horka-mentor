import { homedir } from "node:os";

/**
 * Expanse `~` et `~/...` vers le home de l'utilisateur (os.homedir()).
 * Les chemins absolus, relatifs et vides sont retournés inchangés.
 */
export function expandPath(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return `${homedir()}/${p.slice(2)}`;
  return p;
}

/**
 * Extrait la valeur d'un champ de statut markdown `- **Field**: value`.
 * Nom de champ sensible à la casse (match exact avant `**` — pas de préfixe partiel).
 * Retourne la valeur trimée, ou undefined si le champ est absent.
 */
export function parseStatusField(content: string, field: string): string | undefined {
  const re = new RegExp(`^-\\s*\\*\\*${field}\\*\\*:\\s*(.+)$`, "m");
  const match = re.exec(content);
  return match ? match[1].trim() : undefined;
}
