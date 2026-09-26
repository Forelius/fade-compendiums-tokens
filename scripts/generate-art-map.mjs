/**
 * Generate Foundry CompendiumArt mapping for fade-compendiums-tokens → fade-compendiums.
 *
 * Usage (from fade-compendiums-tokens):
 *   node scripts/generate-art-map.mjs
 *
 * Auto-accepts: exact, structural reorder, aliases.json, overrides.json
 * Fuzzy candidates are skipped (not written) unless --reports is passed.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ASSETS = path.join(ROOT, "assets");
const FADE_ACTORS = path.resolve(
  ROOT,
  "../fade-compendiums/packsrc/actors/Monsters_Beasts"
);
const MODULE_ID = "fade-compendiums-tokens";
const PACK_ID = "fade-compendiums.actor-compendium";
const SKIP_FOLDERS = new Set([
  "Packs",
  "Scripts",
  "packs",
  "scripts",
  "reports",
  "assets",
]);
const WRITE_REPORTS = process.argv.includes("--reports");

const STOP = new Set([
  "a",
  "an",
  "of",
  "the",
  "and",
  "or",
  "giant",
  "normal",
  "large",
  "small",
  "huge",
  "medium",
]);

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function writeCsv(file, rows, headers) {
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const row of rows) lines.push(headers.map((h) => esc(row[h])).join(","));
  fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
}

function normalize(name) {
  return String(name ?? "")
    .replace(/\*/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[,_'/’\-]/g, " ")
    .replace(/\b\d+\s*hd\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function significantTokens(name) {
  return normalize(name)
    .split(" ")
    .filter((t) => t && !STOP.has(t) && !/^\d+$/.test(t));
}

function listTokenFolders() {
  const namesFile = path.join(ROOT, "names.txt");
  let names = [];
  if (fs.existsSync(namesFile)) {
    names = fs
      .readFileSync(namesFile, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  } else {
    names = fs
      .readdirSync(ASSETS, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name);
  }
  return names.filter((n) => !SKIP_FOLDERS.has(n));
}

function walkActors(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkActors(full, out);
    else if (ent.name.endsWith(".json")) {
      const doc = JSON.parse(fs.readFileSync(full, "utf8"));
      if (doc.type === "monster" && doc._id && doc.name) {
        out.push({
          id: doc._id,
          name: doc.name,
          file: path.relative(FADE_ACTORS, full),
        });
      }
    }
  }
  return out;
}

/** Structural candidates derived from BX-style "Creature, Adjective" names. */
function structuralCandidates(fadeName) {
  const cands = new Set();
  const stripped = fadeName.replace(/\*/g, "").trim();
  cands.add(stripped);
  cands.add(stripped.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim());

  for (const prefix of ["Lycanthrope", "Haunt", "Spirit", "Phantom"]) {
    const m = stripped.match(new RegExp(`^${prefix}[,\\s]+(.+)$`, "i"));
    if (m) {
      const rest = m[1].replace(/\([^)]*\)/g, "").replace(/\*/g, "").trim();
      cands.add(rest);
      const base = rest.replace(/\s+(Leader|Chieftain|Chief)$/i, "").trim();
      if (base) cands.add(base);
    }
  }

  const comma = stripped.match(/^([^,(]+),\s*(.+)$/);
  if (comma) {
    const type = comma[1].trim();
    let mod = comma[2].replace(/\([^)]*\)/g, "").replace(/\*/g, "").trim();
    cands.add(type);
    cands.add(`${mod} ${type}`);
    const firstWord = mod.split(/\s+/)[0];
    if (firstWord && firstWord.toLowerCase() === "giant") {
      cands.add(`Giant ${type}`);
    }
    if (/^(normal|large|small|huge|greater|lesser)$/i.test(mod)) {
      cands.add(type);
    }
  }

  const beforeParen = stripped.split("(")[0].replace(/[*]/g, "").trim();
  if (beforeParen) {
    cands.add(beforeParen);
    const roleStripped = beforeParen
      .replace(
        /\s+(Chief|Chieftain|Leader|King|Boss|Bodyguard|Bow|Warrior|Shaman)$/i,
        ""
      )
      .trim();
    if (roleStripped) cands.add(roleStripped);
  }

  return [...cands].filter(Boolean);
}

function tokenOverlapScore(fadeName, tokenName) {
  const a = new Set(significantTokens(fadeName));
  const b = new Set(significantTokens(tokenName));
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = new Set([...a, ...b]).size;
  return inter / union;
}

function assetsPath(folder) {
  return path.join(ASSETS, folder);
}

function firstImageInFolder(folder) {
  const dir = assetsPath(folder);
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => /\.(webp|png|jpg|jpeg|webm)$/i.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return files[0] ?? null;
}

/** Longest common filename prefix among images, for Foundry wildcards. */
function tokenWildcardStem(folder) {
  const dir = assetsPath(folder);
  if (!fs.existsSync(dir)) return path.basename(folder);
  const stems = fs
    .readdirSync(dir)
    .filter((f) => /\.(webp|png|jpg|jpeg|webm)$/i.test(f))
    .map((f) => f.replace(/\s*\(\d+\)\.[^.]+$/i, "").replace(/\.[^.]+$/i, ""));
  if (!stems.length) return path.basename(folder);
  let prefix = stems[0];
  for (let i = 1; i < stems.length; i++) {
    while (prefix && !stems[i].startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
    }
  }
  if (prefix.length < 3) return path.basename(folder).replace(/\s+/g, "");
  return prefix;
}

function artEntry(folder) {
  const portraitFile = firstImageInFolder(folder);
  const actor = portraitFile
    ? `modules/${MODULE_ID}/assets/${folder}/${portraitFile}`
    : undefined;
  const stem = tokenWildcardStem(folder);
  const tokenSrc = `modules/${MODULE_ID}/assets/${folder}/${stem}*`;
  const entry = {
    token: {
      randomImg: true,
      texture: { src: tokenSrc },
    },
  };
  if (actor) entry.actor = actor;
  return entry;
}

function resolveFolder(target, folders, byNorm) {
  if (!target) return null;
  if (folders.includes(target)) return target;
  return byNorm.get(normalize(target)) || null;
}

function main() {
  const aliases = readJson(path.join(ROOT, "aliases.json"), {});
  const overrides = readJson(path.join(ROOT, "overrides.json"), {});
  const folders = listTokenFolders();
  const byNorm = new Map();
  for (const f of folders) {
    const n = normalize(f);
    if (!byNorm.has(n)) byNorm.set(n, f);
    // Also index basename for nested paths
    const base = path.basename(f);
    const bn = normalize(base);
    if (!byNorm.has(bn)) byNorm.set(bn, f);
  }

  const actors = walkActors(FADE_ACTORS);
  const mapping = { [PACK_ID]: {} };
  const matched = [];
  const review = [];
  const unmatched = [];

  for (const actor of actors) {
    const overrideKey =
      overrides[actor.id] || overrides[actor.name] || overrides[normalize(actor.name)];
    if (overrideKey) {
      const resolved = resolveFolder(overrideKey, folders, byNorm);
      if (!resolved) {
        unmatched.push({
          id: actor.id,
          name: actor.name,
          reason: `override folder missing: ${overrideKey}`,
        });
        continue;
      }
      mapping[PACK_ID][actor.id] = artEntry(resolved);
      matched.push({
        id: actor.id,
        name: actor.name,
        folder: resolved,
        method: "override",
      });
      continue;
    }

    const aliasTarget = aliases[actor.name] || aliases[normalize(actor.name)];
    if (aliasTarget) {
      const resolved = resolveFolder(aliasTarget, folders, byNorm);
      if (resolved) {
        mapping[PACK_ID][actor.id] = artEntry(resolved);
        matched.push({
          id: actor.id,
          name: actor.name,
          folder: resolved,
          method: "alias",
        });
        continue;
      }
    }

    const exact = byNorm.get(normalize(actor.name));
    if (exact) {
      mapping[PACK_ID][actor.id] = artEntry(exact);
      matched.push({ id: actor.id, name: actor.name, folder: exact, method: "exact" });
      continue;
    }

    let structuralHit = null;
    for (const cand of structuralCandidates(actor.name)) {
      const hit = byNorm.get(normalize(cand));
      if (hit) {
        structuralHit = hit;
        break;
      }
    }
    if (structuralHit) {
      mapping[PACK_ID][actor.id] = artEntry(structuralHit);
      matched.push({
        id: actor.id,
        name: actor.name,
        folder: structuralHit,
        method: "structural",
      });
      continue;
    }

    const scored = folders
      .map((f) => ({ folder: f, score: tokenOverlapScore(actor.name, f) }))
      .filter((x) => x.score >= 0.45)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    if (scored.length) {
      review.push({
        id: actor.id,
        name: actor.name,
        suggestion1: scored[0]?.folder ?? "",
        score1: scored[0] ? scored[0].score.toFixed(2) : "",
        suggestion2: scored[1]?.folder ?? "",
        score2: scored[1] ? scored[1].score.toFixed(2) : "",
        suggestion3: scored[2]?.folder ?? "",
        score3: scored[2] ? scored[2].score.toFixed(2) : "",
      });
    } else {
      unmatched.push({ id: actor.id, name: actor.name, reason: "no candidate" });
    }
  }

  writeJson(path.join(ROOT, "map-fantastic-depths.json"), mapping);

  if (WRITE_REPORTS) {
    const reportsDir = path.join(ROOT, "reports");
    fs.mkdirSync(reportsDir, { recursive: true });
    writeCsv(path.join(reportsDir, "matched.csv"), matched, [
      "id",
      "name",
      "folder",
      "method",
    ]);
    writeCsv(path.join(reportsDir, "review.csv"), review, [
      "id",
      "name",
      "suggestion1",
      "score1",
      "suggestion2",
      "score2",
      "suggestion3",
      "score3",
    ]);
    writeCsv(path.join(reportsDir, "unmatched.csv"), unmatched, [
      "id",
      "name",
      "reason",
    ]);
  }

  const mappedCount = Object.keys(mapping[PACK_ID]).length;
  console.log(`Actors scanned: ${actors.length}`);
  console.log(`Token folders: ${folders.length}`);
  console.log(`Mapped: ${mappedCount}`);
  console.log(`Review candidates: ${review.length}`);
  console.log(`Unmatched: ${unmatched.length}`);
  console.log(
    WRITE_REPORTS
      ? "Wrote map-fantastic-depths.json and reports/*.csv"
      : "Wrote map-fantastic-depths.json"
  );
  if (unmatched.length) {
    for (const u of unmatched) console.log(`  unmatched: ${u.name} (${u.reason})`);
  }
  if (review.length && !WRITE_REPORTS) {
    for (const r of review) console.log(`  review: ${r.name} -> ${r.suggestion1}`);
  }
}

main();
