import { useCallback, useEffect, useRef, useState } from "react";
import { authHeaders, defaultChartRange, marketsBase, toMs } from "../api.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { handleFormEnterKeyDown } from "../lib/formEnter.js";
import OhlcChart from "../components/OhlcChart.jsx";

const CHART_REFRESH_MS = 10 * 60 * 1000;

export default function Dashboard() {
  const { token, user } = useAuth();
  const base = marketsBase();
  const userId = user?.id ?? user?.email ?? null;

  const [markets, setMarkets] = useState([]);
  const [selectedMarketId, setSelectedMarketId] = useState("");
  const [chartStartDate, setChartStartDate] = useState(() => defaultChartRange(30).startDate);
  const [chartEndDate, setChartEndDate] = useState(() => defaultChartRange(30).endDate);
  const [candles, setCandles] = useState([]);
  const [chartLoading, setChartLoading] = useState(false);
  const hasCandlesRef = useRef(false);

  const [downloadStartDate, setDownloadStartDate] = useState("");
  const [downloadEndDate, setDownloadEndDate] = useState("");
  const [canDownload, setCanDownload] = useState(false);

  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [chartTruncated, setChartTruncated] = useState(false);

  const selectedMarket = markets.find((m) => String(m.id) === selectedMarketId);
  const inviteUnlocked = Boolean(user?.can_download);

  const loadMarkets = useCallback(async () => {
    setLoading(true);
    try {
      const headers = authHeaders(token);
      const [marketRes, statusRes] = await Promise.all([
        fetch(`${base}?page=1&pageSize=1000`, { headers, credentials: "include" }),
        fetch(`${base}/download-status`, { headers, credentials: "include" }),
      ]);
      const marketData = await marketRes.json();
      const statusData = await statusRes.json();
      const items = marketData.items ?? [];
      setMarkets(items);
      setCanDownload(Boolean(statusData.canDownload));
      setSelectedMarketId((prev) => {
        if (prev && items.some((m) => String(m.id) === prev)) return prev;
        return items.length ? String(items[0].id) : "";
      });
    } catch {
      setMessage("Failed to load markets. Is the backend running?");
    } finally {
      setLoading(false);
    }
  }, [base, token]);

  const loadChart = useCallback(
    async (market, startDate, endDate, { silent = false } = {}) => {
      if (!market || !startDate || !endDate) {
        setCandles([]);
        hasCandlesRef.current = false;
        return;
      }
      const start = toMs(startDate);
      const end = toMs(endDate) + 24 * 60 * 60 * 1000 - 1;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
        setMessage("Chart end date must be on or after the start date.");
        setCandles([]);
        hasCandlesRef.current = false;
        return;
      }
      const showLoading = !silent || !hasCandlesRef.current;
      if (showLoading) setChartLoading(true);
      if (!silent) {
        setMessage("");
        setChartTruncated(false);
      }
      try {
        const response = await fetch(`${base}/candles`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", ...authHeaders(token) },
          body: JSON.stringify({
            market: market.name,
            interval: market.interval,
            start_timestamp: start,
            end_timestamp: end,
            chart: true,
          }),
        });
        const body = await response.json();
        if (!response.ok) {
          if (!silent) {
            setMessage(body.message ?? "Failed to load chart data");
            setCandles([]);
            hasCandlesRef.current = false;
          }
          return;
        }
        const next = body.combined ?? [];
        setCandles(next);
        hasCandlesRef.current = next.length > 0;
        setChartTruncated(Boolean(body.truncated));
      } catch {
        if (!silent) {
          setMessage("Failed to load chart data");
          setCandles([]);
          hasCandlesRef.current = false;
        }
      } finally {
        if (showLoading) setChartLoading(false);
      }
    },
    [base, token]
  );

  useEffect(() => {
    if (userId) void loadMarkets();
  }, [userId, loadMarkets]);

  useEffect(() => {
    if (!selectedMarket) return undefined;
    // Force a visible load for market/range changes; keep current candles until new data arrives.
    hasCandlesRef.current = false;
    void loadChart(selectedMarket, chartStartDate, chartEndDate);
    const timer = setInterval(() => {
      void loadChart(selectedMarket, chartStartDate, chartEndDate, { silent: true });
    }, CHART_REFRESH_MS);
    return () => clearInterval(timer);
  }, [selectedMarketId, selectedMarket?.name, selectedMarket?.interval, chartStartDate, chartEndDate, loadChart]);

  async function downloadCsv(event) {
    event.preventDefault();
    if (!inviteUnlocked) {
      setMessage("Invite at least one friend and have them accept to unlock downloads.");
      return;
    }
    if (!selectedMarket || !downloadStartDate || !downloadEndDate) {
      setMessage("Please fill the download form");
      return;
    }
    if (!canDownload) {
      setMessage("You have already downloaded a CSV today. Try again tomorrow.");
      return;
    }

    const start = toMs(downloadStartDate);
    const end = toMs(downloadEndDate) + 24 * 60 * 60 * 1000 - 1;
    const url = `${base}/download?market=${encodeURIComponent(selectedMarket.name)}&interval=${encodeURIComponent(selectedMarket.interval)}&start=${start}&end=${end}`;

    try {
      const response = await fetch(url, { headers: authHeaders(token), credentials: "include" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setMessage(body.message ?? "Download failed");
        if (response.status === 429) setCanDownload(false);
        return;
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${selectedMarket.name}-${selectedMarket.interval}-${start}-${end}.csv`;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
      setCanDownload(false);
      setMessage("CSV downloaded. You can download again tomorrow.");
    } catch {
      setMessage("Download failed");
    }
  }

  return (
    <>
      {message ? <p className="message">{message}</p> : null}

      <section className="card">
        <h2>Market Chart</h2>
        {loading ? <p>Loading markets...</p> : null}
        {!loading && !markets.length ? <p>No registered markets yet.</p> : null}
        {markets.length ? (
          <>
            <form
              className="row-form"
              onKeyDown={handleFormEnterKeyDown}
              onSubmit={(event) => {
                event.preventDefault();
                if (selectedMarket) void loadChart(selectedMarket, chartStartDate, chartEndDate);
              }}
            >
              <label>
                Market
                <select value={selectedMarketId} onChange={(e) => setSelectedMarketId(e.target.value)}>
                  {markets.map((m) => (
                    <option key={m.id} value={String(m.id)}>
                      {m.name} · {m.interval}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Chart Start
                <input type="date" value={chartStartDate} onChange={(e) => setChartStartDate(e.target.value)} required />
              </label>
              <label>
                Chart End
                <input type="date" value={chartEndDate} onChange={(e) => setChartEndDate(e.target.value)} required />
              </label>
              <button type="submit" className="primary">
                Refresh Chart
              </button>
            </form>
            <div className={`chart-status${chartLoading ? " is-loading" : ""}`} aria-live="polite">
              {chartLoading ? "Loading chart…" : chartTruncated ? "Showing the most recent 5,000 candles for this range." : "\u00a0"}
            </div>
            <OhlcChart
              candles={candles}
              marketLabel={selectedMarket ? `${selectedMarket.name} · ${selectedMarket.interval}` : ""}
              resetViewKey={`${selectedMarketId}|${chartStartDate}|${chartEndDate}`}
            />
          </>
        ) : null}
      </section>

      <section className="card">
        <h2>Download CSV</h2>
        <p className="meta download-note">
          {!inviteUnlocked
            ? "Invite one friend to unlock CSV downloads."
            : canDownload
              ? "You can download one CSV export per day."
              : "Daily download used — you can download again tomorrow (UTC)."}
        </p>
        <form onSubmit={downloadCsv} onKeyDown={handleFormEnterKeyDown} className="row-form">
          <label>
            Market
            <select value={selectedMarketId} onChange={(e) => setSelectedMarketId(e.target.value)} disabled={!markets.length}>
              {markets.map((m) => (
                <option key={m.id} value={String(m.id)}>
                  {m.name} · {m.interval}
                </option>
              ))}
            </select>
          </label>
          <label>
            Start Date
            <input type="date" value={downloadStartDate} onChange={(e) => setDownloadStartDate(e.target.value)} required />
          </label>
          <label>
            End Date
            <input type="date" value={downloadEndDate} onChange={(e) => setDownloadEndDate(e.target.value)} required />
          </label>
          <button type="submit" className="primary" disabled={!markets.length || !canDownload || !inviteUnlocked}>
            Download CSV
          </button>
        </form>
      </section>
    </>
  );
}
