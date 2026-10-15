# Market Pulse MVP

A static GitHub Pages dashboard for the Tehran market. It is intentionally a **Monitor** surface: fast scanning, dense-but-readable market state, and explicit separation between analytical data and investment advice.

## Current data contract

`data/market.json` is a snapshot export from the production `scores_history.db` on the Bourse Alert VPS. The UI consumes this file only; it never exposes Telegram credentials or connects directly to the database.

The next production step is to add a server-side publisher that refreshes this JSON during market hours. The options area is intentionally marked as `connecting` until the Bid/Ask mapping and signal-vs-test contract are approved.

## Local verification

```bash
python -m http.server 8000
# open http://127.0.0.1:8000/market/
```

## Deployment shape

- Frontend: free GitHub Pages (`/market/`)
- Data: generated JSON snapshot, no secrets in the browser
- Future live path: a read-only HTTPS API or scheduled JSON publisher
- No trading action is exposed by this MVP
