# Wallet Service

Simple wallet backend with Paystack deposits, JWT/API key auth, and a lightweight demo UI for manual testing.

## Quick start
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
