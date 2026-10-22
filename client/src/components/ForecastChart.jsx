const ForecastChart = ({ data = [] }) => {
  if (!data.length) {
    return <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">No forecast data yet.</div>;
  }

  const max = Math.max(...data.map((point) => Number(point.value || 0)), 1);
  const points = data
    .map((point, index) => {
      const value = Number(point.value || 0);
      const x = (index / Math.max(data.length - 1, 1)) * 100;
      const y = 100 - (value / max) * 80 - 10;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-48 w-full">
        <defs>
          <linearGradient id="forecastLine" x1="0" x2="1">
            <stop offset="0%" stopColor="#c56b4a" />
            <stop offset="100%" stopColor="#7a8b6f" />
          </linearGradient>
        </defs>
        <polyline
          fill="none"
          stroke="url(#forecastLine)"
          strokeWidth="2.5"
          points={points}
        />
      </svg>
      <div className="mt-2 flex justify-between text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
        {data.slice(0, 5).map((point) => (
          <span key={point.label}>{point.label}</span>
        ))}
      </div>
    </div>
  );
};

export default ForecastChart;
