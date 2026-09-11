// Kleine localStorage-helpers met try/catch, zodat een private/incognito-browser
// (waar localStorage kan gooien) de app niet crasht.
export function loadLS(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
export function saveLS(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
