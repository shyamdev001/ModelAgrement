/**
 * End-to-end check of the API: starts the real app on a spare port and drives it over HTTP.
 *   npm test               (SKIP_ONLINE=1 skips the checks that reach the online fallback)
 * Joining the strip to a photo happens in the browser and is not covered here.
 */
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app';
import { stripHeightFor } from '../src/services/stripRenderer';

const PLACES = ['Nadiad', 'Anand', 'Borsad', 'Petlad', 'Sojitra', 'Karamsad', 'Vallabh Vidyanagar', 'Ahmedabad', 'Vadodara', 'Surat', 'Rajkot', 'Kheda', 'Mahudha', 'Davol', 'Heranj'];
const PLUS_CODE = /^[23456789CFGHJMPQRVWX]{8}\+[23456789CFGHJMPQRVWX]{2}$/;
let failures = 0;

function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
}

/** A strip is usable when it is the asked-for size, has a map pin and text, and no broken numbers. */
function stripLooksRight(body: Record<string, any>, width: number): boolean {
  const svg = String(body.stripSvg || '');
  return svg.startsWith('<svg') && svg.trimEnd().endsWith('</svg>') && !svg.includes('NaN') && !svg.includes('undefined') &&
    svg.includes(`width="${width}" height="${stripHeightFor(width)}"`) && body.stripHeight === stripHeightFor(width) &&
    svg.includes('clip-path') && (svg.match(/<path /g) || []).length >= 10;
}

async function main() {
  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const strip = async (fields: Record<string, unknown>) => {
    const res = await fetch(`${base}/api/strip`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ width: 1536, ...fields }) });
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };

  console.log('--- the 15 test places ---');
  for (const place of PLACES) {
    const started = Date.now();
    let r = await strip({ location: place });
    let note = '';
    if (r.status === 409) {
      // Several places share the name: take the first choice, as a person would pick one from the list.
      note = ` (asked to choose between ${r.body.candidates.length}: ${r.body.candidates.map((c: any) => c.label).join(' | ')})`;
      r = await strip({ locationId: r.body.candidates[0].id });
    }
    const b = r.body;
    const ok = r.status === 200 && Number.isFinite(b.latitude) && Number.isFinite(b.longitude) && PLUS_CODE.test(b.plusCode) && stripLooksRight(b, 1536);
    check(place, ok, ok ? `${b.name}, ${b.taluka}, ${b.district} | ${b.latitude}, ${b.longitude} | ${b.plusCode} | strip 1536x${b.stripHeight} | ${Date.now() - started} ms${note}` : JSON.stringify(b).slice(0, 200));
  }

  console.log('--- how the name is typed ---');
  for (const typed of ['nadiad', 'NADIAD', '   Nadiad   ', 'Nadiad, Gujarat', 'Nadiad Gujarat', 'Nadiad, Gujarat, India', 'Nadiad, Kheda', 'nadiad kheda', 'Anand Gujarat', 'Vallabh Vidyanagar, Anand', 'Borsad, Dahod', 'Heranj, Mahudha']) {
    const r = await strip({ location: typed });
    check(`"${typed}"`, r.status === 200, r.status === 200 ? `${r.body.name}, ${r.body.taluka}, ${r.body.district} (${r.body.latitude}, ${r.body.longitude})` : JSON.stringify(r.body));
  }

  console.log('--- strip sizes ---');
  for (const width of [480, 1080, 4032, 8000]) {
    const r = await strip({ location: 'Vallabh Vidyanagar', width });
    check(`photo ${width}px wide`, r.status === 200 && stripLooksRight(r.body, width), `strip ${r.body.stripHeight}px, ${(String(r.body.stripSvg).length / 1024).toFixed(0)} KB`);
  }
  const same = [await strip({ location: 'Anand', date: '2026-10-05', time: '10:32' }), await strip({ location: 'Anand', date: '2026-10-05', time: '10:32' })];
  check('same place gives the same map every time', same[0].body.stripSvg === same[1].body.stripSvg);

  console.log('--- date and time ---');
  const stamped = await strip({ location: 'Anand', date: '2026-10-05', time: '10:32' });
  check('given date and time', stamped.body.date === '05/10/2026' && stamped.body.time === '10:32 AM' && stamped.body.timezone === 'GMT+05:30', `${stamped.body.date} ${stamped.body.time} ${stamped.body.timezone}`);
  const now = await strip({ location: 'Anand' });
  check('default is the current Indian time', /^\d{2}\/\d{2}\/\d{4}$/.test(now.body.date) && /^\d{2}:\d{2} (AM|PM)$/.test(now.body.time), `${now.body.date} ${now.body.time}`);
  check('bad date is refused', (await strip({ location: 'Anand', date: '31/02/2026' })).status === 400);

  console.log('--- problems a person can cause ---');
  const expectError = async (label: string, promise: ReturnType<typeof strip>, status: number, code: string) => {
    const r = await promise;
    check(label, r.status === status && r.body.error === code, `${r.status} ${r.body.error}: ${r.body.message}`);
    return r;
  };
  await expectError('empty location', strip({ location: '   ' }), 400, 'location_empty');
  await expectError('only "Gujarat"', strip({ location: 'Gujarat, India' }), 400, 'location_empty');
  await expectError('no photo width', strip({ location: 'Anand', width: 'abc' }), 400, 'malformed');
  const ambiguous = await expectError('ambiguous name (Kalol)', strip({ location: 'Kalol' }), 409, 'ambiguous_location');
  console.log('      choices:', ambiguous.body.candidates?.map((c: any) => c.label).join(' | '));
  const typo = await expectError('spelling variant -> did you mean', strip({ location: 'Vallabh Vidhyanagaar' }), 409, 'ambiguous_location');
  console.log('      choices:', typo.body.candidates?.map((c: any) => c.label).join(' | '));
  await expectError('choice that does not exist', strip({ locationId: 99999999 }), 404, 'location_not_found');
  const malformed = await fetch(`${base}/api/strip`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"x":' });
  check('malformed request', malformed.status === 400, `${malformed.status} ${JSON.stringify(await malformed.json())}`);
  const huge = await fetch(`${base}/api/strip`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'x'.repeat(50000) }) });
  check('oversized request', huge.status === 400, String(huge.status));

  console.log('--- local search (no network) ---');
  for (const q of ['nad', 'heranj', 'davol', 'vallabh', 'x']) {
    const started = process.hrtime.bigint();
    const res = (await (await fetch(`${base}/api/location/search?q=${encodeURIComponent(q)}`)).json()) as { results: any[] };
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    check(`search "${q}"`, q === 'x' ? res.results.length === 0 : res.results.length > 0, `${res.results.length} results in ${ms.toFixed(1)} ms: ${res.results.slice(0, 3).map((x) => x.label).join(' | ')}`);
  }

  if (process.env.SKIP_ONLINE !== '1') {
    console.log('--- online fallback (places outside the bundled list) ---');
    const first = Date.now();
    const outside = await strip({ location: 'Mumbai' });
    const firstMs = Date.now() - first;
    check('place outside Gujarat resolves online', outside.status === 200 && outside.body.source === 'nominatim' && stripLooksRight(outside.body, 1536), outside.status === 200 ? `${outside.body.location} (${outside.body.latitude}, ${outside.body.longitude}) in ${firstMs} ms` : JSON.stringify(outside.body));
    const second = Date.now();
    const again = await strip({ location: 'mumbai' });
    check('second time comes from the cache', again.status === 200 && Date.now() - second < 500, `${Date.now() - second} ms`);
    await expectError('place that does not exist', strip({ location: 'Zzqxplace Notreal' }), 404, 'location_not_found');
  }

  server.close();
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
