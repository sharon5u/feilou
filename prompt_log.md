It must list which AI model(s)/tools you used, document the development process from start to finish 
(including which parts of the code were written or substantially modified by you), and include important, 
non-trivial prompts verbatim rather than AI-written summaries of them. As a whole, this file should make it 
obvious that you invested roughly 8 hours of work. As a very rough gauge, an 8-hour project that starts from a 
clear plan and then iterates from there might produce somewhere in the range of 15 to 40 prompts worth logging. 
Treat that as a rough estimate rather than a target, since we'd rather have a handful of well-constructed prompts over an artificially stretched list.
Two specific things we want to see in this file:

Which tool for which job. A sentence or two on which model(s) or tool(s) you used for which parts of the work, and why. 
Brainstorming, writing code, and debugging are often best served by different tools, and choosing deliberately is a skill we want you practicing.
One place AI got it wrong. Describe at least one instance where a tool was confidently incorrect, proposed something that couldn't work, or introduced 
a bug it then couldn't find, and what you did about it. One short paragraph is plenty. These observations are what we use to build the class's shared
best practices, and they tend to make for good discussion in your evaluation.

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
I changed from google maps API to 
I then made edits to the design by asking CodeX:
- Here the text box is blocking the map, give user the option to search at first, presenting the big text box while the background is darker.
The user can also click anywhere else to enter the map and drag to pin by themselves.
- Updated the local preview:
Large search card opens over a darkened map.
Click outside, press Escape, or choose Explore the map to dismiss it.
Drag the map, then tap a location to place a pin.
A small Search places button reopens search.
