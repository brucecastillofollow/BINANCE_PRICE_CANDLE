import { useEffect, useRef, useState } from "react";
import { createChart, CandlestickSeries } from "lightweight-charts";
import { CHART_THEMES, getStoredTheme } from "../lib/theme.js";

export default function OhlcChart({ candles, marketLabel }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const [theme, setTheme] = useState(() => getStoredTheme());

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      const next = root.dataset.theme === "day" ? "day" : "night";
      setTheme(next);
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!containerRef.current) {
      return undefined;
    }

    const colors = CHART_THEMES[theme] ?? CHART_THEMES.night;
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 360,
      layout: {
        background: { color: colors.background },
        textColor: colors.textColor,
      },
      grid: {
        vertLines: { color: colors.grid },
        horzLines: { color: colors.grid },
      },
      rightPriceScale: { borderColor: colors.border },
      timeScale: { borderColor: colors.border },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#16a34a",
      downColor: "#dc2626",
      borderVisible: false,
      wickUpColor: "#16a34a",
      wickDownColor: "#dc2626",
    });

    chartRef.current = { chart, series };

    const onResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [theme]);

  useEffect(() => {
    if (!chartRef.current?.series) {
      return;
    }
    const data = (candles ?? [])
      .map((row) => ({
        time: Math.floor(Number(row.open_time) / 1000),
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
      }))
      .filter((row) => Number.isFinite(row.time) && Number.isFinite(row.open));
    chartRef.current.series.setData(data);
    chartRef.current.chart.timeScale().fitContent();
  }, [candles]);

  return (
    <div className="chart-wrap">
      <div className="chart-head">
        <strong>{marketLabel || "OHLC"}</strong>
        <span className="meta">{candles?.length ? `${candles.length} candles` : "No data"}</span>
      </div>
      <div ref={containerRef} className="chart-canvas" />
    </div>
  );
}
