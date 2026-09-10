import { useState, useEffect, useRef } from "react";
import clubLogo from "./images/logohhc.jpg";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const BASE_CATEGORIES = ["Evenement", "Vergadering", "Overig"];
const DEFAULT_COLORS = { Evenement:"#F18C21", Vergadering:"#2E3192", Overig:"#2FA8D8" };
const MONTHS_NL = ["Januari","Februari","Maart","April","Mei","Juni","Juli","Augustus","September","Oktober","November","December"];
const DAYS_NL = ["Ma","Di","Wo","Do","Vr","Za","Zo"];
const ROLE_LABELS = { viewer:"Bekijker", editor:"Redacteur", super:"Beheerder" };
const DEFAULT_CHECKLIST_ITEMS = ["Bier/frisdrank aangevuld", "Kleingeld/kassa gecontroleerd", "Voorraad koffie/thee", "Afsluiten & apparatuur uit"]; // nieuw #38

// `prefer` defaults to "return=representation" (ask PostgREST to hand back the
// row). For tables that are insert-only for anon with no SELECT policy (like
// "ideas" -- intentionally unreadable by the public key), RETURNING also gets
// checked against the SELECT policy, so it fails RLS even though the INSERT
// itself is allowed. Pass "return=minimal" for those.
async function sb(endpoint, method = "GET", body = null, prefer = "return=representation") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
    method,
    headers: { apikey:SUPABASE_ANON_KEY, Authorization:`Bearer ${SUPABASE_ANON_KEY}`, "Content-Type":"application/json", Prefer:prefer },
    ...(body ? { body:JSON.stringify(body) } : {}),
  });
  if (!res.ok) return [];
  try { return await res.json(); } catch { return []; }
}

// Admin writes go through the "admin" Edge Function, which checks the pincode
// server-side and uses the service-role key — the anon key alone can no longer
// write to events/bardienst (see RLS policies), so a stolen anon key is useless.
async function adminApi(body) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/admin`, {
      method: "POST",
      headers: { apikey:SUPABASE_ANON_KEY, Authorization:`Bearer ${SUPABASE_ANON_KEY}`, "Content-Type":"application/json" },
      body: JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch {}
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok:false, status:0, data:{ error:"Netwerkfout" } };
  }
}

function getStoredSession() {
  const s = loadLS("hhc09_admin_session", null);
  if (s && s.token && s.role && s.expires_at && new Date(s.expires_at) > new Date()) return s;
  return null;
}

function loadLS(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } }
function saveLS(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

// Verbetering #6/#21: vergelijkt een formulierstate met de staat bij het openen,
// om te kunnen waarschuwen voor niet-opgeslagen wijzigingen bij het sluiten.
function isDirty(current, initial) {
  if (!initial) return false;
  return JSON.stringify(current) !== JSON.stringify(initial);
}

// Verbetering #23: contrast van een categoriekleur tegen witte tekst (WCAG-formule),
// zodat een te lichte kleur in de instellingen gesignaleerd kan worden.
function hexToRgb(hex) {
  const h = (hex || "").replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  const num = parseInt(full, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}
function relLuminance([r, g, b]) {
  const [R, G, B] = [r, g, b].map(c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}
function contrastWithWhite(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 21;
  return 1.05 / (relLuminance(rgb) + 0.05);
}

// Verbetering #34: houdt een net gefocust veld in een modal zichtbaar boven het
// (mobiele) toetsenbord, i.p.v. dat de gebruiker zelf moet scrollen.
function handleModalFocus(e) {
  const t = e.target;
  if (t && t.matches && t.matches("input,textarea,select")) {
    setTimeout(() => t.scrollIntoView({ block:"center", behavior:"smooth" }), 60);
  }
}

function formatDate(dt) { if (!dt) return ""; return new Date(dt).toLocaleDateString("nl-NL", { weekday:"long", day:"numeric", month:"long" }); }
function formatTime(dt) { if (!dt) return ""; return new Date(dt).toLocaleTimeString("nl-NL", { hour:"2-digit", minute:"2-digit" }); }

// Nieuw #2: meerdaagse evenementen -- valt "dag" (middernacht) binnen [start,end], op datum vergeleken (niet op tijd)?
function isMultiDay(ev) { return ev.end_time && toDateStr(new Date(ev.start_time)) !== toDateStr(new Date(ev.end_time)); }
function dayInRange(day, startTime, endTime) {
  const d = toDateStr(day);
  const s = toDateStr(new Date(startTime));
  const e = endTime ? toDateStr(new Date(endTime)) : s;
  return d >= s && d <= e;
}
function formatRange(startTime, endTime) {
  if (!isMultiDay({ start_time:startTime, end_time:endTime })) return formatDate(startTime);
  return `${formatDate(startTime)} t/m ${formatDate(endTime)}`;
}

// Nieuw #1: terugkerende events. De datetime-local velden ("YYYY-MM-DDTHH:mm") worden
// door de rest van de app als lokale, naïeve strings behandeld (zie openEdit: ev.start_time.slice(0,16)) --
// deze helpers rekenen in diezelfde vorm, zodat gegenereerde occurrences zich identiek gedragen
// aan een handmatig aangemaakt event.
function toDatetimeLocalStr(d) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function computeRecurrenceStarts(startLocalStr, freq, until, count) {
  const first = new Date(startLocalStr);
  const untilDate = until ? new Date(until + "T23:59:59") : null;
  const maxCount = Math.min(count ? parseInt(count, 10) : 52, 104); // hard veiligheidsplafond
  const out = [first];
  for (let i = 1; i < maxCount; i++) {
    const d = new Date(startLocalStr);
    if (freq === "weekly") d.setDate(d.getDate() + 7 * i);
    else if (freq === "monthly") d.setMonth(d.getMonth() + i);
    else break;
    if (untilDate && d > untilDate) break;
    out.push(d);
  }
  return out;
}
function isUpcoming(dt) { return new Date(dt) >= new Date(); }
function daysUntil(dt) { return Math.ceil((new Date(dt) - new Date()) / 86400000); }

// Lokale datum als "YYYY-MM-DD" -- toISOString() zou hier verkeerd zijn: die
// converteert naar UTC en schuift de datum een dag terug in NL-tijdzones (UTC+1/+2).
function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getNextThursday() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const diff = (4 - d.getDay() + 7) % 7; // 4 = donderdag
  d.setDate(d.getDate() + diff);
  return toDateStr(d);
}

function getUpcomingThursdays(n) {
  const start = new Date(getNextThursday() + "T00:00:00"); // lokale tijd, geen UTC-parse
  const list = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i * 7);
    list.push(toDateStr(d));
  }
  return list;
}

const WMO_WEATHER = {
  0:{icon:"☀️",label:"Helder"}, 1:{icon:"🌤️",label:"Vrijwel onbewolkt"}, 2:{icon:"⛅",label:"Half bewolkt"}, 3:{icon:"☁️",label:"Bewolkt"},
  45:{icon:"🌫️",label:"Mist"}, 48:{icon:"🌫️",label:"Mist"},
  51:{icon:"🌦️",label:"Lichte motregen"}, 53:{icon:"🌦️",label:"Motregen"}, 55:{icon:"🌦️",label:"Zware motregen"},
  56:{icon:"🌧️",label:"Lichte ijzel"}, 57:{icon:"🌧️",label:"Ijzel"},
  61:{icon:"🌧️",label:"Lichte regen"}, 63:{icon:"🌧️",label:"Regen"}, 65:{icon:"🌧️",label:"Zware regen"},
  66:{icon:"🌧️",label:"IJzel"}, 67:{icon:"🌧️",label:"Zware ijzel"},
  71:{icon:"❄️",label:"Lichte sneeuw"}, 73:{icon:"❄️",label:"Sneeuw"}, 75:{icon:"❄️",label:"Zware sneeuw"}, 77:{icon:"❄️",label:"Sneeuwkorrels"},
  80:{icon:"🌧️",label:"Lichte regenbui"}, 81:{icon:"🌧️",label:"Regenbui"}, 82:{icon:"🌧️",label:"Zware regenbui"},
  85:{icon:"❄️",label:"Lichte sneeuwbui"}, 86:{icon:"❄️",label:"Sneeuwbui"},
  95:{icon:"⛈️",label:"Onweer"}, 96:{icon:"⛈️",label:"Onweer met hagel"}, 99:{icon:"⛈️",label:"Zwaar onweer"},
};
function getWeatherInfo(code) { return WMO_WEATHER[code] || { icon:"🌡️", label:"Onbekend" }; }

function getGoogleCalendarUrl(ev) {
  const fmt = d => new Date(d).toISOString().replace(/[-:]/g,"").slice(0,15) + "Z";
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(ev.title)}&dates=${fmt(ev.start_time)}/${fmt(ev.end_time||ev.start_time)}&details=${encodeURIComponent(ev.description||"")}&location=${encodeURIComponent(ev.location||"")}`;
}

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  d.setHours(0,0,0,0);
  return d;
}

function getCalendarDays(year, month) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  let startDay = first.getDay(); if (startDay === 0) startDay = 7;
  const days = [];
  for (let i = 1; i < startDay; i++) days.push(null);
  for (let d = 1; d <= last.getDate(); d++) days.push(new Date(year, month, d));
  return days;
}

function generateICS(event) {
  const fmt = d => new Date(d).toISOString().replace(/[-:]/g,"").slice(0,15) + "Z";
  return ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//HHC09//Events//NL","BEGIN:VEVENT",
    `UID:${event.id}@hhc09.nl`,`DTSTART:${fmt(event.start_time)}`,`DTEND:${fmt(event.end_time||event.start_time)}`,
    `SUMMARY:${event.title}`,`DESCRIPTION:${(event.description||"").replace(/\n/g,"\\n")}`,`LOCATION:${event.location||""}`,
    "END:VEVENT","END:VCALENDAR"].join("\r\n");
}

function downloadICS(event) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([generateICS(event)], { type:"text/calendar" }));
  a.download = `${event.title.replace(/\s+/g,"-")}.ics`;
  a.click(); URL.revokeObjectURL(a.href);
}

// ---- NAV ICON (outline, monochroom voor de mobiele navbar) ----
function NavIcon({ name }) {
  const p = { width:20, height:20, viewBox:"0 0 24 24", fill:"none", stroke:"currentColor", strokeWidth:1.8, strokeLinecap:"round", strokeLinejoin:"round" };
  switch (name) {
    case "agenda":
      return <svg {...p}><circle cx="5" cy="6" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="5" cy="18" r="1"/><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="17" y2="18"/></svg>;
    case "nieuws":
      return <svg {...p}><path d="M12 3a4 4 0 0 0-4 4v3.5c0 1.2-.5 2.3-1.4 3.1L6 14h12l-.6-.4a4.2 4.2 0 0 1-1.4-3.1V7a4 4 0 0 0-4-4z"/><path d="M9.5 18a2.5 2.5 0 0 0 5 0"/></svg>;
    case "bardienst":
      return <svg {...p}><path d="M5 8h11v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V8z"/><path d="M16 10h2a2 2 0 1 1 0 4h-2"/><line x1="8" y1="5" x2="8" y2="8"/><line x1="11" y1="4" x2="11" y2="8"/></svg>;
    case "kalender":
      return <svg {...p}><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/></svg>;
    case "archief":
      return <svg {...p}><rect x="3" y="6" width="18" height="4" rx="1"/><path d="M5 10v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/><line x1="10" y1="14" x2="14" y2="14"/></svg>;
    case "statistieken":
      return <svg {...p}><line x1="4" y1="20" x2="20" y2="20"/><line x1="7" y1="20" x2="7" y2="12"/><line x1="12" y1="20" x2="12" y2="6"/><line x1="17" y1="20" x2="17" y2="15"/></svg>;
    case "dashboard":
      return <svg {...p}><rect x="3" y="3" width="7" height="7" rx="1.2"/><rect x="14" y="3" width="7" height="7" rx="1.2"/><rect x="3" y="14" width="7" height="7" rx="1.2"/><rect x="14" y="14" width="7" height="7" rx="1.2"/></svg>;
    case "idee":
    case "ideeen":
      return <svg {...p}><path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.8 10.6c.6.5 1.05 1.4 1.05 2.4h5.5c0-1 .45-1.9 1.05-2.4A6 6 0 0 0 12 3z"/></svg>;
    default:
      return null;
  }
}

// ---- SKELETON CARD ----
function SkeletonCard({ delay = 0 }) {
  return (
    <div style={{ background:"#ffffff", border:"1px solid #ebe8df", borderLeft:"4px solid #ebe8df", borderRadius:8, padding:"18px 20px", position:"relative", overflow:"hidden", animationDelay:`${delay}s` }}>
      <div style={{ position:"absolute", inset:0, background:"linear-gradient(90deg,transparent 0%,#00000010 50%,transparent 100%)", animation:"shimmer 1.6s infinite" }} />
      <div style={{ display:"flex", justifyContent:"space-between", gap:16 }}>
        <div style={{ flex:1 }}>
          <div style={{ height:12, background:"#ebe8df", borderRadius:3, width:"25%", marginBottom:10 }} />
          <div style={{ height:20, background:"#ebe8df", borderRadius:3, width:"55%", marginBottom:8 }} />
          <div style={{ height:13, background:"#ebe8df", borderRadius:3, width:"75%", marginBottom:6 }} />
          <div style={{ height:13, background:"#ebe8df", borderRadius:3, width:"45%" }} />
        </div>
        <div style={{ width:52, height:52, background:"#ebe8df", borderRadius:6, flexShrink:0 }} />
      </div>
    </div>
  );
}

// ---- QR MODAL ----
function QRModal({ event, onClose, primaryColor }) {
  const url = encodeURIComponent(`${window.location.origin}${window.location.pathname}#event-${event.id}`);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${url}&color=${primaryColor.replace("#","")}&bgcolor=ffffff`;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth:340, textAlign:"center" }} onClick={e=>e.stopPropagation()}>
        <h2 style={{ fontSize:20, fontWeight:900, textTransform:"uppercase", marginBottom:4 }}>{event.title}</h2>
        <div style={{ fontSize:13, color:"#76756f", fontFamily:"Barlow,sans-serif", marginBottom:20 }}>{formatDate(event.start_time)}</div>
        <img src={qrUrl} alt="QR code" style={{ width:250, height:250, borderRadius:8, border:"1px solid #e7e4da" }} />
        <div style={{ fontSize:12, color:"#76756f", marginTop:12, fontFamily:"Barlow,sans-serif" }}>Scan voor meer info · Zet op flyers</div>
        <div style={{ display:"flex", gap:10, marginTop:20 }}>
          <a href={qrUrl} download={`qr-${event.id}.png`} className="btn-red" style={{ flex:1, textDecoration:"none", display:"block", textAlign:"center", padding:"10px" }}>Download QR</a>
          <button className="btn-ghost" onClick={onClose}>Sluiten</button>
        </div>
      </div>
    </div>
  );
}

// ---- ATTENDEE MODAL ----
function AttendeeModal({ event, attendees, onClose, onRegister, primaryColor }) {
  const [name, setName] = useState("");
  const [registered, setRegistered] = useState(() => loadLS("hhc09_registered_events", []).includes(event.id));
  const list = attendees[event.id] || [];

  function register() {
    if (!name || registered) return;
    onRegister(event.id, name);
    const ids = loadLS("hhc09_registered_events", []);
    if (!ids.includes(event.id)) saveLS("hhc09_registered_events", [...ids, event.id]);
    setRegistered(true);
    setName("");
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth:440 }} onClick={e=>e.stopPropagation()}>
        <h2 style={{ fontSize:20, fontWeight:900, textTransform:"uppercase", marginBottom:4 }}>{event.title}</h2>
        <div style={{ fontSize:13, color:"#76756f", fontFamily:"Barlow,sans-serif", marginBottom:20 }}>{formatDate(event.start_time)}</div>
        <div style={{ background:"#f3f1ea", borderRadius:8, padding:16, marginBottom:20 }}>
          <div style={{ fontSize:13, fontWeight:700, color:primaryColor, marginBottom:10, textTransform:"uppercase", letterSpacing:1 }}>✅ Aangemeld ({list.length})</div>
          {list.length === 0
            ? <div style={{ fontSize:13, color:"#76756f", fontFamily:"Barlow,sans-serif" }}>Nog niemand aangemeld</div>
            : <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>{list.map((a,i)=><span key={i} style={{ background:"#ebe8df", border:"1px solid #e7e4da", borderRadius:20, padding:"4px 12px", fontSize:13, fontFamily:"Barlow,sans-serif" }}>{a.attendee_name}</span>)}</div>
          }
        </div>
        {registered ? (
          <div style={{ background:primaryColor+"11", border:`1px solid ${primaryColor}33`, borderRadius:8, padding:"12px 14px", textAlign:"center", fontSize:14, fontWeight:700, color:primaryColor, fontFamily:"Barlow,sans-serif" }}>
            ✅ Je bent al aangemeld vanaf dit toestel
          </div>
        ) : (
          <div style={{ display:"flex", gap:8 }}>
            <input className="input" value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&register()} placeholder="Jouw naam" style={{ flex:1 }} />
            <button className="btn-red" onClick={register} disabled={!name}>Ik kom!</button>
          </div>
        )}
        <button className="btn-ghost" style={{ width:"100%", marginTop:10 }} onClick={onClose}>Sluiten</button>
      </div>
    </div>
  );
}

// ---- WEATHER WIDGET ----
function WeatherWidget({ location, startTime }) {
  const [weather, setWeather] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ok | outofrange | error | nolocation

  useEffect(() => {
    if (!location) { setStatus("nolocation"); return; }
    const days = daysUntil(startTime);
    if (days < 0 || days > 15) { setStatus("outofrange"); return; }
    setStatus("loading");
    let cancelled = false;
    (async () => {
      try {
        const geoCacheKey = `hhc09_geo_${location.toLowerCase()}`;
        let coords = loadLS(geoCacheKey, null);
        if (!coords) {
          const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=nl&country=NL`);
          const geoData = await geoRes.json();
          if (!geoData.results?.length) { if (!cancelled) setStatus("error"); return; }
          coords = { lat:geoData.results[0].latitude, lon:geoData.results[0].longitude };
          saveLS(geoCacheKey, coords);
        }
        const dateStr = new Date(startTime).toISOString().slice(0,10);
        const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode&timezone=auto&start_date=${dateStr}&end_date=${dateStr}`);
        const wData = await wRes.json();
        if (!wData.daily?.time?.length) { if (!cancelled) setStatus("error"); return; }
        if (!cancelled) {
          setWeather({
            max: Math.round(wData.daily.temperature_2m_max[0]),
            min: Math.round(wData.daily.temperature_2m_min[0]),
            rain: wData.daily.precipitation_probability_max[0],
            code: wData.daily.weathercode[0],
          });
          setStatus("ok");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, [location, startTime]);

  if (status === "nolocation" || status === "outofrange") return null;

  const info = weather ? getWeatherInfo(weather.code) : null;

  return (
    <div style={{ background:"#f3f1ea", borderRadius:8, padding:14, marginBottom:16 }}>
      <div style={{ fontSize:10, color:"#56554d", fontWeight:700, letterSpacing:2, textTransform:"uppercase", marginBottom:4 }}>Weersverwachting</div>
      {status === "loading" && <div style={{ fontSize:13, color:"#76756f", fontFamily:"Barlow,sans-serif" }}>Laden...</div>}
      {status === "error" && <div style={{ fontSize:13, color:"#76756f", fontFamily:"Barlow,sans-serif" }}>Geen voorspelling beschikbaar</div>}
      {status === "ok" && weather && info && (
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          <span style={{ fontSize:32 }}>{info.icon}</span>
          <div>
            <div style={{ fontSize:15, fontWeight:700 }}>{info.label} · {weather.min}° – {weather.max}°</div>
            <div style={{ fontSize:13, color:"#76756f", fontFamily:"Barlow,sans-serif" }}>☔ {weather.rain}% kans op neerslag</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- ADMIN DASHBOARD ----
function AdminDashboard({ events, attendees, bardienst, news, ideas, pinsList, pinResets, primaryColor, allCategories, categoryColors, onSelectEvent, onGoTab, onNewEvent, onNewBardienst, onNewNews, onOpenSettings }) {
  const now = new Date();
  const upcoming = events.filter(e => !e.archived && !e.hidden && isUpcoming(e.start_time));
  const past = events.filter(e => !e.archived && !isUpcoming(e.start_time));
  const archived = events.filter(e => e.archived);
  const thisMonth = events.filter(e => { const d=new Date(e.start_time); return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear(); });
  const totalAttendees = events.reduce((s,e) => s+(attendees[e.id]||[]).length, 0);
  const nextEvent = upcoming[0];
  const nonArchived = events.filter(e=>!e.archived);

  const todayStr = toDateStr(new Date());
  const upcomingBardienst = bardienst.filter(b => b.shift_date >= todayStr).slice(0, 5);
  const bardienstGaps = getUpcomingThursdays(6).filter(date => !bardienst.some(b => b.shift_date === date));
  const eventsMissingLocation = upcoming.filter(e => !e.location).length;
  const eventsMissingDescription = upcoming.filter(e => !e.description).length;

  const recentNews = news.slice(0, 3);
  const recentIdeas = ideas.slice(0, 3);

  const totalUpcomingCost = upcoming.filter(e => e.cost > 0).reduce((s, e) => s + Number(e.cost), 0);
  const sponsoredCount = nonArchived.filter(e => e.sponsor_name).length;

  const attendeeCounts = {};
  Object.values(attendees).flat().forEach(a => {
    const nm = (a.attendee_name || "").trim();
    if (!nm) return;
    attendeeCounts[nm] = (attendeeCounts[nm] || 0) + 1;
  });
  const topAttendees = Object.entries(attendeeCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const pinsByRole = { viewer:0, editor:0, super:0 };
  pinsList.forEach(p => { if (pinsByRole[p.role] != null) pinsByRole[p.role]++; });

  const stats = [
    { label:"Komende events", value:upcoming.length, color:primaryColor },
    { label:"Afgelopen", value:past.length, color:"#76756f" },
    { label:"Deze maand", value:thisMonth.length, color:"#f4a261" },
    { label:"Aanmeldingen", value:totalAttendees, color:"#2ec4b6" },
    { label:"Gearchiveerd", value:archived.length, color:"#6a4c93" },
    { label:"Bardiensten gepland", value:bardienst.length, color:"#457b9d" },
    { label:"Mededelingen", value:news.length, color:"#e76f51" },
    { label:"Ideeën binnen", value:ideas.length, color:"#2a9d8f" },
  ];

  const attentionItems = [
    ...bardienstGaps.map(date => ({ type:"warn", icon:"🍺", text:`Nog niemand ingepland voor bardienst op ${formatDate(date)}`, action:()=>onGoTab("bardienst") })),
    ...(eventsMissingLocation > 0 ? [{ type:"info", icon:"📍", text:`${eventsMissingLocation} komend${eventsMissingLocation===1?"":"e"} event${eventsMissingLocation===1?"":"s"} zonder locatie`, action:()=>onGoTab("agenda") }] : []),
    ...(eventsMissingDescription > 0 ? [{ type:"info", icon:"📝", text:`${eventsMissingDescription} komend${eventsMissingDescription===1?"":"e"} event${eventsMissingDescription===1?"":"s"} zonder beschrijving`, action:()=>onGoTab("agenda") }] : []),
    ...(ideas.length > 0 ? [{ type:"idea", icon:"💡", text:`${ideas.length} idee${ideas.length===1?"":"ën"} van leden om te bekijken`, action:()=>onGoTab("ideeen") }] : []),
    ...((pinResets?.length > 0) ? [{ type:"warn", icon:"🔑", text:`${pinResets.length} pincode-verzoek${pinResets.length===1?"":"en"} wacht${pinResets.length===1?"":"en"} op afhandeling`, action:onOpenSettings }] : []),
  ];

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20, flexWrap:"wrap", gap:10 }}>
        <div style={{ fontSize:13, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:primaryColor }}>Dashboard</div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <button className="btn-sm" onClick={onNewEvent}>+ Event</button>
          <button className="btn-sm" onClick={onNewBardienst}>+ Bardienst</button>
          <button className="btn-sm" onClick={onNewNews}>+ Mededeling</button>
          <button className="btn-sm" onClick={onOpenSettings}>⚙ Instellingen</button>
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:10, marginBottom:28 }}>
        {stats.map(s => (
          <div key={s.label} style={{ background:"#ffffff", border:`1px solid ${s.color}33`, borderLeft:`3px solid ${s.color}`, borderRadius:8, padding:"14px 16px", animation:"fadeInUp .3s both" }}>
            <div style={{ fontSize:34, fontWeight:900, color:s.color, lineHeight:1 }}>{s.value}</div>
            <div style={{ fontSize:11, color:"#76756f", fontFamily:"Barlow,sans-serif", marginTop:4, textTransform:"uppercase", letterSpacing:.5 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {attentionItems.length > 0 && (
        <div style={{ marginBottom:28 }}>
          <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:"#56554d", marginBottom:10 }}>Aandachtspunten</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {attentionItems.map((it, i) => (
              <div key={i} onClick={it.action} style={{ background:"#ffffff", border:`1px solid ${it.type==="warn"?"#e63946":primaryColor}33`, borderLeft:`3px solid ${it.type==="warn"?"#e63946":primaryColor}`, borderRadius:8, padding:"10px 16px", display:"flex", alignItems:"center", gap:10, cursor:"pointer", fontSize:13, fontFamily:"Barlow,sans-serif" }}>
                <span style={{ fontSize:16 }}>{it.icon}</span>
                <span style={{ flex:1 }}>{it.text}</span>
                <span style={{ color:"#b0afa9" }}>›</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {nextEvent && (
        <div style={{ marginBottom:28 }}>
          <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:"#56554d", marginBottom:10 }}>Eerstvolgende event</div>
          <div onClick={()=>onSelectEvent(nextEvent)} style={{ background:"#ffffff", border:`1px solid ${primaryColor}33`, borderRadius:8, padding:"16px 20px", cursor:"pointer", animation:"fadeInUp .3s .1s both" }}>
            <div style={{ fontSize:18, fontWeight:800, textTransform:"uppercase" }}>{nextEvent.title}</div>
            <div style={{ fontSize:13, color:"#76756f", fontFamily:"Barlow,sans-serif", marginTop:4 }}>{formatDate(nextEvent.start_time)}{nextEvent.location?` · ${nextEvent.location}`:""}</div>
            <div style={{ marginTop:8, display:"flex", alignItems:"center", gap:12 }}>
              <span className="badge" style={{ background:(categoryColors[nextEvent.category]||primaryColor)+"22", color:categoryColors[nextEvent.category]||primaryColor }}>{nextEvent.category}</span>
              <span style={{ fontSize:12, color:primaryColor, fontWeight:700 }}>Over {daysUntil(nextEvent.start_time)} dagen</span>
            </div>
          </div>
        </div>
      )}

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))", gap:20, marginBottom:28 }}>
        <div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
            <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:"#56554d" }}>Bardienstrooster</div>
            <button className="btn-sm" onClick={()=>onGoTab("bardienst")} style={{ fontSize:11 }}>Alles →</button>
          </div>
          {upcomingBardienst.length === 0 ? (
            <div style={{ fontSize:13, color:"#76756f", fontFamily:"Barlow,sans-serif" }}>Geen komende bardiensten gepland</div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {upcomingBardienst.map(b => (
                <div key={b.id} style={{ background:"#ffffff", border:"1px solid #ebe8df", borderRadius:6, padding:"8px 12px", fontSize:13, fontFamily:"Barlow,sans-serif" }}>
                  <strong style={{ fontFamily:"'Saira Condensed',sans-serif" }}>{formatDate(b.shift_date)}</strong> — {b.names}
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
            <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:"#56554d" }}>Laatste mededelingen</div>
            <button className="btn-sm" onClick={()=>onGoTab("nieuws")} style={{ fontSize:11 }}>Alles →</button>
          </div>
          {recentNews.length === 0 ? (
            <div style={{ fontSize:13, color:"#76756f", fontFamily:"Barlow,sans-serif" }}>Nog geen mededelingen geplaatst</div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {recentNews.map(n => (
                <div key={n.id} style={{ background:"#ffffff", border:"1px solid #ebe8df", borderRadius:6, padding:"8px 12px", fontSize:13, fontFamily:"Barlow,sans-serif" }}>
                  {n.pinned && "📌 "}<strong style={{ fontFamily:"'Saira Condensed',sans-serif" }}>{n.title}</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {recentIdeas.length > 0 && (
        <div style={{ marginBottom:28 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
            <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:"#56554d" }}>Nieuwste ideeën</div>
            <button className="btn-sm" onClick={()=>onGoTab("ideeen")} style={{ fontSize:11 }}>Alles →</button>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {recentIdeas.map(idea => (
              <div key={idea.id} style={{ background:"#ffffff", border:"1px solid #ebe8df", borderLeft:"3px solid #2a9d8f", borderRadius:6, padding:"10px 14px", fontSize:13, fontFamily:"Barlow,sans-serif" }}>
                <div style={{ fontWeight:700, color:"#2a9d8f", marginBottom:2 }}>{idea.name || "Anoniem"}</div>
                <div style={{ color:"#76756f" }}>{idea.message.length>120?idea.message.slice(0,120)+"…":idea.message}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))", gap:20, marginBottom:28 }}>
        <div>
          <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:"#56554d", marginBottom:12 }}>Verdeling per categorie</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {allCategories.map(cat => {
              const cc = categoryColors[cat]||primaryColor;
              const count = nonArchived.filter(e=>e.category===cat).length;
              const pct = nonArchived.length ? (count/nonArchived.length)*100 : 0;
              return (
                <div key={cat} style={{ display:"flex", alignItems:"center", gap:12 }}>
                  <div style={{ width:90, fontSize:12, color:cc, fontWeight:700, textTransform:"uppercase", flexShrink:0 }}>{cat}</div>
                  <div style={{ flex:1, height:6, background:"#ebe8df", borderRadius:3, overflow:"hidden" }}>
                    <div style={{ height:"100%", width:`${pct}%`, background:cc, borderRadius:3, transition:"width .6s ease" }} />
                  </div>
                  <div style={{ width:20, fontSize:13, fontWeight:700, color:cc, textAlign:"right", flexShrink:0 }}>{count}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:"#56554d", marginBottom:12 }}>Meest actieve leden</div>
          {topAttendees.length === 0 ? (
            <div style={{ fontSize:13, color:"#76756f", fontFamily:"Barlow,sans-serif" }}>Nog geen aanmeldingen</div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {topAttendees.map(([name, count]) => (
                <div key={name} style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ flex:1, fontSize:13, fontFamily:"Barlow,sans-serif" }}>{name}</div>
                  <span style={{ fontSize:12, background:primaryColor+"22", color:primaryColor, borderRadius:10, padding:"1px 9px", fontWeight:700 }}>{count}×</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))", gap:10 }}>
        <div style={{ background:"#ffffff", border:"1px solid #ebe8df", borderRadius:8, padding:16 }}>
          <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:"#56554d", marginBottom:10 }}>Financieel (komend)</div>
          <div style={{ fontSize:28, fontWeight:900, color:"#52b788" }}>€{totalUpcomingCost.toFixed(2)}</div>
          <div style={{ fontSize:12, color:"#76756f", fontFamily:"Barlow,sans-serif" }}>totaal aan deelnamekosten</div>
          <div style={{ fontSize:12, color:"#76756f", fontFamily:"Barlow,sans-serif", marginTop:6 }}>{sponsoredCount} event{sponsoredCount===1?"":"s"} met sponsor</div>
        </div>
        <div style={{ background:"#ffffff", border:"1px solid #ebe8df", borderRadius:8, padding:16 }}>
          <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:"#56554d", marginBottom:10 }}>Beheerders</div>
          <div style={{ fontSize:28, fontWeight:900, color:primaryColor }}>{pinsList.length}</div>
          <div style={{ fontSize:12, color:"#76756f", fontFamily:"Barlow,sans-serif" }}>{pinsByRole.super} beheerder, {pinsByRole.editor} redacteur, {pinsByRole.viewer} bekijker</div>
          <button className="btn-sm" onClick={onOpenSettings} style={{ marginTop:8 }}>Beheren</button>
        </div>
      </div>
    </div>
  );
}

// ---- WEEK VIEW ----
function WeekView({ events, weekStart, onWeekChange, categoryColors, primaryColor, onEventClick, adminMode }) {
  const days = Array.from({length:7}, (_,i) => { const d=new Date(weekStart); d.setDate(d.getDate()+i); return d; });
  const today = new Date();
  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16, flexWrap:"wrap", gap:8 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <button className="btn-sm" onClick={()=>{ const d=new Date(weekStart); d.setDate(d.getDate()-7); onWeekChange(d); }}>←</button>
          <span style={{ fontSize:15, fontWeight:700, textTransform:"uppercase", minWidth:200, textAlign:"center" }}>
            {days[0].toLocaleDateString("nl-NL",{day:"numeric",month:"short"})} – {days[6].toLocaleDateString("nl-NL",{day:"numeric",month:"short",year:"numeric"})}
          </span>
          <button className="btn-sm" onClick={()=>{ const d=new Date(weekStart); d.setDate(d.getDate()+7); onWeekChange(d); }}>→</button>
        </div>
        <button className="btn-sm" onClick={()=>onWeekChange(getWeekStart(new Date()))}>Deze week</button>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4 }}>
        {days.map((day,i) => {
          const isToday = day.toDateString()===today.toDateString();
          const dayEvs = events.filter(e => !e.archived && (!e.hidden||adminMode) && dayInRange(day, e.start_time, e.end_time));
          return (
            <div key={i} style={{ minHeight:120, background:isToday?primaryColor+"11":"#ffffff", border:`1px solid ${isToday?primaryColor:"#ebe8df"}`, borderRadius:6, padding:"6px 4px" }}>
              <div style={{ fontSize:9, color:isToday?primaryColor:"#56554d", fontWeight:700, textTransform:"uppercase", textAlign:"center", marginBottom:2 }}>{DAYS_NL[i]}</div>
              <div style={{ fontSize:18, fontWeight:900, color:isToday?primaryColor:"#56554d", textAlign:"center", lineHeight:1, marginBottom:6 }}>{day.getDate()}</div>
              {dayEvs.map(ev => {
                const cc = categoryColors[ev.category]||primaryColor;
                return (
                  <div key={ev.id} onClick={()=>onEventClick(ev)} style={{ background:cc+"22", color:cc, fontSize:9, padding:"2px 4px", borderRadius:3, marginBottom:2, cursor:"pointer", overflow:"hidden", whiteSpace:"nowrap", textOverflow:"ellipsis", fontWeight:700 }} title={ev.title}>
                    {formatTime(ev.start_time)} {ev.title}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- YEAR VIEW ----
function YearView({ events, year, onYearChange, categoryColors, primaryColor, onEventClick }) {
  const today = new Date();
  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20 }}>
        <button className="btn-sm" onClick={()=>onYearChange(year-1)}>←</button>
        <span style={{ fontSize:20, fontWeight:700, textTransform:"uppercase", minWidth:60, textAlign:"center" }}>{year}</span>
        <button className="btn-sm" onClick={()=>onYearChange(year+1)}>→</button>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(210px,1fr))", gap:14 }}>
        {MONTHS_NL.map((name, mi) => {
          const monthEvs = events.filter(e => { const d=new Date(e.start_time); return d.getFullYear()===year&&d.getMonth()===mi; });
          const days = getCalendarDays(year, mi);
          return (
            <div key={name} style={{ background:"#ffffff", border:"1px solid #ebe8df", borderRadius:8, padding:"12px 12px 10px", animation:"fadeInUp .3s both" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                <div style={{ fontSize:12, fontWeight:700, textTransform:"uppercase", letterSpacing:1, color:monthEvs.length?primaryColor:"#56554d" }}>{name}</div>
                {monthEvs.length>0 && <span style={{ fontSize:10, background:primaryColor+"22", color:primaryColor, borderRadius:10, padding:"1px 7px", fontWeight:700 }}>{monthEvs.length}</span>}
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:1 }}>
                {DAYS_NL.map(d=><div key={d} style={{ fontSize:7, color:"#e7e4da", textAlign:"center", fontWeight:700, paddingBottom:2 }}>{d[0]}</div>)}
                {days.map((day,i) => {
                  if (!day) return <div key={`e${i}`} />;
                  const dayEvs = monthEvs.filter(e=>new Date(e.start_time).getDate()===day.getDate());
                  const isToday = day.toDateString()===today.toDateString();
                  const cc = dayEvs.length ? (categoryColors[dayEvs[0].category]||primaryColor) : null;
                  return (
                    <div key={i} onClick={()=>dayEvs.length&&onEventClick(dayEvs[0])} title={dayEvs.map(e=>e.title).join(", ")} style={{
                      fontSize:8, textAlign:"center", padding:"2px 0", borderRadius:2,
                      cursor:dayEvs.length?"pointer":"default",
                      background:cc?cc+"33":"transparent",
                      color:isToday?primaryColor:dayEvs.length?"#1d1f3a":"#e7e4da",
                      fontWeight:isToday||dayEvs.length?700:400,
                      outline:isToday?`1px solid ${primaryColor}`:"none",
                    }}>
                      {day.getDate()}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- MAIN COMPONENT ----
export default function HHCEvents() {
  const [events, setEvents] = useState([]);
  const [attendees, setAttendees] = useState({});
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [tab, setTab] = useState("agenda");
  const [filter, setFilter] = useState("Alles");
  const [showPast, setShowPast] = useState(false);
  const [adminMode, setAdminMode] = useState(() => !!getStoredSession());
  const [adminRole, setAdminRole] = useState(() => getStoredSession()?.role || null);
  const [adminToken, setAdminToken] = useState(() => getStoredSession()?.token || null);
  const [pinInput, setPinInput] = useState("");
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinError, setPinError] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [form, setForm] = useState({ title:"", description:"", location:"", start_time:"", end_time:"", category:"Evenement", is_public:true, hidden:false, sponsor_name:"", sponsor_logo:"", image_url:"", cost:"" });
  const formInitialRef = useRef(null); // verbetering #6/#21: snapshot bij openen, voor de onopgeslagen-wijzigingen-check
  const [saving, setSaving] = useState(false);
  const [recurrence, setRecurrence] = useState({ freq:"none", until:"", count:"" }); // nieuw #1: alleen bij nieuw event
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [showQR, setShowQR] = useState(null);
  const [showAttendees, setShowAttendees] = useState(null);
  const [calDate, setCalDate] = useState(() => { const d=new Date(); return {year:d.getFullYear(),month:d.getMonth()}; });
  const [calView, setCalView] = useState("month");
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const [statsYear, setStatsYear] = useState(new Date().getFullYear());
  const [showSettings, setShowSettings] = useState(false);
  const [toast, setToast] = useState(null);

  // Search & filters
  const [searchInput, setSearchInput] = useState(""); // verbetering #9: ruwe invoer, gedebouncet naar searchQuery
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [locationFilter, setLocationFilter] = useState("Alles");
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  // Drag-and-drop sort
  const [eventsOrder, setEventsOrder] = useState([]);
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);

  // Nieuw #179: prullenbak
  const [trashedEvents, setTrashedEvents] = useState([]);
  // Nieuw #40: teams (bardienst per team)
  const [teams, setTeams] = useState([]);
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamColor, setNewTeamColor] = useState("#2E3192");
  // Nieuw #3: eventreeksen/toernooien
  const [eventSeries, setEventSeries] = useState([]);
  const [newSeriesTitle, setNewSeriesTitle] = useState("");
  // Nieuw #178: bulk-bewerken events
  const [selectedEventIds, setSelectedEventIds] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // Nieuw #184: pincode-vergeten-flow
  const [showForgotPin, setShowForgotPin] = useState(false);
  const [forgotPinMessage, setForgotPinMessage] = useState("");
  const [forgotPinSent, setForgotPinSent] = useState(false);
  const [pinResets, setPinResets] = useState([]);

  const [categoryColors, setCategoryColors] = useState(() => loadLS("hhc09_cat_colors", DEFAULT_COLORS));
  const [clubSettings, setClubSettings] = useState(() => loadLS("hhc09_club_settings", { name:"Heusden Herpt Combinatie", subtitle:"Clubagenda", primaryColor:"#2E3192", logo:"" }));
  const [pinsList, setPinsList] = useState([]);
  const [newPin, setNewPin] = useState("");
  const [newPinRole, setNewPinRole] = useState("editor");
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionResult, setConnectionResult] = useState(null);

  // Bardienst
  const [bardienst, setBardienst] = useState([]);
  const [showBardienstForm, setShowBardienstForm] = useState(false);
  const [editingBardienst, setEditingBardienst] = useState(null);
  const [bardienstForm, setBardienstForm] = useState({ shift_date:"", time_label:"", names:"", note:"", checklistText:DEFAULT_CHECKLIST_ITEMS.join("\n"), team_id:"" });
  const bardienstFormInitialRef = useRef(null);
  const [savingBardienst, setSavingBardienst] = useState(false);

  // Mededelingen (nieuws)
  const [news, setNews] = useState([]);
  const [showNewsForm, setShowNewsForm] = useState(false);
  const [editingNews, setEditingNews] = useState(null);
  const [newsForm, setNewsForm] = useState({ title:"", body:"", pinned:false, images:[""] });
  const newsFormInitialRef = useRef(null);
  const [savingNews, setSavingNews] = useState(false);
  const [selectedNews, setSelectedNews] = useState(null);

  // Ideeënbus
  const [ideas, setIdeas] = useState([]);
  const [showIdeaForm, setShowIdeaForm] = useState(false);
  const [ideaName, setIdeaName] = useState("");
  const [ideaMessage, setIdeaMessage] = useState("");
  const [submittingIdea, setSubmittingIdea] = useState(false);

  const primaryColor = clubSettings.primaryColor || "#e63946";
  const canEdit = adminMode && (adminRole === "editor" || adminRole === "super");
  const canDelete = adminMode && adminRole === "super";
  const canSettings = adminMode && adminRole === "super";

  function showToast(msg, type = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  useEffect(() => { load(); }, []);
  // Verbetering #9: filtert pas 200ms na de laatste toetsaanslag, i.p.v. bij elke toets de hele lijst te filteren.
  useEffect(() => { const t = setTimeout(() => setSearchQuery(searchInput), 200); return () => clearTimeout(t); }, [searchInput]);
  useEffect(() => { saveLS("hhc09_cat_colors", categoryColors); }, [categoryColors]);
  useEffect(() => { saveLS("hhc09_club_settings", clubSettings); }, [clubSettings]);
  useEffect(() => {
    if ((showSettings || adminMode) && canSettings && adminToken) {
      adminApi({ action:"pins", op:"list", token:adminToken }).then(res => {
        if (res.ok) setPinsList(res.data?.data || []);
        else if (res.status === 401) sessionExpired();
      });
      // Nieuw #184: openstaande "pincode kwijt"-verzoeken voor de super
      adminApi({ action:"pinResets", op:"list", token:adminToken }).then(res => {
        if (res.ok) setPinResets(res.data?.data || []);
      });
    }
  }, [showSettings, adminMode]);

  async function testConnection() {
    setTestingConnection(true);
    setConnectionResult(null);
    const t0 = Date.now();
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/events?select=id&limit=1`, {
        headers: { apikey:SUPABASE_ANON_KEY, Authorization:`Bearer ${SUPABASE_ANON_KEY}` },
      });
      const ms = Date.now() - t0;
      setConnectionResult(res.ok ? { ok:true, msg:`Verbinding OK (${ms}ms) — dit telt ook als activiteit tegen het automatisch pauzeren van het gratis Supabase-project.` } : { ok:false, msg:`Database antwoordde met fout ${res.status}` });
    } catch {
      setConnectionResult({ ok:false, msg:"Geen verbinding met de database — mogelijk gepauzeerd. Kijk in het Supabase-dashboard." });
    }
    setTestingConnection(false);
  }

  function sessionExpired() {
    setAdminMode(false); setAdminRole(null); setAdminToken(null); saveLS("hhc09_admin_session", null);
    showToast("Sessie verlopen, log opnieuw in", "error");
  }

  async function adminWrite(table, method, id, payload) {
    const res = await adminApi({ action:"write", token:adminToken, table, method, id:id||undefined, payload:payload||undefined });
    if (res.status === 401) { sessionExpired(); return { ok:false }; }
    if (!res.ok) {
      showToast(res.data?.error || "Actie mislukt", "error");
      return { ok:false };
    }
    return { ok:true, data:res.data?.data };
  }

  async function load() {
    setLoading(true);
    // Show cached data immediately while fetching
    const cached = loadLS("hhc09_events_cache", null);
    if (cached) {
      setEvents(cached.events || []);
      setAttendees(cached.attendees || {});
      setEventsOrder((cached.events || []).map(e => e.id));
      setBardienst(cached.bardienst || []);
      setNews(cached.news || []);
      setLoading(false);
    }
    // Verbetering/nieuw #179: deleted_at=is.null zodat zachtverwijderde events nergens
    // in de normale app meer opduiken -- die leven alleen nog in de prullenbak hieronder.
    const endpoint = adminMode
      ? "events?order=start_time.asc&deleted_at=is.null"
      : "events?order=start_time.asc&is_public=eq.true&deleted_at=is.null";
    try {
      const [evs, atts, bd, nw, trashed, tms, srs] = await Promise.all([
        sb(endpoint),
        sb("event_attendees?select=event_id,attendee_name"),
        sb("bardienst?order=shift_date.asc"),
        sb("mededelingen?order=pinned.desc,created_at.desc"),
        adminMode ? sb("events?deleted_at=not.is.null&order=deleted_at.desc") : Promise.resolve([]),
        sb("teams?order=name.asc"),
        sb("event_series?order=created_at.desc"),
      ]);
      const evList = Array.isArray(evs) ? evs : [];
      const attMap = {};
      if (Array.isArray(atts)) atts.forEach(a => { if(!attMap[a.event_id]) attMap[a.event_id]=[]; attMap[a.event_id].push(a); });
      const bdList = Array.isArray(bd) ? bd : [];
      const nwList = Array.isArray(nw) ? nw : [];
      setEvents(evList);
      setEventsOrder(evList.map(e => e.id));
      setAttendees(attMap);
      setBardienst(bdList);
      setNews(nwList);
      setTrashedEvents(Array.isArray(trashed) ? trashed : []);
      setTeams(Array.isArray(tms) ? tms : []);
      setEventSeries(Array.isArray(srs) ? srs : []);
      saveLS("hhc09_events_cache", { events:evList, attendees:attMap, bardienst:bdList, news:nwList, ts:Date.now() });
      setOffline(false);
    } catch {
      setOffline(true);
      if (!cached) { setEvents([]); setBardienst([]); setNews([]); }
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [adminMode]);

  async function loadIdeas() {
    const res = await adminApi({ action:"ideas", op:"list", token:adminToken });
    if (res.ok) setIdeas(res.data?.data || []);
    else if (res.status === 401) sessionExpired();
  }

  useEffect(() => { if (adminMode && adminToken) loadIdeas(); }, [adminMode]);

  async function handleSave() {
    if (!form.title || !form.start_time) return;
    setSaving(true);
    const payload = { ...form, cost:form.cost ? parseFloat(form.cost) : null, end_time:form.end_time || null, series_id:form.series_id || null };

    // Nieuw #1: terugkerende events -- alleen bij het aanmaken van een nieuw event.
    // Genereert losse rijen (elk gewoon een normaal event) i.p.v. herhaling on-the-fly te berekenen,
    // zodat aanmeldingen/QR/bardienst per instantie los blijven werken zoals bij elk ander event.
    if (!editingEvent && recurrence.freq !== "none") {
      const starts = computeRecurrenceStarts(form.start_time, recurrence.freq, recurrence.until, recurrence.count);
      const durationMs = form.end_time ? (new Date(form.end_time) - new Date(form.start_time)) : null;
      const ruleForDisplay = { freq:recurrence.freq, until:recurrence.until||null, count:starts.length };

      const firstPayload = { ...payload, start_time:toDatetimeLocalStr(starts[0]), end_time:durationMs!=null?toDatetimeLocalStr(new Date(starts[0].getTime()+durationMs)):null, recurrence_rule:ruleForDisplay };
      const firstRes = await adminWrite("events", "POST", null, firstPayload);
      if (!firstRes.ok) { setSaving(false); return; }
      const parentId = firstRes.data?.[0]?.id;

      for (const d of starts.slice(1)) {
        const childPayload = { ...payload, start_time:toDatetimeLocalStr(d), end_time:durationMs!=null?toDatetimeLocalStr(new Date(d.getTime()+durationMs)):null, recurrence_rule:ruleForDisplay, recurrence_parent_id:parentId||null };
        await adminWrite("events", "POST", null, childPayload);
      }
      setSaving(false);
      await load(); setShowForm(false);
      showToast(`${starts.length} events aangemaakt (herhaling)`);
      return;
    }

    const res = editingEvent
      ? await adminWrite("events", "PATCH", editingEvent.id, payload)
      : await adminWrite("events", "POST", null, payload);
    setSaving(false);
    if (!res.ok) return;
    await load(); setShowForm(false);
    showToast(editingEvent ? "Event bijgewerkt" : "Event toegevoegd");
  }

  // Nieuw #179: verwijderen is nu een soft delete (deleted_at) i.p.v. direct definitief --
  // het event verdwijnt uit de app maar is te herstellen vanuit de prullenbak in Archief.
  async function handleDelete(id) {
    if (!confirm("Evenement verwijderen? Je kunt dit nog 30 dagen terugvinden in de prullenbak.")) return;
    const res = await adminWrite("events", "PATCH", id, { deleted_at: new Date().toISOString() });
    if (!res.ok) return;
    await load(); setSelectedEvent(null);
    showToast("Event verwijderd", "error");
  }

  async function handleRestoreDeleted(id) {
    const res = await adminWrite("events", "PATCH", id, { deleted_at: null });
    if (!res.ok) return;
    await load();
    showToast("Event hersteld");
  }

  // Nieuw #178: bulk-bewerken -- meerdere events tegelijk archiveren/verwijderen/verplaatsen.
  function toggleEventSelected(id) {
    setSelectedEventIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  async function bulkPatchEvents(payload, successMsg) {
    if (selectedEventIds.size === 0) return;
    setBulkBusy(true);
    const res = await adminApi({ action:"bulkWrite", token:adminToken, table:"events", method:"PATCH", ids:[...selectedEventIds], payload });
    setBulkBusy(false);
    if (res.status === 401) { sessionExpired(); return; }
    if (!res.ok) { showToast(res.data?.error || "Bulkactie mislukt", "error"); return; }
    setSelectedEventIds(new Set());
    await load();
    showToast(successMsg);
  }
  function bulkArchive() { bulkPatchEvents({ archived:true }, `${selectedEventIds.size} events gearchiveerd`); }
  function bulkDelete() {
    if (!confirm(`${selectedEventIds.size} events verwijderen? Ze zijn nog 30 dagen terug te vinden in de prullenbak.`)) return;
    bulkPatchEvents({ deleted_at:new Date().toISOString() }, `${selectedEventIds.size} events verwijderd`);
  }
  function bulkSetCategory(category) { if (category) bulkPatchEvents({ category }, `${selectedEventIds.size} events verplaatst naar "${category}"`); }

  async function handlePermanentDelete(id) {
    if (!confirm("Definitief verwijderen? Dit kan niet meer ongedaan worden gemaakt.")) return;
    const res = await adminWrite("events", "DELETE", id);
    if (!res.ok) return;
    await load();
    showToast("Definitief verwijderd", "error");
  }

  async function handleArchive(ev) {
    const res = await adminWrite("events", "PATCH", ev.id, { archived: !ev.archived });
    if (!res.ok) return;
    await load();
    showToast(ev.archived ? "Event hersteld" : "Event gearchiveerd");
  }

  async function handleDuplicate(ev) {
    const start = new Date(ev.start_time); start.setDate(start.getDate() + 7);
    const end = ev.end_time ? new Date(new Date(ev.end_time).getTime() + 7*86400000) : null;
    const payload = { title:ev.title+" (kopie)", description:ev.description, location:ev.location, category:ev.category, is_public:ev.is_public, hidden:ev.hidden||false, sponsor_name:ev.sponsor_name||"", sponsor_logo:ev.sponsor_logo||"", image_url:ev.image_url||"", cost:ev.cost||null, start_time:start.toISOString(), end_time:end?end.toISOString():null };
    const res = await adminWrite("events", "POST", null, payload);
    if (!res.ok) return;
    await load();
    showToast("Event gedupliceerd");
  }

  async function handleAttend(eventId, name) {
    await sb("event_attendees", "POST", { event_id:eventId, attendee_name:name });
    await load();
  }

  async function handleSaveBardienst() {
    if (!bardienstForm.shift_date || (!bardienstForm.names && !bardienstForm.team_id)) return;
    setSavingBardienst(true);
    // Nieuw #38: checklist-items uit het formulier omzetten, met behoud van reeds afgevinkte items.
    const prevChecklist = editingBardienst?.checklist || [];
    const checklist = bardienstForm.checklistText.split("\n").map(s=>s.trim()).filter(Boolean)
      .map(item => ({ item, done: !!prevChecklist.find(c=>c.item===item)?.done }));
    const payload = { shift_date:bardienstForm.shift_date, time_label:bardienstForm.time_label, names:bardienstForm.names, note:bardienstForm.note, checklist, team_id:bardienstForm.team_id||null };
    const res = editingBardienst
      ? await adminWrite("bardienst", "PATCH", editingBardienst.id, payload)
      : await adminWrite("bardienst", "POST", null, payload);
    setSavingBardienst(false);
    if (!res.ok) return;
    await load(); setShowBardienstForm(false);
    showToast(editingBardienst ? "Bardienst bijgewerkt" : "Bardienst toegevoegd");
  }

  // Nieuw #34: aanwezigheid per naam bijhouden op een bardienst.
  async function toggleAttendance(b, name) {
    const current = (b.attendance && b.attendance[name]) || "present";
    const next = current === "no_show" ? "present" : "no_show";
    const attendance = { ...(b.attendance||{}), [name]:next };
    await adminWrite("bardienst", "PATCH", b.id, { attendance });
    await load();
  }

  // Nieuw #38: één checklist-item afvinken/loskoppelen.
  async function toggleChecklistItem(b, idx) {
    const checklist = (b.checklist||[]).map((c,i) => i===idx ? { ...c, done:!c.done } : c);
    await adminWrite("bardienst", "PATCH", b.id, { checklist });
    await load();
  }

  async function handleDeleteBardienst(id) {
    if (!confirm("Bardienst verwijderen?")) return;
    const res = await adminWrite("bardienst", "DELETE", id);
    if (!res.ok) return;
    await load();
    showToast("Bardienst verwijderd", "error");
  }

  function openNewBardienst() {
    setEditingBardienst(null);
    const f = { shift_date:getNextThursday(), time_label:"", names:"", note:"", checklistText:DEFAULT_CHECKLIST_ITEMS.join("\n"), team_id:"" };
    setBardienstForm(f);
    bardienstFormInitialRef.current = f;
    setShowBardienstForm(true);
  }

  function openEditBardienst(b) {
    setEditingBardienst(b);
    const checklistText = (b.checklist && b.checklist.length) ? b.checklist.map(c=>c.item).join("\n") : DEFAULT_CHECKLIST_ITEMS.join("\n");
    const f = { shift_date:b.shift_date?b.shift_date.slice(0,10):"", time_label:b.time_label||"", names:b.names||"", note:b.note||"", checklistText, team_id:b.team_id||"" };
    setBardienstForm(f);
    bardienstFormInitialRef.current = f;
    setShowBardienstForm(true);
  }

  function closeBardienstForm() {
    if (isDirty(bardienstForm, bardienstFormInitialRef.current) && !confirm("Je hebt niet-opgeslagen wijzigingen in dit formulier. Weet je zeker dat je wilt sluiten?")) return;
    setShowBardienstForm(false);
  }

  async function handleSaveNews() {
    if (!newsForm.title || !newsForm.body) return;
    setSavingNews(true);
    // Nieuw #51: afbeeldingengalerij -- image_urls is de bron, image_url blijft gevuld
    // met de eerste foto voor plekken die nog het enkelvoudige veld gebruiken (lijst-thumbnail).
    const cleanImages = (newsForm.images||[]).map(s=>s.trim()).filter(Boolean);
    const payload = { title:newsForm.title, body:newsForm.body, pinned:newsForm.pinned, image_urls:cleanImages, image_url:cleanImages[0]||null };
    const res = editingNews
      ? await adminWrite("mededelingen", "PATCH", editingNews.id, payload)
      : await adminWrite("mededelingen", "POST", null, payload);
    setSavingNews(false);
    if (!res.ok) return;
    await load(); setShowNewsForm(false);
    showToast(editingNews ? "Mededeling bijgewerkt" : "Mededeling geplaatst");
  }

  async function handleDeleteNews(id) {
    if (!confirm("Mededeling verwijderen?")) return;
    const res = await adminWrite("mededelingen", "DELETE", id);
    if (!res.ok) return;
    await load();
    showToast("Mededeling verwijderd", "error");
  }

  function openNewNews() {
    setEditingNews(null);
    const f = { title:"", body:"", pinned:false, images:[""] };
    setNewsForm(f);
    newsFormInitialRef.current = f;
    setShowNewsForm(true);
  }

  function openEditNews(n) {
    setEditingNews(n);
    const existing = (Array.isArray(n.image_urls) && n.image_urls.length) ? n.image_urls : (n.image_url ? [n.image_url] : [""]);
    const f = { title:n.title, body:n.body, pinned:n.pinned||false, images:existing };
    setNewsForm(f);
    newsFormInitialRef.current = f;
    setShowNewsForm(true);
  }

  function closeNewsForm() {
    if (isDirty(newsForm, newsFormInitialRef.current) && !confirm("Je hebt niet-opgeslagen wijzigingen in dit formulier. Weet je zeker dat je wilt sluiten?")) return;
    setShowNewsForm(false);
  }

  async function submitIdea() {
    if (!ideaMessage.trim()) return;
    setSubmittingIdea(true);
    await sb("ideas", "POST", { name: ideaName.trim() || null, message: ideaMessage.trim() }, "return=minimal");
    setSubmittingIdea(false);
    setShowIdeaForm(false); setIdeaName(""); setIdeaMessage("");
    showToast("Bedankt voor je idee!");
  }

  async function handleRemoveIdea(id) {
    if (!confirm("Idee verwijderen?")) return;
    const res = await adminApi({ action:"ideas", op:"remove", token:adminToken, id });
    if (res.ok) { setIdeas(idl => idl.filter(i=>i.id!==id)); showToast("Idee verwijderd"); }
    else if (res.status === 401) sessionExpired();
    else showToast(res.data?.error || "Kon idee niet verwijderen", "error");
  }

  // Nieuw #3: snel een nieuwe reeks aanmaken vanuit het eventformulier zelf.
  async function handleCreateSeries() {
    const title = newSeriesTitle.trim();
    if (!title) return;
    const res = await adminWrite("event_series", "POST", null, { title });
    if (!res.ok) return;
    const created = res.data?.[0];
    if (created) {
      setEventSeries(s => [created, ...s]);
      setForm(f => ({ ...f, series_id:created.id }));
    }
    setNewSeriesTitle("");
  }

  function openNew() {
    setEditingEvent(null);
    const f = { title:"", description:"", location:"", start_time:"", end_time:"", category:"Evenement", is_public:true, hidden:false, sponsor_name:"", sponsor_logo:"", image_url:"", cost:"", series_id:"" };
    setForm(f);
    formInitialRef.current = f;
    setRecurrence({ freq:"none", until:"", count:"" });
    setShowForm(true);
  }

  function openEdit(ev) {
    setEditingEvent(ev);
    const f = { title:ev.title, description:ev.description||"", location:ev.location||"", start_time:ev.start_time?ev.start_time.slice(0,16):"", end_time:ev.end_time?ev.end_time.slice(0,16):"", category:ev.category||"Evenement", is_public:ev.is_public!==false, hidden:ev.hidden||false, sponsor_name:ev.sponsor_name||"", sponsor_logo:ev.sponsor_logo||"", image_url:ev.image_url||"", cost:ev.cost!=null?String(ev.cost):"", series_id:ev.series_id||"" };
    setForm(f);
    formInitialRef.current = f;
    setShowForm(true);
  }

  // Verbetering #6/#21: bevestiging vragen bij het sluiten van het eventformulier met niet-opgeslagen wijzigingen.
  function closeForm() {
    if (isDirty(form, formInitialRef.current) && !confirm("Je hebt niet-opgeslagen wijzigingen in dit formulier. Weet je zeker dat je wilt sluiten?")) return;
    setShowForm(false);
  }

  async function submitPin() {
    const res = await adminApi({ action:"login", pin:pinInput });
    if (res.ok && res.data?.token) {
      setAdminMode(true); setAdminRole(res.data.role); setAdminToken(res.data.token);
      saveLS("hhc09_admin_session", res.data);
      setShowPinModal(false); setPinInput(""); setPinError(false);
      showToast(`Ingelogd als ${ROLE_LABELS[res.data.role]||res.data.role}`);
    } else {
      setPinError(true);
    }
  }

  function logout() {
    adminApi({ action:"logout", token:adminToken });
    setAdminMode(false); setAdminRole(null); setAdminToken(null);
    saveLS("hhc09_admin_session", null);
    if (["statistieken","dashboard","ideeen"].includes(tab)) setTab("agenda");
  }

  async function handleAddPin() {
    if (newPin.length < 4) return;
    const res = await adminApi({ action:"pins", op:"add", token:adminToken, pin:newPin, role:newPinRole });
    if (res.ok) {
      setPinsList(pl => [...pl, ...(res.data?.data || [])]);
      setNewPin("");
      showToast("Pincode toegevoegd");
    } else if (res.status === 401) sessionExpired();
    else {
      showToast(res.data?.error || "Kon pincode niet toevoegen", "error");
    }
  }

  async function handleRemovePin(id) {
    const res = await adminApi({ action:"pins", op:"remove", token:adminToken, id });
    if (res.ok) {
      setPinsList(pl => pl.filter(p => p.id !== id));
      showToast("Pincode verwijderd");
    } else if (res.status === 401) sessionExpired();
  }

  // Nieuw #40: teams beheren
  // Nieuw #184: pincode-vergeten-flow (minimale variant -- meldt supers, geen self-service reset)
  async function submitForgotPin() {
    const res = await adminApi({ action:"pinResets", op:"create", message:forgotPinMessage.trim() || null });
    if (res.ok) setForgotPinSent(true);
    else showToast("Kon verzoek niet versturen", "error");
  }
  async function resolvePinReset(id) {
    const res = await adminApi({ action:"pinResets", op:"resolve", token:adminToken, id });
    if (res.ok) { setPinResets(p => p.filter(x=>x.id!==id)); showToast("Verzoek afgehandeld"); }
    else if (res.status === 401) sessionExpired();
  }

  async function handleAddTeam() {
    const name = newTeamName.trim();
    if (!name) return;
    const res = await adminWrite("teams", "POST", null, { name, color:newTeamColor });
    if (!res.ok) return;
    setTeams(t => [...t, ...(res.data||[])]);
    setNewTeamName("");
    showToast("Team toegevoegd");
  }
  async function handleRemoveTeam(id) {
    if (!confirm("Team verwijderen? Bardiensten die aan dit team gekoppeld zijn, blijven bestaan maar verliezen de teamkoppeling.")) return;
    const res = await adminWrite("teams", "DELETE", id);
    if (!res.ok) return;
    setTeams(t => t.filter(x=>x.id!==id));
    showToast("Team verwijderd");
  }

  // Drag-and-drop
  function handleDragStart(id) { setDraggedId(id); }
  function handleDragOver(e, id) { e.preventDefault(); setDragOverId(id); }
  function handleDrop(targetId) {
    if (!draggedId || draggedId === targetId) { setDraggedId(null); setDragOverId(null); return; }
    const order = [...eventsOrder];
    const from = order.indexOf(draggedId), to = order.indexOf(targetId);
    order.splice(from, 1); order.splice(to, 0, draggedId);
    setEventsOrder(order);
    setDraggedId(null); setDragOverId(null);
    showToast("Volgorde bijgewerkt");
  }

  const allCategories = [...new Set([...BASE_CATEGORIES, ...events.map(e=>e.category).filter(Boolean)])];
  const allLocations = [...new Set(events.map(e=>e.location).filter(Boolean))];

  const sortedEvents = eventsOrder.length
    ? eventsOrder.map(id => events.find(e=>e.id===id)).filter(Boolean)
    : events;

  const visibleEvents = sortedEvents.filter(ev => {
    if (ev.archived) return false;
    if (ev.hidden && !adminMode) return false;
    if (!showPast && !isUpcoming(ev.start_time)) return false;
    if (filter !== "Alles" && ev.category !== filter) return false;
    if (locationFilter !== "Alles" && ev.location !== locationFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!ev.title.toLowerCase().includes(q) && !(ev.description||"").toLowerCase().includes(q) && !(ev.location||"").toLowerCase().includes(q)) return false;
    }
    if (dateFrom && new Date(ev.start_time) < new Date(dateFrom)) return false;
    if (dateTo && new Date(ev.start_time) > new Date(dateTo+"T23:59:59")) return false;
    return true;
  });

  const upcomingTop = events.filter(ev => !ev.hidden && !ev.archived && isUpcoming(ev.start_time)).slice(0,3);
  const pastEvents = events.filter(ev => !ev.archived && !isUpcoming(ev.start_time));
  const archivedEvents = events.filter(ev => ev.archived);
  const grouped = visibleEvents.reduce((acc,ev) => { const m=new Date(ev.start_time).toLocaleDateString("nl-NL",{month:"long",year:"numeric"}); if(!acc[m])acc[m]=[]; acc[m].push(ev); return acc; }, {});
  const calDays = getCalendarDays(calDate.year, calDate.month);
  // Nieuw #2: ook events meenemen die dit kalendermaand-venster overlappen, niet alleen die er exact in beginnen.
  const calMonthStart = new Date(calDate.year, calDate.month, 1);
  const calMonthEnd = new Date(calDate.year, calDate.month + 1, 0, 23, 59, 59, 999);
  const calEvents = events.filter(ev => {
    if (ev.archived || (ev.hidden && !adminMode)) return false;
    const s = new Date(ev.start_time), e = ev.end_time ? new Date(ev.end_time) : s;
    return e >= calMonthStart && s <= calMonthEnd;
  });
  const statsMonths = Array.from({length:12},(_,i) => ({ month:MONTHS_NL[i].slice(0,3), count:events.filter(e=>{ const d=new Date(e.start_time); return d.getFullYear()===statsYear&&d.getMonth()===i; }).length }));
  const statsMax = Math.max(1, ...statsMonths.map(m=>m.count));
  const activeFilters = searchQuery || dateFrom || dateTo || locationFilter !== "Alles";

  const tabList = [
    { id:"agenda", label:"Agenda" },
    { id:"nieuws", label:"Nieuws" },
    { id:"bardienst", label:"Bardienst" },
    { id:"kalender", label:"Kalender" },
    { id:"archief", label:"Archief" },
    ...(adminMode ? [
      { id:"statistieken", label:"Stats" },
      { id:"dashboard", label:"Dashboard" },
      { id:"ideeen", label:`Ideeën${ideas.length?` (${ideas.length})`:""}` },
    ] : []),
  ];

  const thisWeekStart = getWeekStart(new Date());
  const thisWeekEnd = new Date(thisWeekStart); thisWeekEnd.setDate(thisWeekEnd.getDate() + 7);
  const bardienstThisWeek = bardienst.filter(b => { const d = new Date(b.shift_date); return d >= thisWeekStart && d < thisWeekEnd; });

  return (
    <div style={{ minHeight:"100vh", background:"#f3f1ea", color:"#1d1f3a", fontFamily:"'Saira Condensed','Arial Narrow',Arial,sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Saira+Condensed:ital,wght@0,600;0,700;0,800;0,900;1,700;1,800;1,900&family=Barlow:wght@400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:${primaryColor};border-radius:2px}
        @keyframes fadeInUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(200%)}}
        .ev-card{background:#ffffff;border:1px solid #ebe8df;border-radius:6px;padding:18px 20px;cursor:pointer;transition:all .2s;position:relative;overflow:hidden;animation:fadeInUp .25s ease both;box-shadow:0 1px 2px rgba(0,0,0,.03)}
        .ev-card:hover{background:#fffdf8;transform:translateX(3px);box-shadow:-4px 0 20px ${primaryColor}22,0 1px 3px rgba(0,0,0,.06)}
        .ev-card.hidden-ev{opacity:.5;border-style:dashed}
        .ev-card.drag-over{border-top:2px solid ${primaryColor};transform:translateY(-2px)}
        .ev-card.dragging{opacity:.45;transform:scale(.98);box-shadow:none;cursor:grabbing}
        .filter-btn{background:#fff;border:1.5px solid #e7e4da;color:#76756f;padding:7px 16px;border-radius:22px;cursor:pointer;font-family:'Saira Condensed',sans-serif;font-size:13px;font-weight:700;letter-spacing:.5px;transition:all .2s;text-transform:uppercase}
        .filter-btn.active{background:var(--fc,${primaryColor});border-color:var(--fc,${primaryColor});color:white}
        .filter-btn:hover:not(.active){border-color:var(--fc,${primaryColor});color:var(--fc,${primaryColor})}
        .badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase}
        .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:100;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px);animation:fadeIn .15s ease}
        .modal{background:#ffffff;border:1px solid #e7e4da;border-radius:12px;padding:32px;width:100%;max-width:520px;max-height:90vh;max-height:90dvh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.25)}
        .modal-actions-sticky{position:sticky;bottom:-32px;margin:8px -32px -32px;padding:14px 32px;background:#ffffff;border-top:1px solid #ebe8df}
        .input{background:#ffffff;border:1px solid #e7e4da;color:#1d1f3a;padding:10px 14px;border-radius:6px;font-family:inherit;font-size:16px;width:100%;transition:border-color .2s;min-width:0}
        .input:focus{outline:none;border-color:${primaryColor}}
        .btn-red{background:${primaryColor};color:white;border:none;padding:12px 24px;border-radius:5px;font-family:'Saira Condensed',sans-serif;font-size:16px;font-weight:800;font-style:italic;letter-spacing:.5px;text-transform:uppercase;cursor:pointer;transition:all .2s}
        .btn-red:hover{filter:brightness(1.15)}
        .btn-ghost{background:transparent;color:#76756f;border:1px solid #e7e4da;padding:10px 20px;border-radius:6px;font-family:inherit;font-size:14px;cursor:pointer;transition:all .2s}
        .btn-ghost:hover{border-color:#b0afa9;color:#222}
        .btn-ghost-onbrand{background:rgba(255,255,255,.2);color:#fff;border:1px solid rgba(255,255,255,.5);padding:10px 20px;border-radius:6px;font-family:inherit;font-size:14px;cursor:pointer;transition:all .2s}
        .btn-ghost-onbrand:hover{background:rgba(255,255,255,.32)}
        .btn-sm{background:#ebe8df;border:1px solid #e7e4da;color:#76756f;padding:5px 12px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:12px;transition:all .15s}
        .btn-sm:hover{color:#222;border-color:#b0afa9}
        .pill-tab{background:#ffffff2e;border:none;color:#fff;padding:11px 22px 13px;border-radius:4px 4px 0 0;cursor:pointer;font-family:'Saira Condensed',sans-serif;font-size:16px;font-weight:800;font-style:italic;letter-spacing:.5px;text-transform:uppercase;transition:all .2s;white-space:nowrap;flex-shrink:0}
        .pill-tab.active{background:#fff;color:${primaryColor}}
        .pill-tab:hover:not(.active){background:#ffffff44}
        .admin-corner{position:absolute;top:16px;right:20px;z-index:5;display:flex;align-items:center;gap:8px}
        .bottom-nav{display:none}
        .bottom-nav-btn{flex:0 0 auto;min-width:64px;display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 10px 6px;background:transparent;border:none;color:#76756f;font-family:inherit;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.3px;cursor:pointer;white-space:nowrap}
        .bottom-nav-btn .bn-icon{display:flex;align-items:center;justify-content:center;height:20px}
        .bottom-nav-btn.active{color:${primaryColor}}
        .filter-toggle{display:none}
        .cal-day{min-height:76px;padding:6px;border:1.5px solid #f0eee6;border-radius:5px;background:#fff;transition:background .15s}
        .cal-day.today{border-color:#F18C21}
        .cal-day.has-events{background:#faf9f6}
        .cal-dot{font-size:10px;font-weight:700;padding:2px 5px;border-radius:3px;margin-top:4px;display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;cursor:pointer}
        select.input option{background:#ffffff}
        .settings-row{display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid #ebe8df}
        .stat-bar{background:${primaryColor};border-radius:4px 4px 0 0;min-width:8px;transition:height .5s ease}
        .toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#ffffff;border:1px solid #e7e4da;border-radius:8px;padding:12px 24px;font-size:14px;font-weight:700;z-index:999;animation:fadeInUp .2s ease;box-shadow:0 8px 30px rgba(0,0,0,.18);white-space:nowrap}
        @media print{nav,header,.no-print{display:none!important}body{background:white;color:black}.ev-card{border:1px solid #ccc;break-inside:avoid;margin-bottom:8px}.print-title{display:block!important}}
        .print-title{display:none}
        .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
        .grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
        @media (max-width:600px), (max-height:480px) and (pointer:coarse){
          .grid-2,.grid-3{grid-template-columns:1fr}
          .modal{padding:22px 18px}
          .modal-actions-sticky{margin:8px -18px -22px;padding:12px 18px}
          .btn-ghost-onbrand,.btn-ghost,.btn-red{padding:9px 14px;font-size:13px}
          .btn-sm{padding:7px 12px;font-size:12px;min-height:32px}
          .ev-card{padding:14px 16px}
          .desktop-tabs,.header-chevron{display:none!important}
          .admin-corner{top:12px;right:12px;gap:6px}
          .admin-corner .btn-ghost-onbrand{padding:7px 11px;font-size:11px}
          main{padding-bottom:92px!important}
          .bottom-nav{display:flex;position:fixed;bottom:0;left:0;right:0;background:#ffffff;border-top:1px solid #ebe8df;z-index:90;overflow-x:auto;padding-bottom:env(safe-area-inset-bottom,0);box-shadow:0 -2px 10px rgba(0,0,0,.08)}
          .filter-toggle{display:flex;align-items:center;justify-content:space-between;width:100%;background:#ffffff;border:1px solid #e7e4da;color:#56554d;padding:12px 16px;border-radius:8px;font-family:inherit;font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;cursor:pointer;margin-bottom:10px}
          .filter-bar-content{display:none}
          .filter-bar-content.expanded{display:block;animation:fadeInUp .2s ease both}
        }
      `}</style>

      {/* Toast notification */}
      {toast && (
        <div className="toast" style={{ color:toast.type==="error"?"#e63946":toast.type==="warn"?"#f4a261":primaryColor, borderColor:toast.type==="error"?"#e6394644":primaryColor+"44" }}>
          {toast.type==="error"?"✗":toast.type==="warn"?"⚠":"✓"} {toast.msg}
        </div>
      )}

      {/* Offline banner */}
      {offline && (
        <div style={{ background:"#1a1200", borderBottom:"1px solid #f4a26144", padding:"8px 20px", textAlign:"center", fontSize:13, color:"#f4a261", fontFamily:"Barlow,sans-serif" }}>
          📡 Geen internetverbinding — je ziet de laatste opgeslagen versie
        </div>
      )}

      {/* Header */}
      <header className="no-print" style={{ background:"#F18C21", position:"relative", overflow:"hidden" }}>
        <div style={{ position:"absolute", top:-30, right:40, width:220, height:200, backgroundImage:"radial-gradient(#ffffff55 1.7px,transparent 1.8px)", backgroundSize:"15px 15px", pointerEvents:"none" }} />
        <div style={{ position:"absolute", top:0, bottom:0, left:"46%", width:90, background:"#ffffff1f", transform:"skewX(-15deg)", pointerEvents:"none" }} />
        <div style={{ position:"absolute", top:0, bottom:0, left:"53%", width:26, background:"#ffffff1f", transform:"skewX(-15deg)", pointerEvents:"none" }} />
        <div className="header-chevron" style={{ position:"absolute", top:"50%", right:24, transform:"translateY(-50%)", fontSize:64, fontWeight:900, fontStyle:"italic", color:"#ffffff26", pointerEvents:"none", letterSpacing:-10 }}>❯❯❯</div>

        <div className="admin-corner">
          {adminMode ? (
            <>
              <span style={{ fontSize:11, color:"#2E3192", background:"#ffffffcc", padding:"3px 10px", borderRadius:12, fontWeight:700, textTransform:"uppercase" }}>{ROLE_LABELS[adminRole]||"Admin"}</span>
              <button className="btn-ghost-onbrand" onClick={logout} style={{ fontSize:12 }}>Uitloggen</button>
            </>
          ) : (
            <button className="btn-ghost-onbrand" onClick={()=>{ setShowPinModal(true); setPinInput(""); setPinError(false); }} style={{ fontSize:12 }}>⚙ Beheer</button>
          )}
        </div>

        <div style={{ maxWidth:960, margin:"0 auto", padding:"20px 20px 0", position:"relative" }}>
          <div style={{ display:"flex", alignItems:"flex-end", justifyContent:"space-between", flexWrap:"wrap", gap:12, paddingRight:110 }}>
            <div>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:6 }}>
                <img
                  src={clubSettings.logo || clubLogo}
                  alt="logo"
                  style={{ height:34, width:34, borderRadius:"50%", background:"#fff", padding:2, objectFit:"contain", flexShrink:0 }}
                  onError={e=>{ e.target.onerror=null; e.target.src=clubLogo; }}
                />
                <span style={{ fontSize:11, fontWeight:800, letterSpacing:2, textTransform:"uppercase", color:"#2E3192" }}>{clubSettings.name}</span>
              </div>
              <h1 style={{ fontSize:"clamp(28px,6vw,52px)", fontWeight:900, fontStyle:"italic", letterSpacing:"-1px", lineHeight:.95, textTransform:"uppercase", color:"#fff" }}>{clubSettings.subtitle}</h1>
            </div>
            <div style={{ display:"flex", gap:8, alignItems:"center", paddingBottom:4, flexWrap:"wrap" }}>
              {adminMode && (
                <>
                  {canEdit && <button className="btn-red" onClick={openNew}>+ Nieuw</button>}
                  {canSettings && <button className="btn-ghost-onbrand" onClick={()=>setShowSettings(true)} style={{ fontSize:12 }}>⚙ Instellingen</button>}
                </>
              )}
            </div>
          </div>

          {/* Desktop pill tabs, attached to the header */}
          <div className="desktop-tabs" style={{ display:"flex", gap:6, overflowX:"auto", marginTop:16, paddingBottom:16 }}>
            {tabList.map(t => (
              <button key={t.id} className={`pill-tab ${tab===t.id?"active":""}`} onClick={()=>setTab(t.id)}>{t.label}</button>
            ))}
            <button className="pill-tab" onClick={()=>setShowIdeaForm(true)} style={{ marginLeft:"auto" }}>💡 Ik heb ideeën voor spelerscommissie</button>
          </div>
        </div>
      </header>

      {/* Mobile bottom navbar -- alle tabs + idee-knop */}
      <nav className="bottom-nav no-print">
        {tabList.map(t => (
          <button key={t.id} className={`bottom-nav-btn ${tab===t.id?"active":""}`} onClick={()=>setTab(t.id)}>
            <span className="bn-icon"><NavIcon name={t.id} /></span>
            <span>{t.label}</span>
          </button>
        ))}
        <button className="bottom-nav-btn" onClick={()=>setShowIdeaForm(true)}>
          <span className="bn-icon"><NavIcon name="idee" /></span>
          <span>Idee</span>
        </button>
      </nav>

      {/* Eerstvolgende */}
      {upcomingTop.length > 0 && (() => {
        const ev = upcomingTop[0];
        const days = daysUntil(ev.start_time);
        const d = new Date(ev.start_time);
        const daysLabel = days<0?"Afgelopen":days===0?"Vandaag":days===1?"Morgen":`${days} dagen`;
        return (
          <div className="no-print" style={{ maxWidth:960, margin:"0 auto", padding:"20px 20px 0" }}>
            <div style={{ fontSize:12, fontWeight:800, letterSpacing:3, color:primaryColor, textTransform:"uppercase", marginBottom:10 }}>❯❯ Eerstvolgende</div>
            <div onClick={()=>setSelectedEvent(ev)} style={{ position:"relative", background:"#2E3192", borderRadius:6, padding:"26px 28px", overflow:"hidden", cursor:"pointer", animation:"fadeInUp .3s both" }}>
              <div style={{ position:"absolute", top:0, bottom:0, right:0, width:200, background:"#F18C21", clipPath:"polygon(40% 0,100% 0,100% 100%,0 100%)" }} />
              <div style={{ position:"absolute", top:-20, right:16, width:130, height:130, backgroundImage:"radial-gradient(#ffffff44 1.5px,transparent 1.6px)", backgroundSize:"14px 14px" }} />
              <div style={{ position:"relative", display:"flex", alignItems:"center", gap:26, flexWrap:"wrap" }}>
                <div style={{ textAlign:"center", color:"#fff", flex:"none" }}>
                  <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:900, fontSize:64, lineHeight:.75 }}>{d.getDate()}</div>
                  <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:800, fontSize:20, textTransform:"uppercase", letterSpacing:1 }}>{d.toLocaleDateString("nl-NL",{month:"short"})}</div>
                </div>
                <div style={{ flex:1, minWidth:200 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8, flexWrap:"wrap" }}>
                    <span style={{ background:"#fff", color:"#2E3192", fontSize:11, fontWeight:800, letterSpacing:1, textTransform:"uppercase", padding:"3px 11px", borderRadius:20 }}>{ev.category}</span>
                    <span style={{ fontSize:12, fontWeight:800, letterSpacing:1, color:"#fff", textTransform:"uppercase" }}>{daysLabel}</span>
                  </div>
                  <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:900, fontStyle:"italic", fontSize:36, lineHeight:.9, color:"#fff", textTransform:"uppercase" }}>{ev.title}</div>
                  <div style={{ fontSize:15, color:"#c9cbef", marginTop:8 }}>{formatDate(ev.start_time)} · {formatTime(ev.start_time)}{ev.location?` · ${ev.location}`:""}</div>
                  {ev.cost > 0 && <div style={{ fontSize:13, color:"#c9cbef", marginTop:4 }}>💶 €{Number(ev.cost).toFixed(2)}</div>}
                </div>
              </div>
            </div>
            {upcomingTop.length > 1 && (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:10, marginTop:10, paddingBottom:20 }}>
                {upcomingTop.slice(1).map((ev2,i) => {
                  const cc2 = categoryColors[ev2.category] || primaryColor;
                  const days2 = daysUntil(ev2.start_time);
                  return (
                    <div key={ev2.id} onClick={()=>setSelectedEvent(ev2)} style={{ background:"#ffffff", border:`1px solid ${cc2}33`, borderRadius:8, padding:"12px 16px", cursor:"pointer", animation:`fadeInUp .3s ${(i+1)*0.08}s both` }}>
                      <div style={{ fontSize:14, fontWeight:700, textTransform:"uppercase" }}>{ev2.title}</div>
                      <div style={{ fontSize:12, color:"#76756f", marginTop:2, fontFamily:"Barlow,sans-serif" }}>{formatDate(ev2.start_time)}</div>
                      <div style={{ marginTop:6, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                        <span className="badge" style={{ background:cc2+"22", color:cc2 }}>{ev2.category}</span>
                        <span style={{ fontSize:11, fontWeight:700, color:days2<=3?primaryColor:"#b0afa9" }}>{days2===0?"VANDAAG":days2===1?"MORGEN":`${days2}D`}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* Vastgepinde mededelingen */}
      {news.some(n=>n.pinned) && (
        <div className="no-print" style={{ maxWidth:960, margin:"0 auto", padding:"20px 20px 0" }}>
          <div style={{ background:"#ffffff", border:`1px solid ${primaryColor}33`, borderLeft:`4px solid ${primaryColor}`, borderRadius:8, padding:"14px 20px", display:"flex", flexDirection:"column", gap:10, cursor:"pointer" }} onClick={()=>setTab("nieuws")}>
            {news.filter(n=>n.pinned).map(n => (
              <div key={n.id} style={{ display:"flex", alignItems:"flex-start", gap:12 }}>
                <span style={{ fontSize:22 }}>📌</span>
                <div>
                  <div style={{ fontSize:15, fontWeight:800, textTransform:"uppercase" }}>{n.title}</div>
                  <div style={{ fontSize:13, color:"#76756f", fontFamily:"Barlow,sans-serif", marginTop:2 }}>{n.body.length>140?n.body.slice(0,140)+"…":n.body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bardienst deze week */}
      {bardienstThisWeek.length > 0 && (
        <div className="no-print" style={{ maxWidth:960, margin:"0 auto", padding:"20px 20px 0" }}>
          <div style={{ background:"#ffffff", border:`1px solid ${primaryColor}33`, borderLeft:`4px solid ${primaryColor}`, borderRadius:8, padding:"14px 20px", display:"flex", alignItems:"center", gap:14, flexWrap:"wrap", cursor:"pointer" }} onClick={()=>setTab("bardienst")}>
            <span style={{ fontSize:26 }}>🍺</span>
            <div style={{ flex:1, minWidth:200 }}>
              <div style={{ fontSize:11, fontWeight:700, letterSpacing:2, textTransform:"uppercase", color:primaryColor, marginBottom:4 }}>Bardienst deze week</div>
              {bardienstThisWeek.map(b => (
                <div key={b.id} style={{ fontSize:14, fontFamily:"Barlow,sans-serif" }}>
                  <strong style={{ fontFamily:"'Saira Condensed',sans-serif" }}>{formatDate(b.shift_date)}</strong>{b.time_label?` · ${b.time_label}`:""} — {b.names}
                </div>
              ))}
            </div>
            <button className="btn-sm" onClick={e=>{ e.stopPropagation(); setTab("bardienst"); }}>Bekijk alles</button>
          </div>
        </div>
      )}

      <div className="print-title" style={{ padding:"20px 20px 0", fontSize:24, fontWeight:700 }}>{clubSettings.name} — {clubSettings.subtitle} — {MONTHS_NL[calDate.month]} {calDate.year}</div>

      {/* Search + filter bar -- alleen relevant voor de Agenda-lijst, niet voor Kalender/Bardienst/Nieuws/Archief */}
      {tab==="agenda" && (
      <div className="no-print" style={{ maxWidth:960, margin:"0 auto", padding:"16px 20px 0" }}>
        <button className="filter-toggle" onClick={()=>setShowMobileFilters(v=>!v)}>
          <span>🔍 Filter{activeFilters?" (actief)":""}</span>
          <span>{showMobileFilters?"▲":"▼"}</span>
        </button>
        <div className={`filter-bar-content ${showMobileFilters?"expanded":""}`}>
        <div style={{ display:"flex", gap:8, marginBottom:10, flexWrap:"wrap" }}>
          <div style={{ position:"relative", flex:1, minWidth:200 }}>
            <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:"#56554d", pointerEvents:"none" }}>🔍</span>
            <input className="input" value={searchInput} onChange={e=>setSearchInput(e.target.value)} placeholder="Zoek op naam, locatie, beschrijving..." style={{ paddingLeft:38, borderRadius:24 }} />
          </div>
          <input className="input" type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={{ width:150 }} title="Vanaf datum" />
          <input className="input" type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} style={{ width:150 }} title="Tot datum" />
          <select className="input" value={locationFilter} onChange={e=>setLocationFilter(e.target.value)} style={{ width:"auto" }}>
            <option>Alles</option>
            {allLocations.map(l=><option key={l}>{l}</option>)}
          </select>
          {activeFilters && <button className="btn-sm" onClick={()=>{ setSearchInput(""); setSearchQuery(""); setDateFrom(""); setDateTo(""); setLocationFilter("Alles"); }}>✕ Reset</button>}
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
          {["Alles",...allCategories].map(cat=>(
            <button key={cat} className={`filter-btn ${filter===cat?"active":""}`} style={{ "--fc":cat==="Alles"?primaryColor:(categoryColors[cat]||primaryColor) }} onClick={()=>setFilter(cat)}>{cat}</button>
          ))}
          <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
            <label style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer", fontSize:13, color:"#76756f", fontFamily:"Barlow,sans-serif" }}>
              <input type="checkbox" checked={showPast} onChange={e=>setShowPast(e.target.checked)} style={{ accentColor:primaryColor }} />
              Toon verleden
            </label>
            <button className="btn-sm no-print" onClick={()=>window.print()}>🖨 Afdrukken</button>
          </div>
        </div>
        </div>
      </div>
      )}

      <main style={{ maxWidth:960, margin:"0 auto", padding:"24px 20px 80px" }}>

        {/* AGENDA */}
        {tab==="agenda" && (
          <>
          {/* Nieuw #178: bulk-actiebalk zodra er events geselecteerd zijn */}
          {canEdit && selectedEventIds.size>0 && (
            <div className="no-print" style={{ position:"sticky", top:0, zIndex:5, display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", background:"#1d1f3a", color:"#fff", borderRadius:8, padding:"10px 16px", marginBottom:14 }}>
              <strong style={{ fontFamily:"'Saira Condensed',sans-serif" }}>{selectedEventIds.size} geselecteerd</strong>
              <button className="btn-sm" onClick={bulkArchive} disabled={bulkBusy}>Archiveer</button>
              {canDelete && <button className="btn-sm" onClick={bulkDelete} disabled={bulkBusy} style={{ color:"#e63946" }}>Verwijder</button>}
              <select className="input" defaultValue="" onChange={e=>{ bulkSetCategory(e.target.value); e.target.value=""; }} disabled={bulkBusy} style={{ width:"auto", fontSize:13 }}>
                <option value="" disabled>Verplaats naar categorie…</option>
                {allCategories.map(c=><option key={c} value={c}>{c}</option>)}
              </select>
              <button className="btn-sm" onClick={()=>setSelectedEventIds(new Set())} style={{ marginLeft:"auto" }}>✕ Selectie wissen</button>
            </div>
          )}
          {loading
            ? <div style={{ display:"flex", flexDirection:"column", gap:10 }}>{[0,1,2].map(i=><SkeletonCard key={i} delay={i*0.07} />)}</div>
            : visibleEvents.length===0
              ? (
                <div style={{ textAlign:"center", padding:60 }}>
                  <div style={{ fontSize:48, marginBottom:16 }}>📅</div>
                  <div style={{ color:"#56554d", fontSize:14, letterSpacing:1, textTransform:"uppercase" }}>Geen evenementen gevonden</div>
                  {activeFilters && (
                    <>
                      <div style={{ color:"#76756f", fontSize:13, fontFamily:"Barlow,sans-serif", marginTop:8 }}>Niets gevonden met de huidige filters</div>
                      <button className="btn-sm" style={{ marginTop:14 }} onClick={()=>{ setSearchInput(""); setSearchQuery(""); setDateFrom(""); setDateTo(""); setLocationFilter("Alles"); setFilter("Alles"); }}>✕ Filters wissen</button>
                    </>
                  )}
                  {canEdit && <button className="btn-red" style={{ marginTop:20 }} onClick={openNew}>Eerste evenement toevoegen</button>}
                </div>
              )
              : Object.entries(grouped).map(([month,evs]) => (
                <div key={month} style={{ marginBottom:36 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14 }}>
                    <span style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:900, fontStyle:"italic", fontSize:22, textTransform:"uppercase", color:"#2E3192" }}>{month}</span>
                    <div style={{ flex:1, height:3, background:"#F18C21" }} />
                    <span style={{ fontSize:12, fontWeight:700, color:"#b0afa9", textTransform:"uppercase" }}>{evs.length} activiteit{evs.length!==1?"en":""}</span>
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                    {evs.map((ev,idx) => {
                      const cc = categoryColors[ev.category] || primaryColor;
                      const past = !isUpcoming(ev.start_time);
                      return (
                        <div
                          key={ev.id}
                          className={`ev-card ${ev.hidden?"hidden-ev":""} ${dragOverId===ev.id?"drag-over":""} ${draggedId===ev.id?"dragging":""}`}
                          style={{ "--cc":cc, opacity:past?.5:1, animationDelay:`${idx*0.05}s`, cursor:canEdit?"grab":"pointer" }}
                          onClick={()=>setSelectedEvent(ev)}
                          draggable={canEdit}
                          onDragStart={()=>handleDragStart(ev.id)}
                          onDragOver={e=>handleDragOver(e,ev.id)}
                          onDrop={()=>handleDrop(ev.id)}
                          onDragEnd={()=>{ setDraggedId(null); setDragOverId(null); }}
                        >
                          {ev.image_url && (
                            <div style={{ margin:"-18px -20px 14px", overflow:"hidden", borderRadius:"8px 8px 0 0", height:140 }}>
                              <img src={ev.image_url} alt={ev.title} style={{ width:"100%", height:"100%", objectFit:"cover" }} onError={e=>e.target.parentElement.style.display="none"} />
                            </div>
                          )}
                          <div style={{ display:"flex", alignItems:"center", gap:16 }}>
                            {canEdit && (
                              <input type="checkbox" checked={selectedEventIds.has(ev.id)} onClick={e=>e.stopPropagation()} onChange={()=>toggleEventSelected(ev.id)} style={{ width:18, height:18, accentColor:primaryColor, flexShrink:0, cursor:"pointer" }} title="Selecteren voor bulkactie" />
                            )}
                            <div style={{ background:cc, color:"#fff", borderRadius:8, width:60, height:60, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                              <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontSize:24, fontWeight:900, lineHeight:1 }}>{new Date(ev.start_time).getDate()}</div>
                              <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:1 }}>{new Date(ev.start_time).toLocaleDateString("nl-NL",{month:"short"})}</div>
                            </div>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6, flexWrap:"wrap" }}>
                                <span className="badge" style={{ background:cc+"22", color:cc }}>{ev.category}</span>
                                {ev.hidden && <span className="badge" style={{ background:"#76756f22", color:"#76756f" }}>Verborgen</span>}
                                {!past && daysUntil(ev.start_time)<=3 && <span className="badge" style={{ background:primaryColor+"14", color:primaryColor }}>{daysUntil(ev.start_time)===0?"Vandaag!":daysUntil(ev.start_time)===1?"Morgen":`${daysUntil(ev.start_time)}d`}</span>}
                                {ev.cost > 0 && <span style={{ fontSize:11, color:"#52b788", fontFamily:"Barlow,sans-serif" }}>💶 €{Number(ev.cost).toFixed(2)}</span>}
                                {ev.sponsor_name && <span style={{ fontSize:11, color:"#76756f", fontFamily:"Barlow,sans-serif" }}>🤝 {ev.sponsor_name}</span>}
                              </div>
                              <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontSize:22, fontWeight:800, textTransform:"uppercase", lineHeight:1 }}>{ev.title}</div>
                              {ev.description && <div style={{ fontSize:14, color:"#76756f", marginTop:4, fontFamily:"Barlow,sans-serif", lineHeight:1.4 }}>{ev.description.length>100?ev.description.slice(0,100)+"…":ev.description}</div>}
                              <div style={{ marginTop:8, display:"flex", gap:12, flexWrap:"wrap" }}>
                                <span style={{ fontSize:13, color:"#76756f", fontFamily:"Barlow,sans-serif" }}>🕐 {formatTime(ev.start_time)}{ev.end_time?` – ${formatTime(ev.end_time)}`:""}</span>
                                {ev.location && <span style={{ fontSize:13, color:"#76756f", fontFamily:"Barlow,sans-serif" }}>📍 {ev.location}</span>}
                                <span style={{ fontSize:13, color:"#76756f", fontFamily:"Barlow,sans-serif" }}>👥 {(attendees[ev.id]||[]).length} aangemeld</span>
                              </div>
                              {ev.sponsor_logo && <img src={ev.sponsor_logo} alt={ev.sponsor_name} style={{ height:24, marginTop:8, objectFit:"contain" }} onError={e=>e.target.style.display="none"} />}
                            </div>
                            <span style={{ fontSize:22, color:"#c2bfb2", flexShrink:0 }}>›</span>
                          </div>
                          {canEdit && (
                            <div style={{ marginTop:12, display:"flex", gap:6, flexWrap:"wrap" }} onClick={e=>e.stopPropagation()}>
                              <button className="btn-sm" onClick={()=>openEdit(ev)}>Bewerken</button>
                              <button className="btn-sm" onClick={()=>handleDuplicate(ev)}>Dupliceren</button>
                              <button className="btn-sm" onClick={()=>setShowQR(ev)}>QR Code</button>
                              <button className="btn-sm" onClick={()=>downloadICS(ev)}>📅 .ics</button>
                              <button className="btn-sm" onClick={()=>handleArchive(ev)} style={{ color:"#f4a261" }}>Archiveren</button>
                              {canDelete && <button className="btn-sm" onClick={()=>handleDelete(ev.id)} style={{ color:"#e63946" }}>Verwijderen</button>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
          </>
        )}

        {/* NIEUWS */}
        {tab==="nieuws" && (
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20, flexWrap:"wrap" }}>
              <span style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:900, fontStyle:"italic", fontSize:28, color:"#2E3192", textTransform:"uppercase" }}>Mededelingen</span>
              <span style={{ background:"#2E3192", color:"#fff", fontSize:12, fontWeight:800, padding:"3px 12px", borderRadius:20 }}>{news.length}</span>
              <div style={{ flex:1, height:3, background:"#F18C21", minWidth:20 }} />
              {canEdit && <button className="btn-red" onClick={openNewNews}>+ Mededeling plaatsen</button>}
            </div>
            {news.length === 0 ? (
              <div style={{ textAlign:"center", padding:60 }}>
                <div style={{ fontSize:48, marginBottom:16 }}>📢</div>
                <div style={{ color:"#56554d", fontSize:14, letterSpacing:1, textTransform:"uppercase" }}>Nog geen mededelingen</div>
                {canEdit && <button className="btn-red" style={{ marginTop:20 }} onClick={openNewNews}>Eerste mededeling plaatsen</button>}
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {news.map(n => (
                  <div key={n.id} className="ev-card" onClick={()=>setSelectedNews(n)} style={{ borderLeft:n.pinned?"4px solid #F18C21":"1px solid #ebe8df" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:16 }}>
                      {n.image_url ? (
                        <div style={{ width:60, height:60, borderRadius:8, overflow:"hidden", flexShrink:0 }}>
                          <img src={n.image_url} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} onError={e=>{ e.target.onerror=null; e.target.parentElement.style.display="none"; }} />
                        </div>
                      ) : (
                        <div style={{ width:60, height:60, borderRadius:8, background:n.pinned?"#F18C21":"#2E3192", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, flexShrink:0 }}>📢</div>
                      )}
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4, flexWrap:"wrap" }}>
                          {n.pinned && <span className="badge" style={{ background:"#F18C2122", color:"#F18C21" }}>📌 Vastgepind</span>}
                          <span style={{ fontSize:12, color:"#b0afa9" }}>{new Date(n.created_at).toLocaleDateString("nl-NL", { day:"numeric", month:"long", year:"numeric" })}</span>
                        </div>
                        <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontSize:20, fontWeight:800, textTransform:"uppercase", lineHeight:1.1, color:"#1d1f3a" }}>{n.title}</div>
                        <div style={{ fontSize:13, color:"#76756f", marginTop:4, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{n.body}</div>
                      </div>
                      <span style={{ fontSize:22, color:"#c2bfb2", flexShrink:0 }}>›</span>
                    </div>
                    {canEdit && (
                      <div style={{ marginTop:12, display:"flex", gap:6 }} onClick={e=>e.stopPropagation()}>
                        <button className="btn-sm" onClick={()=>openEditNews(n)}>Bewerken</button>
                        {canDelete && <button className="btn-sm" onClick={()=>handleDeleteNews(n.id)} style={{ color:"#e63946" }}>Verwijderen</button>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* BARDIENST */}
        {tab==="bardienst" && (() => {
          const todayStr0 = toDateStr(new Date());
          const upcomingShifts = bardienst.filter(b => b.shift_date >= todayStr0);
          const pastShifts = bardienst.filter(b => b.shift_date < todayStr0);
          const nextShift = upcomingShifts[0];
          const restShifts = nextShift ? upcomingShifts.slice(1) : upcomingShifts;
          const groupsMap = {};
          [...restShifts, ...pastShifts].forEach(b => {
            const d = new Date(b.shift_date);
            const key = `${MONTHS_NL[d.getMonth()]} ${d.getFullYear()}`;
            (groupsMap[key] = groupsMap[key] || []).push(b);
          });
          const initials = names => names.split(" ").filter(Boolean).map(w=>w[0]).slice(0,2).join("").toUpperCase();
          const shiftRow = (b, cc) => {
            const d = new Date(b.shift_date);
            const isToday = b.shift_date === todayStr0;
            const isPast = b.shift_date < todayStr0;
            const team = b.team_id ? teams.find(t=>t.id===b.team_id) : null;
            const checkedCount = (b.checklist||[]).filter(c=>c.done).length;
            return (
              <div key={b.id} className="ev-card" style={{ opacity:isPast?.5:1, cursor:"default" }}>
                <div style={{ display:"flex", alignItems:"center", gap:16 }}>
                  <div style={{ background:cc, color:"#fff", borderRadius:8, width:60, height:60, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                    <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontSize:24, fontWeight:900, lineHeight:1 }}>{d.getDate()}</div>
                    <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:1 }}>{d.toLocaleDateString("nl-NL",{month:"short"})}</div>
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6, flexWrap:"wrap" }}>
                      {isToday && <span className="badge" style={{ background:cc+"22", color:cc }}>Vandaag</span>}
                      {b.time_label && <span style={{ fontSize:13, color:"#76756f" }}>🕐 {b.time_label}</span>}
                    </div>
                    <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontSize:22, fontWeight:800, textTransform:"uppercase", lineHeight:1, color:"#1d1f3a" }}>{formatDate(b.shift_date)}</div>
                    <div style={{ marginTop:10, display:"flex", flexWrap:"wrap", gap:8 }}>
                      {/* Nieuw #40: team-badge i.p.v. losse namen wanneer een team gekoppeld is */}
                      {team && (
                        <span style={{ display:"inline-flex", alignItems:"center", gap:7, background:team.color+"22", border:`1px solid ${team.color}55`, borderRadius:20, padding:"4px 14px", fontSize:13, fontWeight:800, color:team.color, textTransform:"uppercase" }}>
                          👕 {team.name}
                        </span>
                      )}
                      {b.names.split(",").map(n=>n.trim()).filter(Boolean).map((n,i) => {
                        const status = (b.attendance && b.attendance[n]) || "present";
                        const noShow = status === "no_show";
                        return (
                          <span key={i} onClick={canEdit?()=>toggleAttendance(b,n):undefined}
                            title={canEdit?(noShow?"Gemarkeerd als niet gekomen -- klik om te herstellen":"Klik om als 'niet gekomen' te markeren"):undefined}
                            style={{ display:"inline-flex", alignItems:"center", gap:7, background:noShow?"#e6394611":cc+"14", border:`1px solid ${noShow?"#e6394655":cc+"33"}`, borderRadius:20, padding:"3px 12px 3px 3px", fontSize:13, fontWeight:700, color:noShow?"#e63946":"#1d1f3a", textDecoration:noShow?"line-through":"none", cursor:canEdit?"pointer":"default" }}>
                            <span style={{ width:22, height:22, borderRadius:"50%", background:noShow?"#e63946":cc, color:"#fff", fontSize:10, fontWeight:800, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>{noShow?"✗":initials(n)}</span>
                            {n}
                          </span>
                        );
                      })}
                    </div>
                    {b.note && <div style={{ fontSize:14, color:"#76756f", marginTop:8, lineHeight:1.4 }}>📝 {b.note}</div>}
                    {/* Nieuw #38: voorraad-checklist */}
                    {(b.checklist||[]).length>0 && (
                      <div style={{ marginTop:10, background:"#f7f6f2", borderRadius:6, padding:"8px 12px" }}>
                        <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:1, color:"#76756f", marginBottom:6 }}>Checklist ({checkedCount}/{b.checklist.length})</div>
                        <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                          {b.checklist.map((c,i) => (
                            <label key={i} style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, fontFamily:"Barlow,sans-serif", cursor:canEdit?"pointer":"default", color:c.done?"#76756f":"#1d1f3a", textDecoration:c.done?"line-through":"none" }}>
                              <input type="checkbox" checked={!!c.done} disabled={!canEdit} onChange={()=>toggleChecklistItem(b,i)} style={{ accentColor:cc }} />
                              {c.item}
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                {canEdit && (
                  <div style={{ marginTop:12, display:"flex", gap:6, flexWrap:"wrap" }}>
                    <button className="btn-sm" onClick={()=>openEditBardienst(b)}>Bewerken</button>
                    {canDelete && <button className="btn-sm" onClick={()=>handleDeleteBardienst(b.id)} style={{ color:"#e63946" }}>Verwijderen</button>}
                  </div>
                )}
              </div>
            );
          };
          return (
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20, flexWrap:"wrap" }}>
              <span style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:900, fontStyle:"italic", fontSize:28, color:"#2E3192", textTransform:"uppercase" }}>Bardienstrooster</span>
              <span style={{ background:"#2E3192", color:"#fff", fontSize:12, fontWeight:800, padding:"3px 12px", borderRadius:20 }}>{bardienst.length} diensten</span>
              <div style={{ flex:1, height:3, background:"#F18C21", minWidth:20 }} />
              {canEdit && <button className="btn-red" onClick={openNewBardienst}>+ Bardienst toevoegen</button>}
            </div>
            {bardienst.length === 0 ? (
              <div style={{ textAlign:"center", padding:60 }}>
                <div style={{ fontSize:48, marginBottom:16 }}>🍺</div>
                <div style={{ color:"#56554d", fontSize:14, letterSpacing:1, textTransform:"uppercase" }}>Nog geen bardiensten ingepland</div>
                {canEdit && <button className="btn-red" style={{ marginTop:20 }} onClick={openNewBardienst}>Eerste bardienst toevoegen</button>}
              </div>
            ) : (
              <div>
                {nextShift && (() => {
                  const d = new Date(nextShift.shift_date);
                  const days = Math.round((new Date(nextShift.shift_date+"T00:00:00") - new Date(todayStr0+"T00:00:00")) / 86400000);
                  const daysLabel = days===0?"Vandaag":days===1?"Morgen":`${days} dagen`;
                  return (
                    <div style={{ marginBottom:30 }}>
                      <div style={{ fontSize:12, fontWeight:800, letterSpacing:3, color:"#F18C21", textTransform:"uppercase", marginBottom:10 }}>❯❯ Eerstvolgende bardienst</div>
                      <div style={{ position:"relative", background:"#F18C21", borderRadius:6, padding:"26px 28px", overflow:"hidden" }}>
                        <div style={{ position:"absolute", top:0, bottom:0, right:0, width:200, background:"#2E3192", clipPath:"polygon(40% 0,100% 0,100% 100%,0 100%)" }} />
                        <div style={{ position:"absolute", top:-20, right:16, width:130, height:130, backgroundImage:"radial-gradient(#ffffff44 1.5px,transparent 1.6px)", backgroundSize:"14px 14px" }} />
                        <div style={{ position:"relative", display:"flex", alignItems:"center", gap:26, flexWrap:"wrap" }}>
                          <div style={{ textAlign:"center", color:"#fff", flex:"none" }}>
                            <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:900, fontSize:64, lineHeight:.75 }}>{d.getDate()}</div>
                            <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:800, fontSize:20, textTransform:"uppercase", letterSpacing:1 }}>{d.toLocaleDateString("nl-NL",{month:"short"})}</div>
                          </div>
                          <div style={{ flex:1, minWidth:200 }}>
                            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8, flexWrap:"wrap" }}>
                              <span style={{ background:"#fff", color:"#F18C21", fontSize:11, fontWeight:800, letterSpacing:1, textTransform:"uppercase", padding:"3px 11px", borderRadius:20 }}>🍺 Bardienst</span>
                              <span style={{ fontSize:12, fontWeight:800, letterSpacing:1, color:"#fff", textTransform:"uppercase" }}>{daysLabel}</span>
                            </div>
                            <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:900, fontStyle:"italic", fontSize:32, lineHeight:1, color:"#fff", textTransform:"uppercase" }}>{formatDate(nextShift.shift_date)}</div>
                            <div style={{ fontSize:15, color:"#ffe4c2", marginTop:8 }}>{nextShift.time_label || "Tijd volgt"}</div>
                            <div style={{ marginTop:12, display:"flex", flexWrap:"wrap", gap:8 }}>
                              {nextShift.team_id && (() => { const t = teams.find(x=>x.id===nextShift.team_id); return t ? (
                                <span style={{ display:"inline-flex", alignItems:"center", gap:7, background:"#ffffff26", borderRadius:20, padding:"4px 14px", fontSize:13, fontWeight:800, color:"#fff", textTransform:"uppercase" }}>👕 {t.name}</span>
                              ) : null; })()}
                              {nextShift.names.split(",").map(n=>n.trim()).filter(Boolean).map((n,i)=>(
                                <span key={i} style={{ display:"inline-flex", alignItems:"center", gap:7, background:"#ffffff26", borderRadius:20, padding:"3px 12px 3px 3px", fontSize:13, fontWeight:700, color:"#fff" }}>
                                  <span style={{ width:22, height:22, borderRadius:"50%", background:"#fff", color:"#F18C21", fontSize:10, fontWeight:800, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>{initials(n)}</span>
                                  {n}
                                </span>
                              ))}
                            </div>
                            {nextShift.note && <div style={{ fontSize:13, color:"#ffe4c2", marginTop:10 }}>📝 {nextShift.note}</div>}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {Object.entries(groupsMap).map(([month, shifts]) => (
                  <div key={month} style={{ marginBottom:30 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14 }}>
                      <span style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:900, fontStyle:"italic", fontSize:22, textTransform:"uppercase", color:"#2E3192" }}>{month}</span>
                      <div style={{ flex:1, height:3, background:"#F18C21" }} />
                      <span style={{ fontSize:12, fontWeight:700, color:"#b0afa9", textTransform:"uppercase" }}>{shifts.length} dienst{shifts.length!==1?"en":""}</span>
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                      {shifts.map(b => shiftRow(b, "#2E3192"))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          );
        })()}

        {/* KALENDER */}
        {tab==="kalender" && (
          <div>
            <div style={{ display:"flex", gap:6, marginBottom:16 }}>
              {[["month","Maand"],["week","Week"],["year","Jaar"]].map(([v,l])=>(
                <button key={v} className={`filter-btn ${calView===v?"active":""}`} onClick={()=>setCalView(v)} style={{ fontSize:12 }}>{l}</button>
              ))}
            </div>

            {calView==="month" && (
              <div>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20, flexWrap:"wrap", gap:12 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:14 }}>
                    <button onClick={()=>setCalDate(d=>{ const m=d.month===0?11:d.month-1; return {year:d.month===0?d.year-1:d.year,month:m}; })} style={{ border:"none", cursor:"pointer", background:"#2E3192", color:"#fff", width:38, height:38, borderRadius:4, fontSize:18, fontWeight:700 }}>‹</button>
                    <span style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:900, fontStyle:"italic", fontSize:30, color:"#2E3192", textTransform:"uppercase", minWidth:220, textAlign:"center" }}>{MONTHS_NL[calDate.month]} {calDate.year}</span>
                    <button onClick={()=>setCalDate(d=>{ const m=d.month===11?0:d.month+1; return {year:d.month===11?d.year+1:d.year,month:m}; })} style={{ border:"none", cursor:"pointer", background:"#2E3192", color:"#fff", width:38, height:38, borderRadius:4, fontSize:18, fontWeight:700 }}>›</button>
                  </div>
                  <div style={{ display:"flex", gap:8 }}>
                    <button onClick={()=>setCalDate({year:new Date().getFullYear(),month:new Date().getMonth()})} style={{ border:"1.5px solid #F18C21", cursor:"pointer", background:"#fff", color:"#F18C21", fontFamily:"'Saira Condensed',sans-serif", fontWeight:800, fontSize:14, textTransform:"uppercase", padding:"8px 18px", borderRadius:4 }}>Vandaag</button>
                    <button className="btn-sm" onClick={()=>window.print()}>🖨 Afdrukken</button>
                  </div>
                </div>
                <div style={{ background:"#fff", border:"1px solid #ebe8df", borderRadius:8, padding:16, boxShadow:"0 1px 3px rgba(0,0,0,.04)" }}>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:6, marginBottom:6 }}>
                    {DAYS_NL.map(d=><div key={d} style={{ textAlign:"center", fontSize:11, fontWeight:800, letterSpacing:1, color:"#b0afa9", padding:"4px 0", textTransform:"uppercase" }}>{d}</div>)}
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:6 }}>
                    {calDays.map((day,i) => {
                      if (!day) return <div key={`e${i}`} />;
                      const dayEvs = calEvents.filter(ev => dayInRange(day, ev.start_time, ev.end_time));
                      const isToday = day.toDateString()===new Date().toDateString();
                      return (
                        <div key={day.toISOString()} className={`cal-day ${isToday?"today":""} ${dayEvs.length?"has-events":""}`}>
                          <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:800, fontSize:16, color:isToday?primaryColor:(dayEvs.length?"#1d1f3a":"#c2bfb2"), textAlign:"right", lineHeight:1 }}>{day.getDate()}</div>
                          {dayEvs.slice(0,2).map(ev => {
                            const cc = categoryColors[ev.category]||primaryColor;
                            return <span key={ev.id} className="cal-dot" style={{ background:cc, color:"#fff" }} onClick={()=>setSelectedEvent(ev)} title={ev.title}>{formatTime(ev.start_time)} {ev.title}</span>;
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div style={{ display:"flex", gap:18, flexWrap:"wrap", marginTop:16 }}>
                  {allCategories.map(cat=><span key={cat} style={{ display:"flex", alignItems:"center", gap:6, fontSize:13, fontWeight:600, color:"#76756f" }}><span style={{ width:12, height:12, borderRadius:3, background:categoryColors[cat]||primaryColor, display:"inline-block" }}/>{cat}</span>)}
                </div>
              </div>
            )}

            {calView==="week" && (
              <WeekView events={events} weekStart={weekStart} onWeekChange={setWeekStart} categoryColors={categoryColors} primaryColor={primaryColor} onEventClick={setSelectedEvent} adminMode={adminMode} />
            )}

            {calView==="year" && (
              <YearView events={events.filter(e=>!e.archived&&(!e.hidden||adminMode))} year={calDate.year} onYearChange={y=>setCalDate(d=>({...d,year:y}))} categoryColors={categoryColors} primaryColor={primaryColor} onEventClick={setSelectedEvent} />
            )}
          </div>
        )}

        {/* ARCHIEF */}
        {tab==="archief" && (
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20 }}>
              <span style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:900, fontStyle:"italic", fontSize:28, color:"#2E3192", textTransform:"uppercase" }}>Archief</span>
              <span style={{ background:"#2E3192", color:"#fff", fontSize:12, fontWeight:800, padding:"3px 12px", borderRadius:20 }}>{pastEvents.length} events</span>
              <div style={{ flex:1, height:3, background:"#F18C21" }} />
            </div>
            {pastEvents.length===0
              ? (
                <div style={{ textAlign:"center", padding:60 }}>
                  <div style={{ fontSize:48, marginBottom:16 }}>🗄</div>
                  <div style={{ color:"#56554d", fontSize:14, letterSpacing:1, textTransform:"uppercase" }}>Nog geen verleden evenementen</div>
                </div>
              )
              : <div style={{ display:"flex", flexDirection:"column", gap:9 }}>
                  {[...pastEvents].reverse().map(ev => {
                    const cc = categoryColors[ev.category]||primaryColor;
                    const att = (attendees[ev.id]||[]).length;
                    const d = new Date(ev.start_time);
                    return (
                      <div key={ev.id} onClick={()=>setSelectedEvent(ev)} style={{ display:"flex", alignItems:"center", gap:14, background:"#fff", border:"1px solid #ebe8df", borderLeft:`4px solid ${cc}`, borderRadius:6, padding:"13px 16px", cursor:"pointer" }}>
                        <div style={{ flex:"none", textAlign:"center", width:50 }}>
                          <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:900, fontSize:22, color:cc, lineHeight:.85 }}>{d.getDate()}</div>
                          <div style={{ fontSize:10, fontWeight:800, color:"#b0afa9", textTransform:"uppercase" }}>{d.toLocaleDateString("nl-NL",{month:"short"})}</div>
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:800, fontSize:19, color:"#1d1f3a", textTransform:"uppercase", lineHeight:1 }}>{ev.title}</div>
                          <div style={{ fontSize:13, color:"#76756f", marginTop:4 }}>{formatDate(ev.start_time)}{ev.location?` · ${ev.location}`:""}</div>
                        </div>
                        <span style={{ background:cc+"18", color:cc, fontSize:10, fontWeight:800, letterSpacing:1, textTransform:"uppercase", padding:"3px 10px", borderRadius:20, flex:"none" }}>{ev.category}</span>
                        {att>0 && <span style={{ fontSize:13, color:"#b0afa9", flex:"none" }}>👥 {att}</span>}
                      </div>
                    );
                  })}
                </div>
            }
            {adminMode && archivedEvents.length>0 && (
              <div style={{ marginTop:36 }}>
                <div style={{ fontSize:13, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:"#6a4c93", marginBottom:14 }}>Gearchiveerd ({archivedEvents.length})</div>
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {archivedEvents.map(ev => (
                    <div key={ev.id} style={{ background:"#ffffff", border:"1px solid #ebe8df", borderLeft:"3px solid #6a4c93", borderRadius:6, padding:"12px 16px", display:"flex", alignItems:"center", gap:12, opacity:.6, flexWrap:"wrap" }}>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:15, fontWeight:700, textTransform:"uppercase" }}>{ev.title}</div>
                        <div style={{ fontSize:13, color:"#76756f", fontFamily:"Barlow,sans-serif" }}>{formatDate(ev.start_time)}</div>
                      </div>
                      <button className="btn-sm" onClick={()=>handleArchive(ev)}>Herstellen</button>
                      {canDelete && <button className="btn-sm" onClick={()=>handleDelete(ev.id)} style={{ color:"#e63946" }}>Verwijderen</button>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Nieuw #179: prullenbak -- zachtverwijderde events, te herstellen of definitief te wissen */}
            {canDelete && trashedEvents.length>0 && (
              <div style={{ marginTop:36 }}>
                <div style={{ fontSize:13, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:"#e63946", marginBottom:6 }}>🗑 Prullenbak ({trashedEvents.length})</div>
                <div style={{ fontSize:12, color:"#76756f", fontFamily:"Barlow,sans-serif", marginBottom:14 }}>Verwijderde events -- herstel ze of wis ze definitief.</div>
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {trashedEvents.map(ev => (
                    <div key={ev.id} style={{ background:"#ffffff", border:"1px solid #ebe8df", borderLeft:"3px solid #e63946", borderRadius:6, padding:"12px 16px", display:"flex", alignItems:"center", gap:12, opacity:.6, flexWrap:"wrap" }}>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:15, fontWeight:700, textTransform:"uppercase" }}>{ev.title}</div>
                        <div style={{ fontSize:13, color:"#76756f", fontFamily:"Barlow,sans-serif" }}>{formatDate(ev.start_time)} · verwijderd {formatDate(ev.deleted_at)}</div>
                      </div>
                      <button className="btn-sm" onClick={()=>handleRestoreDeleted(ev.id)}>Herstellen</button>
                      <button className="btn-sm" onClick={()=>handlePermanentDelete(ev.id)} style={{ color:"#e63946" }}>Definitief verwijderen</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* STATISTIEKEN (admin) */}
        {tab==="statistieken" && adminMode && (() => {
          const yearEvents = events.filter(e=>new Date(e.start_time).getFullYear()===statsYear);
          const yearAtt = yearEvents.reduce((s,e)=>s+(attendees[e.id]||[]).length,0);
          const now = new Date();
          const thisMonthCount = events.filter(e=>{ const d=new Date(e.start_time); return d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth(); }).length;
          return (
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20 }}>
              <span style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:800, fontStyle:"italic", fontSize:20, color:"#2E3192", textTransform:"uppercase" }}>Statistieken</span>
              <select className="input" value={statsYear} onChange={e=>setStatsYear(Number(e.target.value))} style={{ width:"auto", fontSize:14 }}>
                {[...new Set(events.map(e=>new Date(e.start_time).getFullYear()))].sort().reverse().map(y=><option key={y} value={y}>{y}</option>)}
              </select>
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:12, marginBottom:26 }}>
              <div style={{ background:"#2E3192", borderRadius:8, padding:"18px 20px" }}>
                <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:900, fontSize:44, color:"#fff", lineHeight:.9 }}>{yearEvents.length}</div>
                <div style={{ fontSize:11, color:"#b9bbe8", textTransform:"uppercase", letterSpacing:1, fontWeight:700 }}>Events in {statsYear}</div>
              </div>
              <div style={{ background:"#F18C21", borderRadius:8, padding:"18px 20px" }}>
                <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:900, fontSize:44, color:"#fff", lineHeight:.9 }}>{yearAtt}</div>
                <div style={{ fontSize:11, color:"#fff", textTransform:"uppercase", letterSpacing:1, fontWeight:700, opacity:.85 }}>Aanmeldingen</div>
              </div>
              <div style={{ background:"#fff", border:"1px solid #ebe8df", borderRadius:8, padding:"18px 20px" }}>
                <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:900, fontSize:44, color:"#2E3192", lineHeight:.9 }}>{thisMonthCount}</div>
                <div style={{ fontSize:11, color:"#9a988c", textTransform:"uppercase", letterSpacing:1, fontWeight:700 }}>Deze maand</div>
              </div>
            </div>

            <div style={{ background:"#fff", border:"1px solid #ebe8df", borderRadius:8, padding:"22px 24px", marginBottom:24 }}>
              <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:800, fontStyle:"italic", fontSize:20, color:"#2E3192", textTransform:"uppercase", marginBottom:18 }}>Events per maand · {statsYear}</div>
              <div style={{ display:"flex", alignItems:"flex-end", gap:8, height:150 }}>
                {statsMonths.map((m,mi) => (
                  <div key={m.month} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:6, height:"100%", justifyContent:"flex-end" }}>
                    <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:800, fontSize:14, color:"#F18C21" }}>{m.count||""}</div>
                    <div style={{ width:"100%", height:m.count?(14+(m.count/statsMax)*96):3, background:m.count===0?"#ece9e0":(mi===now.getMonth()&&statsYear===now.getFullYear()?"#F18C21":"#2E3192"), borderRadius:"3px 3px 0 0", transition:"height .5s ease" }} />
                    <div style={{ fontSize:10, fontWeight:700, color:"#b0afa9", textTransform:"uppercase" }}>{m.month}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:800, fontSize:16, color:"#76756f", textTransform:"uppercase", letterSpacing:2, marginBottom:12 }}>Per categorie</div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:12 }}>
              {allCategories.map(cat => {
                const cc = categoryColors[cat]||primaryColor;
                const count = yearEvents.filter(e=>e.category===cat).length;
                return (
                  <div key={cat} style={{ background:"#ffffff", border:"1px solid #ebe8df", borderTop:`4px solid ${cc}`, borderRadius:8, padding:"16px 18px" }}>
                    <div style={{ fontSize:11, fontWeight:800, letterSpacing:1, color:cc, textTransform:"uppercase", marginBottom:4 }}>{cat}</div>
                    <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:900, fontSize:36, color:cc, lineHeight:1 }}>{count}</div>
                    <div style={{ fontSize:12, color:"#b0afa9" }}>events</div>
                  </div>
                );
              })}
            </div>
          </div>
          );
        })()}

        {/* DASHBOARD (admin) */}
        {tab==="dashboard" && adminMode && (
          <AdminDashboard
            events={events} attendees={attendees} bardienst={bardienst} news={news} ideas={ideas} pinsList={pinsList} pinResets={pinResets}
            primaryColor={primaryColor} allCategories={allCategories} categoryColors={categoryColors}
            onSelectEvent={ev=>{ setSelectedEvent(ev); setTab("agenda"); }}
            onGoTab={setTab}
            onNewEvent={openNew}
            onNewBardienst={openNewBardienst}
            onNewNews={openNewNews}
            onOpenSettings={()=>setShowSettings(true)}
          />
        )}

        {/* IDEEËNBUS (admin) */}
        {tab==="ideeen" && adminMode && (
          <div>
            <div style={{ fontSize:13, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:primaryColor, marginBottom:8 }}>Ideeënbus ({ideas.length})</div>
            <div style={{ fontSize:12, color:"#76756f", fontFamily:"Barlow,sans-serif", marginBottom:20 }}>Alleen beheerders zien deze ideeën — ze zijn niet zichtbaar voor bezoekers.</div>
            {ideas.length === 0 ? (
              <div style={{ textAlign:"center", padding:60 }}>
                <div style={{ fontSize:48, marginBottom:16 }}>💡</div>
                <div style={{ color:"#56554d", fontSize:14, letterSpacing:1, textTransform:"uppercase" }}>Nog geen ideeën binnengekomen</div>
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {ideas.map(idea => (
                  <div key={idea.id} style={{ background:"#ffffff", border:"1px solid #ebe8df", borderLeft:`4px solid ${primaryColor}`, borderRadius:8, padding:"14px 20px" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:10, flexWrap:"wrap" }}>
                      <div>
                        <div style={{ fontSize:13, fontWeight:700, color:primaryColor }}>{idea.name || "Anoniem"}</div>
                        <div style={{ fontSize:12, color:"#76756f", fontFamily:"Barlow,sans-serif" }}>{new Date(idea.created_at).toLocaleString("nl-NL")}</div>
                      </div>
                      {canEdit && <button className="btn-sm" onClick={()=>handleRemoveIdea(idea.id)} style={{ color:"#e63946" }}>Verwijderen</button>}
                    </div>
                    <div style={{ fontSize:15, fontFamily:"Barlow,sans-serif", marginTop:8, lineHeight:1.5, whiteSpace:"pre-wrap" }}>{idea.message}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </main>

      {/* EVENT DETAIL MODAL */}
      {selectedEvent && (() => {
        const ev = selectedEvent;
        const cc = categoryColors[ev.category]||primaryColor;
        // Nieuw #11: gerelateerde events -- zelfde reeks, anders zelfde categorie/locatie, anders eerstvolgende.
        const related = (() => {
          const pool = events.filter(e => e.id!==ev.id && !e.archived && !e.deleted_at && (!e.hidden||adminMode));
          const bySeries = ev.series_id ? pool.filter(e => e.series_id===ev.series_id) : [];
          const byCatOrLoc = pool.filter(e => e.category===ev.category || (ev.location && e.location===ev.location));
          const upcoming = pool.filter(e => isUpcoming(e.start_time)).sort((a,b)=>new Date(a.start_time)-new Date(b.start_time));
          const combined = [...bySeries, ...byCatOrLoc, ...upcoming];
          const seen = new Set(); const out = [];
          for (const e of combined) { if (!seen.has(e.id)) { seen.add(e.id); out.push(e); } if (out.length>=3) break; }
          return out;
        })();
        return (
          <div className="modal-overlay" onClick={()=>setSelectedEvent(null)}>
            <div className="modal" style={{ maxWidth:540, padding:0, overflow:"hidden" }} onClick={e=>e.stopPropagation()}>
              {ev.image_url && (
                <div style={{ overflow:"hidden", height:180 }}>
                  <img src={ev.image_url} alt={ev.title} style={{ width:"100%", height:"100%", objectFit:"cover" }} onError={e=>e.target.parentElement.style.display="none"} />
                </div>
              )}
              <div style={{ position:"relative", background:cc, padding:"26px 28px", overflow:"hidden" }}>
                <div style={{ position:"absolute", top:-16, right:16, width:120, height:120, backgroundImage:"radial-gradient(#ffffff44 1.5px,transparent 1.6px)", backgroundSize:"14px 14px", pointerEvents:"none" }} />
                <div style={{ position:"relative", display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:14 }}>
                  <div>
                    <span style={{ background:"#fff", color:cc, fontSize:11, fontWeight:800, letterSpacing:1, textTransform:"uppercase", padding:"3px 11px", borderRadius:20 }}>{ev.category}</span>
                    {ev.hidden && <span style={{ background:"#ffffff33", color:"#fff", fontSize:11, fontWeight:800, letterSpacing:1, textTransform:"uppercase", padding:"3px 11px", borderRadius:20, marginLeft:6 }}>Verborgen</span>}
                    {(ev.recurrence_rule || ev.recurrence_parent_id) && <span style={{ background:"#ffffff33", color:"#fff", fontSize:11, fontWeight:800, letterSpacing:1, textTransform:"uppercase", padding:"3px 11px", borderRadius:20, marginLeft:6 }}>🔁 {ev.recurrence_rule?.freq==="monthly"?"Maandelijks":"Wekelijks"}</span>}
                    {ev.series_id && <span style={{ background:"#ffffff33", color:"#fff", fontSize:11, fontWeight:800, letterSpacing:1, textTransform:"uppercase", padding:"3px 11px", borderRadius:20, marginLeft:6 }}>🏆 {eventSeries.find(s=>s.id===ev.series_id)?.title||"Reeks"}</span>}
                    <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:900, fontStyle:"italic", fontSize:34, lineHeight:.9, color:"#fff", textTransform:"uppercase", marginTop:10 }}>{ev.title}</div>
                  </div>
                  <button onClick={()=>setSelectedEvent(null)} style={{ border:"none", cursor:"pointer", background:"#ffffff33", color:"#fff", width:34, height:34, borderRadius:"50%", fontSize:18, flex:"none" }}>✕</button>
                </div>
              </div>
              <div style={{ padding:"24px 28px 28px" }}>
              <div className="grid-2" style={{ marginBottom:16 }}>
                <div style={{ background:"#f7f6f2", borderRadius:6, padding:14, gridColumn:isMultiDay(ev)?"1 / -1":undefined }}>
                  <div style={{ fontSize:10, color:"#b0afa9", fontWeight:800, letterSpacing:2, textTransform:"uppercase", marginBottom:4 }}>Datum{isMultiDay(ev)?" · meerdaags":""}</div>
                  <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:800, fontSize:18, color:"#1d1f3a" }}>{formatRange(ev.start_time, ev.end_time)}</div>
                </div>
                {!isMultiDay(ev) && (
                  <div style={{ background:"#f7f6f2", borderRadius:6, padding:14 }}>
                    <div style={{ fontSize:10, color:"#b0afa9", fontWeight:800, letterSpacing:2, textTransform:"uppercase", marginBottom:4 }}>Tijd</div>
                    <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:800, fontSize:18, color:"#1d1f3a" }}>{formatTime(ev.start_time)}{ev.end_time?` – ${formatTime(ev.end_time)}`:""}</div>
                  </div>
                )}
              </div>
              {ev.location && (
                <a href={`https://maps.google.com/?q=${encodeURIComponent(ev.location)}`} target="_blank" rel="noopener noreferrer" style={{ display:"flex", alignItems:"center", justifyContent:"space-between", background:"#f7f6f2", borderRadius:6, padding:14, marginBottom:16, textDecoration:"none" }}>
                  <div>
                    <div style={{ fontSize:10, color:"#b0afa9", fontWeight:800, letterSpacing:2, textTransform:"uppercase", marginBottom:4 }}>Locatie</div>
                    <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:800, fontSize:18, color:"#1d1f3a" }}>📍 {ev.location}</div>
                  </div>
                  <span style={{ fontSize:12, fontWeight:700, color:"#F18C21" }}>Maps ↗</span>
                </a>
              )}
              <WeatherWidget location={ev.location} startTime={ev.start_time} />
              {ev.cost > 0 && (
                <div style={{ background:"#f7f6f2", borderRadius:6, padding:14, marginBottom:16 }}>
                  <div style={{ fontSize:10, color:"#b0afa9", fontWeight:800, letterSpacing:2, textTransform:"uppercase", marginBottom:4 }}>Kosten deelname</div>
                  <div style={{ fontSize:24, fontWeight:900, color:"#52b788" }}>€{Number(ev.cost).toFixed(2)}</div>
                </div>
              )}
              {ev.sponsor_name && (
                <div style={{ background:"#f7f6f2", borderRadius:6, padding:14, marginBottom:16, display:"flex", alignItems:"center", gap:12 }}>
                  <div>
                    <div style={{ fontSize:10, color:"#b0afa9", fontWeight:800, letterSpacing:2, textTransform:"uppercase", marginBottom:2 }}>Gesponsord door</div>
                    <div style={{ fontSize:15, fontWeight:700 }}>🤝 {ev.sponsor_name}</div>
                  </div>
                  {ev.sponsor_logo && <img src={ev.sponsor_logo} alt={ev.sponsor_name} style={{ height:36, objectFit:"contain", marginLeft:"auto" }} onError={e=>e.target.style.display="none"} />}
                </div>
              )}
              {ev.description && <div style={{ marginBottom:18, fontSize:15, color:"#56554d", lineHeight:1.6 }}>{ev.description}</div>}
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", background:cc+"18", borderRadius:6, padding:"14px 16px", marginBottom:18, flexWrap:"wrap", gap:8 }}>
                <span style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:800, fontSize:16, color:cc }}>👥 {(attendees[ev.id]||[]).length} aangemeld</span>
                {isUpcoming(ev.start_time) && <span style={{ fontSize:12, fontWeight:700, color:cc, textTransform:"uppercase" }}>{daysUntil(ev.start_time)===0?"Vandaag":daysUntil(ev.start_time)===1?"Morgen":`${daysUntil(ev.start_time)} dagen`}</span>}
                <button className="btn-sm" onClick={()=>{ setShowAttendees(ev); setSelectedEvent(null); }} style={{ flex:"none" }}>Bekijken / Aanmelden</button>
              </div>
              <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                <button className="btn-red" style={{ flex:1, background:"#F18C21", fontStyle:"italic" }} onClick={()=>{ setShowAttendees(ev); setSelectedEvent(null); }}>Ik kom!</button>
                <button className="btn-ghost" onClick={()=>setSelectedEvent(null)}>Sluiten</button>
              </div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginTop:10 }}>
                <button className="btn-sm" onClick={()=>downloadICS(ev)}>📅 .ics</button>
                <a href={getGoogleCalendarUrl(ev)} target="_blank" rel="noopener noreferrer" className="btn-sm" style={{ textDecoration:"none", display:"inline-flex", alignItems:"center" }}>📅 Google Calendar</a>
                <button className="btn-sm" onClick={()=>{ setShowQR(ev); setSelectedEvent(null); }}>QR Code</button>
                {canEdit && (
                  <>
                    <button className="btn-sm" onClick={()=>{ setSelectedEvent(null); openEdit(ev); }}>Bewerken</button>
                    <button className="btn-sm" onClick={()=>handleDuplicate(ev)}>Dupliceren</button>
                    <button className="btn-sm" onClick={()=>handleArchive(ev)} style={{ color:"#f4a261" }}>Archiveren</button>
                    {canDelete && <button className="btn-sm" onClick={()=>handleDelete(ev.id)} style={{ color:"#e63946" }}>Verwijderen</button>}
                  </>
                )}
              </div>
              {related.length>0 && (
                <div style={{ marginTop:22, paddingTop:18, borderTop:"1px solid #ebe8df" }}>
                  <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:"#b0afa9", marginBottom:10 }}>Ook interessant</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                    {related.map(r => {
                      const rc = categoryColors[r.category]||primaryColor;
                      return (
                        <div key={r.id} onClick={()=>setSelectedEvent(r)} style={{ display:"flex", alignItems:"center", gap:10, background:"#f7f6f2", borderRadius:6, padding:"9px 12px", cursor:"pointer" }}>
                          <span style={{ width:8, height:8, borderRadius:"50%", background:rc, flexShrink:0 }} />
                          <span style={{ flex:1, fontSize:13, fontWeight:700, color:"#1d1f3a" }}>{r.title}</span>
                          <span style={{ fontSize:12, color:"#76756f", fontFamily:"Barlow,sans-serif" }}>{formatDate(r.start_time)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              </div>
            </div>
          </div>
        );
      })()}

      {showQR && <QRModal event={showQR} onClose={()=>setShowQR(null)} primaryColor={primaryColor} />}
      {showAttendees && <AttendeeModal event={showAttendees} attendees={attendees} onClose={()=>setShowAttendees(null)} onRegister={handleAttend} primaryColor={primaryColor} />}

      {/* FORM MODAL */}
      {showForm && (
        <div className="modal-overlay" onClick={closeForm}>
          <div className="modal" style={{ maxWidth:640 }} onClick={e=>e.stopPropagation()} onFocusCapture={handleModalFocus}>
            <h2 style={{ fontSize:20, fontWeight:900, textTransform:"uppercase", marginBottom:20 }}>{editingEvent?"Bewerken":"Nieuw evenement"}</h2>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div><label style={{ fontSize:11, color:"#76756f", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Titel *</label><input className="input" value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="Evenementnaam" /></div>
              <div className="grid-2">
                <div><label style={{ fontSize:11, color:"#76756f", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Start *</label><input className="input" type="datetime-local" value={form.start_time} onChange={e=>setForm(f=>({...f,start_time:e.target.value}))} /></div>
                <div><label style={{ fontSize:11, color:"#76756f", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Einde</label><input className="input" type="datetime-local" value={form.end_time} onChange={e=>setForm(f=>({...f,end_time:e.target.value}))} /></div>
              </div>
              <div className="grid-2">
                <div><label style={{ fontSize:11, color:"#76756f", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Categorie</label>
                  <select className="input" value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>
                    {allCategories.map(c=><option key={c}>{c}</option>)}
                  </select>
                </div>
                <div><label style={{ fontSize:11, color:"#76756f", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Locatie</label><input className="input" value={form.location} onChange={e=>setForm(f=>({...f,location:e.target.value}))} placeholder="Sportpark De Brug" /></div>
              </div>
              <div><label style={{ fontSize:11, color:"#76756f", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Beschrijving</label><textarea className="input" rows={3} value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="Extra info..." style={{ resize:"vertical" }} /></div>

              {/* Nieuw #3: eventreeksen/toernooien */}
              <div>
                <label style={{ fontSize:11, color:"#76756f", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Onderdeel van reeks</label>
                <div style={{ display:"flex", gap:8 }}>
                  <select className="input" value={form.series_id} onChange={e=>setForm(f=>({...f,series_id:e.target.value}))} style={{ flex:1 }}>
                    <option value="">Geen reeks</option>
                    {eventSeries.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}
                  </select>
                </div>
                <div style={{ display:"flex", gap:8, marginTop:6 }}>
                  <input className="input" value={newSeriesTitle} onChange={e=>setNewSeriesTitle(e.target.value)} placeholder="Nieuwe reeks (bv. Zomertoernooi 2026)" style={{ flex:1, fontSize:13 }} />
                  <button type="button" className="btn-sm" onClick={handleCreateSeries} disabled={!newSeriesTitle.trim()}>+ Aanmaken</button>
                </div>
              </div>

              {/* Nieuw #1: terugkerende events -- alleen bij het aanmaken van een nieuw event */}
              {!editingEvent && (
                <div>
                  <label style={{ fontSize:11, color:"#76756f", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Herhaling</label>
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                    <select className="input" value={recurrence.freq} onChange={e=>setRecurrence(r=>({...r,freq:e.target.value}))} style={{ width:"auto" }}>
                      <option value="none">Nooit (eenmalig)</option>
                      <option value="weekly">Wekelijks</option>
                      <option value="monthly">Maandelijks</option>
                    </select>
                    {recurrence.freq!=="none" && (
                      <>
                        <input className="input" type="date" value={recurrence.until} onChange={e=>setRecurrence(r=>({...r,until:e.target.value}))} style={{ width:150 }} title="Tot en met datum" placeholder="Tot en met" />
                        <input className="input" type="number" min="1" max="104" value={recurrence.count} onChange={e=>setRecurrence(r=>({...r,count:e.target.value}))} style={{ width:110 }} placeholder="Max. aantal" title="Maximum aantal keer (standaard 52)" />
                      </>
                    )}
                  </div>
                  {recurrence.freq!=="none" && <div style={{ fontSize:12, color:"#76756f", fontFamily:"Barlow,sans-serif", marginTop:6 }}>Maakt losse events aan tot de einddatum of het maximum, wat eerder komt.</div>}
                </div>
              )}
              <div>
                <label style={{ fontSize:11, color:"#76756f", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Afbeelding URL</label>
                <input className="input" value={form.image_url} onChange={e=>setForm(f=>({...f,image_url:e.target.value}))} placeholder="https://... (banner/foto)" />
                {form.image_url && <img src={form.image_url} alt="preview" style={{ width:"100%", height:90, objectFit:"cover", borderRadius:6, border:"1px solid #e7e4da", marginTop:8 }} onError={e=>e.target.style.display="none"} />}
              </div>
              <div className="grid-3">
                <div><label style={{ fontSize:11, color:"#76756f", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Kosten (€)</label><input className="input" type="number" min="0" step="0.01" value={form.cost} onChange={e=>setForm(f=>({...f,cost:e.target.value}))} placeholder="0.00" /></div>
                <div><label style={{ fontSize:11, color:"#76756f", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Sponsornaam</label><input className="input" value={form.sponsor_name} onChange={e=>setForm(f=>({...f,sponsor_name:e.target.value}))} placeholder="Bakkerij Jansen" /></div>
                <div><label style={{ fontSize:11, color:"#76756f", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Sponsorlogo URL</label><input className="input" value={form.sponsor_logo} onChange={e=>setForm(f=>({...f,sponsor_logo:e.target.value}))} placeholder="https://..." /></div>
              </div>
              <div style={{ display:"flex", gap:16, alignItems:"center" }}>
                <label style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer", fontSize:14, fontFamily:"Barlow,sans-serif" }}><input type="checkbox" checked={form.is_public} onChange={e=>setForm(f=>({...f,is_public:e.target.checked}))} style={{ accentColor:primaryColor }} /> Publiek</label>
                <label style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer", fontSize:14, fontFamily:"Barlow,sans-serif" }}><input type="checkbox" checked={form.hidden} onChange={e=>setForm(f=>({...f,hidden:e.target.checked}))} style={{ accentColor:"#76756f" }} /> Verborgen</label>
              </div>
              <div className="modal-actions-sticky" style={{ display:"flex", gap:10 }}>
                <button className="btn-red" onClick={handleSave} disabled={saving||!form.title||!form.start_time} style={{ flex:1 }}>{saving?"Opslaan...":editingEvent?"Opslaan":"Toevoegen"}</button>
                <button className="btn-ghost" onClick={closeForm}>Annuleren</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* BARDIENST FORM MODAL */}
      {showBardienstForm && (
        <div className="modal-overlay" onClick={closeBardienstForm}>
          <div className="modal" style={{ maxWidth:480 }} onClick={e=>e.stopPropagation()} onFocusCapture={handleModalFocus}>
            <h2 style={{ fontSize:20, fontWeight:900, textTransform:"uppercase", marginBottom:20 }}>{editingBardienst?"Bardienst bewerken":"Bardienst toevoegen"}</h2>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div><label style={{ fontSize:11, color:"#76756f", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Datum *</label><input className="input" type="date" value={bardienstForm.shift_date} onChange={e=>setBardienstForm(f=>({...f,shift_date:e.target.value}))} /></div>
              <div><label style={{ fontSize:11, color:"#76756f", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Tijd (optioneel)</label><input className="input" value={bardienstForm.time_label} onChange={e=>setBardienstForm(f=>({...f,time_label:e.target.value}))} placeholder="bv. 20:00 – 01:00" /></div>
              {/* Nieuw #40: bardienst per team i.p.v. losse namen */}
              <div>
                <label style={{ fontSize:11, color:"#76756f", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Team (optioneel)</label>
                <select className="input" value={bardienstForm.team_id} onChange={e=>setBardienstForm(f=>({...f,team_id:e.target.value}))}>
                  <option value="">Geen team -- losse namen hieronder</option>
                  {teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div><label style={{ fontSize:11, color:"#76756f", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Namen {bardienstForm.team_id?"(optioneel, extra bij het team)":"* (komma-gescheiden)"}</label><input className="input" value={bardienstForm.names} onChange={e=>setBardienstForm(f=>({...f,names:e.target.value}))} placeholder="Jan, Piet, Marie" /></div>
              <div><label style={{ fontSize:11, color:"#76756f", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Notitie</label><input className="input" value={bardienstForm.note} onChange={e=>setBardienstForm(f=>({...f,note:e.target.value}))} placeholder="Extra info" /></div>
              {/* Nieuw #38: voorraad-checklist */}
              <div>
                <label style={{ fontSize:11, color:"#76756f", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Checklist (één item per regel)</label>
                <textarea className="input" rows={4} value={bardienstForm.checklistText} onChange={e=>setBardienstForm(f=>({...f,checklistText:e.target.value}))} style={{ resize:"vertical" }} />
              </div>
              <div className="modal-actions-sticky" style={{ display:"flex", gap:10 }}>
                <button className="btn-red" onClick={handleSaveBardienst} disabled={savingBardienst||!bardienstForm.shift_date||(!bardienstForm.names&&!bardienstForm.team_id)} style={{ flex:1 }}>{savingBardienst?"Opslaan...":editingBardienst?"Opslaan":"Toevoegen"}</button>
                <button className="btn-ghost" onClick={closeBardienstForm}>Annuleren</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* NIEUWS DETAIL MODAL */}
      {selectedNews && (() => {
        const n = selectedNews;
        const cc = n.pinned ? "#F18C21" : "#2E3192";
        return (
          <div className="modal-overlay" onClick={()=>setSelectedNews(null)}>
            <div className="modal" style={{ maxWidth:540, padding:0 }} onClick={e=>e.stopPropagation()}>
              <div style={{ position:"relative", background:cc, padding:"26px 28px", overflow:"hidden" }}>
                <div style={{ position:"absolute", top:-16, right:16, width:120, height:120, backgroundImage:"radial-gradient(#ffffff44 1.5px,transparent 1.6px)", backgroundSize:"14px 14px", pointerEvents:"none" }} />
                <div style={{ position:"relative", display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:14 }}>
                  <div>
                    {n.pinned && <span style={{ background:"#fff", color:cc, fontSize:11, fontWeight:800, letterSpacing:1, textTransform:"uppercase", padding:"3px 11px", borderRadius:20 }}>📌 Vastgepind</span>}
                    <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:900, fontStyle:"italic", fontSize:30, lineHeight:1, color:"#fff", textTransform:"uppercase", marginTop:n.pinned?10:0 }}>{n.title}</div>
                  </div>
                  <button onClick={()=>setSelectedNews(null)} style={{ border:"none", cursor:"pointer", background:"#ffffff33", color:"#fff", width:34, height:34, borderRadius:"50%", fontSize:18, flex:"none" }}>✕</button>
                </div>
              </div>
              <div style={{ padding:"24px 28px 28px" }}>
                <div style={{ fontSize:12, color:"#b0afa9", marginBottom:16 }}>{new Date(n.created_at).toLocaleDateString("nl-NL", { day:"numeric", month:"long", year:"numeric" })}</div>
                {/* Nieuw #51: afbeeldingengalerij -- CSS scroll-snap i.p.v. eigen carrousel-state (dit is een IIFE, geen component, dus geen hooks) */}
                {(() => {
                  const imgs = (Array.isArray(n.image_urls) && n.image_urls.length) ? n.image_urls : (n.image_url ? [n.image_url] : []);
                  if (!imgs.length) return null;
                  return (
                    <div style={{ marginBottom:18 }}>
                      <div style={{ display:"flex", gap:8, overflowX:"auto", scrollSnapType:"x mandatory", borderRadius:8 }}>
                        {imgs.map((url,i) => (
                          <img key={i} src={url} alt={`${n.title} ${i+1}`} style={{ width:"100%", flex:"0 0 100%", maxHeight:280, objectFit:"cover", borderRadius:8, scrollSnapAlign:"start", display:"block" }} onError={e=>{ e.target.style.display="none"; }} />
                        ))}
                      </div>
                      {imgs.length>1 && <div style={{ fontSize:11, color:"#b0afa9", marginTop:6, textAlign:"center", fontFamily:"Barlow,sans-serif" }}>{imgs.length} foto's — swipe om te bladeren</div>}
                    </div>
                  );
                })()}
                <div style={{ fontSize:15, color:"#1d1f3a", lineHeight:1.6, whiteSpace:"pre-wrap" }}>{n.body}</div>
                <div style={{ marginTop:22, display:"flex", gap:8, flexWrap:"wrap" }}>
                  <button className="btn-ghost" onClick={()=>setSelectedNews(null)}>Sluiten</button>
                  {canEdit && <button className="btn-sm" onClick={()=>{ setSelectedNews(null); openEditNews(n); }}>Bewerken</button>}
                  {canDelete && <button className="btn-sm" onClick={()=>{ setSelectedNews(null); handleDeleteNews(n.id); }} style={{ color:"#e63946" }}>Verwijderen</button>}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* NIEUWS FORM MODAL */}
      {showNewsForm && (
        <div className="modal-overlay" onClick={closeNewsForm}>
          <div className="modal" style={{ maxWidth:520 }} onClick={e=>e.stopPropagation()} onFocusCapture={handleModalFocus}>
            <h2 style={{ fontSize:20, fontWeight:900, textTransform:"uppercase", marginBottom:20 }}>{editingNews?"Mededeling bewerken":"Mededeling plaatsen"}</h2>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div><label style={{ fontSize:11, color:"#76756f", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Titel *</label><input className="input" value={newsForm.title} onChange={e=>setNewsForm(f=>({...f,title:e.target.value}))} placeholder="Titel van de mededeling" /></div>
              <div><label style={{ fontSize:11, color:"#76756f", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Tekst *</label><textarea className="input" rows={5} value={newsForm.body} onChange={e=>setNewsForm(f=>({...f,body:e.target.value}))} placeholder="Waar gaat het over..." style={{ resize:"vertical" }} /></div>
              <div>
                <label style={{ fontSize:11, color:"#76756f", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Afbeeldingen {newsForm.images.filter(Boolean).length>1?`(${newsForm.images.filter(Boolean).length})`:""}</label>
                {newsForm.images.map((url, i) => (
                  <div key={i} style={{ display:"flex", gap:8, alignItems:"flex-start", marginBottom:8 }}>
                    <div style={{ flex:1 }}>
                      <input className="input" value={url} onChange={e=>setNewsForm(f=>({...f,images:f.images.map((u,ui)=>ui===i?e.target.value:u)}))} placeholder="https://... (foto bij het bericht)" />
                      {url && <img src={url} alt="preview" style={{ width:"100%", height:90, objectFit:"cover", borderRadius:6, border:"1px solid #e7e4da", marginTop:8 }} onError={e=>e.target.style.display="none"} />}
                    </div>
                    {newsForm.images.length>1 && <button type="button" className="btn-sm" onClick={()=>setNewsForm(f=>({...f,images:f.images.filter((_,ui)=>ui!==i)}))} style={{ color:"#e63946" }}>✕</button>}
                  </div>
                ))}
                <button type="button" className="btn-sm" onClick={()=>setNewsForm(f=>({...f,images:[...f.images,""]}))}>+ Nog een foto</button>
              </div>
              <label style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer", fontSize:14, fontFamily:"Barlow,sans-serif" }}><input type="checkbox" checked={newsForm.pinned} onChange={e=>setNewsForm(f=>({...f,pinned:e.target.checked}))} style={{ accentColor:primaryColor }} /> Vastpinnen bovenaan de agenda</label>
              <div className="modal-actions-sticky" style={{ display:"flex", gap:10 }}>
                <button className="btn-red" onClick={handleSaveNews} disabled={savingNews||!newsForm.title||!newsForm.body} style={{ flex:1 }}>{savingNews?"Opslaan...":editingNews?"Opslaan":"Plaatsen"}</button>
                <button className="btn-ghost" onClick={closeNewsForm}>Annuleren</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* IDEE FORM MODAL */}
      {showIdeaForm && (
        <div className="modal-overlay" onClick={()=>setShowIdeaForm(false)}>
          <div className="modal" style={{ maxWidth:440 }} onClick={e=>e.stopPropagation()}>
            <h2 style={{ fontSize:20, fontWeight:900, textTransform:"uppercase", marginBottom:6 }}>💡 Ideeën voor spelerscommissie</h2>
            <p style={{ color:"#76756f", fontSize:14, fontFamily:"Barlow,sans-serif", marginBottom:16 }}>Alleen het bestuur ziet dit — jouw naam is optioneel.</p>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              <input className="input" value={ideaName} onChange={e=>setIdeaName(e.target.value)} placeholder="Jouw naam (optioneel)" />
              <textarea className="input" rows={4} value={ideaMessage} onChange={e=>setIdeaMessage(e.target.value)} placeholder="Wat is je idee voor de spelerscommissie?" style={{ resize:"vertical" }} />
            </div>
            <div style={{ display:"flex", gap:10, marginTop:16 }}>
              <button className="btn-red" onClick={submitIdea} disabled={submittingIdea||!ideaMessage.trim()} style={{ flex:1 }}>{submittingIdea?"Versturen...":"Versturen"}</button>
              <button className="btn-ghost" onClick={()=>setShowIdeaForm(false)}>Annuleren</button>
            </div>
          </div>
        </div>
      )}

      {/* PIN MODAL */}
      {showPinModal && (
        <div className="modal-overlay" onClick={()=>{ setShowPinModal(false); setShowForgotPin(false); setForgotPinSent(false); }}>
          <div className="modal" style={{ maxWidth:380 }} onClick={e=>e.stopPropagation()} onFocusCapture={handleModalFocus}>
            {!showForgotPin ? (
              <>
                <h2 style={{ fontSize:22, fontWeight:900, textTransform:"uppercase", marginBottom:6 }}>Beheer</h2>
                <p style={{ color:"#76756f", fontSize:14, fontFamily:"Barlow,sans-serif", marginBottom:20 }}>Voer je pincode in</p>
                <input className="input" type="password" placeholder="Pincode" value={pinInput} onChange={e=>{ setPinInput(e.target.value); setPinError(false); }} onKeyDown={e=>e.key==="Enter"&&submitPin()} style={{ fontSize:24, letterSpacing:8, textAlign:"center", marginBottom:pinError?8:16 }} autoFocus />
                {pinError && <p style={{ color:"#e63946", fontSize:13, textAlign:"center", marginBottom:16, fontFamily:"Barlow,sans-serif" }}>Verkeerde pincode</p>}
                <div style={{ display:"flex", gap:10 }}>
                  <button className="btn-red" onClick={submitPin} style={{ flex:1 }}>Inloggen</button>
                  <button className="btn-ghost" onClick={()=>setShowPinModal(false)}>Annuleren</button>
                </div>
                {/* Nieuw #184: pincode-vergeten-flow */}
                <button className="btn-ghost" style={{ width:"100%", marginTop:10, border:"none" }} onClick={()=>{ setShowForgotPin(true); setForgotPinSent(false); setForgotPinMessage(""); }}>Pincode kwijt?</button>
              </>
            ) : forgotPinSent ? (
              <>
                <h2 style={{ fontSize:20, fontWeight:900, textTransform:"uppercase", marginBottom:10 }}>Verzoek verstuurd</h2>
                <p style={{ color:"#76756f", fontSize:14, fontFamily:"Barlow,sans-serif", marginBottom:20 }}>Een beheerder met de rol "Beheerder" ziet je verzoek in de instellingen en kan je een nieuwe pincode geven.</p>
                <button className="btn-ghost" style={{ width:"100%" }} onClick={()=>{ setShowPinModal(false); setShowForgotPin(false); }}>Sluiten</button>
              </>
            ) : (
              <>
                <h2 style={{ fontSize:20, fontWeight:900, textTransform:"uppercase", marginBottom:6 }}>Pincode kwijt</h2>
                <p style={{ color:"#76756f", fontSize:14, fontFamily:"Barlow,sans-serif", marginBottom:16 }}>Er is geen automatische reset -- je verzoek wordt gemeld bij een beheerder, die je persoonlijk een nieuwe pincode geeft.</p>
                <textarea className="input" rows={3} value={forgotPinMessage} onChange={e=>setForgotPinMessage(e.target.value)} placeholder="Wie ben je en welke rol had je? (optioneel, maar handig)" style={{ resize:"vertical", marginBottom:16 }} />
                <div style={{ display:"flex", gap:10 }}>
                  <button className="btn-red" onClick={submitForgotPin} style={{ flex:1 }}>Verstuur verzoek</button>
                  <button className="btn-ghost" onClick={()=>setShowForgotPin(false)}>Terug</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* SETTINGS MODAL */}
      {showSettings && (
        <div className="modal-overlay" onClick={()=>setShowSettings(false)}>
          <div className="modal" style={{ maxWidth:620 }} onClick={e=>e.stopPropagation()} onFocusCapture={handleModalFocus}>
            <h2 style={{ fontSize:20, fontWeight:900, textTransform:"uppercase", marginBottom:20 }}>⚙ Beheerinstellingen</h2>

            <div style={{ fontSize:12, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:primaryColor, marginBottom:12 }}>Clubinstellingen</div>
            <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:24 }}>
              <div className="grid-2">
                <div><label style={{ fontSize:11, color:"#76756f", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Clubnaam</label><input className="input" value={clubSettings.name} onChange={e=>setClubSettings(s=>({...s,name:e.target.value}))} /></div>
                <div><label style={{ fontSize:11, color:"#76756f", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Ondertitel</label><input className="input" value={clubSettings.subtitle} onChange={e=>setClubSettings(s=>({...s,subtitle:e.target.value}))} /></div>
              </div>
              <div className="grid-2">
                <div><label style={{ fontSize:11, color:"#76756f", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Hoofdkleur</label>
                  <div style={{ display:"flex", gap:8 }}>
                    <input className="input" value={clubSettings.primaryColor} onChange={e=>setClubSettings(s=>({...s,primaryColor:e.target.value}))} />
                    <input type="color" value={clubSettings.primaryColor} onChange={e=>setClubSettings(s=>({...s,primaryColor:e.target.value}))} style={{ width:44, height:42, border:"1px solid #e7e4da", borderRadius:6, padding:2, background:"#f3f1ea", cursor:"pointer" }} />
                  </div>
                </div>
                <div><label style={{ fontSize:11, color:"#76756f", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Logo URL</label><input className="input" value={clubSettings.logo} onChange={e=>setClubSettings(s=>({...s,logo:e.target.value}))} placeholder="Standaard HHC&#8217;09-logo (laat leeg om te gebruiken)" /></div>
              </div>
            </div>

            <div style={{ fontSize:12, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:primaryColor, marginBottom:12 }}>Categorie kleuren</div>
            <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:24 }}>
              {allCategories.map(cat => {
                const cv = categoryColors[cat] || "#76756f";
                const lowContrast = contrastWithWhite(cv) < 4.5; // verbetering #23
                return (
                  <div key={cat}>
                    <div className="settings-row" style={{ borderBottom:lowContrast?"none":undefined }}>
                      <span style={{ fontSize:14, fontFamily:"Barlow,sans-serif", display:"flex", alignItems:"center", gap:8 }}>
                        {cat}
                        <span style={{ background:cv, color:"#fff", fontSize:10, fontWeight:800, letterSpacing:1, textTransform:"uppercase", padding:"3px 9px", borderRadius:20 }}>Voorbeeld</span>
                      </span>
                      <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                        <input className="input" value={cv} onChange={e=>setCategoryColors(c=>({...c,[cat]:e.target.value}))} style={{ width:100, fontSize:13 }} />
                        <input type="color" value={cv} onChange={e=>setCategoryColors(c=>({...c,[cat]:e.target.value}))} style={{ width:36, height:36, border:"1px solid #e7e4da", borderRadius:6, padding:2, background:"#f3f1ea", cursor:"pointer" }} />
                      </div>
                    </div>
                    {lowContrast && (
                      <div style={{ fontSize:12, color:"#e63946", fontFamily:"Barlow,sans-serif", padding:"0 0 12px", borderBottom:"1px solid #ebe8df" }}>
                        ⚠ Deze kleur is te licht — witte tekst erop (badges, kalender) is lastig leesbaar. Kies een donkerdere tint.
                      </div>
                    )}
                  </div>
                );
              })}
              <button className="btn-sm" onClick={()=>setCategoryColors(DEFAULT_COLORS)} style={{ alignSelf:"flex-start", marginTop:4 }}>Reset kleuren</button>
            </div>

            {/* Nieuw #40: teams (voor bardienst per team) */}
            <div style={{ fontSize:12, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:primaryColor, marginBottom:12 }}>Teams</div>
            <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:24 }}>
              {teams.map(t => (
                <div key={t.id} className="settings-row">
                  <span style={{ fontSize:14, fontFamily:"Barlow,sans-serif", display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ width:12, height:12, borderRadius:3, background:t.color, display:"inline-block" }} />
                    {t.name}
                  </span>
                  <button className="btn-sm" onClick={()=>handleRemoveTeam(t.id)} style={{ color:"#e63946" }}>Verwijderen</button>
                </div>
              ))}
              {teams.length===0 && <div style={{ fontSize:13, color:"#76756f", fontFamily:"Barlow,sans-serif" }}>Nog geen teams -- voeg er hieronder één toe.</div>}
              <div style={{ display:"flex", gap:8, marginTop:6 }}>
                <input className="input" value={newTeamName} onChange={e=>setNewTeamName(e.target.value)} placeholder="Teamnaam (bv. JO17-1)" style={{ flex:1 }} />
                <input type="color" value={newTeamColor} onChange={e=>setNewTeamColor(e.target.value)} style={{ width:36, height:36, border:"1px solid #e7e4da", borderRadius:6, padding:2, background:"#f3f1ea", cursor:"pointer" }} />
                <button className="btn-sm" onClick={handleAddTeam} disabled={!newTeamName.trim()}>Toevoegen</button>
              </div>
            </div>

            {/* Nieuw #184: openstaande "pincode kwijt"-verzoeken */}
            {pinResets.length>0 && (
              <>
                <div style={{ fontSize:12, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:"#e63946", marginBottom:12 }}>🔑 Pincode-verzoeken ({pinResets.length})</div>
                <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:24 }}>
                  {pinResets.map(r => (
                    <div key={r.id} style={{ background:"#fff7f2", border:"1px solid #e6394633", borderRadius:6, padding:"10px 14px", display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
                      <div style={{ flex:1, minWidth:160 }}>
                        <div style={{ fontSize:13, fontFamily:"Barlow,sans-serif" }}>{r.message || "(geen bericht toegevoegd)"}</div>
                        <div style={{ fontSize:11, color:"#76756f", fontFamily:"Barlow,sans-serif" }}>{new Date(r.created_at).toLocaleString("nl-NL")}</div>
                      </div>
                      <button className="btn-sm" onClick={()=>resolvePinReset(r.id)}>Afgehandeld</button>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div style={{ fontSize:12, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:primaryColor, marginBottom:12 }}>Beheerders pincodes</div>
            <div style={{ fontSize:12, color:"#76756f", fontFamily:"Barlow,sans-serif", marginBottom:10 }}>Pincodes worden gehasht opgeslagen en server-side gecontroleerd — daarom is de code zelf hier niet meer zichtbaar.</div>
            <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:12 }}>
              {pinsList.map(p => (
                <div key={p.id} className="settings-row">
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <span style={{ fontSize:10, background:primaryColor+"22", color:primaryColor, padding:"2px 8px", borderRadius:10, fontWeight:700, textTransform:"uppercase" }}>{ROLE_LABELS[p.role]||p.role}</span>
                    <span style={{ fontSize:12, color:"#76756f", fontFamily:"Barlow,sans-serif" }}>sinds {new Date(p.created_at).toLocaleDateString("nl-NL")}</span>
                  </div>
                  {pinsList.length>1 && <button className="btn-sm" onClick={()=>handleRemovePin(p.id)} style={{ color:"#e63946" }}>Verwijderen</button>}
                </div>
              ))}
              <div style={{ display:"flex", gap:8, marginTop:6 }}>
                <input className="input" type="password" value={newPin} onChange={e=>setNewPin(e.target.value)} placeholder="Nieuwe pincode (min. 4 tekens)" style={{ flex:1 }} />
                <select className="input" value={newPinRole} onChange={e=>setNewPinRole(e.target.value)} style={{ width:"auto" }}>
                  {Object.entries(ROLE_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}
                </select>
                <button className="btn-sm" onClick={handleAddPin} disabled={newPin.length<4}>Toevoegen</button>
              </div>
            </div>

            <div style={{ fontSize:12, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:primaryColor, marginBottom:12 }}>Systeemstatus</div>
            <div style={{ fontSize:12, color:"#76756f", fontFamily:"Barlow,sans-serif", marginBottom:10 }}>Het gratis Supabase-project pauzeert automatisch na 7 dagen zonder activiteit. Test hier de verbinding — dat telt meteen als activiteit.</div>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:24, flexWrap:"wrap" }}>
              <button className="btn-sm" onClick={testConnection} disabled={testingConnection}>{testingConnection?"Bezig...":"🔌 Verbinding testen"}</button>
              {connectionResult && (
                <span style={{ fontSize:12, fontFamily:"Barlow,sans-serif", color:connectionResult.ok?"#2a9d8f":"#e63946" }}>
                  {connectionResult.ok?"✓":"✗"} {connectionResult.msg}
                </span>
              )}
            </div>

            <button className="btn-ghost" onClick={()=>setShowSettings(false)} style={{ width:"100%", marginTop:8 }}>Sluiten</button>
          </div>
        </div>
      )}

    </div>
  );
}
