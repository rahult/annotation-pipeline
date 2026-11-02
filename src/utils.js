export function download(content, filename, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function formatValue(value, unit = 'score') {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  if (unit === 'ms') return Number(value) >= 1000 ? `${(Number(value) / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
  if (unit === 'usd') return `$${Number(value).toFixed(3)}`;
  if (unit === 'percent') return `${Number(value).toFixed(1)}%`;
  return Number(value).toFixed(2);
}

export function timeAgo(date) {
  const ms = Date.now() - new Date(date).getTime();
  if (!Number.isFinite(ms)) return 'Unknown';
  if (ms < 60_000) return 'Just now';
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}h ago`;
  if (ms < 7 * 86400_000) return `${Math.floor(ms / 86400_000)}d ago`;
  return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function dateTime(date) {
  return new Date(date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function classNames(...parts) { return parts.filter(Boolean).join(' '); }

export function clone(value) { return structuredClone(value); }

export function runLabel(run) { return run.label || run.id.replace(/^run[_-]?/i, 'RUN-').slice(0, 16); }

export function scoreLabel(score) { return score == null ? '—' : Number(score).toFixed(1); }
