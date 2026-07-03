import { useEffect, useState } from "react";
import { API_BASE, defaultChartRange, toMs } from "../api.js";
import OhlcChart from "../components/OhlcChart.jsx";
import SiteBrand from "../components/SiteBrand.jsx";

export default function Dashboard() {
  const [markets, setMarkets] = useState([]);
  const [selectedMarketId, setSelectedMarketId] = useState("");
  const [chartStartDate, setChartStartDate] = useState(() => defaultChartRange(30).startDate);
  const [chartEndDate, setChartEndDate] = useState(() => defaultChartRange(30).endDate);
  const [candles, setCandles] = useState([]);
  const [chartLoading, setChartLoading] = useState(false);

  const [downloadStartDate, setDownloadStartDate] = useState("");
  const [downloadEndDate, setDownloadEndDate] = useState("");
  const [canDownload, setCanDownload] = useState(true);

  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [chartTruncated, setChartTruncated] = useState(false);

  const selectedMarket = markets.find((m) => String(m.id) === selectedMarketId);

  async function loadMarkets() {
    setLoading(true);
    try {
      const [marketRes, statusRes] = await Promise.all([
        fetch(`${API_BASE}/markets?page=1&pageSize=1000`),
        fetch(`${API_BASE}/markets/download-status`),
      ]);
      const marketData = await marketRes.json();
      const statusData = await statusRes.json();
      const items = marketData.items ?? [];
      setMarkets(items);
      setCanDownload(Boolean(statusData.canDownload));
      if (items.length && !selectedMarketId) {
        setSelectedMarketId(String(items[0].id));
      }
    } catch {
      setMessage("Failed to load markets. Is the backend running?");
    } finally {
      setLoading(false);
    }
  }

  async function loadChart(market, startDate, endDate) {
    if (!market || !startDate || !endDate) {
      setCandles([]);
      return;
    }
    const start = toMs(startDate);
    const end = toMs(endDate) + 24 * 60 * 60 * 1000 - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      setMessage("Chart end date must be on or after the start date.");
      setCandles([]);
      return;
    }
    setChartLoading(true);
    setMessage("");
    setChartTruncated(false);
    try {
      const response = await fetch(`${API_BASE}/markets/candles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        setMessage(body.message ?? "Failed to load chart data");
        setCandles([]);
        return;
      }
      setCandles(body.combined ?? []);
      setChartTruncated(Boolean(body.truncated));
    } catch {
      setMessage("Failed to load chart data");
      setCandles([]);
    } finally {
      setChartLoading(false);
    }
  }

  useEffect(() => {
    void loadMarkets();
  }, []);

  useEffect(() => {
    if (selectedMarket) {
      void loadChart(selectedMarket, chartStartDate, chartEndDate);
    }
  }, [selectedMarketId, chartStartDate, chartEndDate, markets]);

  async function downloadCsv(event) {
    event.preventDefault();
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
    const url = `${API_BASE}/markets/download?market=${encodeURIComponent(selectedMarket.name)}&interval=${encodeURIComponent(selectedMarket.interval)}&start=${start}&end=${end}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setMessage(body.message ?? "Download failed");
        if (response.status === 429) {
          setCanDownload(false);
        }
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
    <div className="app">
      <header className="page-header">
        <SiteBrand
          title="Market Dashboard"
          subtitle="View OHLC charts and export candle data for registered markets."
        />
      </header>
      {message ? <p className="message">{message}</p> : null}

      <section className="card">
        <h2>Market Chart</h2>
        {loading ? <p>Loading markets...</p> : null}
        {!loading && !markets.length ? <p>No registered markets yet.</p> : null}
        {markets.length ? (
          <>
            <form
              className="row-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (selectedMarket) {
                  void loadChart(selectedMarket, chartStartDate, chartEndDate);
                }
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
                <input
                  type="date"
                  value={chartStartDate}
                  onChange={(e) => setChartStartDate(e.target.value)}
                  required
                />
              </label>
              <label>
                Chart End
                <input
                  type="date"
                  value={chartEndDate}
                  onChange={(e) => setChartEndDate(e.target.value)}
                  required
                />
              </label>
              <button type="submit" className="primary">
                Refresh Chart
              </button>
            </form>
            {chartLoading ? <p>Loading chart...</p> : null}
            {chartTruncated ? (
              <p className="meta">Showing the most recent 5,000 candles for this range.</p>
            ) : null}
            <OhlcChart
              candles={candles}
              marketLabel={selectedMarket ? `${selectedMarket.name} · ${selectedMarket.interval}` : ""}
            />
          </>
        ) : null}
      </section>

      <section className="card">
        <h2>Download CSV</h2>
        <p className="meta download-note">
          {canDownload
            ? "You can download one CSV export per day."
            : "Daily download used — you can download again tomorrow (UTC)."}
        </p>
        <form onSubmit={downloadCsv} className="row-form">
          <label>
            Market
            <select
              value={selectedMarketId}
              onChange={(e) => setSelectedMarketId(e.target.value)}
              disabled={!markets.length}
            >
              {markets.map((m) => (
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
          <button type="submit" className="primary" disabled={!markets.length || !canDownload}>
            Download CSV
          </button>
        </form>
      </section>
    </div>
  );
}
