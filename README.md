# Binance Price Candle (Node.js Fullstack)

Full-stack project with:

- Backend: Node.js + Express + PostgreSQL
- Frontend: React (Vite)
- Market CRUD (add/update/remove/list)
- Binance daily kline sync from ZIP files
- CSV download by market and date range

Binance data source (daily klines):

- [Binance Data Collection](https://data.binance.vision/?prefix=data/spot/daily/klines)
- [Binance Data Collection - klines prefix](https://data.binance.vision/?prefix=data/spot/daily/klines/)

## Project Structure

- `backend/`: API server and sync logic
- `frontend/`: user interface

## Backend API

- `GET /health`
- `GET /interval-options`
- `GET /markets`
- `POST /markets`
- `PUT /markets/:id`
- `DELETE /markets/:id`
- `POST /markets/:id/sync`
- `GET /markets/sync-status`
- `GET /markets/download?market=BTCUSDT&start=...&end=...`

## Database

Main table:

- `markets(id, name, interval, start_timestamp, last_timestamp, created_at, updated_at)`

Per market table naming:

- `market_btcusdt`, `market_ethusdt`, etc.

Per market candle columns (12 fields):

- Open time, Open, High, Low, Close, Volume, Close time,
- Quote asset volume, Number of trades,
- Taker buy base asset volume, Taker buy quote asset volume, Ignore

## Run Locally

1. Create PostgreSQL database (example `binance_candles`).
2. Copy `.env.example` to `.env` in the project root. Set `DB_*` (or `DATABASE_URL`) for PostgreSQL, and replace `JWT_SECRET` and `ADMIN_PASSWORD` with strong values.
3. Install dependencies:

```bash
npm run install:all
```

4. Run backend:

```bash
npm run dev:backend
```

5. Run frontend (new terminal):

```bash
npm run dev:frontend
```

Ports come from `.env`: `FRONTEND_PORT` (Vite) and `BACKEND_PORT` (Express). Defaults are `5173` and `4000` if unset.
Parallel market sync workers are controlled by `SYNC_WORKER_COUNT` (default `3`).

## User sign-in

The main page offers a Binance Candle Data email/password account. Registration,
sign-in, and the Binance session use this project's database and backend; the
Weien Wong Hub does not need to be running. An account created before Hub sign-in
was introduced can use its original Binance password.

Hub sign-in remains an optional link. If an existing account has only Hub
credentials, sign in through the Hub once while it is available, then use
**Binance account access** to set a Binance password. After that, the Binance
password works during Hub outages. A Hub-only account without a Binance password
cannot set one while the Hub is unavailable. This project does not currently
offer email-based password recovery.

`AUTH_JWT_SECRET` is needed only for optional Hub SSO and must match the Hub's
signing secret when used. Binance email/password sessions use a separate key
derived from this project's `JWT_SECRET` and a cookie scoped to this site.

## Admin panel (`/admin-views`)

Market management (add/delete/sync/live) and unlimited CSV export require a separate
admin username and password from `.env`:

- `ADMIN_USERNAME` / `ADMIN_PASSWORD`

Sign in at `/admin-views`. Session cookie lasts `ADMIN_SESSION_HOURS` (default 12).
Hub/Gmail login alone does not open the admin panel.

## Notes

- On backend startup, all existing markets are synced up to yesterday if needed.
- You can also trigger sync manually from the frontend via `Sync` button.
- CSV download returns data directly from the market-specific table.
