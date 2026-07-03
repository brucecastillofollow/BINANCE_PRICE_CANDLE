import { useEffect, useRef } from "react";
import { createChart, CandlestickSeries } from "lightweight-charts";

export default function OhlcChart({ candles, marketLabel }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) {
      return undefined;
    }

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 360,
      layout: {
        background: { color: "#ffffff" },
        textColor: "#334155",
      },
      grid: {
        vertLines: { color: "#e2e8f0" },
        horzLines: { color: "#e2e8f0" },
      },
      rightPriceScale: { borderColor: "#cbd5e1" },
      timeScale: { borderColor: "#cbd5e1" },
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
  }, []);

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
