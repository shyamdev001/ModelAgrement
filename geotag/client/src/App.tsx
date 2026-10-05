import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { requestStrip, searchPlaces, type GeotagInfo, type Place } from './api';
import { appendStrip, loadPhoto, PhotoError } from './compose';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

interface Result {
  url: string;
  fileName: string;
  info: GeotagInfo;
  width: number;
  photoHeight: number;
  stripHeight: number;
}

const fieldClass =
  'w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-ink placeholder:text-slate-500 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30';

export default function App() {
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState('');
  const [location, setLocation] = useState('');
  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [chosen, setChosen] = useState<Place | null>(null); // a place picked from the list, so it is not asked about again
  const [customTime, setCustomTime] = useState(false);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [choice, setChoice] = useState<{ message: string; candidates: Place[] } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLElement>(null);

  // Object URLs hold the picture in memory until released.
  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);

  // Suggestions come from the server's own list, a moment after typing stops.
  useEffect(() => {
    const query = location.trim();
    if (query.length < 2 || !showSuggestions) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => setSuggestions(await searchPlaces(query, controller.signal)), 220);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [location, showSuggestions]);

  function choosePhoto(file: File | undefined) {
    if (!file) return;
    setError('');
    setResult(null);
    setChoice(null);
    if (!ALLOWED.includes(file.type)) return setError('Please choose a JPG, PNG or WEBP photo.');
    setPhoto(file);
    setPhotoUrl(URL.createObjectURL(file));
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    choosePhoto(event.dataTransfer.files[0]);
  }

  async function run(picked?: Place) {
    const place = picked ?? chosen ?? undefined;
    if (!photo) return setError('Please choose a photo first.');
    if (!place && !location.trim()) return setError('Please enter a village, town or city name.');
    setBusy(true);
    setError('');
    setChoice(null);
    setShowSuggestions(false);
    try {
      const loaded = await loadPhoto(photo);
      const outcome = await requestStrip({
        width: loaded.width,
        location: place ? place.label : location,
        locationId: place?.id ?? undefined,
        date: customTime ? date : undefined,
        time: customTime ? time : undefined,
      });
      if (outcome.kind === 'error') return setError(outcome.message);
      if (outcome.kind === 'choose') return setChoice({ message: outcome.message, candidates: outcome.candidates });

      const { stripSvg, stripHeight, ...info } = outcome.strip;
      const { blob, extension } = await appendStrip(loaded, stripSvg, stripHeight, photo.type);
      const fileName = `geotag-${info.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'photo'}.${extension}`;
      setResult({ url: URL.createObjectURL(blob), fileName, info, width: loaded.width, photoHeight: loaded.height, stripHeight });
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (err) {
      setError(err instanceof PhotoError ? err.message : 'We could not process this photo. Please try another photo.');
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void run();
  }

  function pickSuggestion(place: Place) {
    setLocation(place.label);
    setChosen(place);
    setShowSuggestions(false);
  }

  const info = result?.info;
  const details: [string, string][] = info
    ? [
        ['Location', info.location],
        ['District', [info.taluka && `${info.taluka} taluka`, info.district].filter(Boolean).join(', ') || '-'],
        ['Latitude', info.latitude.toFixed(6)],
        ['Longitude', info.longitude.toFixed(6)],
        ['Plus Code', info.plusCode],
        ['Date', info.date],
        ['Time', info.time],
        ['Timezone', info.timezone],
      ]
    : [];

  return (
    <div className="min-h-screen">
      <header className="bg-brand-dark text-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-5">
          <svg viewBox="0 0 24 24" className="h-8 w-8 shrink-0" aria-hidden="true">
            <path fill="#ffffff" d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" />
          </svg>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Geotag Photo Generator</h1>
            <p className="text-sm text-white/85">Add a location strip under a photo</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">
        <form onSubmit={onSubmit} className="space-y-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-7">
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-700">1. Photo</h2>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              id="photo"
              onChange={(e) => { choosePhoto(e.target.files?.[0]); e.target.value = ''; }}
            />
            <label
              htmlFor="photo"
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 text-center transition-colors ${photo ? 'py-4' : 'py-10'} ${dragging ? 'border-brand bg-brand/10' : 'border-slate-300 bg-slate-50 hover:border-brand'}`}
            >
              {photo ? (
                <>
                  <img src={photoUrl} alt="The photo you chose" className="max-h-72 w-auto max-w-full rounded-lg object-contain" />
                  <span className="mt-3 text-sm font-medium text-brand">Choose a different photo</span>
                  <span className="mt-0.5 max-w-full truncate text-xs text-slate-600">{photo.name} · {(photo.size / 1024 / 1024).toFixed(1)} MB</span>
                </>
              ) : (
                <>
                  <span className="text-base font-semibold text-ink">Choose or take a photo</span>
                  <span className="mt-1 text-sm text-slate-600">or drag it here · JPG, PNG or WEBP</span>
                </>
              )}
            </label>
          </section>

          <section>
            <label htmlFor="location" className="mb-2 block text-sm font-semibold uppercase tracking-wide text-slate-700">2. Location</label>
            <div className="relative">
              <input
                id="location"
                className={fieldClass}
                placeholder="Village, town or city, e.g. Nadiad"
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="words"
                enterKeyHint="go"
                value={location}
                onChange={(e) => { setLocation(e.target.value); setChosen(null); setShowSuggestions(true); setChoice(null); }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              />
              {showSuggestions && suggestions.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                  {suggestions.map((place) => (
                    <li key={place.id}>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pickSuggestion(place)} className="block w-full px-4 py-2.5 text-left text-sm hover:bg-slate-100">
                        <span className="font-medium text-ink">{place.name}</span>
                        <span className="text-slate-600">{place.label.slice(place.name.length)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="mt-2 text-sm text-slate-600">Just the place name. The strip shows the coordinates of that village or town, not of the exact site.</p>

            <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" className="h-4 w-4 accent-brand" checked={customTime} onChange={(e) => setCustomTime(e.target.checked)} />
              Set the date and time myself (otherwise: now, Indian time)
            </label>
            {customTime && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <input type="date" aria-label="Date" className={fieldClass} value={date} onChange={(e) => setDate(e.target.value)} />
                <input type="time" aria-label="Time" className={fieldClass} value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
            )}
          </section>

          {choice && (
            <section className="rounded-xl border border-amber-300 bg-amber-50 p-4" aria-live="polite">
              <h2 className="font-semibold text-amber-950">{choice.message}</h2>
              <ul className="mt-3 space-y-2">
                {choice.candidates.map((place) => (
                  <li key={place.id}>
                    <button type="button" disabled={busy} onClick={() => { setLocation(place.label); setChosen(place); void run(place); }} className="w-full rounded-lg border border-amber-300 bg-white px-4 py-3 text-left text-sm font-medium text-ink hover:border-brand disabled:opacity-60">
                      {place.label}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-900">{error}</p>}

          <button type="submit" disabled={busy} className="w-full rounded-xl bg-brand px-6 py-4 text-base font-semibold text-white shadow-sm transition-colors hover:bg-brand-dark disabled:cursor-wait disabled:opacity-70">
            {busy ? 'Working…' : 'Generate Geotag Photo'}
          </button>
        </form>

        {result && info && (
          <section ref={resultRef} className="mt-6 scroll-mt-4 space-y-5 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Your photo is ready</h2>
              <a href={result.url} download={result.fileName} className="rounded-xl bg-brand px-5 py-3 text-base font-semibold text-white hover:bg-brand-dark">Download Image</a>
            </div>
            <figure>
              <img src={result.url} alt={`Photo with location strip for ${info.location}`} className="w-full rounded-lg ring-1 ring-slate-200" />
              <figcaption className="mt-2 text-xs text-slate-600">
                {result.width} × {result.photoHeight + result.stripHeight} px: your photo ({result.width} × {result.photoHeight}) with a {result.stripHeight} px strip added below it.
              </figcaption>
            </figure>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              {details.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 border-b border-slate-200 pb-2 sm:block">
                  <dt className="text-sm text-slate-600">{label}</dt>
                  <dd className="text-right text-sm font-semibold text-ink sm:text-left sm:text-base">{value}</dd>
                </div>
              ))}
            </dl>
            <details className="text-sm">
              <summary className="cursor-pointer font-medium text-brand">Compare with the original photo</summary>
              <img src={photoUrl} alt="Original photo" className="mt-3 w-full rounded-lg ring-1 ring-slate-200" />
            </details>
          </section>
        )}

        <footer className="mt-8 space-y-1 pb-8 text-center text-xs leading-relaxed text-slate-600">
          <p>The coordinates are those of the village, town or city you typed. The small map is an illustration, not a real street map.</p>
          <p>Your photo stays on this device; only the place name is sent.</p>
          <p>
            Place data: <a className="underline" href="https://github.com/datameet/indian_village_boundaries" target="_blank" rel="noreferrer">DataMeet Indian Village Boundaries</a> (ODbL),{' '}
            <a className="underline" href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a> (CC BY 4.0) and ©{' '}
            <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> (ODbL). Places outside the list are looked up with Nominatim.
          </p>
        </footer>
      </main>
    </div>
  );
}
