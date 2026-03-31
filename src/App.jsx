import { useEffect, useMemo, useState } from 'react';

const DEFAULT_UNDERLYING = 'SPX';
const MIN_STRIKE_STEP = 5;

function getTodayNYDate() {
  const now = new Date();
  const ny = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return ny.toISOString().split('T')[0];
}

function getNearestStrike(price) {
  return Math.round(price / MIN_STRIKE_STEP) * MIN_STRIKE_STEP;
}

function dateToPolyISOString(dateString) {
  // Polygon accepts YYYY-MM-DD, but some endpoints have ISO; keep YYYY-MM-DD
  return dateString;
}

function buildOptionsChainEndpoint({ underlying, expiration, contract_type, strike }) {
  const params = new URLSearchParams({
    underlying_ticker: underlying,
    expiration_date: dateToPolyISOString(expiration),
    contract_type,
    limit: '10',
    apiKey: '',
  });
  if (strike != null) {
    params.set('strike_price', strike.toString());
  }
  return `https://api.polygon.io/v3/reference/options/symbols?${params.toString()}`;
}

async function fetchJson(url, apiKey) {
  const parsed = new URL(url);
  parsed.searchParams.set('apiKey', apiKey);

  const res = await fetch(parsed.toString());
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${res.statusText} - ${text}`);
  }
  return res.json();
}

async function fetchOptionQuote(symbol, apiKey) {
  // 1. Try v2 last quote endpoint for options for best compatibility.
  const endpoints = [
    `https://api.polygon.io/v2/last/option/${symbol}`,
    `https://api.polygon.io/v1/last_quote/options/${symbol}`,
  ];

  for (const endpoint of endpoints) {
    try {
      const data = await fetchJson(`${endpoint}?apiKey=${apiKey}`, apiKey);
      if (data.last && data.last.price != null) {
        return data.last.price;
      }
      if (data.results && data.results.last) {
        return data.results.last.price;
      }
      if (data.last_quote && data.last_quote.price != null) {
        return data.last_quote.price;
      }
    } catch (err) {
      // continue to next endpoint
    }
  }
  throw new Error(`Unable to fetch quote for ${symbol}`);
}

async function fetchOpenPrice(symbol, date, apiKey) {
  // Get first minute of market day (9:30-9:31 ET) by time-range agg.
  const from = `${date}T09:30:00-04:00`;
  const to = `${date}T10:00:00-04:00`;
  const url = `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/min/${from}/${to}?adjusted=true&sort=asc&limit=5`;

  const data = await fetchJson(`${url}&apiKey=${apiKey}`, apiKey);
  if (data.results && data.results.length > 0) {
    // first bar open price is the first market price at open.
    return data.results[0].o;
  }
  return null;
}

export default function App() {
  const storedKey = import.meta.env.VITE_POLYGON_API_KEY || '';
  const [apiKey, setApiKey] = useState(storedKey);
  const [underlying, setUnderlying] = useState(DEFAULT_UNDERLYING);
  const [expirationDate, setExpirationDate] = useState(getTodayNYDate());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  const autoRefreshLabel = useMemo(() => {
    return `Last updated: ${data?.timestamp ? new Date(data.timestamp).toLocaleTimeString() : '--'}`;
  }, [data]);

  const fetchStraddle = async () => {
    if (!apiKey) {
      setError('Add a Polygon API key first');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // 0) get underlying price for ATM strike
      const qUrl = `https://api.polygon.io/v1/last_quote/index/${underlying}?apiKey=${apiKey}`;
      const qData = await fetchJson(qUrl, apiKey);
      const underlyingPrice = qData?.last?.price ?? qData?.last_quote?.price ?? null;
      if (underlyingPrice == null) {
        throw new Error('Unable to read underlying quote for SPX');
      }

      const atmStrike = getNearestStrike(underlyingPrice);
      const exp = expirationDate;

      // 1) fetch ATM call and put symbols
      const callSymbolData = await fetchJson(`${buildOptionsChainEndpoint({ underlying, expiration: exp, contract_type: 'call', strike: atmStrike })}&apiKey=${apiKey}`, apiKey);
      const putSymbolData = await fetchJson(`${buildOptionsChainEndpoint({ underlying, expiration: exp, contract_type: 'put', strike: atmStrike })}&apiKey=${apiKey}`, apiKey);

      const callSymbol = callSymbolData?.results?.[0]?.symbol;
      const putSymbol = putSymbolData?.results?.[0]?.symbol;

      if (!callSymbol || !putSymbol) {
        throw new Error(`0DTE contracts not found for expiration=${exp} strike=${atmStrike}`);
      }

      // 2) fetch latest quotes
      const [callPrice, putPrice] = await Promise.all([
        fetchOptionQuote(callSymbol, apiKey),
        fetchOptionQuote(putSymbol, apiKey),
      ]);

      // 3) fetch open prices from 9:30 AM
      const [callOpen, putOpen] = await Promise.all([
        fetchOpenPrice(callSymbol, exp, apiKey),
        fetchOpenPrice(putSymbol, exp, apiKey),
      ]);

      const currentStraddle = callPrice + putPrice;
      const dayStartStraddle = (callOpen ?? callPrice) + (putOpen ?? putPrice);
      const decayPct = dayStartStraddle > 0 ? ((dayStartStraddle - currentStraddle) / dayStartStraddle) * 100 : 0;

      setData({
        timestamp: Date.now(),
        underlyingPrice,
        atmStrike,
        expirationDate: exp,
        callSymbol,
        putSymbol,
        callPrice,
        putPrice,
        currentStraddle,
        callOpen,
        putOpen,
        dayStartStraddle,
        decayPct,
      });
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!storedKey) return;
    fetchStraddle();
    const timer = setInterval(fetchStraddle, 60 * 1000); // refresh every minute
    return () => clearInterval(timer);
  }, [apiKey, expirationDate]);

  return (
    <div className="app">
      <h1>SPX 0DTE Straddle Tracker</h1>
      <div className="controls">
        <div className="field">
          <label>Polygon API Key (VITE_POLYGON_API_KEY):</label>
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value.trim())} placeholder="Enter your key" />
        </div>
        <div className="field">
          <label>Underlying Index</label>
          <input type="text" value={underlying} onChange={(e) => setUnderlying(e.target.value.trim().toUpperCase())} />
        </div>
        <div className="field">
          <label>Expiration Date (0DTE target):</label>
          <input type="date" value={expirationDate} onChange={(e) => setExpirationDate(e.target.value)} />
        </div>
        <button onClick={fetchStraddle} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh Now'}
        </button>
      </div>

      {error && <div className="error">Error: {error}</div>}

      {data ? (
        <div className="results">
          <div>{autoRefreshLabel}</div>
          <ul>
            <li>Underlying Price ({underlying}): {data.underlyingPrice.toFixed(2)}</li>
            <li>ATM Strike: {data.atmStrike}</li>
            <li>Call symbol: {data.callSymbol} @ {data.callPrice.toFixed(2)}</li>
            <li>Put symbol: {data.putSymbol} @ {data.putPrice.toFixed(2)}</li>
            <li>Current straddle price: {data.currentStraddle.toFixed(2)}</li>
            <li>Start-of-day straddle: {data.dayStartStraddle.toFixed(2)}</li>
            <li>Decay since open: {data.decayPct.toFixed(2)}%</li>
            <li>Call open: {data.callOpen != null ? data.callOpen.toFixed(2) : 'n/a'}</li>
            <li>Put open: {data.putOpen != null ? data.putOpen.toFixed(2) : 'n/a'}</li>
          </ul>
        </div>
      ) : (
        <div className="empty-state">Press refresh to load 0DTE straddle data.</div>
      )}

      <p className="note">
        Note: 0DTE mean expiration at selected date (usually today). if market is closed this may show no data. 🔁 updates every minute once configured.
      </p>
    </div>
  );
}
