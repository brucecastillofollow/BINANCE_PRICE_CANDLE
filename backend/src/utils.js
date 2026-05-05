export function isValidMarketName(value) {
  return typeof value === "string" && /^[A-Z0-9]{5,20}$/.test(value.trim());
}

export function toTableName(marketName) {
  return `market_${marketName.toLowerCase()}`;
}

export function sanitizeCsvValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value);
  if (/[,"\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}
