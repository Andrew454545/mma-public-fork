/**
 * Generate multi-granularity country border GeoJSON files from Natural Earth data.
 *
 * Downloads Natural Earth 10m admin-0 map subunits shapefile, then produces
 * two simplified versions (medium and heavy) that match the schema of the
 * existing app/public/borders.json (the "light" version).
 *
 * Usage: node generate.mjs
 * Requires: mapshaper (npx), Node 18+
 *
 * Output:
 *   borders-medium.json  (~2-5 MB)
 *   borders-heavy.json   (~8-15 MB)
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, "_tmp");
const NE_URL = "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_map_subunits.zip";
const ZIP_PATH = join(TMP, "ne_10m_admin_0_map_subunits.zip");
const SHP_DIR = join(TMP, "shp");

// Read the existing light borders to extract the exact feature list
const lightPath = join(__dirname, "../../app/public/borders.json");
const light = JSON.parse(readFileSync(lightPath, "utf8"));
const targets = light.features.map(f => ({
  code: f.properties.code,
  name: f.properties.name,
  country: f.properties.country,
}));
console.log(`Reference: ${targets.length} features from existing borders.json`);

// --- Step 1: Download ---
if (!existsSync(TMP)) mkdirSync(TMP, { recursive: true });
if (!existsSync(SHP_DIR)) mkdirSync(SHP_DIR, { recursive: true });

if (!existsSync(ZIP_PATH)) {
  console.log("Downloading Natural Earth 10m map subunits...");
  execSync(`curl -kL -o "${ZIP_PATH}" "${NE_URL}"`, { stdio: "inherit" });
} else {
  console.log("Using cached Natural Earth download");
}

// --- Step 2: Extract ---
const shpFile = join(SHP_DIR, "ne_10m_admin_0_map_subunits.shp");
if (!existsSync(shpFile)) {
  console.log("Extracting shapefile...");
  execSync(`powershell -Command "Expand-Archive -Path '${ZIP_PATH}' -DestinationPath '${SHP_DIR}' -Force"`, { stdio: "inherit" });
}

// --- Step 3: Convert to GeoJSON (full resolution) ---
const fullGeojson = join(TMP, "full.json");
if (!existsSync(fullGeojson)) {
  console.log("Converting to GeoJSON...");
  execSync(`npx mapshaper "${shpFile}" -o "${fullGeojson}" format=geojson`, { stdio: "inherit" });
}

const full = JSON.parse(readFileSync(fullGeojson, "utf8"));
console.log(`Natural Earth features: ${full.features.length}`);

// --- Step 4: Build a mapping from our target features to NE features ---
// Strategy: for each target, find all NE features that should merge into it.
// Our borders.json groups NE subunits by ISO code + a name that may cover
// multiple NE subunits (e.g., "Belgium" covers Flemish/Walloon/Brussels,
// "Japan" is separate from "Okinawa" which maps to "Nansei-shoto").

// Explicit mappings for features whose names differ between our borders.json
// and Natural Earth's SUBUNIT/NAME fields.
// Format: "ourCode:ourName" -> ["NE SUBUNIT name", ...] (case-insensitive)
const EXPLICIT_MAP = {
  "GG:Alderney": ["alderney"],
  "GG:Guernsey": ["guernsey", "sark", "herm"],
  "IN:Andaman and Nicobar Islands": ["andaman", "nicobar"],
  "NL:Bonaire": ["bonaire"],
  "CL:Easter Island": ["easter island", "easter i."],
  "RU:European Russia": ["european russia"],
  "EC:Galápagos Islands": ["galapagos", "galápagos"],
  "JP:Okinawa": ["nanseishoto", "nansei-shoto"],
  "JP:Ogasawara Islands": ["bonin islands", "bonin is.", "volcano islands", "volcano is.", "izushoto", "izu-shoto"],
  "ID:Java": ["java"],
  "JE:Jersey": ["jersey"],
  "ID:Kalimantan": ["kalimantan"],
  "FR:Kerguelen Islands": ["kerguelen"],
  "ID:Lesser Sunda Islands": ["lesser sunda islands", "bali", "nusa tenggara"],
  "MY:Malaysian Borneo": ["sabah", "sarawak"],
  "ID:Maluku Islands": ["maluku islands", "maluku"],
  "US:Midway Atoll": ["midway"],
  "NZ:New Zealand Subantarctic Islands": ["subantarctic"],
  "NL:Saba": ["saba"],
  "IT:Sardinia": ["sardinia", "sardegna"],
  "NL:Sint Eustatius": ["sint eustatius", "st. eustatius"],
  "SX:Sint Maarten": ["sint maarten"],
  "ID:Sulawesi": ["sulawesi"],
  "ID:Sumatra": ["sumatra"],
  "AU:Tasmania": ["tasmania"],
  "TK:Tokelau": ["tokelau"],
  "TV:Tuvalu": ["tuvalu"],
  "VI:US Virgin Islands": ["u.s. virgin islands", "us virgin islands", "u.s. virgin is."],
  "VA:Vatican City": ["vatican"],
  "US:Wake Island": ["wake atoll", "wake island", "wake is."],
  "ID:Western New Guinea": ["western new guinea", "papua"],
};

function normalName(s) {
  return s.toLowerCase()
    .replace(/['']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function buildMapping(neFeatures) {
  // For each target, collect matching NE feature indices
  const mapping = targets.map(() => []);
  const claimed = new Set();

  // Pass 0: explicit mappings for known mismatches
  for (let ti = 0; ti < targets.length; ti++) {
    const t = targets[ti];
    const key = `${t.code}:${t.name}`;
    const explicit = EXPLICIT_MAP[key];
    if (!explicit) continue;
    for (let ni = 0; ni < neFeatures.length; ni++) {
      if (claimed.has(ni)) continue;
      const p = neFeatures[ni].properties;
      const names = [p.NAME, p.SUBUNIT, p.NAME_LONG, p.GEOUNIT, p.BRK_NAME].map(n => normalName(n || ""));
      if (explicit.some(e => names.some(n => n.includes(e) || e.includes(n)))) {
        mapping[ti].push(ni);
        claimed.add(ni);
      }
    }
  }

  // Pass 1: exact name match on NAME or SUBUNIT
  for (let ti = 0; ti < targets.length; ti++) {
    const t = targets[ti];
    const tName = normalName(t.name);
    for (let ni = 0; ni < neFeatures.length; ni++) {
      if (claimed.has(ni)) continue;
      const p = neFeatures[ni].properties;
      const iso = p.ISO_A2_EH || p.ISO_A2 || "";
      if (iso !== t.code && iso !== "-99") continue;
      const names = [p.NAME, p.SUBUNIT, p.NAME_LONG, p.GEOUNIT, p.BRK_NAME].map(n => normalName(n || ""));
      if (names.includes(tName)) {
        mapping[ti].push(ni);
        claimed.add(ni);
      }
    }
  }

  // Pass 2a: partial match for sub-targets (have a `country` prop) first
  for (let ti = 0; ti < targets.length; ti++) {
    if (mapping[ti].length > 0) continue;
    const t = targets[ti];
    if (!t.country) continue;
    const tName = normalName(t.name);

    for (let ni = 0; ni < neFeatures.length; ni++) {
      if (claimed.has(ni)) continue;
      const p = neFeatures[ni].properties;
      const iso = p.ISO_A2_EH || p.ISO_A2 || "";
      if (iso !== t.code) continue;
      const subunit = normalName(p.SUBUNIT || "");
      const name = normalName(p.NAME || "");
      if (subunit.includes(tName) || tName.includes(subunit) || name.includes(tName) || tName.includes(name)) {
        mapping[ti].push(ni);
        claimed.add(ni);
      }
    }
  }

  // Pass 2b: main countries (no `country` prop) grab all remaining unclaimed NE features with matching ISO
  for (let ti = 0; ti < targets.length; ti++) {
    if (mapping[ti].length > 0) continue;
    const t = targets[ti];
    if (t.country) continue;

    for (let ni = 0; ni < neFeatures.length; ni++) {
      if (claimed.has(ni)) continue;
      const p = neFeatures[ni].properties;
      const iso = p.ISO_A2_EH || p.ISO_A2 || "";
      if (iso !== t.code) continue;
      mapping[ti].push(ni);
      claimed.add(ni);
    }
  }

  // Pass 3: for -99 codes (N. Cyprus, Somaliland, etc.), try by name
  for (let ti = 0; ti < targets.length; ti++) {
    if (mapping[ti].length > 0) continue;
    const t = targets[ti];
    const tName = normalName(t.name);

    for (let ni = 0; ni < neFeatures.length; ni++) {
      if (claimed.has(ni)) continue;
      const p = neFeatures[ni].properties;
      const names = [p.NAME, p.SUBUNIT, p.NAME_LONG, p.BRK_NAME].map(n => normalName(n || ""));
      if (names.some(n => n === tName || n.includes(tName) || tName.includes(n))) {
        mapping[ti].push(ni);
        claimed.add(ni);
      }
    }
  }

  return mapping;
}

function mergeGeometries(features) {
  if (features.length === 0) return null;
  // Collect all polygon rings into a single MultiPolygon
  const allPolygons = [];
  for (const f of features) {
    if (!f.geometry) continue;
    if (f.geometry.type === "Polygon") {
      allPolygons.push(f.geometry.coordinates);
    } else if (f.geometry.type === "MultiPolygon") {
      allPolygons.push(...f.geometry.coordinates);
    }
  }
  if (allPolygons.length === 0) return null;
  if (allPolygons.length === 1) {
    return { type: "Polygon", coordinates: allPolygons[0] };
  }
  return { type: "MultiPolygon", coordinates: allPolygons };
}

function countVertices(geojson) {
  let count = 0;
  for (const f of geojson.features) {
    if (!f.geometry) continue;
    const polys = f.geometry.type === "Polygon"
      ? [f.geometry.coordinates]
      : f.geometry.coordinates;
    for (const poly of polys) {
      for (const ring of poly) count += ring.length;
    }
  }
  return count;
}

// Build a lookup from the light borders for fallback
const lightLookup = new Map();
for (const f of light.features) {
  lightLookup.set(`${f.properties.code}:${f.properties.name}`, f);
}

function generateVersion(simplifyPct, precision, outputName) {
  console.log(`\nGenerating ${outputName} (simplify ${simplifyPct}%, precision ${precision})...`);

  const simplified = join(TMP, `simplified_${outputName}`);
  execSync(
    `npx mapshaper "${fullGeojson}" -simplify ${simplifyPct}% dp -o "${simplified}" format=geojson precision=${precision}`,
    { stdio: "inherit" }
  );

  const data = JSON.parse(readFileSync(simplified, "utf8"));
  const mapping = buildMapping(data.features);

  const outputFeatures = [];
  const missing = [];
  let fallbackCount = 0;

  for (let ti = 0; ti < targets.length; ti++) {
    const t = targets[ti];
    const neIndices = mapping[ti];

    const props = { code: t.code, name: t.name };
    if (t.country) props.country = t.country;

    if (neIndices.length === 0) {
      // Fall back to light version geometry
      const fallback = lightLookup.get(`${t.code}:${t.name}`);
      if (fallback) {
        outputFeatures.push({ type: "Feature", properties: props, geometry: fallback.geometry });
        fallbackCount++;
      } else {
        missing.push(t);
      }
      continue;
    }

    const neFeats = neIndices.map(i => data.features[i]);
    const geometry = mergeGeometries(neFeats);
    if (!geometry) {
      const fallback = lightLookup.get(`${t.code}:${t.name}`);
      if (fallback) {
        outputFeatures.push({ type: "Feature", properties: props, geometry: fallback.geometry });
        fallbackCount++;
      } else {
        missing.push(t);
      }
      continue;
    }

    outputFeatures.push({ type: "Feature", properties: props, geometry });
  }

  if (fallbackCount > 0) {
    console.log(`  ${fallbackCount} features used light-version fallback (NE doesn't split these subunits)`);
  }
  if (missing.length > 0) {
    console.log(`  WARNING: ${missing.length} features truly missing:`);
    for (const m of missing) console.log(`    ${m.code} - ${m.name}`);
  }

  const output = { type: "FeatureCollection", features: outputFeatures };
  const vertices = countVertices(output);

  const outPath = join(__dirname, outputName);
  writeFileSync(outPath, JSON.stringify(output));
  const size = readFileSync(outPath).length;
  console.log(`  ${outputFeatures.length}/${targets.length} features, ${vertices.toLocaleString()} vertices, ${(size / 1024 / 1024).toFixed(1)} MB`);
}

// Medium: ~30% of 10m detail, 4 decimal places
generateVersion(30, 0.0001, "borders-medium.json");

// Heavy: ~80% of 10m detail, 5 decimal places
generateVersion(80, 0.00001, "borders-heavy.json");

// Cleanup (skip if --keep-tmp)
if (!process.argv.includes("--keep-tmp")) {
  console.log("\nCleaning up temp files...");
  rmSync(TMP, { recursive: true, force: true });
}

console.log("\nDone!");
