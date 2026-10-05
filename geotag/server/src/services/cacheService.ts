import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Location } from './locationService';

/**
 * Remembers places that had to be looked up online, so each is only ever asked for once.
 * It is a convenience, not a dependency: on hosts that wipe the disk (Render free) the file
 * simply starts empty again, and if it cannot be written at all a plain in-memory map is used.
 */
const CACHE_PATH = process.env.CACHE_DB_PATH || path.join(os.tmpdir(), 'geotag-location-cache.db');
const memory = new Map<string, Location>();
let db: DatabaseSync | null = null;

try {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  db = new DatabaseSync(CACHE_PATH);
  db.exec(`CREATE TABLE IF NOT EXISTS location_cache (
    id INTEGER PRIMARY KEY,
    query TEXT NOT NULL,
    normalizedQuery TEXT NOT NULL UNIQUE,
    resolvedName TEXT NOT NULL,
    district TEXT NOT NULL,
    state TEXT NOT NULL,
    country TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    source TEXT NOT NULL,
    createdAt TEXT NOT NULL
  )`);
} catch (err) {
  console.warn('[cache] using memory only:', (err as Error).message);
  db = null;
}

export function getCached(normalizedQuery: string): Location | null {
  const hit = memory.get(normalizedQuery);
  if (hit) return hit;
  try {
    const row = db?.prepare('SELECT * FROM location_cache WHERE normalizedQuery = ?').get(normalizedQuery) as Record<string, unknown> | undefined;
    if (!row) return null;
    const location: Location = {
      id: null, name: String(row.resolvedName), district: String(row.district), taluka: '', state: String(row.state),
      country: String(row.country), latitude: Number(row.latitude), longitude: Number(row.longitude), source: 'nominatim',
    };
    memory.set(normalizedQuery, location);
    return location;
  } catch {
    return null;
  }
}

export function saveCached(query: string, normalizedQuery: string, location: Location): void {
  memory.set(normalizedQuery, location);
  try {
    db?.prepare(`INSERT OR REPLACE INTO location_cache (query, normalizedQuery, resolvedName, district, state, country, latitude, longitude, source, createdAt)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(query, normalizedQuery, location.name, location.district, location.state, location.country,
      location.latitude, location.longitude, location.source, new Date().toISOString());
  } catch (err) {
    console.warn('[cache] could not save:', (err as Error).message);
  }
}
