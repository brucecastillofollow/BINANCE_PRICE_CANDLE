export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function adminHeaders() {
  const key = import.meta.env.VITE_ADMIN_API_KEY;
  return key ? { "X-Admin-Key": key } : {};
}

export function marketsBase() {
  const base = API_BASE || "";
  return `${base}/markets`;
}

export function toMs(dateValue) {
  return new Date(`${dateValue}T00:00:00.000Z`).getTime();
}

export function formatDateInput(date) {
  return date.toISOString().slice(0, 10);
}

export function defaultChartRange(days = 30) {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);
  return {
    startDate: formatDateInput(start),
    endDate: formatDateInput(end),
  };
}
