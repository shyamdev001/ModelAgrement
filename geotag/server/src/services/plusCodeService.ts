// Google's open-source Open Location Code library; the code is computed here, no network call.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { OpenLocationCode } = require('open-location-code') as { OpenLocationCode: new () => { encode(lat: number, lon: number, length?: number): string } };

const olc = new OpenLocationCode();

/** Full 10-digit Plus Code (about 14 m x 14 m) for a coordinate, e.g. "7JJJMVV6+GJ". */
export function plusCodeFor(latitude: number, longitude: number): string {
  return olc.encode(latitude, longitude, 10);
}
