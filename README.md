# 飞喽 — keyless travel journal

A cartoon scrapbook journal with Leaflet street maps, OpenStreetMap tiles, and submitted Nominatim place search. Map search needs no API key. Accounts use Supabase through a Python backend: each user has private database entries and photo storage. **Start with [SETUP.md](SETUP.md) to connect your Supabase project.** No Vite or npm build is needed.

## Run in VS Code

Open this folder and choose Terminal → New Terminal:

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# Configure .env using SETUP.md, then:
python3 server.py
```

Open **http://127.0.0.1:4173/**. Keep the terminal running. Press Ctrl+C to stop it. If the port is already occupied by the earlier preview, use that preview or stop its server before starting this one. Use the exact address configured in APP_ORIGIN. Sign in to load your cloud memories.

Do not use `python3 -m http.server` or VS Code Live Server: those do not supply `/api/search` or `/api/map-config`. The supplied Python server uses Pillow to validate images and python-dotenv to read local configuration. It serves only public site assets and rejects `config.js`, hidden files, and files outside `dist`.

## Menu update

Run the **contents** of `supabase/menu-features.sql` in Supabase SQL Editor before using Flight tracker or View profile. See SETUP.md for the live verification checklist. The menu offers newest-first memories, manually entered boarding passes with illustrated map routes, and a private editable profile.

## Use

Press Find or Enter to search for a town, attraction, or address. No searches happen while typing. Choose a result to zoom the map and add a memory. You can dismiss the search overlay and select any point directly. Sign in to save notes, dates, titles, place names, and up to four photos to your private account. Multiple memories with the same rounded coordinates share a pin. Old browser-only data is preserved but not automatically imported into accounts.

Search coverage varies. Add a city or country when results are ambiguous. This is not Google Places, satellite imagery, Street View, or a source of business reviews.

## Files to edit

- `dist/index.html`: page, search dialog and memory form.
- `dist/theme.css`: scrapbook colors, tape accents and cartoon styling.
- `dist/styles.css`: base layout and responsive panel rules.
- `dist/app.js`: Leaflet map, pins, submitted search, journal CRUD and photo validation.
- `server.py`: same-origin search endpoint, validation, upstream requests and cache.
- `accounts.py`: managed authentication, HttpOnly sessions, owner-scoped CRUD and private photo proxy.
- `supabase/setup.sql`: database, bucket and ownership policies.
- `.env.example`: placeholder-only configuration; copy to ignored `.env`.
- `SETUP.md`: account setup, deployment and two-user isolation checks.
- `tests/test_server.py`: offline backend regression tests.
- `dist/vendor/leaflet/`: vendored Leaflet 1.9.4 and license; normally do not edit.
- `dist/places.js`: a few suggested starting destinations; not the live search database.
- `dist/assets/world.json`: retained legacy outline asset; no longer loaded.

## Service policy and limits — read before publishing

The developer chose Nominatim for this low-traffic student project after reviewing its restrictions:
https://operations.osmfoundation.org/policies/nominatim/

Search must be directly submitted by a person. The public service prohibits autocomplete, systematic/bulk querying, and generic geocoding services. The limit is one upstream request per second across the whole application. Our server has one shared gate (1.1-second minimum spacing), no automatic retries, a 60-second cooldown after upstream HTTP errors, and a SQLite cache for repeat searches (30 days, up to 1,000 queries). Queries sent to Nominatim are not confidential: do not search private or sensitive information.

Run **one server process and one deployment instance only**. Multiple replicas would bypass the shared rate limit. The gate controls request rate, not suitability for high traffic; if demand grows, use another provider or your own service. The cache is `.cache/search.sqlite3`, outside the served directory and excluded from Git. It contains query text, so treat it as private runtime data.

OSM tile rules: https://operations.osmfoundation.org/policies/tiles/
Visible attribution, ordinary browser caching and valid Referer headers are retained. No tile prefetch, bulk download, or offline map feature is implemented. Public tiles and search have no availability guarantee. The app can still show saved text/photos if a provider is unavailable.

## Configuration without source edits

Optional process environment variables (not API keys):

- `SEARCH_URL`: Nominatim-compatible `/search` endpoint.
- `SEARCH_USER_AGENT`: identify your app; add your public project URL or contact address before publishing.
- `SEARCH_CACHE_PATH`: cache database path; default `.cache/search.sqlite3`.
- `TILE_URL`: tile provider URL with `{z}`, `{x}`, `{y}` placeholders.
- `TILE_ATTRIBUTION`: tile provider attribution text. If changing provider, also update attribution links in the page/server as required by that provider.
- `HOST`, `PORT`: local server bind address/port; default `127.0.0.1:4173`.

The server reads environment variables and an ignored `.env` file. The map remains keyless; accounts need the server-only settings in SETUP.md. Google configuration files from earlier setup are not used. Do not commit them. Website settings never contain keys.

## GitHub and deployment

Commit source, README, tests, requirements, and Leaflet license. Exclude `config.js`, `.env*`, caches, virtual environments and credentials. The downloadable source archive excludes these files too. If you previously committed a real key, revoke/regenerate it and notify your instructor; `.gitignore` cannot erase Git history. Existing history was not audited.

This version needs a Python host; GitHub Pages or a static-only upload cannot run search. A Render Python Web Service can use:

```text
Build command: pip install -r requirements.txt
Start command: gunicorn --workers 1 --threads 4 --timeout 150 --bind 0.0.0.0:$PORT server:app
```

Keep one instance; set `SEARCH_USER_AGENT` with your public project URL/contact in the host's environment settings. Use a private writable cache path; persistent storage keeps the cache across restarts. Review the hosting plan's current pricing and storage behavior before deployment. Configure HTTPS on the published origin. No deployment has been performed. The earlier `.openai/hosting.json` is a legacy static-Sites configuration and is not a deployment configuration for this Python version.

Account entries/photos persist in Supabase. Follow SETUP.md for the required environment settings, confirmation setting and live isolation tests. Local memories are not transferred. Backups and a full production account lifecycle are outside this draft.

## Verification

Run offline backend tests:

```sh
python3 -m unittest discover -s tests -v
```

The offline suite covers map/search regressions and account boundaries, including two simulated users, private photo access, real PNG validation, sessions, CSRF, logout and malformed uploads. These use a simulated Supabase service; they do not prove your live policies. See SETUP.md for the required real two-account check. Live Supabase login, cloud persistence and deployment have not been verified.

## Explain it in an interview

Leaflet renders the map; OpenStreetMap supplies tile images; Nominatim converts submitted place text to coordinates. Python provides a single search gate and cache shared by all visitors. JavaScript sends no keyed request. Python exchanges credentials with Supabase Auth and keeps tokens in private server sessions. The browser gets only an opaque HttpOnly cookie. Each database/storage call uses the user’s token, so row-level security enforces ownership as well as Python. New photo previews use temporary object URLs; saved photos load through an authenticated endpoint. Text is inserted with `textContent` to avoid treating notes as HTML. Coordinate rounding groups memories at the same location; nearby different locations may still overlap at low zoom.

Your suggested own feature: add a travel-year filter that updates both the memory list and pin counts without deleting entries. Estimate 45–90 minutes, plus checks for changing an entry's date and empty results.

### Left menu navigation
Map is the home view. Memories, Flight tracker, and View profile open full-page sections within the same app. The map stays loaded so returning to it preserves zoom and position. Navigation and forms are in `dist/app.js`, markup in `dist/index.html`, and layout in `dist/theme.css`.
