/**
 * One-time build step: turns open geographic data into data/gujarat-locations.db.
 * Run on a PC (npm run build:data), then commit the .db file. The server never downloads this data.
 *
 * Inputs, placed in data/raw/ (see README for the download links):
 *   gj.geojson       DataMeet "Indian Village Boundaries", Gujarat (Census 2001 villages and towns). ODbL.
 *   IN.txt           GeoNames dump for India. CC BY 4.0.
 *   osm-places.json  OpenStreetMap place points for Gujarat, from Overpass. ODbL.
 *
 * Every coordinate in the database comes from one of those files. Nothing is invented.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { looseKey, normalizeText } from '../src/utils/normalizeLocation';

const RAW = path.join(__dirname, '..', 'data', 'raw');
const OUT = path.join(__dirname, '..', 'data', 'gujarat-locations.db');

type Ring = [number, number][];
interface Place {
  name: string;
  district: string;
  taluka: string;
  type: 'city' | 'town' | 'village' | 'locality';
  lat: number;
  lon: number;
  population: number;
  aliases: Set<string>;
  source: string;
  coordSource: 'boundary' | 'geonames' | 'osm';
  rings: Ring[];
  bbox: [number, number, number, number];
  area: number;
}

// Census 2001 spellings -> the spelling people use today. The old one stays searchable.
const DISTRICT_NAMES: Record<string, string> = {
  'Banas Kantha': 'Banaskantha',
  'Sabar Kantha': 'Sabarkantha',
  Mahesana: 'Mehsana',
  Kachchh: 'Kutch',
  Ahmadabad: 'Ahmedabad',
  'Panch Mahals': 'Panchmahal',
  Dohad: 'Dahod',
  'The Dangs': 'Dang',
};

const LATIN = /^[A-Za-z0-9 .'()&/-]+$/;
const stripAccents = (value: string) => value.normalize('NFKD').replace(/[̀-ͯ]/g, '');

function ringStats(ring: Ring) {
  let area = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    area += cross;
    cx += (ring[j][0] + ring[i][0]) * cross;
    cy += (ring[j][1] + ring[i][1]) * cross;
  }
  area /= 2;
  if (Math.abs(area) < 1e-12) return { area: 0, lon: ring[0][0], lat: ring[0][1] };
  return { area: Math.abs(area), lon: cx / (6 * area), lat: cy / (6 * area) };
}

function inRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const contains = (place: Place, lon: number, lat: number) =>
  lon >= place.bbox[0] && lon <= place.bbox[2] && lat >= place.bbox[1] && lat <= place.bbox[3] &&
  place.rings.some((ring) => inRing(lon, lat, ring));

function km(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dy = (lat2 - lat1) * 111.2;
  const dx = (lon2 - lon1) * 111.2 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  return Math.hypot(dx, dy);
}

/** "Chandlodiya (M+OG) (Part)" -> "Chandlodiya"; "Pirojpura(Tankani)" -> "Pirojpura (Tankani)". */
function cleanCensusName(raw: string): string {
  let name = raw
    .replace(/\((?:M\b[^)]*|Part|OG|CT|INA|NA|CB)\)/gi, ' ')
    .replace(/\s+INA$/i, '')
    .replace(/\s*\(\s*/g, ' (')
    .replace(/\s+/g, ' ')
    .trim();
  if (name.includes('(') && !name.includes(')')) name += ')';
  return name;
}

function keysOf(names: Iterable<string>): Set<string> {
  const keys = new Set<string>();
  for (const name of names) {
    const key = looseKey(normalizeText(name));
    if (key.length >= 3) keys.add(key);
  }
  return keys;
}

// ---------------------------------------------------------------- 1. villages and towns (boundaries)
const places: Place[] = [];
const byKey = new Map<string, Place>();
const geo = JSON.parse(fs.readFileSync(path.join(RAW, 'gj.geojson'), 'utf8'));
for (const feature of geo.features) {
  const props = feature.properties;
  if (!props.NAME || props.STATE !== 'Gujarat' || /Dadra/.test(props.DISTRICT)) continue;
  const name = cleanCensusName(props.NAME);
  if (!name) continue;
  const ring: Ring = feature.geometry.coordinates[0];
  const stats = ringStats(ring);
  const lons = ring.map((p) => p[0]), lats = ring.map((p) => p[1]);
  const bbox: Place['bbox'] = [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
  const district = DISTRICT_NAMES[props.DISTRICT] ?? props.DISTRICT;
  const key = `${normalizeText(name)}|${props.SUB_DISTRICT}|${district}`;

  const existing = byKey.get(key);
  if (existing) {
    // The census splits some towns into parts ("Kalol" and "Kalol INA"): one place, several outlines.
    existing.rings.push(ring);
    existing.bbox = [Math.min(existing.bbox[0], bbox[0]), Math.min(existing.bbox[1], bbox[1]), Math.max(existing.bbox[2], bbox[2]), Math.max(existing.bbox[3], bbox[3])];
    if (props.TYPE === 'Town') existing.type = 'town';
    if (stats.area > existing.area) Object.assign(existing, { lat: stats.lat, lon: stats.lon, area: stats.area });
    continue;
  }
  const aliases = new Set<string>();
  if (props.NAME !== name) aliases.add(stripAccents(props.NAME));
  const bracket = /^(.+?) \((.+)\)$/.exec(name);
  if (bracket) {
    aliases.add(bracket[1]);
    aliases.add(`${bracket[1]} ${bracket[2]}`);
  }
  const place: Place = {
    name, district, taluka: props.SUB_DISTRICT, type: props.TYPE === 'Town' ? 'town' : 'village',
    lat: stats.lat, lon: stats.lon, population: 0, aliases, source: 'datameet', coordSource: 'boundary',
    rings: [ring], bbox, area: stats.area,
  };
  // The centre of an outline can fall outside a crescent-shaped village; then use a corner of it rather than a point elsewhere.
  if (!inRing(place.lon, place.lat, ring)) Object.assign(place, { lon: ring[0][0], lat: ring[0][1] });
  byKey.set(key, place);
  places.push(place);
}
const boundaryPlaces = places.slice();
console.log('boundary places:', boundaryPlaces.length);

// ---------------------------------------------------------------- 2. settlement points (GeoNames, OSM)
interface Point { name: string; alternates: string[]; lat: number; lon: number; population: number; type: Place['type']; source: 'geonames' | 'osm' }
const points: Point[] = [];

for (const line of fs.readFileSync(path.join(RAW, 'IN.txt'), 'utf8').split('\n')) {
  const c = line.split('\t');
  if (c[10] !== '09' || c[6] !== 'P' || ['PPLH', 'PPLQ', 'PPLW'].includes(c[7])) continue;
  const population = Number(c[14]) || 0;
  points.push({
    name: c[2] || stripAccents(c[1]),
    alternates: [c[1], ...c[3].split(',')].map(stripAccents).filter((n) => n && LATIN.test(n)),
    lat: Number(c[4]), lon: Number(c[5]), population,
    type: c[7] === 'PPLX' ? 'locality' : population >= 100000 ? 'city' : population >= 10000 ? 'town' : 'village',
    source: 'geonames',
  });
}
const geonamesCount = points.length;

for (const el of JSON.parse(fs.readFileSync(path.join(RAW, 'osm-places.json'), 'utf8')).elements) {
  const tags = el.tags ?? {};
  const candidates = [tags['name:en'], tags.name, tags.int_name, tags.alt_name, tags.official_name]
    .flatMap((value: string | undefined) => (value ? value.split(';') : []))
    .map((value: string) => stripAccents(value.trim()))
    .filter((value: string) => value && LATIN.test(value));
  if (candidates.length === 0) continue;
  points.push({
    name: candidates[0], alternates: candidates.slice(1), lat: el.lat, lon: el.lon,
    population: Number(tags.population) || 0,
    type: tags.place === 'city' ? 'city' : tags.place === 'town' ? 'town' : 'village',
    source: 'osm',
  });
}
console.log('points: geonames', geonamesCount, 'osm', points.length - geonamesCount);

// ---------------------------------------------------------------- 3. merge points into places
const keyIndex = new Map<string, Place[]>();
const indexPlace = (place: Place) => {
  for (const key of keysOf([place.name, ...place.aliases])) {
    const list = keyIndex.get(key) ?? [];
    if (!list.includes(place)) list.push(place);
    keyIndex.set(key, list);
  }
};
places.forEach(indexPlace);

let merged = 0, added = 0;
for (const point of points) {
  const keys = keysOf([point.name, ...point.alternates]);
  // Same name (in any spelling) and close by = the same place, already in the database.
  let match: Place | undefined, best = Infinity;
  for (const key of keys) {
    for (const place of keyIndex.get(key) ?? []) {
      const inside = contains(place, point.lon, point.lat);
      const distance = inside ? 0 : km(point.lat, point.lon, place.lat, place.lon);
      if (distance < best && (inside || distance <= 6)) { best = distance; match = place; }
    }
  }
  if (match) {
    merged++;
    for (const name of [point.name, ...point.alternates]) if (name !== match.name) match.aliases.add(name);
    match.population = Math.max(match.population, point.population);
    if (point.type === 'city' || (point.type === 'town' && match.type === 'village')) match.type = point.type;
    // A mapped settlement point says where the village itself is; the outline's centre may be in a field.
    const better = match.coordSource === 'boundary' || (match.coordSource === 'geonames' && point.source === 'osm');
    if (better) Object.assign(match, { lat: point.lat, lon: point.lon, coordSource: point.source });
    indexPlace(match);
    continue;
  }

  // A place the census outlines do not name: keep it, and take district/taluka from the outline it sits in.
  let home = boundaryPlaces.find((place) => contains(place, point.lon, point.lat));
  if (!home) {
    let nearest = 15;
    for (const place of boundaryPlaces) {
      const distance = km(point.lat, point.lon, place.lat, place.lon);
      if (distance < nearest) { nearest = distance; home = place; }
    }
  }
  if (!home) continue; // outside Gujarat's outlines altogether: district unknown, leave it to the fallback
  const place: Place = {
    name: point.name, district: home.district, taluka: home.taluka, type: point.type,
    lat: point.lat, lon: point.lon, population: point.population,
    aliases: new Set(point.alternates.filter((n) => n !== point.name)),
    source: point.source, coordSource: point.source, rings: [], bbox: [0, 0, 0, 0], area: 0,
  };
  places.push(place);
  indexPlace(place);
  added++;
}
console.log('points merged into existing places:', merged, 'added as new places:', added);

// ---------------------------------------------------------------- 4. write SQLite
fs.rmSync(OUT, { force: true });
const db = new DatabaseSync(OUT);
db.exec(`
  CREATE TABLE locations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    normalizedName TEXT NOT NULL,
    district TEXT NOT NULL,
    taluka TEXT NOT NULL,
    state TEXT NOT NULL,
    country TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    type TEXT NOT NULL,
    population INTEGER NOT NULL,
    aliases TEXT NOT NULL,
    normalizedDistrict TEXT NOT NULL,
    normalizedTaluka TEXT NOT NULL,
    source TEXT NOT NULL
  );
  CREATE TABLE location_names (
    locationId INTEGER NOT NULL REFERENCES locations(id),
    normalized TEXT NOT NULL,
    loose TEXT NOT NULL,
    isPrimary INTEGER NOT NULL
  );
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);
const insertPlace = db.prepare(`INSERT INTO locations VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const insertName = db.prepare(`INSERT INTO location_names VALUES (?,?,?,?)`);
const oldDistrict = Object.fromEntries(Object.entries(DISTRICT_NAMES).map(([old, modern]) => [modern, old]));

db.exec('BEGIN');
{
  places.sort((a, b) => a.district.localeCompare(b.district) || a.taluka.localeCompare(b.taluka) || a.name.localeCompare(b.name));
  places.forEach((place, i) => {
    const id = i + 1;
    const normalizedName = normalizeText(place.name);
    const aliases = [...place.aliases].filter((alias) => normalizeText(alias) && normalizeText(alias) !== normalizedName).slice(0, 20);
    if (!Number.isFinite(place.lat) || !Number.isFinite(place.lon) || place.lat < 19.5 || place.lat > 25 || place.lon < 68 || place.lon > 75) {
      throw new Error(`coordinates outside Gujarat for ${place.name}: ${place.lat}, ${place.lon}`);
    }
    const districtWords = [place.district, oldDistrict[place.district]].filter(Boolean).map(normalizeText).join('|');
    insertPlace.run(id, place.name, normalizedName, place.district, place.taluka, 'Gujarat', 'India',
      Number(place.lat.toFixed(6)), Number(place.lon.toFixed(6)), place.type, place.population,
      JSON.stringify(aliases), districtWords, normalizeText(place.taluka), `${place.source}/${place.coordSource}`);
    const seen = new Set<string>();
    [place.name, ...aliases].forEach((name, n) => {
      const normalized = normalizeText(name);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      insertName.run(id, normalized, looseKey(normalized), n === 0 ? 1 : 0);
    });
  });
  const meta = db.prepare('INSERT INTO meta VALUES (?,?)');
  meta.run('builtAt', new Date().toISOString());
  meta.run('places', String(places.length));
  meta.run('attribution', 'DataMeet Indian Village Boundaries (ODbL); GeoNames (CC BY 4.0); OpenStreetMap contributors (ODbL)');
}
db.exec('COMMIT');
db.exec(`
  CREATE INDEX idx_locations_normalizedName ON locations(normalizedName);
  CREATE INDEX idx_locations_district ON locations(district);
  CREATE INDEX idx_locations_taluka ON locations(taluka);
  CREATE INDEX idx_names_normalized ON location_names(normalized);
  CREATE INDEX idx_names_loose ON location_names(loose);
  VACUUM;
`);
db.close();
console.log('wrote', OUT, places.length, 'places,', (fs.statSync(OUT).size / 1e6).toFixed(1), 'MB');
