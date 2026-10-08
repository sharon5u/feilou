## Brainstorming stage
I came up with the idea of a travel journal and then divided the high level idea into small parts. 
## First draft
I asked Claude and CodeX to generate a first version of my app and discovered that CodeX was better with UI and design, as well as the level of complexity for a first draft. I used the same prompt: 
"
Help me build “Places I’ve Kept,” a travel journal web app for a student project. I have approximately 8 hours of focused development time, so keep it simple, polished, and easy for me to understand and explain.
Main experience
The opening screen is an interactive world map. Users click a spot to drop a pin, type the place name, and add a memory with a written note and photos. Clicking a saved pin opens its memories.
Technology

Use Google Maps JavaScript API for the map, zooming, and clickable pins.
Do not use Google Places API or a geocoding API. Users manually enter place names; coordinates come from where they click.
Use Supabase for authentication, a database for journal entries, and private photo storage.
Choose a simple frontend stack with minimal dependencies.
Essential features

Accounts: Sign up, log in, and log out.
World map: Pan, zoom, and click to select a location.
Add a memory: Enter a place name, title, travel date, note, and optional photos. Preview photos before saving.
View memories: Display saved locations as pins. Clicking a pin opens a journal panel. Allow multiple entries at the same location.
Edit and delete: Update memories or delete them with confirmation.
Persistence: Saved entries and photos remain available after refreshing or logging back in.
Design
Use a warm digital-scrapbook style with cream backgrounds, muted accents, readable typography, and simple photo borders. Let the map fill the main screen, with a journal panel on desktop and a mobile-friendly panel on smaller screens.
Include clear instructions for first-time users, accessible forms, and loading, empty, error, and save-success states.
Security and setup

Enforce database and photo-storage permissions so each user can access only their own memories.
Keep server secrets out of frontend code and source control.
Restrict the Google Maps browser API key to the intended websites and API.
Validate uploads and set reasonable image-size and file-type limits.
Explain Google Cloud billing setup, current API pricing, and Supabase setup before any paid step.
Provide an example environment file with placeholders and clear local-run instructions.
How to help me build
Start with a brief architecture and implementation plan, then build in small working stages. Prioritize this complete flow:
Log in → click the map → add a note and photo → save → reopen the memory.
Explain important code and decisions in plain language. Identify one meaningful feature I can implement or substantially modify myself, and keep a short development log of AI assistance, decisions, and what I learned.
Verify that memories persist, photos load, editing and deletion work, and two users cannot access each other’s data. Clearly identify anything incomplete or untested.
Leave location search, social sharing, AI-generated writing, flight paths, and other extras out of the first version. Build a first version that does not include API yet". 

From there, I used CodeX for the remaining working period. 

## Middle Stage
I changed from google maps API to Nominatim’s API for place searches without an API key. I wanted to try out a keyless API since I have used an API with a key for the previous assignment. 
-  OK, I want a keyless search but I also want the amount of details in the visual of my map compared to google maps, which option should I choose.
-  Choose Leaflet + OpenStreetMap for the map, with a keyless search service. That’s the best fit for your student project. You’ll get much more detail than the current country-outline map, including street-level views. It won’t exactly match Google’s business listings, satellite imagery, or Street View. Detail varies by location. Your cartoon panels and custom pins can remain. Leaflet
For search, Nominatim is a possible keyless option for a small, low-traffic project, but you must deliberately accept its usage policy:
Search only after clicking Find or pressing Enter—no live autocomplete.
Maximum one request per second across the whole app, not per visitor.
Identify the application, display attribution, cache repeated searches, and allow switching providers.
A small Python backend can enforce those limits and cache results without needing an API key.
OpenStreetMap’s public map tiles also require visible attribution, normal caching, and no bulk/offline downloads; availability isn’t guaranteed. Tile usage policy

I then made edits to the design by asking CodeX:

- Here the text box is blocking the map, give user the option to search at first, presenting the big text box while the background is darker.
The user can also click anywhere else to enter the map and drag to pin by themselves.
- Updated the local preview:
Large search card opens over a darkened map.
Click outside, press Escape, or choose Explore the map to dismiss it.
Drag the map, then tap a location to place a pin.
A small Search places button reopens search.
- OK, I want to add in a login-in function that stores each user's data separately, with a backend to do this
- For your project, adding login involves these steps:
1. Create the frontend form.
   Add Sign in and Create account options with username and password fields in HTML, styled with CSS.
2. Send requests to the backend.
   JavaScript reads the form and sends the credentials to a Python API endpoint using fetch() over HTTPS.
3. Connect the backend to Supabase Authentication.
   The backend reads Supabase configuration from environment variables. Supabase creates accounts and verifies passwords—your own database tables shouldn’t store plaintext passwords.
4. Establish a session.
   After successful authentication, the backend creates a session and sends an HttpOnly cookie so subsequent requests identify the signed-in user.
5. Protect personal data.
   Associate memories, flights, and profiles with the authenticated user’s ID. Backend checks and Supabase database policies restrict access to that user’s records.
6. Update the interface.
   Show the username, avatar, and Sign out button. Load that account’s saved data and display helpful login errors.
7. Implement logout and test.
   Invalidate the session when signing out. Test registration, incorrect passwords, persistence after refreshing, and separation between two accounts.
- can I use somethingelse other than supabase?
- Yes—Supabase is optional. You can keep your current map and design while replacing the backend.
Alternative	What it offers	Trade-off
Appwrite Cloud	Managed login, database, and private photo storage. Docs	Closest replacement; still requires a cloud project and permission setup.
Django + SQLite	Python backend with built-in user authentication and sessions. Docs	No external authentication provider, but we must implement ownership checks, private photo serving, and persistent hosting.

I originally wanted email verification as well, but involves too many privacy checks. 

- the user should receive an email directly with a code
- Yes—the user should receive a code in the email, then enter it in 飞喽. The app already supports this; Supabase’s email template needs changing.
1. Open Supabase → Authentication → Email Templates → Confirm sign up.
2. Replace the email body with:<h2>Welcome to 飞喽!</h2>
   <p>Your verification code is:</p>
   <h1>{{ .Token }}</h1>
   <p>Return to 飞喽 and enter this code under Confirm email.</p>
   <p>If you didn’t create an account, ignore this email.</p>
3. Click Save. Keep {{ .Token }} exactly as written—Supabase replaces it with the verification code. Supabase documentation
4. Under Authentication → URL Configuration, change Site URL to:http://127.0.0.1:4173
Then return to 飞喽. For an unconfirmed account, try Create an account again to request a fresh email, then enter its code under Confirm email.
The old email won’t change, and its expired link should no longer be used.
- I don't want to use email verification, I just need a simple sign up/create account if the username and password match in the user database

More design: 
- I want to create a menu bar that has serverla functions: 1. memories: allows user to browse their memories, which are sorted in chronological order from most recent. 2: Flight tracker: allows user to enter/fill in a boarding passes about their travels and the result will show as flight lines on the map with airplane icon. 3. view profile: views personal information such as birthday, name, where are you from, and more.

## AI Tools
I used CodeX for building the essential features and telling me the steps to edit in VS code. I switched back to ChatGPT mode for debugging. Throughout the beginning stages, I tried to move to Claude since I am more familiar, but I realized that CodeX is to some extent better at grasping the functions and how the features fit with the entire design. Also, CodeX is a little faster than Claude. 

## Where AI got wrong
AI was incorrect about how I wanted with the flight & boarding pass function. CodeX thought I wanted a boarding pass separate with the flight path, in which the two are not updated together. I later reinforced that the flight path should automatically appear on the map once the boarding pass is added in the flight tracking section. 


