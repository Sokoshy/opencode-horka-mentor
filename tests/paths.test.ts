import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { expandPath, parseStatusField } from "../src/lib/paths.ts";

// ---------------------------------------------------------------- expandPath

test("expandPath: `~` seul → homedir", () => {
  assert.equal(expandPath("~"), homedir());
});

test("expandPath: `~/foo/bar` → homedir + suffixe", () => {
  assert.equal(expandPath("~/foo/bar"), `${homedir()}/foo/bar`);
});

test("expandPath: chemin absolu inchangé", () => {
  assert.equal(expandPath("/var/lib/mentor"), "/var/lib/mentor");
});

test("expandPath: chemin relatif inchangé", () => {
  assert.equal(expandPath("./.opencode/memory"), "./.opencode/memory");
});

test("expandPath: entrées vides/vagues inchangées", () => {
  assert.equal(expandPath(""), "");
  // `~embed` ne commence pas par `~/` → pas d'expansion (comportement standard)
  assert.equal(expandPath("~foo"), "~foo");
});

// ------------------------------------------------------------ parseStatusField

test("parseStatusField: champ trouvé → valeur trimée", () => {
  const content = "- **Level**: learning\n- **Mode**: build\n";
  assert.equal(parseStatusField(content, "Level"), "learning");
  assert.equal(parseStatusField(content, "Mode"), "build");
});

test("parseStatusField: champ absent → undefined", () => {
  const content = "- **Level**: learning\n";
  assert.equal(parseStatusField(content, "Interval"), undefined);
  assert.equal(parseStatusField(content, "Mode"), undefined);
});

test("parseStatusField: whitespace supplémentaire trimé", () => {
  const content = "-   **Level**:    learning   \n";
  assert.equal(parseStatusField(content, "Level"), "learning");
});

test("parseStatusField: contenu multiline — ligne correspondante isolée", () => {
  const content = [
    "# Profil",
    "",
    "- **Name**: Alice",
    "",
    "## Topics",
    "- **Async**: learning",
  ].join("\n");
  assert.equal(parseStatusField(content, "Name"), "Alice");
  assert.equal(parseStatusField(content, "Async"), "learning");
});

test("parseStatusField: pas de match sur préfixe partiel du nom de champ", () => {
  // Comportement RÉEL du regex : `Level` exige `**` immédiatement après,
  // donc `**LevelUp**` ne matche PAS le champ "Level" — assert le comportement réel.
  const content = "- **LevelUp**: almost\n- **Level**: beginner\n";
  assert.equal(parseStatusField(content, "Level"), "beginner");
  // À l'inverse, le champ "LevelUp" matche sa propre ligne.
  assert.equal(parseStatusField(content, "LevelUp"), "almost");
});

test("parseStatusField: ligne sans puce `-` ne matche pas", () => {
  const content = "**Level**: learning\n";
  assert.equal(parseStatusField(content, "Level"), undefined);
});
