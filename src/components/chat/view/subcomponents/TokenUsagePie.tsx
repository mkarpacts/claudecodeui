type TokenUsagePieProps = {
  used: number;
  total: number;
};

export default function TokenUsagePie({ used, total }: TokenUsagePieProps) {
  // Token usage visualization component
  // Only bail out on missing values or non‐positive totals; allow used===0 to render 0%
  if (used == null || total == null || total <= 0) return null;

  const percentage = Math.min(100, (used / total) * 100);
  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  const getColor = () => {
    if (percentage <= 25) return '#22c55e';
    if (percentage <= 50) return '#eab308';
    if (percentage <= 75) return '#f59e0b';
    return '#ef4444';
  };

  const tooltip = `Kapacita konverzace: ${used.toLocaleString('cs-CZ')} / ${total.toLocaleString('cs-CZ')}`;

  return (
    <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400" title={tooltip}>
      <svg width="24" height="24" viewBox="0 0 24 24" className="-rotate-90 transform">
        {/* Background circle */}
        <circle
          cx="12"
          cy="12"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-gray-300 dark:text-gray-600"
        />
        {/* Progress circle */}
        <circle
          cx="12"
          cy="12"
          r={radius}
          fill="none"
          stroke={getColor()}
          strokeWidth="2"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <span>{percentage.toFixed(1)}%</span>
    </div>
  );
}