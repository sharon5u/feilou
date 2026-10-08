# Connect accounts and private storage

The account code is implemented, but real sign-up and cloud saves require your own Supabase project. No project or credentials have been created for you. Never paste a key into chat or put it in `dist/`.

## 1. Create the managed backend

1. Create a project at https://supabase.com/dashboard. Keep its database password private.
2. Open **SQL Editor**, paste `supabase/setup.sql`, and run it. Use a new project: the script assumes there are no other broad policies granting access to these tables/bucket.
3. 
4. Check that `entries` has RLS enabled and four owner-only policies. Check Storage → `journal-photos` is **private**, with the 5 MB and image-type restrictions.
5. Get the project URL and **publishable key** from the project's Connect/API settings. Use a publishable key, NOT a secret or service-role key. Service-role credentials bypass the ownership rules.

## 2. Enable username signup without verification

In Supabase → Authentication → Sign In / Providers → Email, turn **Confirm email OFF** and save. Keep the Email password provider and new-user signups enabled. Some dashboard versions put Confirm email under the User Signups section on the same page. No custom SMTP or email template is needed for this flow.

The app takes a case-insensitive username (3–32 ASCII letters, digits, underscores or hyphens) plus a password of at least 8 characters. Python maps the username to an internal, non-deliverable alias such as `u-traveler@users.feilou.invalid` because Supabase's password provider expects an email identifier. That alias is an account identifier, not a real mailbox. Supabase hashes and verifies the password; the app does not store passwords in its journal table. Do not change the alias mapping after people create accounts.

Signup checks Supabase's confirmation setting before creating the account. With confirmation disabled, signup returns a session and signs the user in immediately. No code or email is required. Duplicate usernames are rejected by Supabase's unique identity constraint.

Existing email accounts can still sign in with their email address in the Username field. Previously unconfirmed accounts may need administrator confirmation; new username accounts are separate identities and will not inherit an old email account's memories. No accounts or memories are deleted or reassigned by this update.

Password recovery by email is not available for these username-only accounts. Remember the password; a recovery feature would require a separate design.

## 3. Set up your VS Code terminal

From the `feilou` folder:

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Edit `.env` locally:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
APP_ORIGIN=http://127.0.0.1:4173
```

Then run:

```sh
python3 server.py
```

Open **http://127.0.0.1:4173/**. The origin must match `APP_ORIGIN` exactly; `localhost` is a different origin. Restart Python after changing configuration. If an old server is running, stop it with Ctrl+C first. Live Server and `python -m http.server` do not run the backend.

## 4. Verify with two accounts before publishing

Use a normal browser for account A and an incognito window for account B.

- Create username account A and sign in. Find a place; save a title, note, date, and a small PNG/JPG/WebP. Confirm the success message and pin.
- Refresh and reopen the pin. The text and photo should still appear. Edit the note, remove/add a photo, refresh again.
- Copy A's photo URL from the image and A's entry ID from the `/api/entries` Network response.
- Sign into B. A's memories must not appear. Opening A's photo URL in B must return 404; signed out it must return 401. A's entry ID must not allow B to edit/delete it (404).
- Create B's own memory. Switch back to A: only A's entry appears.
- Sign out of A: the list, pins and photos clear. Opening its private photo URL must fail. Sign back in: its memories return.
- Delete a test memory after confirming the dialog. Verify it stays deleted after refresh and its photo object is removed from Storage.
- Try a fake image, a file above 5 MB, and five photos. They must be rejected.
- Separately verify Supabase's RLS directly, as described below. Passing server tests alone does not prove deployed policies.

### Direct database RLS check (SQL Editor, test accounts only)

After creating an A memory, substitute the real **B user UUID** below. Run all statements together. The query must return only B's rows; changing A's row must affect zero rows. `rollback` prevents test changes from persisting. This checks database policies under the authenticated role rather than the SQL editor's administrator role.

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"B_USER_UUID","role":"authenticated"}', true);
select id, user_id from public.entries;
update public.entries set title = 'RLS check' where id = 'A_ENTRY_UUID';
select name from storage.objects where bucket_id = 'journal-photos';
rollback;
```

Also test INSERT with a different `user_id` in a separate rolled-back transaction: it must fail RLS. Never change policies to make these unauthorized operations succeed.

## 5. Publish the Python app

Use a Python web host (for example a Render Web Service), not GitHub Pages. Configure:

```text
Build: pip install -r requirements.txt
Start: gunicorn --workers 1 --threads 4 --timeout 150 --bind 0.0.0.0:$PORT server:app
```

Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `APP_ORIGIN=https://YOUR_ACTUAL_DOMAIN` in the host's private environment settings. Update Supabase's Site URL too. HTTPS makes the session cookie Secure. Do not upload `.env`, `.private`, or old `dist/config.js`. Maintain one process/instance for the existing shared Nominatim rate gate.

Entry/photo persistence is in Supabase. Local session storage is `.private/sessions.sqlite3`; losing the host's filesystem signs people out but does not delete their memories. The private directory must be writable. The default is suitable for one instance only.

## Limits and known omissions

- Sessions expire after at most one hour; users sign in again. Automatic refresh and password-reset/account-deletion UI are not implemented in this student version.
- Lists currently retrieve the latest 1,000 entries per account. No multi-device live updates; refresh or My memories reloads current data.
- Four photos, 5 MB each, 40 megapixels max; server validates decoded content. Photos remain private but original EXIF metadata is retained.
- A network timeout after a write can have an uncertain outcome. Refresh before retrying a save to avoid duplicates. Failed saves/cleanup can leave private orphan photos; inspect Storage before manually removing objects not referenced in `entries.photos`. Automatic reconciliation is not implemented.
- Existing IndexedDB memories are untouched but not displayed/imported into accounts. There is no automatic migration to avoid assigning another person's local memories to the wrong account.
- Offline tests simulate Supabase. Real account creation, live RLS, live uploads and production deployment remain unverified until these setup steps and checks are completed.
- This is a student-project starting point, not a complete production account system. Rate limiting, backups and quotas need ongoing management for public traffic.

## Service references and free-tier planning

Supabase documents a Free allowance of 500 MB database space and 1 GB storage; photos can consume storage quickly. Review current quotas, egress, email and inactivity limits in your project before publishing. No paid service was enabled by this change.

- https://supabase.com/docs/guides/platform/billing-on-supabase
- https://supabase.com/docs/guides/auth/passwords
- https://supabase.com/docs/guides/auth/auth-smtp
- https://supabase.com/docs/guides/getting-started/api-keys
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/storage/security/access-control


## Menu features: database update and checks

If your app was already configured before the menu update, open `supabase/menu-features.sql` in VS Code, copy its **contents**, paste into Supabase SQL Editor, and Run. Do not paste the filename. This only adds private `flights` and `profiles` tables/policies; your existing journal entries remain unchanged. No new API keys are needed.

- **Memories:** saved entries are sorted by travel date, newest first.
- **Flight tracker:** manually enter flight number, airline, date and seat. For both From and To, type an airport/city, press Find place, then select a result. Save to show a curved route and airplane. Edit or delete from the boarding-pass card. The route is illustrative, not the actual flown path or a live flight feed. Boarding-pass image scanning and flight-number lookup are not included.
- **View profile:** view/edit name, birthday, hometown, country/region and bio. Everything is optional and private to the signed-in account.
- Search requests still use the same shared Nominatim rate limit; if a search is busy, wait and press Find place again. No typing autocomplete is used.
- Lists retrieve up to 1,000 records. On refresh, flights reload onto the map. Profile details load when opening View profile.

Live checklist: save a flight/profile; refresh and reopen both; edit; check another account cannot see either; delete a test flight and check the line disappears. Inspect RLS with the authenticated-role test above using `public.flights` and `public.profiles`. The offline tests use a simulated provider, so these live checks remain necessary after running the migration.

### Animal profile characters
Run the contents of `supabase/profile-avatar.sql` in the Supabase SQL Editor after `menu-features.sql`, then restart `python3 server.py`. Profile now offers 12 animal emoji characters. Select one and click Save profile. The choice is stored in the owner-protected profiles table and restored in the header on sign-in/refresh. Emoji appearance depends on the device.
