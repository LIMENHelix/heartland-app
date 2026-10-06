# Heartland — patient retention system

**Live:** https://heartland-deploy.vercel.app

| Surface | Who | URL |
|---|---|---|
| **Coordinator console** | Coordinators and sales | `/` and `/console/` |
| **Patient app** (installable PWA) | Patients | `/app/` |
| **Pricing deck** | Sales (pre-existing, preserved) | `/pricing` |
| API + retention engine | — | `/api/*` |

It is a patient-facing app whose job is **communication with a patient coordinator**: a direct
line instead of texting, push alerts, articles and studies, and reminders about labs and
renewals. The console is the clinic side of that same line, plus a ranked list of who to call
today.

There is deliberately very little clinical content. No questionnaires, no diagnosis, no scores.

Deployed to Vercel project `heartland-deploy` under the **limen-helix** team, with a Neon
Postgres database (`Limen_Heartland_app`). Brand and clinical content come from
`HMH_BRAND_AND_CONTENT_SPEC.md`, harvested from heartlandmenshealth.com on 2026-07-30.

Demo sign-in: username `sample` / password `rejuv`.
**Change that password before anyone real uses this.**

---

## Read this before it touches a real patient

**1. This database stores PHI.** Patient names, phone numbers, what they are being treated
with, and every message you send them. That is Protected Health Information. It currently
runs on **Neon's free tier, which does not come with a BAA**, and Vercel only signs a BAA on
Enterprise. That is fine for the seeded demo patients, who are all invented. It is not fine
for real patient records. Settle the BAA question before loading real people.

**2. HIPAA treats marketing differently from treatment communication.** Refill reminders and
treatment communication are generally permitted. Promotional messaging generally requires
prior written authorisation. The console makes you label every message **treatment**,
**refill** or **promotional**, warns on promotional, and stores the label on every message so
it is auditable. It flags the question; it does not answer it. Get the answer from Promeniq.

**3. Nothing clinical goes in a push notification.** A lock screen is not a private place.
The payload is always generic ("A message from your care team"); real content stays behind
the patient's login. Do not "improve" this by putting the message title in the notification.

---

## Layout

```
public/app/        patient PWA          →  /app
public/console/    coordinator console  →  /
public/pricing/    the pricing deck     →  /pricing
api/index.js       all 22 API routes, one Vercel function
lib/db.js          Postgres + the retention engine
lib/push.js        Web Push (RFC 8188 / 8291 / 8292)
scripts/           dev server, migrate, seed
tools/             icon generator
vercel.json        routing and security headers
```

Only dependency is `pg`. Everything else is Node built-ins.

---

## Working on it

```
vercel link --project heartland-deploy --scope limen-helix   # once
vercel env pull .env.local                                   # once, and after env changes
npm install

npm run dev        # local server on :8080, against the SAME Neon database
npm run migrate    # apply schema (idempotent)
npm run seed       # demo data, refuses to run if patients already exist
npm run selftest   # verify Web Push crypto against the RFC 8291 vector
npm run icons      # regenerate PWA icons
vercel deploy --prod --yes
```

`npm run dev` talks to the production database, because there is only one. Be aware of that
before you experiment.

> The Vercel CLI defaults to the `vercel-spectrum` scope. Always pass
> `--scope limen-helix` for this project.

**Environment** (all injected by the Neon integration except the last two):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon pooled connection string. Required. |
| `HMH_VAPID_SUBJECT` | optional; contact `mailto:` in the VAPID JWT |
| `HMH_INSECURE_COOKIE` | **local only**, set automatically by `npm run dev`. Never set in production. |

VAPID keys are generated on first request and stored in the `settings` table, so they survive
redeploys. Generation is race-safe (first writer wins) because two cold-start lambdas
generating different keys would silently break every push subscription taken in between.
**Do not delete those rows** — it invalidates every existing subscription.

---

## How a patient gets set up

1. Coordinator opens the patient in the console and taps **Get app setup link**.
2. They text or read that link to the patient.
3. The patient opens it. The link is **single use** and expires in 30 days.
4. Exchanging it mints a separate device token, which is what the app authenticates with.
   The setup link is never the credential, so a link seen over someone's shoulder does not
   become permanent access to the record.
5. **On iPhone the patient must then tap Share, then Add to Home Screen.** Notifications do
   not work from a Safari tab. The app says so when it detects an uninstalled iPhone.

---

## Push notifications

Server-sent Web Push works on iOS 16.4+ **for Home-Screen-installed web apps**, and on
Android Chrome. Locally *scheduled* notifications work nowhere on iOS — there is no
Notification Triggers API. That is why every nudge is sent from the server.

`lib/push.js` implements the whole path on Node's built-in crypto, no dependencies:
**RFC 8188** (aes128gcm), **RFC 8291** (message encryption), **RFC 8292** (VAPID, ES256 with
raw r‖s signatures). It is verified byte-for-byte against the official test vector in
RFC 8291 §5 — `npm run selftest`. If that passes, the crypto interoperates. Do not swap it
for a library without a reason.

---

## What the coordinator enters, and what the app works out

The coordinator types four things once. Everything else is computed.

| Entered | Used for |
|---|---|
| **Start date** | the entire lab schedule, and the renewal date |
| **Date of birth** | identity when a patient calls |
| **Phone** | tap-to-call from the board and the inbox |
| **Agreement length** (12 / 24 / 36 months) | renewal date, measured from the start date |
| Add-ons of interest | a coordinator-only note. Patients never see it. |

### The lab schedule

The clinic's rule, entered once and computed forever:

> **8 weeks after the start date, then 4 weeks after that, then every 6 months.**

`labSchedule()` in `lib/db.js` returns the whole series; `labStatus()` returns the next one due
and the most recent one already past. Six-month steps use calendar months with end-of-month
clamping, so a start date of 31 August lands on 28 February rather than spilling into March.

The app cannot know whether a draw actually happened, so a date that has passed within the last
45 days shows as "labs were due" and prompts a call. After that it stops nagging and shows the
next one.

### Renewal

An explicit renewal date always wins. Otherwise it is the agreement length measured from the
start date. A 12-month agreement starting 15 January renews 15 January the next year.

### The retention board

Five signals, ranked, each with a plain sentence a coordinator can act on. It ranks who to
phone. It decides nothing clinical.

| Signal | Fires when |
|---|---|
| Medication running out | supply ends within 10 days, or has ended |
| **Labs** | a scheduled draw is within 14 days, or passed in the last 45 |
| Renewal due | within 14 days, or past |
| Time since last visit | 90+ days |
| Gone quiet in the app | 21+ days since last open |
| Pinned | always top |

Thresholds live in one place: `THRESHOLDS` in `lib/db.js`.

## The direct line

Two-way, and deliberately not SMS. A patient taps **Ask a question**; it lands in the console
under **Questions**, split into "waiting on you" and "answered". Answering sends a normal
message back, threaded to the question via `reply_to`, and pushes a notification.

Patients are told in the app that this is answered during clinic hours, not around the clock,
and that anything urgent is a phone call. The console repeats that to the coordinator.

---

## Design

The patient app follows heartlandmenshealth.com rather than inventing a look:

- **Deep navy `#21313B` ground**, as the site uses.
- **Terracotta is the call to action.** The site's own CTAs (Book Online, Request Appointment)
  are terracotta, not gold. Gold is for rules, labels and secondary actions.
- **Cream `#E5E4DA` cards** for what matters most, the way the site treats its location cards.
- **Centred uppercase headings between two gold rules**, the site's signature section device.
- **An arrow in a ring** on primary buttons, as the site does.
- Raleway 700/800 uppercase headings, PT Sans body.

There is no light mode. The app commits to the brand's navy.

One deliberate deviation: the site sets **white on `#C66B3D`, which is 3.77:1** and fails AA.
The app uses `#B85A2B`, the nearest step of the same hue that reaches 4.63:1. It is visually
almost identical and readable. Do not "correct" it back to the site's exact hex.

CSS animations interpolate *into* the element's normal style and use no `fill-mode`. If an
animation never runs the element is simply visible. Do not reintroduce
`animation: … both` with only a `from` keyframe — it renders the UI blank when the animation
does not start.

---

## Routing: these must stay redirects, not rewrites

`vercel.json` **redirects** `/`, `/console`, `/app` and `/pricing` to their trailing-slash
forms. Do not "simplify" them into rewrites.

Every page loads its CSS and JS with relative paths (`src="console.js"`). A rewrite serves the
HTML while leaving the URL as `/`, so the browser resolves that to `/console.js`, gets a 404,
and renders a **blank page**. A redirect changes the address bar to `/console/`, so relative
paths resolve to `/console/console.js`.

This bit once. Note that `curl /` returned `200` the whole time it was broken: the HTML was
fine, its assets were not. When verifying, load the URL a person would actually type and look
at the rendered page, not the status code of the document.

## Security decisions worth keeping

- **Setup link ≠ credential.** Single use, 30-day expiry, exchanged for a separate revocable
  device token (`patient_tokens`).
- **`X-Frame-Options: DENY`** everywhere. The console shows PHI and must not be frameable.
  (This is why it cannot be embedded in an iframe, including for screenshots.)
- **HSTS** one year, including subdomains. `X-Robots-Tag: noindex` on `/app` and `/console`.
- **Session cookie** `HttpOnly`, `SameSite=Strict`, `Secure`, 12-hour expiry.
- **Passwords** scrypt with a per-user salt, compared with `timingSafeEqual`.
- **Login does not reveal whether an account exists** — wrong email and wrong password return
  the same message.
- **TLS to Postgres is stated explicitly** (`rejectUnauthorized: true`) with `sslmode` stripped
  from the URL, because pg 8.13+ warns its implicit handling changes in a future major and the
  verification behaviour would shift silently on upgrade.
- **Article and message bodies are escaped, then paragraphed.** Coordinator input is never
  injected as raw HTML.
- The service worker **never caches `/api/`**.
- Dead push subscriptions (404/410) are deactivated automatically.

---

## Verified in production

- All routes 200; `/api/admin/board` 401s without a session; unknown API paths 404.
- Login rejects a wrong password, accepts the right one.
- Retention board ranks correctly across all four signals plus pinning, reading live from Neon.
- Coordinator sends → message lands in the patient's inbox → read receipt returns.
- A bad bearer token is rejected; a setup link cannot be used as one.
- VAPID public key is unchanged across a redeploy.
- The pricing deck still serves at `/pricing`.
- Push crypto reproduces the RFC 8291 §5 vector; VAPID ES256 signature verifies.

## Not done yet

- **Demo access is `sample` / `rejuv`.** Keep this limited to seeded/demo data only.
- **No automated sending.** Every message is a human pressing send. Given the HIPAA marketing
  line that is the right starting point; scheduled campaigns are the next step once compliance
  answers.
- **No AdvancedMD integration.** Visit dates and supply are coordinator-entered. Pulling them
  from the chart needs the Connect API under a paid Certified API Developer Agreement; the
  free FHIR API is read-only.
- **No audit log** of who viewed which patient. A real HIPAA deployment wants one.
- **No password reset or account management UI.** Coordinators are added in SQL today.
- **No rate limiting on login.**
- **`/api/subscribe` from the old pricing deck was not ported.** It was already returning 500
  before this deployment; the deck's "save patient & subscribe" button does not work.
