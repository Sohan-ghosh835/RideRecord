# RideRecord

A private, offline-first ownership record for motorcycles and scooters: find your exact model, then track fuel/charging,
maintenance, expenses, documents and history for one or many vehicles.

```
riderecord/
  web/      React + TypeScript + Vite app. IndexedDB persistence. Works fully on its own.
  server/   Optional FastAPI catalog service: validated catalog API, controlled ingestion, admin review queue.
```

## Quick start

```bash
# App (works without the server)
cd web && npm install
npm run dev            # http://localhost:5173
npm test               # 52 domain + persistence tests
npm run build          # production build in web/dist (includes an offline service worker)

# Optional catalog service
cd server && pip install -r requirements.txt
ADMIN_TOKEN=choose-a-long-secret uvicorn app.main:app --port 8000
python -m pytest       # 12 backend tests
# point the app at it:   echo "VITE_API_URL=http://localhost:8000" > web/.env.local
```

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `VITE_API_URL` | web | Optional catalog service URL. Unset = built-in catalog + imports only. |
| `ADMIN_TOKEN` | server | Enables `/admin/*`. Unset = admin API returns 503. Never put it in the client. |
| `CATALOG_DB` | server | SQLite path (default `data/catalog.sqlite3`). Schema is plain SQL, portable to PostgreSQL. |
| `INGEST_DIR` | server | Only directory `/admin/ingest/file` may read (default `data/incoming`). |
| `CORS_ORIGINS` | server | Comma-separated allowed origins. |

## Data model and migrations
IndexedDB database `riderecord`, versioned in `web/src/db/db.ts` (`DB_VERSION = 2`). Add a new `if (oldVersion < N)` block for every
schema change and never edit old blocks; a test upgrades a real v1 database and checks nothing is lost. The server uses SQLite;
`server/app/store.py` holds the schema (`CREATE TABLE IF NOT EXISTS`). Moving to PostgreSQL means swapping the connection and placeholders.

## Catalog: what is and isn't in it (read this)
* The bundled catalog (~100 records, 19 manufacturers) is **identification-only**: manufacturer, model, generation, approximate
  production years, category and fuel type. Every record is labelled `seed-unverified`. It deliberately contains **no** power, torque,
  weight, tank or service-interval figures, because none were verified against a manufacturer source in this build. Production years are
  approximate and should be confirmed.
* The UI shows the verification state of every figure (verified / unverified / estimated / entered by you) and the source behind it.
* **Verified data** enters via (a) Catalog → Import (JSON, validated, previewed, sanitised), or (b) the server's ingestion pipeline.
  "Verified" is only kept when an official manufacturer, manual or distributor source is attached.
* Catalog coverage is **measured** on the Catalog page. Nothing here claims global completeness.
* Maintenance intervals are **generic starting points** labelled as such until the owner enters the manual's figures.
  No model-specific service schedule is included, because none were sourced.

## Ingestion (server)
`PoliteFetcher` checks robots.txt, identifies itself, throttles per host, retries with backoff, caps response size, never retries 401/402/403/451
and never works around blocks. `Adapter` subclasses only extract; validation, dedupe, source ranking (official > distributor > other), conflict
queueing, raw-payload storage and change history are shared. **No manufacturer-specific scraper ships**: whether a site may be fetched
depends on its terms and must be decided per source, then implemented as an adapter. Use licensed feeds, open datasets or file imports first.
Bulk ingestion runs from a controlled process (`/admin/ingest/file` or your own scheduler calling `ingest()`); public requests never trigger external fetching.

## Privacy and storage
All records live in the browser on the device (IndexedDB); documents and receipts too. There is no account and no cloud sync in this build,
so cross-device use and recovery depend on **Backup & restore** (JSON with SHA-256 integrity check, preview, add-only or newer-wins, atomic).
Registration numbers are optional, masked by default and excluded from reports unless chosen.

## Not implemented / needs external work
* Accounts, cloud sync and object storage (the data model uses stable UUIDs and `updatedAt`, so sync can be added; saves are idempotent).
* OCR of receipts (needs an OCR engine/service; uploads are stored and linked, nothing is auto-extracted).
* Verified catalog data and model-specific service intervals (need licensed/official sources).
* Scheduled refresh job (call `ingest()` from cron/a worker; not wired to a scheduler here).
* Push/notification reminders (due/expiry state is computed and shown in-app only).
