# n8n Workflows

Both workflows run in the DTS n8n instance (`matthewmeskin.app.n8n.cloud`).
Replace `https://your-portal-url.vercel.app` with the deployed portal URL.

## Workflow 1 — Monthly Bluewire Email Import

1. **Email Trigger** (Gmail Trigger or IMAP) — watch the monitored inbox for an
   email with an Excel attachment.
2. **Extract Attachment** — get the binary of the `.xlsx` file.
3. **HTTP Request → Upload API**
   ```
   POST https://your-portal-url.vercel.app/api/upload-scores
   Headers: Authorization: Bearer {{ $env.CRON_SECRET }}
   Body: multipart/form-data with the Excel file (field name: file)
   ```
4. **IF** `{{ $json.flagged > 0 }}` — continue, else stop.
5. **Gmail Send** — compose the flagged-carrier email from the response and send.

## Workflow 2 — RMIS Delta Monitor

1. **Schedule Trigger** — every 10 minutes.
2. **HTTP Request: Delta Summary**
   ```
   POST https://api.rmissecure.com/_c/std/api/DeltaAPI.aspx
   Body JSON:
   {
     "ClientID": "{{ $env.RMIS_CLIENT_ID }}",
     "ClientPassword": "{{ $env.RMIS_CLIENT_PASSWORD }}",
     "APIMode": "Summary"
   }
   ```
3. **IF** `{{ $json.RMISDeltaAPI.SUMMARY.TotalInsdIDs > 0 }}` — else stop.
4. **HTTP Request: Delta Fetch**
   ```
   POST https://api.rmissecure.com/_c/std/api/DeltaAPI.aspx
   Body JSON:
   {
     "ClientID": "{{ $env.RMIS_CLIENT_ID }}",
     "ClientPassword": "{{ $env.RMIS_CLIENT_PASSWORD }}",
     "APIMode": "Fetch",
     "MaxRecs": "50"
   }
   ```
5. **HTTP Request: Portal Delta Endpoint**
   ```
   POST https://your-portal-url.vercel.app/api/cron/delta
   Headers: Authorization: Bearer {{ $env.CRON_SECRET }}
   Body JSON:
   {
     "insdIDs": {{ $json.RMISDeltaAPI.FETCH.InsdID }},
     "clientID": "{{ $env.RMIS_CLIENT_ID }}",
     "clientPassword": "{{ $env.RMIS_CLIENT_PASSWORD }}"
   }
   ```
   The portal handles the Expanded Carrier API calls, Supabase upserts, change
   detection, hard-stop alerting, and the Delta `Clear` call.
6. **IF** `{{ $json.hardStopsDetected > 0 }}` — send an immediate Gmail alert.

> The `/api/cron/delta` route also works without `insdIDs` in the body: it will
> call the Delta Summary + Fetch itself. This makes it usable from a Vercel Cron
> job as well, provided `CRON_SECRET` is set so Vercel sends the Bearer header.
