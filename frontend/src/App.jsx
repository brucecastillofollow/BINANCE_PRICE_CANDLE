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
  const [pagination, setPagination] = useState({ page: 1, pageSize: 8, total: 0, totalPages: 1 });
  const [searchInput, setSearchInput] = useState("");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [allMarketNames, setAllMarketNames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [newName, setNewName] = useState("");
  const [newInterval, setNewInterval] = useState("1m");
  const [newStartDate, setNewStartDate] = useState("");

  const [downloadMarket, setDownloadMarket] = useState("");
  const [downloadStartDate, setDownloadStartDate] = useState("");
  const [downloadEndDate, setDownloadEndDate] = useState("");

  const marketNames = useMemo(() => allMarketNames, [allMarketNames]);

  async function loadInitial(targetPage = pagination.page, targetSearch = searchKeyword) {
    setLoading(true);
    try {
      const [intervalRes, marketRes, allNamesRes] = await Promise.all([
        fetch(`${API_BASE}/interval-options`),
        fetch(
          `${API_BASE}/markets?page=${targetPage}&pageSize=${pagination.pageSize}&search=${encodeURIComponent(targetSearch)}`
        ),
        fetch(`${API_BASE}/markets?page=1&pageSize=1000`),
      ]);
      const intervalData = await intervalRes.json();
      const marketData = await marketRes.json();
      const allMarketData = await allNamesRes.json();
      setIntervalOptions(intervalData);
      setMarkets(marketData.items ?? []);
      setPagination({
        page: marketData.page ?? 1,
        pageSize: marketData.pageSize ?? pagination.pageSize,
        total: marketData.total ?? 0,
        totalPages: marketData.totalPages ?? 1,
      });
      setAllMarketNames((allMarketData.items ?? []).map((item) => item.name));
      if (intervalData.length) {
        setNewInterval(intervalData[0]);
      }
      if (allMarketData.items?.length && !downloadMarket) {
        setDownloadMarket(allMarketData.items[0].name);
      }
    } catch {
      setMessage("Failed to load data. Is backend running?");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInitial(1, "");
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      void loadInitial(pagination.page, searchKeyword);
    }, 5000);
    return () => clearInterval(timer);
  }, [pagination.page, searchKeyword]);

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
    await loadInitial(1, searchKeyword);
    setMessage("Market created and sync queued");
  }

  async function deleteMarket(id) {
    setMessage("");
    const response = await fetch(`${API_BASE}/markets/${id}`, { method: "DELETE" });
    if (!response.ok) {
      setMessage("Failed to delete market");
      return;
    }
    await loadInitial(pagination.page, searchKeyword);
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
    await loadInitial(pagination.page, searchKeyword);
    setMessage("Sync queued");
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
    await loadInitial(pagination.page, searchKeyword);
    setMessage("Market updated and sync queued");
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

  async function applySearch(event) {
    event.preventDefault();
    setSearchKeyword(searchInput.trim().toUpperCase());
    await loadInitial(1, searchInput.trim().toUpperCase());
  }

  async function goToPage(nextPage) {
    const boundedPage = Math.max(1, Math.min(nextPage, pagination.totalPages));
    await loadInitial(boundedPage, searchKeyword);
  }

  return (
    <div className="app">
      <header className="page-header">
        <h1>Binance Price Candle Manager</h1>
        <p className="subtitle">Manage market sync and export candle data.</p>
      </header>
      {message ? <p className="message">{message}</p> : null}

      <section className="card">
        <h2>Add Market</h2>
        <form onSubmit={createMarket} className="row-form">
          <label>
            Market Name
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="BTCUSDT"
              required
            />
          </label>
          <label>
            Interval
            <select value={newInterval} onChange={(e) => setNewInterval(e.target.value)}>
              {intervalOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label>
            Start Date
            <input
              type="date"
              value={newStartDate}
              onChange={(e) => setNewStartDate(e.target.value)}
              required
            />
          </label>
          <button type="submit" className="primary">
            Add Market
          </button>
        </form>
      </section>

      <section className="card">
        <h2>Download CSV</h2>
        <form onSubmit={downloadCsv} className="row-form">
          <label>
            Market
            <select value={downloadMarket} onChange={(e) => setDownloadMarket(e.target.value)} disabled={!marketNames.length}>
              {marketNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Start Date
            <input
              type="date"
              value={downloadStartDate}
              onChange={(e) => setDownloadStartDate(e.target.value)}
              required
            />
          </label>
          <label>
            End Date
            <input
              type="date"
              value={downloadEndDate}
              onChange={(e) => setDownloadEndDate(e.target.value)}
              required
            />
          </label>
          <button type="submit" className="primary" disabled={!marketNames.length}>
            Download CSV
          </button>
        </form>
      </section>

      <section className="card">
        <h2>Markets</h2>
        <form onSubmit={applySearch} className="row-form">
          <label>
            Filter by Market Name
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="BTCUSDT"
            />
          </label>
          <button type="submit" className="primary">
            Search
          </button>
          <button
            type="button"
            onClick={async () => {
              setSearchInput("");
              setSearchKeyword("");
              await loadInitial(1, "");
            }}
          >
            Reset
          </button>
        </form>
        {loading ? <p>Loading...</p> : null}
        {!loading && markets.length === 0 ? <p>No markets yet.</p> : null}
        <div className="market-list">
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
        </div>
        <div className="pagination-bar">
          <button type="button" onClick={() => void goToPage(pagination.page - 1)} disabled={pagination.page <= 1}>
            Prev
          </button>
          <span>
            Page {pagination.page} / {pagination.totalPages} (Total: {pagination.total})
          </span>
          <button
            type="button"
            onClick={() => void goToPage(pagination.page + 1)}
            disabled={pagination.page >= pagination.totalPages}
          >
            Next
          </button>
        </div>
      </section>
    </div>
  );
}

function MarketRow({ market, intervals, onDelete, onSync, onSave }) {
  const [interval, setInterval] = useState(market.interval);
  const [startDate, setStartDate] = useState(new Date(Number(market.start_timestamp)).toISOString().slice(0, 10));

  return (
    <div className="market-row">
      <div className="market-head">
        <strong>{market.name}</strong>
        <div className="meta">last_timestamp: {formatTs(market.last_timestamp)}</div>
        <div className="meta">
          status: {market.sync_status ?? "idle"} ({Number(market.sync_progress ?? 0).toFixed(1)}%)
        </div>
        {market.sync_error ? <div className="meta error-text">error: {market.sync_error}</div> : null}
      </div>
      <label>
        Interval
        <select value={interval} onChange={(e) => setInterval(e.target.value)}>
          {intervals.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>
      <label>
        Start Date
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      </label>
      <button className="primary" onClick={() => onSave(market.id, interval, toMs(startDate))}>
        Update
      </button>
      <button onClick={() => onSync(market.id)}>Sync</button>
      <button className="danger" onClick={() => onDelete(market.id)}>
        Delete
      </button>
    </div>
  );
}
