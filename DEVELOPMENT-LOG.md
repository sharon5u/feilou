# Development log — 2026-10-04

- AI assistance: Codex authored the initial interface, local map rendering, search catalog, IndexedDB CRUD, photo handling and documentation. User supplied the product brief and narrowed this version to no API usage.
- Architecture: plain browser files keep the student project explainable and easy to publish. No runtime dependencies or remote API calls.
- Design: cream paper, muted green map, terracotta pins, a desktop journal margin, and a mobile bottom panel.
- Data: Natural Earth country outlines were downloaded from datasets/geo-countries and simplified into a local JSON asset. Search adds a small hand-maintained destination catalog.
- Persistence decision: IndexedDB supports photo Blobs and transaction completion; localStorage is a poor fit for binary photos. This intentionally postpones the earlier account/security/backend scope.
- Problem: standalone browser automation could not start its browser. Used the supported in-app browser for focused interactive checks instead.
- Verified: note creation/editing, photo preview and persistence after refresh, reopening a pin, same-location grouping, cancellation of deletion, and visual desktop/mobile checks. Remaining tests are listed in README.
- Concepts to study: coordinates versus display pixels; transforming one SVG group; transaction commit versus request success; object URL lifecycle; backend ownership enforcement versus frontend filtering.
- Student contribution planned: travel-year filtering across the journal list and pins. This is suggested work, not a claim that the student has already implemented or learned it.

- Deployment: Site registered; hosting workflow was blocked by automatic approval review before source publishing could be confirmed. The portable download remains complete.

- User-directed redesign: added a cute cartoon scrapbook theme inspired by the supplied memory-card screenshot: pastel colors, rounded lettering, tape accents, Polaroid borders, and soft raised buttons. Stored separately in theme.css so the student can customize it easily.

- 2026-10-05: Moved the large welcome text and place search into a dismissible opening overlay over a dimmed map. Outside click, Escape, or Explore closes it; choosing a result also closes it. Added compact Search control and keyboard focus containment.

## 2026-10-07 — keyless search and detailed maps

- User selected the keyless approach after reviewing Nominatim's public-service restrictions.
- Replaced SVG interaction with vendored Leaflet 1.9.4 and OSM street tiles. Retained existing journal database/schema, scrapbook theme and search overlay.
- Added a Python standard-library WSGI server. Search runs only on explicit submission, uses a durable bounded cache and one shared request gate. Public deployment must use one worker/instance.
- Secret handling: no Google key is used or read; private config and hidden files are blocked by the static handler, and omitted from the updated ZIP.
- Verification: 5 offline backend tests passed; live Eiffel Tower search succeeded; browser tested selecting a result, saving a labelled test memory, refresh and reopening it. Existing entries remained available. Fresh photo uploads and public deployment were not retested/performed.
- Student learning points: map library vs tile provider vs geocoder; shared rate limit vs per-browser delay; WSGI request routing; browser persistence vs server search caching.

- Fixed Chrome page loading indefinitely: the single-threaded local WSGI server was blocked reading an idle connection. Added threaded connection handling with a 15-second socket timeout; search still uses one shared upstream lock. Verified HTTP 200 while another socket remains idle and added a regression test.

- Chrome blank-map follow-up: scripts and map-config endpoint return HTTP 200. Added versioned app asset URLs and no-store headers for local static assets to prevent old-script/new-page mismatches. Chrome itself was unavailable to automation, so the user must confirm the hard refresh. OSM tile caching remains unchanged.

- Formatted authored HTML/CSS/JavaScript with Prettier and Python with Black for readability. Added formatting conventions. Python syntax trees were unchanged, JavaScript syntax checks and all six backend tests passed. Third-party Leaflet distribution and generated map data remain unchanged.


## 2026-10-07 — Private accounts and backend (AI assisted)

- Request: add login and isolate each user's memories with backend storage.
- AI implemented a Supabase Auth/Postgres/private Storage integration behind the existing Python server, account dialog, email-code confirmation, opaque HttpOnly sessions, server image validation, SQL RLS policies, setup guide and offline tests.
- Decision: keep every keyed request in Python to satisfy coursework. Use the publishable key plus each user's JWT, never a service-role key that bypasses RLS. Keep map/search keyless.
- Existing local memories remain untouched; automatic migration would risk assigning shared-browser data to the wrong account.
- Problem found in testing: the simulated database reused mutable dictionaries unlike a real JSON response; corrected the fixture so removal/cleanup behavior is tested realistically.
- Learning notes to review: authentication establishes identity; authorization is enforced separately on every database row and storage path. Hiding another user's pins in JavaScript is not access control. A .env file alone cannot keep browser-delivered values secret.
- Scope decisions: one-hour sessions without refresh, no password reset UI, no automatic orphan cleanup. Network-write ambiguity and live-policy testing documented in SETUP.md.
- Student-owned follow-up: implement a travel-year filter affecting both the list and pin counts, then explain how filtering differs from security rules.
- Verification: offline account/search regression tests; browser login dialog and missing-configuration state. Real Supabase setup and end-to-end two-account verification still required.

- Browser follow-up: with a temporary simulated backend, verified sign-in → select Paris → save note → refresh → reopen pin → sign out (pins/list clear). This was not a live Supabase test. Temporary test server stopped afterward.

## 2026-10-07 — Visible account choices
- Replaced the account-action dropdown with side-by-side Sign in / Create an account buttons. Kept a separate confirmation-code button and automatically selects confirmation after signup requires email verification.
- Mode buttons expose selected state and are disabled during requests. JavaScript syntax check passed; live signup was not attempted.

## 2026-10-07 — Username accounts without email verification
- User requested username/password signup and login without verification emails. Removed code UI and verification endpoint.
- Retained managed password hashing in Supabase; normalized usernames map to reserved .invalid email identifiers. Existing email login remains supported. Authorization still uses immutable user UUIDs and RLS.
- Added signup preflight for Supabase's mailer_autoconfirm setting, so disabled confirmation is required before creating synthetic identities.
- Added offline tests for normalization, provider login rejection, invalid usernames and confirmation-setting guard. No actual account creation or password transmission used for testing.
- Remaining setup: owner must disable Confirm email in Supabase. Username-only accounts have no email password recovery.

- Verification: all 18 offline tests and JavaScript syntax check passed. Read-only live settings check found email confirmation still enabled; no live signup attempted. Local server restarted.

## 2026-10-07 — Memories, Flight tracker and Profile menu
- User expanded scope to flight routes and personal profiles. Added three persistent menu buttons; memories sorted newest travel date first.
- Flight forms store manually entered boarding-pass fields and explicitly selected search coordinates; curved illustrated paths use unwrapped longitude to cross the Pacific correctly, with keyboard-accessible airplane markers. No live flight tracking or boarding-pass OCR.
- Added private profiles (name, birthday, hometown, country/region, bio) and owner-scoped endpoints with server validation. Separate rerunnable SQL migration enables RLS. Existing memory tables unchanged.
- AI implemented and checked the changes. 21 offline tests passed, including cross-user isolation, invalid coordinates/dates and profile updates. Browser with simulated provider verified flight save/map rendering and profile save. Live migration and RLS still need user setup/verification.

- Follow-up checks: browser refresh preserved both profile and flight in simulated provider; mobile menu and map usable with bottom panel closed. Route geometry tests passed for both Pacific directions and date-line crossings. Actual local server restarted.

## 2026-10-07 — Left navigation and full-page sections
- AI assistance: moved the menu to a persistent left rail and added a Map home button. Memories, Flights, and Profile now fill the workspace instead of the map sidebar.
- Reused the existing editors in a separate page container to keep this plain-JavaScript project manageable. Location details still open beside the map.
- Added active-page labels, heading focus, unsaved-change protection, and a View route on map action.
- Validation: JavaScript syntax check and desktop browser navigation with a simulated account; full-page Memories/Flights/Profile and return to Map verified. Live backend isolation was not re-tested for this layout change.

## 2026-10-07 — Boarding pass polish
AI assistance: designed an original pale-blue souvenir ticket with clear route/details, a red Feilou stamp, decorative barcode and perforated stub, inspired by the supplied illustration. Smaller screens stack the stub beneath the ticket. Flight forms and list cards share the palette. No database changes. Verified JavaScript syntax and desktop rendering with sample flight data; mobile styling added but not visually tested.

## 2026-10-07 — Pin photo previews
AI assistance: added lazy-loaded private photo tooltips on pin hover and keyboard focus, with loading/error states. New server-generated photo paths include upload milliseconds, avoiding a database migration and correctly ranking photos added to older entries. Existing UUID-only photos remain supported; their order uses entry creation time because past upload timestamps were not recorded. Photo-selection checks and account tests run; hover appearance not browser-tested this turn. Restart Python after updating.

## 2026-10-07 — Account welcome
AI assistance: replaced automatic search popup with the sign-in/create-account dialog after the session check. Existing sessions skip the dialog. Successful authentication now returns to the map. Search remains available through Search places. Verified signed-out initial dialog and switching to Create account in browser; JavaScript syntax passed.

## 2026-10-07 — Memories gallery
AI assistance: replaced plain memory links with a responsive postcard gallery, uploaded photo covers, counts, date/location icons, note excerpts and place/photo summary. Kept newest travel dates first and existing location detail navigation. Covers load lazily through the private photo endpoint; no-photo/error covers have decorative artwork. Verified JS syntax and desktop rendering with sample memories and a synthetic cover image; real account photo access and mobile layout were not re-tested.

## 2026-10-07 — Illustrated world view
AI assistance: added a local simplified atlas derived from the existing world.json outlines, pastel regional colors, continent/ocean labels, a grid and compass. Decorative polygons never intercept pin/map clicks. Zoom levels 1–4 use the atlas; closer views restore the existing detailed tiles. Three world copies support panning across the date line. If the asset fails, the regular map remains available. Verified desktop rendering and switching to detailed tiles at zoom 5. Mobile appearance was not separately tested.

## 2026-10-07 — Mobile layout and scrapbook finishing
AI assistance: made the left menu a collapsible drawer on phones, gave page content the full width, enlarged touch targets and input text, and constrained scrollable dialogs. Added washi tape, real second-photo stacks, chronological month sections, passport-style memory/place/photo/flight totals, and checkmarked save messages. Preserved empty states. Verified phone sign-in and drawer; sample gallery at 390px had no horizontal overflow. Desktop sample rendering checked. Live account saves were not re-tested for these visual changes.

## 2026-10-07 — Animal profile characters
AI assistance: added an accessible native radio picker with 12 animal emoji, a large selected preview, and a clickable avatar above the username in the header. Added server allowlist validation and an additive profile-avatar.sql migration; existing profile RLS protects this field. Avatar restores via the authenticated profile endpoint. Four simulated menu tests passed, including every avatar choice, persistence, invalid choice rejection and owner isolation. Live SQL migration and browser interaction remain unverified.

## 2026-10-07 — Header avatar synchronization fix
AI assistance: animal selection now previews immediately in both picker and header. Saving commits the choice; confirmed discard restores the saved character. Version checks prevent delayed profile loading from overwriting a new selection. JavaScript checks verified immediate update, stale-response protection, and discard rollback. Live persistence still depends on the profile-avatar SQL migration.

## 2026-10-07 — Avatar save regression
The existing Python process predated avatar support; static frontend edits were live but backend code was not reloaded. Restarted the local server. Frontend now rejects a save response whose avatar differs from the submitted choice rather than silently replacing it with bunny. Four simulated menu tests passed. User-account live save remains to be confirmed.
