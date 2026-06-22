# DTS Carrier Compliance Portal

A Next.js 14 web application that gives Diversified Transportation Services (DTS)
a single place to track every carrier in the network, monitor compliance against
the vetting policy, and document the reasonable-care steps taken during vetting.

n8n handles all automation (monthly Bluewire imports and RMIS Delta monitoring).
This portal handles everything humans need to see and do.

## Stack

- **Next.js 14** (App Router, TypeScript)
- **Tailwind CSS** — brand colors: Maroon `#AB0534`, Blue `#0063A0`, Dark Blue `#33658A`
- **Supabase** (Postgres) — primary datastore
- **RMIS** Expanded Carrier API + Delta API — insurance/authority data
- **Google Drive** — vetting document storage
- **Resend** — compliance alert emails

## Project structure

```
/app
  /api
    /carriers                GET list (+ /metrics for dashboard cards)
    /carriers/[dot]          GET full carrier detail
    /carriers/[dot]/status   PATCH carrier_status
    /carriers/[dot]/insurance GET fresh RMIS pull
    /upload-scores           POST parse Excel, upsert scores, alert
    /vetting                 POST save a vetting record
    /vetting/[id]/document   POST upload a document to Drive
    /cron/delta              POST RMIS Delta processing (n8n / Vercel cron)
  /carriers                  Carrier list dashboard + detail pages
  /upload                    Manual Excel upload page
/lib                         Supabase client, scoring + RMIS logic, Drive, email
/components                  UI primitives (/ui) and feature panels
/supabase/schema.sql         Database schema — run this first
```

## Getting started

1. **Create the database.** In the Supabase SQL Editor, run
   [`supabase/schema.sql`](supabase/schema.sql).

2. **Configure environment.** Copy `.env.example` to `.env.local` and fill in
   every value (Supabase keys, RMIS credentials, Google Drive OAuth, Resend,
   `CRON_SECRET`, etc.).

3. **Install and run.**
   ```bash
   npm install
   npm run dev
   ```
   Open http://localhost:3000 — it redirects to `/carriers`.

## Compliance logic

- **Bluewire scoring** (`lib/scoringRules.ts`): GAP threshold 65; the five
  category scores (Crash, Violation, CSA Basics, Driver OOS, Critical/Acute) each
  must be above 65. Approval levels: `auto_clear`, `additional_vetting`,
  `manager_exception` (GAP 60–64), `owner_exception` (GAP < 60).
- **RMIS policy** (`lib/rmisEvaluator.ts`): hard stops for inactive authority,
  Conditional/Unsatisfactory rating, missing/insufficient auto ($1M) or cargo
  ($100K) coverage, and authority under 90 days. Flags for authority under
  365 days, missing agreement/W-9, zero inspections, elevated OOS ratios, etc.
- **Vetting checklist** (`lib/vettingChecklist.ts`): 14-step reasonable-care
  checklist with a pre-filled exception-note template.

## Deploy to Vercel

```bash
vercel deploy
```

Add every variable from `.env.local` under **Project Settings → Environment
Variables** (Production, Preview, Development). After the first deploy, set
`NEXT_PUBLIC_APP_URL` to the live URL and redeploy.

## n8n automation

Two workflows drive the portal (see `docs/n8n-workflows.md`):

1. **Monthly Bluewire import** — watches an inbox for the Excel export and POSTs
   it to `/api/upload-scores` with `Authorization: Bearer <CRON_SECRET>`.
2. **RMIS Delta monitor** — every 10 minutes, calls the RMIS Delta API and POSTs
   changed insured IDs to `/api/cron/delta` (also `Bearer <CRON_SECRET>`). The
   route pulls the Expanded Carrier API, detects changes, upserts insurance,
   alerts on hard stops, and clears the RMIS queue.

## Notes

- Supabase and Resend clients are initialized lazily so `next build` succeeds
  without secrets present; real env vars are read at request time.
- The portal assumes the database is populated by the n8n automations and by the
  portal's own API routes; it does not perform its own scheduled jobs.
