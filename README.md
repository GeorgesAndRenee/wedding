# Ava & Noah — Wedding Photo Share

A static site (HTML/CSS/JS, no PHP, no backend of your own) where guests
enter their name, drop in photos, and see them appear in a live gallery.
Storage and the guest/photo records live in **Supabase** — a free,
hosted Postgres database + file storage service — so the whole thing can
be hosted for free on GitHub Pages (or Netlify, Vercel, Cloudflare
Pages, etc.).

## 1. Why Supabase (and not Firebase)

You asked for a way to skip PHP and use an external database with a free
host. The two usual candidates are Firebase and Supabase:

- **Firebase** used to have a free Storage tier, but as of late 2024
  Google requires the paid **Blaze** plan (a credit card on file) to use
  Firebase Storage at all — even if your actual usage costs $0. Firestore
  (the database part) is still free on its own, but you'd need Blaze
  just to store the photo files.
- **Supabase** gives you a genuinely free plan with **no credit card
  required**: a Postgres database, file storage, and realtime updates,
  all usable straight from client-side JavaScript. That's what this
  project uses.

The trade-off: a free Supabase project **pauses itself after 7 days of
inactivity** (a click in the dashboard un-pauses it instantly, no data
is lost). For a wedding, just open the dashboard the day before to make
sure it's awake — visits/uploads keep it active.

If you'd rather not manage a database at all and only need "upload a
photo, get a URL back" (no guest name, no live gallery), **Cloudinary**
is a good free alternative — it hosts images directly from the browser
with no backend, but you'd lose the guest-name gallery feature this
site has, since listing photos back securely really wants a small
database behind it.

## 2. Create your Supabase project

1. Go to [supabase.com](https://supabase.com) and sign up (no card
   needed for the free plan).
2. Create a new project. Pick any name/region and set a database
   password (you won't need it for this site, but keep it somewhere
   safe).
3. Once the project is ready, open **Project Settings → API**. You'll
   need two values from this page in a minute:
   - **Project URL**
   - **anon public** key

## 3. Create the database table

Open the **SQL Editor** in the Supabase dashboard, paste this in, and
run it:

```sql
create table photos (
  id uuid primary key default gen_random_uuid(),
  guest_name text not null,
  url text not null,
  storage_path text not null,
  created_at timestamptz not null default now()
);

alter table photos enable row level security;

-- Anyone with the link can see the gallery
create policy "Anyone can view photos"
on photos for select
to anon
using (true);

-- Anyone with the link can add a photo record
create policy "Anyone can add a photo"
on photos for insert
to anon
with check (true);
```

This is the same idea as MySQL's `GRANT`, just expressed as row-level
policies: the `anon` key is meant to be public, and these two policies
are what actually decide what it's allowed to do.

## 4. Create the storage bucket

1. In the dashboard, go to **Storage** → **Create a new bucket**.
2. Name it exactly `wedding-photos` (or change `BUCKET` in `app.js` to
   match whatever you pick).
3. Toggle it **Public** — this lets uploaded photos be viewed by URL in
   the gallery.
4. While you're there, it's worth setting a **file size limit** (e.g.
   15 MB) and restricting **allowed MIME types** to `image/*` on the
   bucket itself, so those limits are enforced by Supabase and not just
   by the browser.

Then, back in the **SQL Editor**, add policies so guests can upload:

```sql
create policy "Public read access to wedding photos"
on storage.objects for select
to anon
using ( bucket_id = 'wedding-photos' );

create policy "Anyone can upload wedding photos"
on storage.objects for insert
to anon
with check ( bucket_id = 'wedding-photos' );
```

## 5. Plug your keys into the site

Open `app.js` and edit the top two lines:

```js
const SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
const SUPABASE_ANON_KEY = "YOUR-PUBLIC-ANON-KEY";
```

Paste in the **Project URL** and **anon public** key from step 2. It's
fine that these end up visible in your site's source — that's how
Supabase (and Firebase) are designed to work; the RLS policies above
are what actually enforce access, not secrecy of this key.

## 6. Try it locally

Since the JavaScript uses `fetch` under the hood, opening `index.html`
directly by double-clicking it can hit browser restrictions. Easiest
fix: run a tiny local server from inside the project folder, e.g.

```bash
php -S localhost:8000
```

(or `npx serve`, or VS Code's "Live Server" extension), then visit
`http://localhost:8000`.

## 7. Deploy for free on GitHub Pages

1. Create a new GitHub repository and push these files (`index.html`,
   `style.css`, `app.js`) to it.
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to "Deploy from a
   branch," pick your default branch (e.g. `main`) and the `/ (root)`
   folder.
4. Save — GitHub gives you a URL like
   `https://yourusername.github.io/your-repo-name/` within a minute or
   two.

That link is what you share with guests — it works well as a QR code on
table cards or a wedding-website page, so people can scan and upload
without typing anything.

## 8. Customize

- Names, date, and copy: edit the text directly in `index.html`
  (search for "Ava" and "Noah").
- Colors and type: all in the `:root` block at the top of `style.css`.
- Per-upload limits (`MAX_FILES_PER_BATCH`, `MAX_FILE_SIZE_MB`): top of
  `app.js`.

## 9. A note on access

Anyone with the link can view and upload to the gallery — there's no
login. That's normal for this kind of shared album (same model as an
unlisted Google Photos link) and keeps things frictionless for guests,
but it also means the link itself is the only gate. Don't post it
publicly beyond your invitations if you'd rather keep it to your guest
list.
