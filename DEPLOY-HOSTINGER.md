# Deploying J.H.M. Filling Station to Hostinger

This is the whole path from the zip on your machine to the manager signing in
from the forecourt. Read the first section before you buy anything — the plan
you pick decides which of the two paths below you follow.

---

## What you are actually deploying

Two halves, and only one of them goes to Hostinger.

| Half | Where it lives | What it holds |
|---|---|---|
| The database | **Supabase** (already running) | every number: dips, meter readings, shifts, the ledger, the audit log |
| The app | **Hostinger** | the screens, the API routes, the reports, the chat |

Supabase is already hosted and already carries the schema, the accounts and the
data. Nothing in this guide moves it. Hostinger runs the Next.js app, and the
app talks to Supabase over HTTPS.

That split matters for a reason worth stating plainly: **if Hostinger goes down
you lose the screens, not the money.** The records are in Postgres, with the
audit log, and they are still there when the app comes back.

### What the app needs from a host

- **Node.js 20 or newer** (22.x recommended). Next 15 will not run on 18.
- **A persistent process.** This is a server-rendered app — middleware checks
  every request, pages are rendered per request, and API routes run on demand.
  A host that only serves static files cannot run it.
- **About 1 GB of RAM to build.** The build compiles 34 routes.
- **Outbound HTTPS**, so the app can reach Supabase.
- **A scheduled job every few minutes** — see [The cron](#the-cron) below. Only
  needed once n8n is wired up.

---

## Which Hostinger plan

| Plan | Runs this app? | Which path |
|---|---|---|
| Single / Premium web hosting | **No** — no Node.js app support | — |
| **Business web hosting** | Yes | [Path A](#path-a--business-or-cloud-hosting) |
| **Cloud Startup / Professional / Enterprise** | Yes | [Path A](#path-a--business-or-cloud-hosting) |
| **VPS** (KVM 1 and up) | Yes | [Path B](#path-b--vps) |

Hostinger's Business and Cloud plans include a Node.js web app feature with a
Next.js preset: you give it the project, it runs the build, and it keeps the
process alive with a Restart button. That is Path A and it is the easier one.

**The one thing Path A cannot do is run a command by hand.** There is no SSH
`npm run …` on Business or Cloud. That is fine here — every script you need
(`seed`, `verify:rls`, the checks) talks to Supabase, not to the web host, so
you run them from your own laptop and they work identically. But if you want a
terminal on the server, you want a VPS.

Take a VPS if you want root, Docker, your own cron syntax, or you expect to run
other things on the same box. Otherwise take Business or Cloud.

---

## Before either path

Do these once, on your own machine, in the project folder.

### 1. Check the build

```bash
npm install
npm run build
```

It must end with the route table and no error. If it fails here it will fail on
Hostinger too, and the error is much easier to read locally.

### 2. Have your environment values to hand

Open `.env.local`. You will paste these into Hostinger's dashboard, one at a
time. They are not in the zip — `.env.local` is deliberately excluded, because
it carries keys and passwords and a zip gets forwarded.

If you do not have `.env.local`, copy `.env.example` and fill it from the
Supabase dashboard (Project settings → API).

### 3. Decide what to do about the demo day

The database currently holds a **demo trading day** and four `@jhm.test`
accounts, both used to prove the reports. See `docs/demo-day.md`. Decide before
go-live whether the deployment points at this project or at a clean one — a
real Daily Sheet with demo rows on it is worse than no Daily Sheet.

---

## Path A — Business or Cloud hosting

### A1. Prepare the upload

Hostinger builds the project itself, so the zip must **not** contain
`node_modules` or `.next`. The zip you were given is already like this:
`package.json` sits at the **root of the archive**, not inside a wrapper
folder, which is what every Node platform expects to find. If you are making
your own:

```bash
zip -r jhm-app.zip . -x "node_modules/*" ".next/*" ".git/*" ".env.local"
```

### A2. Create the Node.js app

In hPanel:

1. **Websites → your domain → Dashboard**.
2. Find the **Node.js** / **Web apps** section and create a new application.
3. Choose how the code arrives:
   - **Upload a .zip** — simplest, and what the file you have is for.
   - **GitHub repository** — better if you will keep changing it, because every
     push rebuilds. Push this folder to a private repo first, with a
     `.gitignore` that excludes `.env.local` (the one in the project already
     does).

### A3. Fill in the settings

| Field | Value |
|---|---|
| Framework | **Next.js** (let it auto-detect if it offers to) |
| Node.js version | **22.x** |
| Build command | `npm run build` |
| Start command | `npm start` |
| Output directory | `.next` |
| Entry file | leave as the framework default — Next has its own server |

Do not set a custom port. The platform supplies `PORT` and `next start` uses it.

### A4. Environment variables

Add each of these in the application's **Environment Variables** panel, then
restart the app. Values come from your `.env.local`.

| Variable | Needed for | If it is missing |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | everything | the app will not start |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | everything | the app will not start |
| `SUPABASE_SERVICE_ROLE_KEY` | the n8n inbound routes, the queue drain | those refuse with `503`; the app is otherwise fine |
| `ANTHROPIC_API_KEY` | reading meter photos | the capture screen falls back to typing the reading |
| `ANTHROPIC_MODEL` | — | defaults to `claude-sonnet-4-5` |
| `OPENAI_API_KEY` | the chat assistant | the panel says it cannot answer yet, and still records the question |
| `OPENAI_MODEL` | — | defaults to `gpt-4o-mini` |
| `OPENAI_TRANSCRIBE_MODEL` | Bangla speech where the browser has none | defaults to `whisper-1` |
| `N8N_EVENT_WEBHOOK` | mirroring events to Google Sheets | the queue fills and nothing is lost |
| `N8N_INBOUND_SECRET` | `/api/n8n/chat`, `/api/n8n/command` | **those routes stay closed**, which is the safe default |
| `NEXT_PUBLIC_N8N_CHAT_WEBHOOK` | routing chat through n8n | unused by default |
| `N8N_TRANSCRIBE_WEBHOOK` | voice through n8n rather than OpenAI | falls back to OpenAI |
| `SYNC_DRAIN_SECRET` | the cron below | falls back to `N8N_INBOUND_SECRET` |

**Only the two `NEXT_PUBLIC_` values reach the browser.** Everything else is
read server-side only. Never add that prefix to a key — it would be compiled
into the JavaScript every phone downloads.

The `SEED_*` and `STATION_*` variables in `.env.local` are for scripts on your
laptop. They have no business in the Hostinger panel.

### A5. Point the domain at it

Attach your domain or subdomain to the application, and let Hostinger issue the
free SSL certificate. **HTTPS is not optional here** — the service worker will
not register without it, so the app will not install to a home screen, and the
camera on the meter-reading screen will not open.

Then jump to [After either path](#after-either-path).

---

## Path B — VPS

Ubuntu 22.04 or 24.04, as root over SSH.

### B1. Node, a process manager, a web server

```bash
apt update && apt install -y curl nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
npm install -g pm2
```

### B2. The app

```bash
mkdir -p /var/www/jhm && cd /var/www/jhm
# upload and unzip the project here, or: git clone <your private repo> .
npm ci
```

Create `/var/www/jhm/.env.local` with the variables from the table in
[A4](#a4-environment-variables) — same names, same meanings.

```bash
npm run build
pm2 start npm --name jhm -- start
pm2 save
pm2 startup          # run the line it prints, so it survives a reboot
```

`next start` listens on 3000 unless `PORT` says otherwise.

### B3. Nginx in front

`/etc/nginx/sites-available/jhm`:

```nginx
server {
    listen 80;
    server_name jhm.example.com;

    # Meter photos are uploaded from the forecourt. The default 1 MB is not
    # enough for a phone camera.
    client_max_body_size 12M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

`X-Forwarded-For` is not decoration: the audit log records the IP of whoever
made each write, and without that header every row in the log says the same
thing.

```bash
ln -s /etc/nginx/sites-available/jhm /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
apt install -y certbot python3-certbot-nginx
certbot --nginx -d jhm.example.com
```

### B4. Deploying a change later

```bash
cd /var/www/jhm && git pull && npm ci && npm run build && pm2 reload jhm
```

---

## After either path

### The cron

On Vercel, `vercel.json` scheduled `GET /api/sync/drain` every five minutes.
**Hostinger does not read `vercel.json`**, so that job has to be recreated or
the outbound queue to n8n and Google Sheets never empties.

Nothing about the station's own records depends on it — the queue holds events
with backoff and loses nothing — but the Sheets mirror goes stale.

**Business / Cloud:** hPanel → **Advanced → Cron Jobs**, every 5 minutes:

```bash
curl -s -H "Authorization: Bearer YOUR_SYNC_DRAIN_SECRET" https://your-domain/api/sync/drain
```

**VPS:** `crontab -e`

```
*/5 * * * * curl -s -H "Authorization: Bearer YOUR_SYNC_DRAIN_SECRET" https://your-domain/api/sync/drain
```

It is safe to run twice at once — the queue claims rows `FOR UPDATE SKIP
LOCKED` — and safe to miss.

### Check the deployment

From your own machine, against the live URL:

```bash
npm run check:accounts -- https://your-domain
```

```bash
npm run check:render -- https://your-domain
```

```bash
npm run check:reports -- https://your-domain
```

Then open the site on a phone and confirm:

- the login page loads over **https**
- signing in as the manager lands on `/manager`
- the browser offers **Add to Home Screen**
- turning off mobile data and reloading shows the offline page, not an error

### The accounts

Four accounts exist already. **Change every password below on first sign-in** —
they were written down in order to be handed to you, which is exactly what a
password should never be.

| Role | Email | Starting password | Lands on |
|---|---|---|---|
| Admin / Owner | `onik820@gmail.com` | (the one you chose) | `/admin` |
| Managing Director | `md@jhmfilling.com` | `JhmStation-MD-2026` | `/md` |
| Station Manager | `manager@jhmfilling.com` | `JhmStation-Manager-2026` | `/manager` |
| Employee | `employee@jhmfilling.com` | `JhmStation-Employee-2026` | `/dispenser` |

The four `@jhm.test` accounts are development fixtures used by
`npm run verify:rls`. Switch them off from **People** before go-live.

### Adding the real staff

The admin does not create accounts by hand any more, and does not choose
anyone's password.

1. Sign in as the admin and open **People** (`/people`).
2. **Invite someone** — name, email, and whether they are a manager or an
   employee. Pick how many days the link should live; 7 is the default.
3. The link appears **once**. Copy it and send it to them.
4. They open it on their own phone, choose their own password, and land on
   their own dashboard.

Things worth knowing about that flow:

- An invitation can only ever make a **manager or an employee**. An admin or MD
  account is created deliberately, never by whoever is holding a URL.
- The link is single-use and expires. A spent, cancelled or wrong link shows
  nothing at all — not even that it once existed.
- The admin never learns the password. Only its owner does.
- Someone who leaves is **switched off**, not deleted. Their name is on months
  of shift closes and ledger rows and those have to keep pointing somewhere.

### Two Supabase settings that are not in code

- **Enable leaked-password protection** — Supabase dashboard, Authentication →
  Policies. The security advisor flags this until you do, and it is the single
  cheapest thing on this page.
- **Review the SECURITY DEFINER functions** the linter reports. All of them are
  deliberate and each carries a comment saying why; migrations `0012`, `0022`
  and `0033` are the written record.

---

## When something is wrong

| What you see | What it usually is |
|---|---|
| Build fails on Hostinger, works locally | Node version is 18. Set it to 22.x. |
| Every page redirects to `/login` and login fails | `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` is missing or has a stray space. |
| "Database error querying schema" on sign-in | An account was created by hand with NULL token columns in `auth.users`. See the note in `README.md`; `provision_account()` gets this right. |
| Signed in, then bounced straight back to `/login` | The account has no active profile, or it was switched off. Check **People**. |
| No **Add to Home Screen**, no camera | The site is on http. The service worker needs https. |
| Chat says it cannot answer | `OPENAI_API_KEY` is unset. The question is still recorded. |
| Nothing reaches Google Sheets | `N8N_EVENT_WEBHOOK` is unset, or the cron above was never created. |
| Meter photo upload fails on VPS only | `client_max_body_size` in nginx. |
| Every audit row has the same IP | `X-Forwarded-For` is not being passed through the proxy. |

---

## What this guide does not cover

Moving the **database**. Supabase stays where it is. If you ever want the
Postgres on a Hostinger VPS too, that is a different job: the app leans on
Supabase Auth, Storage, Realtime and RLS, not only on Postgres, and replacing
those is a rewrite rather than a migration.
