export const MONTHS_NL = ["Januari","Februari","Maart","April","Mei","Juni","Juli","Augustus","September","Oktober","November","December"];
export const DAYS_NL = ["Ma","Di","Wo","Do","Vr","Za","Zo"];

export function formatDate(dt) { if (!dt) return ""; return new Date(dt).toLocaleDateString("nl-NL", { weekday:"long", day:"numeric", month:"long" }); }
export function formatTime(dt) { if (!dt) return ""; return new Date(dt).toLocaleTimeString("nl-NL", { hour:"2-digit", minute:"2-digit" }); }

// "Geen specifieke tijd" wordt aangegeven met 00:00 (zie het formulier) -- zo'n event toont dan
// nergens een tijd, i.p.v. de verwarrende "00:00" te laten zien.
export function isTimeSet(ev) {
  const s = new Date(ev.start_time);
  if (s.getHours()!==0 || s.getMinutes()!==0) return true;
  if (ev.end_time) { const e = new Date(ev.end_time); if (e.getHours()!==0 || e.getMinutes()!==0) return true; }
  return false;
}

// Nieuw #2: meerdaagse evenementen -- valt "dag" (middernacht) binnen [start,end], op datum vergeleken (niet op tijd)?
export function isMultiDay(ev) { return ev.end_time && toDateStr(new Date(ev.start_time)) !== toDateStr(new Date(ev.end_time)); }
export function dayInRange(day, startTime, endTime) {
  const d = toDateStr(day);
  const s = toDateStr(new Date(startTime));
  const e = endTime ? toDateStr(new Date(endTime)) : s;
  return d >= s && d <= e;
}
export function formatRange(startTime, endTime) {
  if (!isMultiDay({ start_time:startTime, end_time:endTime })) return formatDate(startTime);
  return `${formatDate(startTime)} t/m ${formatDate(endTime)}`;
}
// Compacte meerdaagse notatie, bv. "VR 9 – ZA 10 OKTOBER" (of "VR 9 SEP – ZA 3 OKTOBER" over maandgrenzen heen).
export function formatRangeCompact(startTime, endTime) {
  const s = new Date(startTime), e = new Date(endTime);
  const wd = d => d.toLocaleDateString("nl-NL",{weekday:"short"}).toUpperCase();
  const sameMonth = s.getMonth()===e.getMonth() && s.getFullYear()===e.getFullYear();
  const sMonth = sameMonth ? "" : ` ${s.toLocaleDateString("nl-NL",{month:"short"}).toUpperCase()}`;
  const eMonth = ` ${e.toLocaleDateString("nl-NL",{month:"long"}).toUpperCase()}`;
  const year = s.getFullYear()!==e.getFullYear() ? ` ${e.getFullYear()}` : "";
  return `${wd(s)} ${s.getDate()}${sMonth} – ${wd(e)} ${e.getDate()}${eMonth}${year}`;
}

// Nieuw #1: terugkerende events. De datetime-local velden ("YYYY-MM-DDTHH:mm") worden
// door de rest van de app als lokale, naïeve strings behandeld -- deze helpers rekenen
// in diezelfde vorm, zodat gegenereerde occurrences zich identiek gedragen aan een
// handmatig aangemaakt event.
export function toDatetimeLocalStr(d) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
// Zet een naive "YYYY-MM-DDTHH:mm" waarde (zoals <input type=datetime-local> geeft, door de
// browser als lokale tijd bedoeld) om naar een UTC ISO-string voor opslag in een timestamptz-kolom.
// Zonder deze stap slaat Postgres de string ongewijzigd als UTC op, waardoor de tijd bij het
// terugtonen (die wél correct UTC->lokaal omrekent) een uur/twee uur verschuift.
export function localToUtcIso(naiveLocalStr) {
  return naiveLocalStr ? new Date(naiveLocalStr).toISOString() : null;
}
export function computeRecurrenceStarts(startLocalStr, freq, until, count) {
  const first = new Date(startLocalStr);
  const untilDate = until ? new Date(until + "T23:59:59") : null;
  const maxCount = Math.min(count ? parseInt(count, 10) : 52, 104); // hard veiligheidsplafond
  const out = [first];
  for (let i = 1; i < maxCount; i++) {
    const d = new Date(first);
    if (freq === "weekly") d.setDate(d.getDate() + i * 7);
    else if (freq === "monthly") d.setMonth(d.getMonth() + i);
    else break;
    if (untilDate && d > untilDate) break;
    out.push(d);
  }
  return out;
}

export function isUpcoming(dt) { return new Date(dt) >= new Date(); }
export function daysUntil(dt) { return Math.ceil((new Date(dt) - new Date()) / 86400000); }

// Lokale datum als "YYYY-MM-DD" -- toISOString() zou hier verkeerd zijn: die
// converteert naar UTC en schuift de datum een dag terug in NL-tijdzones (UTC+1/+2).
export function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getNextThursday() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const diff = (4 - d.getDay() + 7) % 7; // 4 = donderdag
  d.setDate(d.getDate() + diff);
  return toDateStr(d);
}

export function getUpcomingThursdays(n) {
  const start = new Date(getNextThursday() + "T00:00:00"); // lokale tijd, geen UTC-parse
  const list = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i * 7);
    list.push(toDateStr(d));
  }
  return list;
}

export function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  d.setHours(0,0,0,0);
  return d;
}

export function getCalendarDays(year, month) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  let startDay = first.getDay(); if (startDay === 0) startDay = 7;
  const days = [];
  for (let i = 1; i < startDay; i++) days.push(null);
  for (let d = 1; d <= last.getDate(); d++) days.push(new Date(year, month, d));
  return days;
}
