// Dev auto-discovery — re-export du plugin source (évite la duplication).
// Opencode charge automatiquement ce fichier ; il délègue à src/index.ts
// qui résout ses propres chemins (skills/references) via import.meta.url.
export { default } from "../../src/index.ts"
