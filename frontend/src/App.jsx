import { useEffect, useMemo, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

function toMs(dateValue) {
  return new Date(`${dateValue}T00:00:00.000Z`).getTime();
}

function formatTs(ts) {
  return new Date(Number(ts)).toISOString();
}

export default function App() {
  const [intervalOptions, setIntervalOptions] = useState([]);
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [newName, setNewName] = useState("");
  const [newInterval, setNewInterval] = useState("1m");
  const [newStartDate, setNewStartDate] = useState("");

  const [downloadMarket, setDownloadMarket] = useState("");
  const [downloadStartDate, setDownloadStartDate] = useState("");
  const [downloadEndDate, setDownloadEndDate] = useState("");

  const marketNames = useMemo(() => markets.map((m) => m.name), [markets]);

  async function loadInitial() {
    setLoading(true);
    try {
      const [intervalRes, marketRes] = await Promise.all([
        fetch(`${API_BASE}/interval-options`),
        fetch(`${API_BASE}/markets`),
      ]);
      const intervalData = await intervalRes.json();
      const marketData = await marketRes.json();
      setIntervalOptions(intervalData);
      setMarkets(marketData);
      if (intervalData.length) {
        setNewInterval(intervalData[0]);
      }
      if (marketData.length) {
        setDownloadMarket(marketData[0].name);
      }
    } catch {
      setMessage("Failed to load data. Is backend running?");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInitial();
  }, []);

  useEffect(() => {
    if (!downloadMarket && marketNames.length) {
      setDownloadMarket(marketNames[0]);
    }
  }, [downloadMarket, marketNames]);

  async function createMarket(event) {
    event.preventDefault();
    setMessage("");
    if (!newStartDate) {
      setMessage("Please select start date");
      return;
    }

    const payload = {
      name: newName.trim().toUpperCase(),
      interval: newInterval,
      start_timestamp: toMs(newStartDate),
    };

    const response = await fetch(`${API_BASE}/markets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      setMessage(errorBody.message ?? "Failed to create market");
      return;
    }

    setNewName("");
    await loadInitial();
    setMessage("Market created");
  }

  async function deleteMarket(id) {
    setMessage("");
    const response = await fetch(`${API_BASE}/markets/${id}`, { method: "DELETE" });
    if (!response.ok) {
      setMessage("Failed to delete market");
      return;
    }
    await loadInitial();
    setMessage("Market deleted");
  }

  async function syncMarket(id) {
    setMessage("Syncing...");
    const response = await fetch(`${API_BASE}/markets/${id}/sync`, { method: "POST" });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      setMessage(errorBody.message ?? "Sync failed");
      return;
    }
    await loadInitial();
    setMessage("Sync completed");
  }

  async function updateMarket(id, interval, startTimestamp) {
    const response = await fetch(`${API_BASE}/markets/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        interval,
        start_timestamp: Number(startTimestamp),
      }),
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      setMessage(errorBody.message ?? "Failed to update market");
      return;
    }
    await loadInitial();
    setMessage("Market updated");
  }

  function downloadCsv(event) {
    event.preventDefault();
    if (!downloadMarket || !downloadStartDate || !downloadEndDate) {
      setMessage("Please fill download form");
      return;
    }
    const start = toMs(downloadStartDate);
    const end = toMs(downloadEndDate) + 24 * 60 * 60 * 1000 - 1;
    const url = `${API_BASE}/markets/download?market=${encodeURIComponent(downloadMarket)}&start=${start}&end=${end}`;
    window.open(url, "_blank");
  }

  return (
    <div className="app">
      <h1>Binance Price Candle Manager</h1>
      {message ? <p className="message">{message}</p> : null}

      <section className="card">
        <h2>Add Market</h2>
        <form onSubmit={createMarket} className="row-form">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="BTCUSDT"
            required
          />
          <select value={newInterval} onChange={(e) => setNewInterval(e.target.value)}>
            {intervalOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={newStartDate}
            onChange={(e) => setNewStartDate(e.target.value)}
            required
          />
          <button type="submit">Add</button>
        </form>
      </section>

      <section className="card">
        <h2>Markets</h2>
        {loading ? <p>Loading...</p> : null}
        {!loading && markets.length === 0 ? <p>No markets yet.</p> : null}
        {markets.map((market) => (
          <MarketRow
            key={market.id}
            market={market}
            intervals={intervalOptions}
            onDelete={deleteMarket}
            onSync={syncMarket}
            onSave={updateMarket}
          />
        ))}
      </section>

      <section className="card">
        <h2>Download CSV</h2>
        <form onSubmit={downloadCsv} className="row-form">
          <select value={downloadMarket} onChange={(e) => setDownloadMarket(e.target.value)}>
            {marketNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={downloadStartDate}
            onChange={(e) => setDownloadStartDate(e.target.value)}
            required
          />
          <input
            type="date"
            value={downloadEndDate}
            onChange={(e) => setDownloadEndDate(e.target.value)}
            required
          />
          <button type="submit">Download</button>
        </form>
      </section>
    </div>
  );
}

function MarketRow({ market, intervals, onDelete, onSync, onSave }) {
  const [interval, setInterval] = useState(market.interval);
  const [startDate, setStartDate] = useState(new Date(Number(market.start_timestamp)).toISOString().slice(0, 10));

  return (
    <div className="market-row">
      <div>
        <strong>{market.name}</strong>
        <div className="meta">last_timestamp: {formatTs(market.last_timestamp)}</div>
      </div>
      <select value={interval} onChange={(e) => setInterval(e.target.value)}>
        {intervals.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
      <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      <button onClick={() => onSave(market.id, interval, toMs(startDate))}>Update</button>
      <button onClick={() => onSync(market.id)}>Sync</button>
      <button className="danger" onClick={() => onDelete(market.id)}>
        Delete
      </button>
    </div>
  );
}
