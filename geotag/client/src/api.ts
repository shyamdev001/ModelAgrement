const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export interface Place {
  id: number | null;
  name: string;
  taluka: string;
  district: string;
  state: string;
  label: string;
}

export interface GeotagInfo {
  location: string;
  name: string;
  taluka: string;
  district: string;
  state: string;
  country: string;
  latitude: number;
  longitude: number;
  plusCode: string;
  date: string;
  time: string;
  timezone: string;
  source: 'local' | 'nominatim';
}

export interface StripResponse extends GeotagInfo {
  stripWidth: number;
  stripHeight: number;
  stripSvg: string;
}

export type StripResult =
  | { kind: 'done'; strip: StripResponse }
  | { kind: 'choose'; message: string; candidates: Place[] }
  | { kind: 'error'; message: string };

export interface StripInput {
  width: number;
  location: string;
  locationId?: number;
  date?: string;
  time?: string;
}

const OFFLINE = 'Could not reach the server. Check your internet and try again.';

/** Asks the server for the strip for this place. Only the place name and the photo's width are sent, never the photo. */
export async function requestStrip(input: StripInput): Promise<StripResult> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/strip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { kind: 'error', message: OFFLINE };
  }
  const body = (await res.json().catch(() => ({}))) as Partial<StripResponse> & { error?: string; message?: string; candidates?: Place[] };
  if (res.ok && body.stripSvg) return { kind: 'done', strip: body as StripResponse };
  if (body.error === 'ambiguous_location' && body.candidates?.length) {
    return { kind: 'choose', message: body.message || 'Which location did you mean?', candidates: body.candidates };
  }
  return { kind: 'error', message: body.message || 'Something went wrong. Please try again.' };
}

/** Suggestions from the server's own Gujarat list. */
export async function searchPlaces(query: string, signal: AbortSignal): Promise<Place[]> {
  try {
    const res = await fetch(`${API_URL}/api/location/search?q=${encodeURIComponent(query)}`, { signal });
    return res.ok ? ((await res.json()) as { results: Place[] }).results : [];
  } catch {
    return [];
  }
}
