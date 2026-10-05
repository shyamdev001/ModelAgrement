import { UserError } from '../utils/errors';
import { parseLocationQuery } from '../utils/normalizeLocation';
import { getCached, saveCached } from './cacheService';
import { findLocal, findLocalById, type Location } from './locationService';

/**
 * OpenStreetMap Nominatim, used ONLY for places the bundled database does not have.
 * Its usage policy: identify the app, at most one request a second, no autocomplete, cache results.
 */
const NOMINATIM_URL = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = process.env.NOMINATIM_USER_AGENT || 'GeotagPhotoGenerator/1.0 (internal photo labelling tool)';
const CONTACT_EMAIL = process.env.NOMINATIM_EMAIL || '';
const ENABLED = process.env.FALLBACK_GEOCODER !== 'off';
const MIN_GAP_MS = 1100;
const TIMEOUT_MS = 8000;
const NOT_FOUND_TTL_MS = 60 * 60 * 1000;

const PLACE_KEYS = ['village', 'town', 'city', 'hamlet', 'municipality', 'suburb', 'neighbourhood', 'city_district'] as const;
const notFound = new Map<string, number>();
let queue: Promise<unknown> = Promise.resolve();
let lastCall = 0;

class GeocoderDown extends Error {}

/** Runs calls one after another, at least MIN_GAP_MS apart. */
function throttled<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastCall + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastCall = Date.now();
    return task();
  });
  queue = run.catch(() => undefined);
  return run;
}

async function ask(q: string): Promise<Location | null> {
  const url = new URL(NOMINATIM_URL);
  url.search = new URLSearchParams({ q, format: 'jsonv2', addressdetails: '1', limit: '5', countrycodes: 'in', 'accept-language': 'en' }).toString();
  if (CONTACT_EMAIL) url.searchParams.set('email', CONTACT_EMAIL);

  let results: Array<Record<string, any>>;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    results = (await res.json()) as Array<Record<string, any>>;
  } catch (err) {
    throw new GeocoderDown((err as Error).message);
  }

  // Only settlements and their administrative areas count: a shop or a road named "Nadiad" is not the town.
  const hit = results.find((r) => r.category === 'place' || (r.category === 'boundary' && r.type === 'administrative'));
  if (!hit) return null;
  const latitude = Number(hit.lat), longitude = Number(hit.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const address = hit.address ?? {};
  const placeKey = PLACE_KEYS.find((key) => address[key]);
  return {
    id: null,
    name: String(hit.name || (placeKey && address[placeKey]) || q.split(',')[0]),
    district: String(address.state_district || address.county || '').replace(/ District$/i, ''),
    taluka: '',
    state: String(address.state || ''),
    country: String(address.country || 'India'),
    latitude: Number(latitude.toFixed(6)),
    longitude: Number(longitude.toFixed(6)),
    source: 'nominatim',
  };
}

/**
 * The whole lookup: bundled database -> cache of earlier online answers -> online fallback.
 * Throws a UserError (with a plain-language message) when no single place can be settled on.
 */
export async function resolveLocation(input: string, locationId?: number): Promise<Location> {
  if (locationId !== undefined) {
    const chosen = findLocalById(locationId);
    if (!chosen) throw new UserError('location_not_found', 'That choice is no longer available. Please type the location again.', 404);
    return chosen;
  }

  const parsed = parseLocationQuery(input);
  if (parsed.readings.length === 0) {
    throw new UserError('location_empty', 'Please enter a village, town or city name.');
  }

  const local = findLocal(parsed);
  if (local.status === 'found') return local.location;
  if (local.status === 'ambiguous') {
    // Several places share the name, or only a differently spelled name matched: let the person choose, never guess.
    const message = local.guess ? 'We could not find that exact spelling. Did you mean one of these?' : 'Which location did you mean?';
    throw new UserError('ambiguous_location', message, 409, { candidates: local.candidates });
  }

  const cached = getCached(parsed.normalizedQuery);
  if (cached) return cached;

  const giveUp = (reason: 'missing' | 'down') =>
    reason === 'down'
      ? new UserError('geocoder_unavailable', 'This place is not in our Gujarat list, and the online lookup is not reachable right now. Check the spelling or try again in a minute.', 503)
      : new UserError('location_not_found', 'Location not found. Please enter a village, town, or city name.', 404);

  const missUntil = notFound.get(parsed.normalizedQuery);
  if (!ENABLED || (missUntil && missUntil > Date.now())) throw giveUp('missing');

  let found: Location | null;
  try {
    // Gujarat first (that is where the business is), then anywhere in India.
    found = await throttled(() => ask(`${parsed.normalizedQuery}, Gujarat, India`));
    if (!found) found = await throttled(() => ask(`${parsed.normalizedQuery}, India`));
  } catch (err) {
    if (!(err instanceof GeocoderDown)) throw err;
    console.warn('[geocoder] unavailable:', err.message);
    throw giveUp('down');
  }
  if (!found) {
    notFound.set(parsed.normalizedQuery, Date.now() + NOT_FOUND_TTL_MS);
    throw giveUp('missing');
  }
  saveCached(input.trim(), parsed.normalizedQuery, found);
  return found;
}
