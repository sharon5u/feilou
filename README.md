# 飞喽 (Fly) — Travel journal

Feilou (fly) is an interactive travel journal that allows users to record memories on a world map. Users can create an account, upload travel photos, record flights, and customize their profile. The frontend uses HTML, CSS, JavaScript, and Leaflet. A Python backend connects the app to Supabase for authentication and data storage.

Live website: https://feilou.onrender.com
Source code: https://github.com/sharon5u/feilou

## How to use 飞喽 (Fly)

1. Open the website and create an account or sign in.
2. Search for a place or select a location on the map to add a memory and photos.
3. Open **Memories** to browse your entries from newest to oldest.
4. Open **Flight tracker** to enter flight information using the boarding-pass form and display routes on the map.
5. Open **View profile** to edit your personal information and choose an animal character. 

## Features I am most proud of

- The function to search for specific locations such as Carnegie Mellon on the map. 
- Flight tracking: can visualize your travels around the world with the boarding-pass design. 


## Running locally (AI assisted with writing this section)

You need Python 3 and a configured Supabase project.
Clone the repository and enter its folder:

    git clone https://github.com/sharon5u/feilou.git
    cd feilou

Create and activate a virtual environment on macOS/Linux:

    python3 -m venv .venv
    source .venv/bin/activate

Install dependencies:

    pip install -r requirements.txt

Copy the environment template:

    cp .env.example .env

Replace the placeholders in `.env` with your project's values:

    SUPABASE_URL=https://YOUR_PROJECT.supabase.co
    SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
    APP_ORIGIN=http://127.0.0.1:4173

Follow `SETUP.md` to configure Supabase and apply the SQL setup files.

Start the server:

    python3 server.py

Open http://127.0.0.1:4173 in your browser.

## Secrets and user data

Local configuration is stored in `.env`, which is excluded from Git. `.env.example` contains placeholders only. The local `.private/` directory and `dist/config.js` are also excluded.

For deployment, configuration is supplied through Render environment variables. Private credentials must not be committed to GitHub.

The backend uses Supabase authentication and database access policies to keep each account's records separate. Supabase secret or service-role keys must never be placed in browser code.


## AI Use

I used Codex to help develop and debug the application, including frontend layouts, Python backend integration, and Supabase setup. I also used AI assistance to iterate on the map styling, boarding-pass design, responsive layout, and profile features.

[Add the exact other tools/models you used, if any.]

## Models, Tools
1. LeafLet: a free, open-source JavaScript library for building interactive maps. It handles dragging and zooming the map, placing pins at saved locations, showing photos, and drawing flight routes and airplane marks.
2. OpenStreetMap: provides the geographic map data.
3. Supabase: authentication and data storage.
