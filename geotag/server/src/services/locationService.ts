import { DatabaseSync } from 'node:sqlite';
import { dataPath } from '../utils/dataPath';
import { looseKey, normalizeText, parseLocationQuery, type ParsedQuery } from '../utils/normalizeLocation';

export interface Location {
  id: number | null; // null for places that came from the fallback geocoder
  name: string;
  district: string;
  taluka: string;
  state: string;
  country: string;
  latitude: number;
  longitude: number;
  source: 'local' | 'nominatim';
}

export type LocalResult =
  | { status: 'found'; location: Location }
  | { status: 'ambiguous'; candidates: Location[]; guess: boolean }
  | { status: 'not_found' };

interface Row extends Omit<Location, 'source'> {
  type: string;
  population: number;
  normalizedDistrict: string;
  normalizedTaluka: string;
  isPrimary: number;
}

const DB_PATH = process.env.LOCATIONS_DB_PATH || dataPath('gujarat-locations.db');
const MAX_CANDIDATES = 12;
const COLUMNS = `l.id, l.name, l.district, l.taluka, l.state, l.country, l.latitude, l.longitude,
  l.type, l.population, l.normalizedDistrict, l.normalizedTaluka`;

// The bundled database is opened read-only: it ships with the app and is never written at runtime.
const db = new DatabaseSync(DB_PATH, { readOnly: true });
const byNormalized = db.prepare(`SELECT ${COLUMNS}, MAX(n.isPrimary) AS isPrimary FROM location_names n JOIN locations l ON l.id = n.locationId WHERE n.normalized = ? GROUP BY l.id`);
const byLoose = db.prepare(`SELECT ${COLUMNS}, MAX(n.isPrimary) AS isPrimary FROM location_names n JOIN locations l ON l.id = n.locationId WHERE n.loose = ? GROUP BY l.id`);
const byId = db.prepare(`SELECT ${COLUMNS}, 1 AS isPrimary FROM locations l WHERE l.id = ?`);
const byPrefix = db.prepare(`SELECT ${COLUMNS}, MAX(n.isPrimary) AS isPrimary FROM location_names n JOIN locations l ON l.id = n.locationId
  WHERE n.normalized >= ? AND n.normalized < ? GROUP BY l.id
  ORDER BY (l.normalizedName = ?) DESC, l.population DESC, (l.type != 'village') DESC, l.name LIMIT ?`);

const toLocation = (row: Row): Location => ({
  id: row.id, name: row.name, district: row.district, taluka: row.taluka, state: row.state, country: row.country,
  latitude: row.latitude, longitude: row.longitude, source: 'local',
});

const isMajor = (row: Row) => row.type === 'city' || row.type === 'town' || row.population >= 10000;
const rank = (a: Row, b: Row) => b.population - a.population || Number(isMajor(b)) - Number(isMajor(a)) || a.district.localeCompare(b.district);

/** True when a typed word such as "kheda" names this place's district or taluka. */
function inArea(row: Row, qualifier: string): boolean {
  const loose = looseKey(qualifier);
  return [...row.normalizedDistrict.split('|'), row.normalizedTaluka].some((area) => area === qualifier || looseKey(area) === loose);
}

/** Looks a typed place up in the bundled Gujarat database. Never touches the network. */
export function findLocal(parsed: ParsedQuery): LocalResult {
  // Pass 1 trusts the spelling. Pass 2 allows spelling variants, and its matches are only ever offered as "did you mean".
  for (const exact of [true, false]) {
    for (const reading of parsed.readings) {
      let rows = (exact ? byNormalized.all(reading.name) : byLoose.all(looseKey(reading.name))) as unknown as Row[];
      rows = rows.filter((row) => reading.qualifiers.every((qualifier) => inArea(row, qualifier)));
      if (rows.length === 0) continue;

      // "Surat" the city, not a village that merely lists Surat as an alternative name.
      if (rows.some((row) => row.isPrimary)) rows = rows.filter((row) => row.isPrimary);
      rows.sort(rank);
      if (!exact) return { status: 'ambiguous', candidates: rows.slice(0, MAX_CANDIDATES).map(toLocation), guess: true };

      const major = rows.filter(isMajor);
      if (rows.length === 1) return { status: 'found', location: toLocation(rows[0]) };
      // One well-known town among same-named villages: that is what people mean. Add the district to get a village.
      if (major.length === 1) return { status: 'found', location: toLocation(major[0]) };
      return { status: 'ambiguous', candidates: rows.slice(0, MAX_CANDIDATES).map(toLocation), guess: false };
    }
  }
  return { status: 'not_found' };
}

export function findLocalById(id: number): Location | null {
  const row = byId.get(id) as unknown as Row | undefined;
  return row ? toLocation(row) : null;
}

/** Suggestions while typing. Local database only. */
export function searchLocal(query: string, limit = 8): Location[] {
  const { readings } = parseLocationQuery(query);
  const name = readings[0]?.name ?? normalizeText(query);
  if (name.length < 2) return [];
  const rows = byPrefix.all(name, `${name}￿`, name, limit * 3) as unknown as Row[];
  const qualifiers = readings[0]?.qualifiers ?? [];
  const narrowed = rows.filter((row) => qualifiers.every((qualifier) => inArea(row, qualifier)));
  return (narrowed.length ? narrowed : rows).slice(0, limit).map(toLocation);
}

export function locationCount(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM locations').get() as { n: number }).n;
}

/** "Nadiad, Kheda, Gujarat" style label for choice lists. */
export function describe(location: Location): string {
  const parts = [location.name];
  if (location.taluka && normalizeText(location.taluka) !== normalizeText(location.name)) parts.push(`${location.taluka} taluka`);
  if (location.district && normalizeText(location.district) !== normalizeText(location.name)) parts.push(location.district);
  if (location.state) parts.push(location.state);
  return parts.join(', ');
}
