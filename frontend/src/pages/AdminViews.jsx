import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { API_BASE, adminHeaders, toMs } from "../api.js";
import { handleFormEnterKeyDown } from "../lib/formEnter.js";
import SiteBrand from "../components/SiteBrand.jsx";
import ThemeToggle from "../components/ThemeToggle.jsx";

function formatTs(ts) {
  if (ts === null || ts === undefined) {
    return "—";
  }
  const raw = String(ts).trim();
  if (!/^\d+$/.test(raw)) {
    const n = Number(raw);
    return Number.isFinite(n) ? formatMsAsIso(n) : String(ts);
  }
  if (raw.length > 15) {
    return `${raw} ms (unexpected magnitude — check DB value)`;
  }
  return formatMsAsIso(Number(raw));
}

function formatMsAsIso(ms) {
  if (!Number.isFinite(ms)) {
    return "invalid";
  }
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) {
    return String(ms);
  }
  const y = d.getUTCFullYear();
  if (y < 2000 || y > 2100) {
    return `${ms} ms (not a normal candle time)`;
  }
  return d.toISOString();
}

export default function AdminViews() {
  const [intervalOptions, setIntervalOptions] = useState([]);
  const [markets, setMarkets] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 8, total: 0, totalPages: 1 });
  const [searchInput, setSearchInput] = useState("");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [allMarkets, setAllMarkets] = useState([]);
  const [dataCheckById, setDataCheckById] = useState({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [newName, setNewName] = useState("");
  const [newInterval, setNewInterval] = useState("1m");
  const [newStartDate, setNewStartDate] = useState("");

  const [downloadMarketId, setDownloadMarketId] = useState("");
  const [downloadStartDate, setDownloadStartDate] = useState("");
  const [downloadEndDate, setDownloadEndDate] = useState("");

  async function loadInitial(
    targetPage = pagination.page,
    targetSearch = searchKeyword,
    { showLoading = false } = {}
  ) {
    if (showLoading) {
      setLoading(true);
    }
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
      setAllMarkets(allMarketData.items ?? []);
      if (allMarketData.items?.length && !downloadMarketId) {
        setDownloadMarketId(String(allMarketData.items[0].id));
      }
    } catch {
      setMessage("Failed to load data. Is backend running?");
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void loadInitial(1, "", { showLoading: true });
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      void loadInitial(pagination.page, searchKeyword, { showLoading: false });
    }, 5000);
    return () => clearInterval(timer);
  }, [pagination.page, searchKeyword]);

  useEffect(() => {
    if (!downloadMarketId && allMarkets.length) {
      setDownloadMarketId(String(allMarkets[0].id));
    }
  }, [downloadMarketId, allMarkets]);

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

  function downloadCsv(event) {
    event.preventDefault();
    const selected = allMarkets.find((m) => String(m.id) === downloadMarketId);
    if (!selected || !downloadStartDate || !downloadEndDate) {
      setMessage("Please fill download form");
      return;
    }
    const start = toMs(downloadStartDate);
    const end = toMs(downloadEndDate) + 24 * 60 * 60 * 1000 - 1;
    const url = `${API_BASE}/markets/download?market=${encodeURIComponent(selected.name)}&interval=${encodeURIComponent(selected.interval)}&start=${start}&end=${end}`;
    fetch(url, { headers: adminHeaders() })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          setMessage(body.message ?? "Download failed");
          return;
        }
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = `${selected.name}-${selected.interval}-${start}-${end}.csv`;
        anchor.click();
        URL.revokeObjectURL(objectUrl);
      })
      .catch(() => setMessage("Download failed"));
  }

  async function toggleLive(marketId, enabled) {
    setMessage("");
    const response = await fetch(`${API_BASE}/markets/${marketId}/live`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      setMessage(errorBody.message ?? "Live toggle failed");
      return;
    }
    await loadInitial(pagination.page, searchKeyword);
    setMessage(enabled ? "Added to live stream" : "Removed from live stream");
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

  async function runDataCheck(marketId) {
    setDataCheckById((prev) => ({
      ...prev,
      [marketId]: { loading: true, error: null, data: null },
    }));
    try {
      const response = await fetch(`${API_BASE}/markets/${marketId}/data-check?maxReported=500`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setDataCheckById((prev) => ({
          ...prev,
          [marketId]: { loading: false, error: body.message ?? "Check failed", data: null },
        }));
        return;
      }
      setDataCheckById((prev) => ({
        ...prev,
        [marketId]: { loading: false, error: null, data: body },
      }));
    } catch {
      setDataCheckById((prev) => ({
        ...prev,
        [marketId]: { loading: false, error: "Network error", data: null },
      }));
    }
  }

  return (
    <div className="app">
      <header className="page-header">
        <SiteBrand
          title="Binance Price Candle Manager"
          subtitle="Manage market sync and export candle data."
          action={
            <>
              <ThemeToggle />
              <Link to="/" className="nav-link">
                Dashboard
              </Link>
            </>
          }
        />
      </header>
      {message ? <p className="message">{message}</p> : null}

      <section className="card">
        <h2>Add Market</h2>
        <form onSubmit={createMarket} onKeyDown={handleFormEnterKeyDown} className="row-form">
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
        <form onSubmit={downloadCsv} onKeyDown={handleFormEnterKeyDown} className="row-form">
          <label>
            Market
            <select
              value={downloadMarketId}
              onChange={(e) => setDownloadMarketId(e.target.value)}
              disabled={!allMarkets.length}
            >
              {allMarkets.map((m) => (
                <option key={m.id} value={String(m.id)}>
                  {m.name} · {m.interval}
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
          <button type="submit" className="primary" disabled={!allMarkets.length}>
            Download CSV
          </button>
        </form>
      </section>

      <section className="card">
        <h2>Markets</h2>
        <form onSubmit={applySearch} onKeyDown={handleFormEnterKeyDown} className="row-form">
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
              onDelete={deleteMarket}
              onSync={syncMarket}
              onDataCheck={runDataCheck}
              onLive={toggleLive}
              dataCheck={dataCheckById[market.id]}
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

function MarketRow({ market, onDelete, onSync, onDataCheck, onLive, dataCheck }) {
  return (
    <div className="market-row">
      <div className="market-head">
        <strong>
          {market.name} · {market.interval}
        </strong>
        {market.live_enabled ? <span className="live-badge">LIVE</span> : null}
        <div className="meta">last_timestamp: {formatTs(market.last_timestamp)}</div>
        <div className="meta">
          status: {market.sync_status ?? "idle"} ({Number(market.sync_progress ?? 0).toFixed(1)}%)
        </div>
        {market.sync_error ? <div className="meta error-text">error: {market.sync_error}</div> : null}
      </div>
      <div className="market-actions">
        <button onClick={() => onSync(market.id)}>Sync</button>
        <button type="button" className="ghost" onClick={() => onDataCheck(market.id)}>
          Check
        </button>
        <button
          type="button"
          className={market.live_enabled ? "ghost" : "primary"}
          onClick={() => onLive(market.id, !market.live_enabled)}
        >
          {market.live_enabled ? "Remove from Live" : "Add to Live"}
        </button>
        <button className="danger" onClick={() => onDelete(market.id)}>
          Delete
        </button>
      </div>
      {dataCheck?.loading ? <div className="check-banner">Checking open_time gaps…</div> : null}
      {dataCheck?.error ? <div className="check-banner error-text">Check: {dataCheck.error}</div> : null}
      {dataCheck?.data ? (
        <div className="check-panel">
          <div className="check-summary">
            <strong>Gap check</strong> — step {dataCheck.data.stepMs} ms ({dataCheck.data.interval}). Total missing slots:{" "}
            <strong>{dataCheck.data.totalMissingSlots}</strong>
            {dataCheck.data.missingTruncated ? " (listed open times truncated — increase maxReported in API if needed)" : ""}
          </div>
          {Number(dataCheck.data.totalMissingSlots) === 0 && !dataCheck.data.irregularPairs?.length ? (
            <p className="meta">No gaps found in the checked range.</p>
          ) : null}
          {dataCheck.data.irregularPairs?.length ? (
            <details className="check-details">
              <summary>Irregular spacing ({dataCheck.data.irregularPairs.length})</summary>
              <pre>{JSON.stringify(dataCheck.data.irregularPairs, null, 2)}</pre>
            </details>
          ) : null}
          {dataCheck.data.gaps?.length ? (
            <details className="check-details" open>
              <summary>Gaps ({dataCheck.data.gaps.length})</summary>
              <pre>{JSON.stringify(dataCheck.data.gaps, null, 2)}</pre>
            </details>
          ) : null}
          {dataCheck.data.missingOpenTimes?.length ? (
            <details className="check-details">
              <summary>Missing open_time samples ({dataCheck.data.missingOpenTimes.length})</summary>
              <pre>{dataCheck.data.missingOpenTimes.join("\n")}</pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
