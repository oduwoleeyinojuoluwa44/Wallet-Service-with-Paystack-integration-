# Wallet Service

Simple wallet backend with Paystack deposits, JWT/API key auth, and a lightweight demo UI for manual testing.

## Quick start (local)
1) Copy `.env` from `.env.example` (one is included with placeholders) and fill:
   - `JWT_SECRET` (required)
   - Optional mocks for local only: `ALLOW_PAYSTACK_STUB=true`, `ALLOW_INSECURE_GOOGLE_MOCK=true`
   - Real services: `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_REDIRECT_URI`
2) Install deps: `npm install`
3) Run: `npm start`
4) Open the demo UI at `http://localhost:3000/` to exercise auth, API keys, deposits, transfers, balance, and history.

## Notes
- Mock Google login: if `ALLOW_INSECURE_GOOGLE_MOCK=true`, use the UI's email field to obtain a JWT.
- Paystack: webhook is at `/wallet/paystack/webhook`; only the webhook credits wallets.

## Deploy (Railway or similar)
- Ensure env vars are set: `JWT_SECRET`, `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_REDIRECT_URI` (e.g., `https://your-app.up.railway.app/auth/google/callback`), `ALLOW_PAYSTACK_STUB=false`, **`DATABASE_URL` (Postgres connection string)**.
- Use start command: `npm start` (package.json main is `src/server.js`; Node >=18).
- Set the Paystack webhook to `https://<your-domain>/wallet/paystack/webhook` (must be HTTPS and reachable).
- Update your Google OAuth client authorized redirect URI to match the deployed domain/callback.
- Storage: now uses Postgres (`DATABASE_URL`). On Railway, add a Postgres service and set `DATABASE_URL` from its connection string.
