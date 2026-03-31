# SPX 0DTE Straddle Tracker (React + Vite)

A small React app that fetches SPX 0DTE options data from Polygon and calculates:

- SPX underlying price
- ATM call and put prices
- total straddle price (call + put)
- decay % since day start

## Setup

1. Set your Polygon API key as environment variable in `.env`:

```bash
VITE_POLYGON_API_KEY=your_polygon_api_key_here
```

2. Install:

```bash
npm install
```

3. Run locally:

```bash
npm run dev
```

4. Build for production:

```bash
npm run build
```

5. Preview production build:

```bash
npm run preview
```

## Vercel deployment

- Connect your repo to Vercel.
- Set environment variable in Vercel dashboard:
  - `VITE_POLYGON_API_KEY`
- Build command: `npm run build`
- Output directory: `dist`

## How it works

1. Reads SPX quote from Polygon endpoint.
2. Picks ATM strike and requests SPX options symbols (call/put for selected expiration).
3. Loads latest option quotes for selected call/put.
4. Loads first minute open values from `V2 aggs` for day-start straddle.
5. Computes current straddle and percentage decay from start-of-day.

## Notes

- 0DTE ideally means expiration date is today; adjust `expirationDate` field for next weekly expiration.
- Polygon API behavior can vary by plan and may require contract-specific endpoints.
- This is starter code; if you use a live plan, expect improved error handling and contract filtering in production.

