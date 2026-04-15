# delivery-orchestrator

B2B delivery-logistics microservice. Exposes two HTTP endpoints for delivery window discovery and order booking, backed by an in-memory SQLite database seeded at boot.

- `POST /get_quotes` — given an order payload, returns every available delivery window with a unique `quote_id`.
- `POST /book_order` — given a `quote_id` + original payload, atomically creates an order if the window still has capacity.

## Requirements

- Node.js 20+
- npm

## Install

```bash
npm install
```

## Run the service

```bash
npm run dev
```

Example request:

```bash
curl -X POST http://localhost:3000/get_quotes \
  -H 'content-type: application/json' \
  -d '{"lng":34.78,"lat":32.08,"min_time":"2026-04-15 09:00:00","max_time":"2026-04-15 13:00:00","weight":120}'
```

Then book one of the returned `quote_id`s:

```bash
curl -X POST http://localhost:3000/book_order \
  -H 'content-type: application/json' \
  -d '{"quote_id":"<uuid>","lng":34.78,"lat":32.08,"min_time":"2026-04-15 09:00:00","max_time":"2026-04-15 13:00:00","weight":120}'
```

## Run the tests

```bash
npm test
```

Watch mode:

```bash
npm run test:watch
```

## Build for production

```bash
npm run build
npm start
```
