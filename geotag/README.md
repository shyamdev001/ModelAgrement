# Geotag Photo Generator

Choose a photo, type a village / town / city, download the same photo with a thin location strip
added underneath (small map picture, place name, Plus Code, latitude, longitude, date, time).

The coordinates are those of **the place that was typed** (the village or town), not of the exact
spot where the photo was taken, and the small map is an illustration, not a real street map. The
strip says so in small print. This is an internal labelling tool.

It lives in its own folder and does not touch the Model Agreement generator in the repository root.
Everything is hosted on Vercel as one project.

```
geotag/
  vercel.json             build + function settings for Vercel
  api/index.ts            Vercel entry point: hands /api/* to the Express app
  client/                 the page: React + TypeScript + Tailwind (Vite)
    src/App.tsx           the one page
    src/compose.ts        joins the strip to the photo, in the browser
    src/api.ts            calls to the API
  server/
    data/gujarat-locations.db   the bundled place list (SQLite, 22,041 places)
    data/fonts/                 fonts the strip text is drawn with
    scripts/build-locations.ts  rebuilds the place list from open data
    scripts/smoke-test.ts       API test
    src/
      routes/     strip.routes.ts, location.routes.ts
      services/   locationService, geocodingService, cacheService, plusCodeService,
                  mapRenderer, stripRenderer
      utils/      normalizeLocation, timezone, dataPath, errors
      app.ts, server.ts (local development only), env.ts
```

## How it works

1. The browser opens the photo and reads its width. **The photo never leaves the device.**
2. The page sends the place name and that width to `POST /api/strip`.
3. The server finds the place, computes the Plus Code and draws the strip as an SVG.
4. The browser draws the photo and, under it, the strip onto a canvas of the photo's exact width,
   and offers the result as a download.

## Run on your PC

Needs Node 22.13 or newer (the API uses Node's built-in SQLite). Two terminals:

```bash
cd geotag
npm install
npm run dev
```

```bash
cd geotag/client
npm install
npm run dev
```

Open http://localhost:5173. The page forwards `/api` to the API on port 4000.

Check types, test the API (add `SKIP_ONLINE=1` to skip the three online checks), build the page:

```bash
cd geotag
npm run typecheck
npm test
npm run build
```

## Deploy on Vercel

1. Push the repository to GitHub.
2. In Vercel: Add New > Project > import the same repository again.
3. Set **Root Directory** to `geotag`. Leave the framework preset on "Other"; `vercel.json` supplies
   the build command and output folder.
4. (Optional) add the environment variable `NOMINATIM_USER_AGENT` with your business name.
5. Deploy. Check `https://<your-address>/api/health` answers `{"ok":true,"places":22041}`.

The existing Model Agreement project keeps deploying from the repository root; the root
`.vercelignore` keeps this folder out of it.

### Settings (all optional)

| Name | Meaning |
| --- | --- |
| `NOMINATIM_USER_AGENT` | How the app identifies itself to Nominatim. Put your business name. |
| `NOMINATIM_EMAIL` | Contact sent with fallback lookups. |
| `FALLBACK_GEOCODER` | `off` = never look places up online. |
| `CORS_ORIGIN` | Only if the page is hosted at another address than the API. |
| `VITE_API_URL` (client) | Only if the API is hosted at another address than the page. |

No API keys or paid services are needed. There is no login: anyone with the address can use it.

## How a location is found

1. **Clean what was typed.** Lowercase, accents and punctuation removed, "Gujarat" / "India" dropped.
   `Nadiad, Kheda, Gujarat` becomes the name `nadiad` with the hint `kheda`.
2. **Bundled list first.** `gujarat-locations.db` is opened read-only and searched by exact name or
   alternative name (indexed, a few milliseconds). District or taluka words narrow the result.
3. **More than one match?**
   - One well-known town among same-named villages: the town is used ("Borsad" is Borsad in Anand;
     type "Borsad, Dahod" for the village).
   - Otherwise the page asks "Which location did you mean?" and lists the choices.
   - If only a different spelling matched, it is offered as "Did you mean...", never used silently.
4. **Not in the list.** Only then is OpenStreetMap Nominatim asked, at most once a second, and the
   answer is remembered so the same place is not asked for again.
5. **Still nothing.** The person is told the location was not found. No coordinates are ever made up.

The suggestions under the location box come from the bundled list only.

### The place list

Built once by `npm run build:data` from three open datasets, then committed:

| Source | What it gives | License |
| --- | --- | --- |
| [DataMeet Indian Village Boundaries](https://github.com/datameet/indian_village_boundaries) (`gj/gj.geojson`) | 18,758 villages and towns with district and taluka (Census 2001 names) | ODbL |
| [GeoNames](https://download.geonames.org/export/dump/) (`IN.zip`, `admin1 = 09`) | settlement points, alternative spellings, population | CC BY 4.0 |
| OpenStreetMap place points for Gujarat (Overpass) | settlement points | ODbL |

A village's coordinates are its mapped settlement point where OSM or GeoNames has one, otherwise
the centre of its census outline. Districts are the 2001 ones (25), so places in districts created
later (Botad, Morbi, Aravalli, ...) are listed under the older district.

To rebuild, put `gj.geojson`, `IN.txt` and `osm-places.json` in `server/data/raw/` and run
`npm run build:data`. The OSM file comes from this Overpass query:

```
[out:json][timeout:240];area["ISO3166-2"="IN-GJ"]->.a;
node[place~"^(city|town|village|hamlet)$"][name](area.a);out;
```

### Cache

Online answers are kept in a small SQLite file in the system temp folder. On Vercel that folder is
emptied whenever the function restarts; the app then simply starts with an empty cache and asks
again. If the file cannot be written at all, an in-memory cache is used.

## Plus Code, map, strip, photo

- **Plus Code**: computed on the server with Google's open-source `open-location-code` library from
  the chosen coordinates (10 digits). No network call.
- **Map**: drawn in `mapRenderer.ts` from a random generator seeded with the coordinates, so a place
  always gets the same picture. Its roads, river and parks are invented.
- **Strip**: about 14% of the photo's width in height. Text is drawn as outlines from the bundled
  Carlito font, so it looks the same everywhere.
- **Photo**: width, height and framing do not change; the canvas is only made taller. PNG and WEBP
  come out pixel-for-pixel identical. A JPEG has to be saved again, at quality 0.97. A phone photo
  stored sideways is shown upright, with the strip under it. The camera data inside the file (EXIF)
  is not carried over to the result.
- Very large photos can exceed a phone browser's canvas limit (about 16 megapixels on older
  iPhones); the page then asks for a smaller photo.

## API

`POST /api/strip` (JSON): `width` (photo width in pixels), `location`, optional `locationId` (a
choice from a "which did you mean" list), optional `date` (`YYYY-MM-DD` or `DD/MM/YYYY`), optional
`time` (`HH:MM`). Answers with name, taluka, district, state, latitude, longitude, plusCode, date,
time, timezone, stripHeight and stripSvg. Problems come back as `{ "error": "...", "message": "..." }`;
an ambiguous name also carries `candidates`.

`GET /api/location/search?q=nad` searches the bundled list. `GET /api/health`.

## Attribution

Shown in the page footer and required to stay: DataMeet Indian Village Boundaries (ODbL), GeoNames
(CC BY 4.0), © OpenStreetMap contributors (ODbL). The place list is a database derived from ODbL
data, so if you pass the `.db` file on to others it must stay under ODbL. Fonts: Carlito (SIL OFL).
