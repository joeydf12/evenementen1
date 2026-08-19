import { useState, useEffect } from "react";
import clubLogo from "./images/logohhc.jpg";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const BASE_CATEGORIES = ["Evenement", "Vergadering", "Overig"];
const DEFAULT_COLORS = { Evenement:"#f5821f", Vergadering:"#1d2d6b", Overig:"#7ec1e0" };
const MONTHS_NL = ["Januari","Februari","Maart","April","Mei","Juni","Juli","Augustus","September","Oktober","November","December"];
const DAYS_NL = ["Ma","Di","Wo","Do","Vr","Za","Zo"];
const ROLE_LABELS = { viewer:"Bekijker", editor:"Redacteur", super:"Beheerder" };

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

function formatDate(dt) { if (!dt) return ""; return new Date(dt).toLocaleDateString("nl-NL", { weekday:"long", day:"numeric", month:"long" }); }
function formatTime(dt) { if (!dt) return ""; return new Date(dt).toLocaleTimeString("nl-NL", { hour:"2-digit", minute:"2-digit" }); }
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
    <div style={{ background:"#ffffff", border:"1px solid #e7e0d0", borderLeft:"4px solid #e7e0d0", borderRadius:8, padding:"18px 20px", position:"relative", overflow:"hidden", animationDelay:`${delay}s` }}>
      <div style={{ position:"absolute", inset:0, background:"linear-gradient(90deg,transparent 0%,#00000010 50%,transparent 100%)", animation:"shimmer 1.6s infinite" }} />
      <div style={{ display:"flex", justifyContent:"space-between", gap:16 }}>
        <div style={{ flex:1 }}>
          <div style={{ height:12, background:"#e7e0d0", borderRadius:3, width:"25%", marginBottom:10 }} />
          <div style={{ height:20, background:"#e7e0d0", borderRadius:3, width:"55%", marginBottom:8 }} />
          <div style={{ height:13, background:"#e7e0d0", borderRadius:3, width:"75%", marginBottom:6 }} />
          <div style={{ height:13, background:"#e7e0d0", borderRadius:3, width:"45%" }} />
        </div>
        <div style={{ width:52, height:52, background:"#e7e0d0", borderRadius:6, flexShrink:0 }} />
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
        <div style={{ fontSize:13, color:"#666", fontFamily:"Barlow,sans-serif", marginBottom:20 }}>{formatDate(event.start_time)}</div>
        <img src={qrUrl} alt="QR code" style={{ width:250, height:250, borderRadius:8, border:"1px solid #d8cfb8" }} />
        <div style={{ fontSize:12, color:"#555", marginTop:12, fontFamily:"Barlow,sans-serif" }}>Scan voor meer info · Zet op flyers</div>
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
        <div style={{ fontSize:13, color:"#666", fontFamily:"Barlow,sans-serif", marginBottom:20 }}>{formatDate(event.start_time)}</div>
        <div style={{ background:"#f5f1e6", borderRadius:8, padding:16, marginBottom:20 }}>
          <div style={{ fontSize:13, fontWeight:700, color:primaryColor, marginBottom:10, textTransform:"uppercase", letterSpacing:1 }}>✅ Aangemeld ({list.length})</div>
          {list.length === 0
            ? <div style={{ fontSize:13, color:"#555", fontFamily:"Barlow,sans-serif" }}>Nog niemand aangemeld</div>
            : <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>{list.map((a,i)=><span key={i} style={{ background:"#e7e0d0", border:"1px solid #d8cfb8", borderRadius:20, padding:"4px 12px", fontSize:13, fontFamily:"Barlow,sans-serif" }}>{a.attendee_name}</span>)}</div>
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
    <div style={{ background:"#f5f1e6", borderRadius:8, padding:14, marginBottom:16 }}>
      <div style={{ fontSize:10, color:"#444", fontWeight:700, letterSpacing:2, textTransform:"uppercase", marginBottom:4 }}>Weersverwachting</div>
      {status === "loading" && <div style={{ fontSize:13, color:"#555", fontFamily:"Barlow,sans-serif" }}>Laden...</div>}
      {status === "error" && <div style={{ fontSize:13, color:"#555", fontFamily:"Barlow,sans-serif" }}>Geen voorspelling beschikbaar</div>}
      {status === "ok" && weather && info && (
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          <span style={{ fontSize:32 }}>{info.icon}</span>
          <div>
            <div style={{ fontSize:15, fontWeight:700 }}>{info.label} · {weather.min}° – {weather.max}°</div>
            <div style={{ fontSize:13, color:"#888", fontFamily:"Barlow,sans-serif" }}>☔ {weather.rain}% kans op neerslag</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- ADMIN DASHBOARD ----
function AdminDashboard({ events, attendees, bardienst, news, ideas, pinsList, primaryColor, allCategories, categoryColors, onSelectEvent, onGoTab, onNewEvent, onNewBardienst, onNewNews, onOpenSettings }) {
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
    { label:"Afgelopen", value:past.length, color:"#555" },
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
            <div style={{ fontSize:11, color:"#555", fontFamily:"Barlow,sans-serif", marginTop:4, textTransform:"uppercase", letterSpacing:.5 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {attentionItems.length > 0 && (
        <div style={{ marginBottom:28 }}>
          <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:"#444", marginBottom:10 }}>Aandachtspunten</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {attentionItems.map((it, i) => (
              <div key={i} onClick={it.action} style={{ background:"#ffffff", border:`1px solid ${it.type==="warn"?"#e63946":primaryColor}33`, borderLeft:`3px solid ${it.type==="warn"?"#e63946":primaryColor}`, borderRadius:8, padding:"10px 16px", display:"flex", alignItems:"center", gap:10, cursor:"pointer", fontSize:13, fontFamily:"Barlow,sans-serif" }}>
                <span style={{ fontSize:16 }}>{it.icon}</span>
                <span style={{ flex:1 }}>{it.text}</span>
                <span style={{ color:"#999" }}>›</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {nextEvent && (
        <div style={{ marginBottom:28 }}>
          <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:"#444", marginBottom:10 }}>Eerstvolgende event</div>
          <div onClick={()=>onSelectEvent(nextEvent)} style={{ background:"#ffffff", border:`1px solid ${primaryColor}33`, borderRadius:8, padding:"16px 20px", cursor:"pointer", animation:"fadeInUp .3s .1s both" }}>
            <div style={{ fontSize:18, fontWeight:800, textTransform:"uppercase" }}>{nextEvent.title}</div>
            <div style={{ fontSize:13, color:"#666", fontFamily:"Barlow,sans-serif", marginTop:4 }}>{formatDate(nextEvent.start_time)} · {nextEvent.location||"Locatie onbekend"}</div>
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
            <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:"#444" }}>Bardienstrooster</div>
            <button className="btn-sm" onClick={()=>onGoTab("bardienst")} style={{ fontSize:11 }}>Alles →</button>
          </div>
          {upcomingBardienst.length === 0 ? (
            <div style={{ fontSize:13, color:"#555", fontFamily:"Barlow,sans-serif" }}>Geen komende bardiensten gepland</div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {upcomingBardienst.map(b => (
                <div key={b.id} style={{ background:"#ffffff", border:"1px solid #e7e0d0", borderRadius:6, padding:"8px 12px", fontSize:13, fontFamily:"Barlow,sans-serif" }}>
                  <strong style={{ fontFamily:"'Barlow Condensed',sans-serif" }}>{formatDate(b.shift_date)}</strong> — {b.names}
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
            <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:"#444" }}>Laatste mededelingen</div>
            <button className="btn-sm" onClick={()=>onGoTab("nieuws")} style={{ fontSize:11 }}>Alles →</button>
          </div>
          {recentNews.length === 0 ? (
            <div style={{ fontSize:13, color:"#555", fontFamily:"Barlow,sans-serif" }}>Nog geen mededelingen geplaatst</div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {recentNews.map(n => (
                <div key={n.id} style={{ background:"#ffffff", border:"1px solid #e7e0d0", borderRadius:6, padding:"8px 12px", fontSize:13, fontFamily:"Barlow,sans-serif" }}>
                  {n.pinned && "📌 "}<strong style={{ fontFamily:"'Barlow Condensed',sans-serif" }}>{n.title}</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {recentIdeas.length > 0 && (
        <div style={{ marginBottom:28 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
            <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:"#444" }}>Nieuwste ideeën</div>
            <button className="btn-sm" onClick={()=>onGoTab("ideeen")} style={{ fontSize:11 }}>Alles →</button>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {recentIdeas.map(idea => (
              <div key={idea.id} style={{ background:"#ffffff", border:"1px solid #e7e0d0", borderLeft:"3px solid #2a9d8f", borderRadius:6, padding:"10px 14px", fontSize:13, fontFamily:"Barlow,sans-serif" }}>
                <div style={{ fontWeight:700, color:"#2a9d8f", marginBottom:2 }}>{idea.name || "Anoniem"}</div>
                <div style={{ color:"#555" }}>{idea.message.length>120?idea.message.slice(0,120)+"…":idea.message}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))", gap:20, marginBottom:28 }}>
        <div>
          <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:"#444", marginBottom:12 }}>Verdeling per categorie</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {allCategories.map(cat => {
              const cc = categoryColors[cat]||primaryColor;
              const count = nonArchived.filter(e=>e.category===cat).length;
              const pct = nonArchived.length ? (count/nonArchived.length)*100 : 0;
              return (
                <div key={cat} style={{ display:"flex", alignItems:"center", gap:12 }}>
                  <div style={{ width:90, fontSize:12, color:cc, fontWeight:700, textTransform:"uppercase", flexShrink:0 }}>{cat}</div>
                  <div style={{ flex:1, height:6, background:"#e7e0d0", borderRadius:3, overflow:"hidden" }}>
                    <div style={{ height:"100%", width:`${pct}%`, background:cc, borderRadius:3, transition:"width .6s ease" }} />
                  </div>
                  <div style={{ width:20, fontSize:13, fontWeight:700, color:cc, textAlign:"right", flexShrink:0 }}>{count}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:"#444", marginBottom:12 }}>Meest actieve leden</div>
          {topAttendees.length === 0 ? (
            <div style={{ fontSize:13, color:"#555", fontFamily:"Barlow,sans-serif" }}>Nog geen aanmeldingen</div>
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
        <div style={{ background:"#ffffff", border:"1px solid #e7e0d0", borderRadius:8, padding:16 }}>
          <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:"#444", marginBottom:10 }}>Financieel (komend)</div>
          <div style={{ fontSize:28, fontWeight:900, color:"#52b788" }}>€{totalUpcomingCost.toFixed(2)}</div>
          <div style={{ fontSize:12, color:"#555", fontFamily:"Barlow,sans-serif" }}>totaal aan deelnamekosten</div>
          <div style={{ fontSize:12, color:"#555", fontFamily:"Barlow,sans-serif", marginTop:6 }}>{sponsoredCount} event{sponsoredCount===1?"":"s"} met sponsor</div>
        </div>
        <div style={{ background:"#ffffff", border:"1px solid #e7e0d0", borderRadius:8, padding:16 }}>
          <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:"#444", marginBottom:10 }}>Beheerders</div>
          <div style={{ fontSize:28, fontWeight:900, color:primaryColor }}>{pinsList.length}</div>
          <div style={{ fontSize:12, color:"#555", fontFamily:"Barlow,sans-serif" }}>{pinsByRole.super} beheerder, {pinsByRole.editor} redacteur, {pinsByRole.viewer} bekijker</div>
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
          const dayEvs = events.filter(e => !e.archived && (!e.hidden||adminMode) && new Date(e.start_time).toDateString()===day.toDateString());
          return (
            <div key={i} style={{ minHeight:120, background:isToday?primaryColor+"11":"#ffffff", border:`1px solid ${isToday?primaryColor:"#e7e0d0"}`, borderRadius:6, padding:"6px 4px" }}>
              <div style={{ fontSize:9, color:isToday?primaryColor:"#444", fontWeight:700, textTransform:"uppercase", textAlign:"center", marginBottom:2 }}>{DAYS_NL[i]}</div>
              <div style={{ fontSize:18, fontWeight:900, color:isToday?primaryColor:"#444", textAlign:"center", lineHeight:1, marginBottom:6 }}>{day.getDate()}</div>
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
            <div key={name} style={{ background:"#ffffff", border:"1px solid #e7e0d0", borderRadius:8, padding:"12px 12px 10px", animation:"fadeInUp .3s both" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                <div style={{ fontSize:12, fontWeight:700, textTransform:"uppercase", letterSpacing:1, color:monthEvs.length?primaryColor:"#444" }}>{name}</div>
                {monthEvs.length>0 && <span style={{ fontSize:10, background:primaryColor+"22", color:primaryColor, borderRadius:10, padding:"1px 7px", fontWeight:700 }}>{monthEvs.length}</span>}
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:1 }}>
                {DAYS_NL.map(d=><div key={d} style={{ fontSize:7, color:"#d8cfb8", textAlign:"center", fontWeight:700, paddingBottom:2 }}>{d[0]}</div>)}
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
                      color:isToday?primaryColor:dayEvs.length?"#333":"#d8cfb8",
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
  const [saving, setSaving] = useState(false);
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
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [locationFilter, setLocationFilter] = useState("Alles");
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  // Drag-and-drop sort
  const [eventsOrder, setEventsOrder] = useState([]);
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);

  const [categoryColors, setCategoryColors] = useState(() => loadLS("hhc09_cat_colors", DEFAULT_COLORS));
  const [clubSettings, setClubSettings] = useState(() => loadLS("hhc09_club_settings", { name:"Heusden Herpt Combinatie", subtitle:"Clubagenda", primaryColor:"#1d2d6b", logo:"" }));
  const [pinsList, setPinsList] = useState([]);
  const [newPin, setNewPin] = useState("");
  const [newPinRole, setNewPinRole] = useState("editor");
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionResult, setConnectionResult] = useState(null);

  // Bardienst
  const [bardienst, setBardienst] = useState([]);
  const [showBardienstForm, setShowBardienstForm] = useState(false);
  const [editingBardienst, setEditingBardienst] = useState(null);
  const [bardienstForm, setBardienstForm] = useState({ shift_date:"", time_label:"", names:"", note:"" });
  const [savingBardienst, setSavingBardienst] = useState(false);

  // Mededelingen (nieuws)
  const [news, setNews] = useState([]);
  const [showNewsForm, setShowNewsForm] = useState(false);
  const [editingNews, setEditingNews] = useState(null);
  const [newsForm, setNewsForm] = useState({ title:"", body:"", pinned:false });
  const [savingNews, setSavingNews] = useState(false);

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
  useEffect(() => { saveLS("hhc09_cat_colors", categoryColors); }, [categoryColors]);
  useEffect(() => { saveLS("hhc09_club_settings", clubSettings); }, [clubSettings]);
  useEffect(() => {
    if ((showSettings || adminMode) && canSettings && adminToken) {
      adminApi({ action:"pins", op:"list", token:adminToken }).then(res => {
        if (res.ok) setPinsList(res.data?.data || []);
        else if (res.status === 401) sessionExpired();
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
    const endpoint = adminMode ? "events?order=start_time.asc" : "events?order=start_time.asc&is_public=eq.true";
    try {
      const [evs, atts, bd, nw] = await Promise.all([
        sb(endpoint),
        sb("event_attendees?select=event_id,attendee_name"),
        sb("bardienst?order=shift_date.asc"),
        sb("mededelingen?order=pinned.desc,created_at.desc"),
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
    const payload = { ...form, cost:form.cost ? parseFloat(form.cost) : null, end_time:form.end_time || null };
    const res = editingEvent
      ? await adminWrite("events", "PATCH", editingEvent.id, payload)
      : await adminWrite("events", "POST", null, payload);
    setSaving(false);
    if (!res.ok) return;
    await load(); setShowForm(false);
    showToast(editingEvent ? "Event bijgewerkt" : "Event toegevoegd");
  }

  async function handleDelete(id) {
    if (!confirm("Evenement definitief verwijderen?")) return;
    const res = await adminWrite("events", "DELETE", id);
    if (!res.ok) return;
    await load(); setSelectedEvent(null);
    showToast("Event verwijderd", "error");
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
    if (!bardienstForm.shift_date || !bardienstForm.names) return;
    setSavingBardienst(true);
    const res = editingBardienst
      ? await adminWrite("bardienst", "PATCH", editingBardienst.id, bardienstForm)
      : await adminWrite("bardienst", "POST", null, bardienstForm);
    setSavingBardienst(false);
    if (!res.ok) return;
    await load(); setShowBardienstForm(false);
    showToast(editingBardienst ? "Bardienst bijgewerkt" : "Bardienst toegevoegd");
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
    setBardienstForm({ shift_date:getNextThursday(), time_label:"", names:"", note:"" });
    setShowBardienstForm(true);
  }

  function openEditBardienst(b) {
    setEditingBardienst(b);
    setBardienstForm({ shift_date:b.shift_date?b.shift_date.slice(0,10):"", time_label:b.time_label||"", names:b.names||"", note:b.note||"" });
    setShowBardienstForm(true);
  }

  async function handleSaveNews() {
    if (!newsForm.title || !newsForm.body) return;
    setSavingNews(true);
    const res = editingNews
      ? await adminWrite("mededelingen", "PATCH", editingNews.id, newsForm)
      : await adminWrite("mededelingen", "POST", null, newsForm);
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
    setNewsForm({ title:"", body:"", pinned:false });
    setShowNewsForm(true);
  }

  function openEditNews(n) {
    setEditingNews(n);
    setNewsForm({ title:n.title, body:n.body, pinned:n.pinned||false });
    setShowNewsForm(true);
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

  function openNew() {
    setEditingEvent(null);
    setForm({ title:"", description:"", location:"", start_time:"", end_time:"", category:"Evenement", is_public:true, hidden:false, sponsor_name:"", sponsor_logo:"", image_url:"", cost:"" });
    setShowForm(true);
  }

  function openEdit(ev) {
    setEditingEvent(ev);
    setForm({ title:ev.title, description:ev.description||"", location:ev.location||"", start_time:ev.start_time?ev.start_time.slice(0,16):"", end_time:ev.end_time?ev.end_time.slice(0,16):"", category:ev.category||"Evenement", is_public:ev.is_public!==false, hidden:ev.hidden||false, sponsor_name:ev.sponsor_name||"", sponsor_logo:ev.sponsor_logo||"", image_url:ev.image_url||"", cost:ev.cost!=null?String(ev.cost):"" });
    setShowForm(true);
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
  const calEvents = events.filter(ev => { const d=new Date(ev.start_time); return !ev.archived&&d.getFullYear()===calDate.year&&d.getMonth()===calDate.month&&(!ev.hidden||adminMode); });
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
    <div style={{ minHeight:"100vh", background:"#f5f1e6", color:"#1c1c26", fontFamily:"'Barlow Condensed','Arial Narrow',Arial,sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800;900&family=Barlow:wght@400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:${primaryColor};border-radius:2px}
        @keyframes fadeInUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(200%)}}
        .ev-card{background:#ffffff;border:1px solid #e7e0d0;border-left:4px solid var(--cc);border-radius:8px;padding:18px 20px;cursor:pointer;transition:all .2s;position:relative;overflow:hidden;animation:fadeInUp .25s ease both;box-shadow:0 1px 3px rgba(0,0,0,.06)}
        .ev-card:hover{background:#fffdf8;transform:translateX(3px);box-shadow:-4px 0 20px ${primaryColor}22,0 1px 3px rgba(0,0,0,.06)}
        .ev-card.hidden-ev{opacity:.5;border-style:dashed}
        .ev-card.drag-over{border-top:2px solid ${primaryColor};transform:translateY(-2px)}
        .filter-btn{background:transparent;border:1px solid #d8cfb8;color:#888;padding:6px 16px;border-radius:20px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;letter-spacing:.5px;transition:all .2s;text-transform:uppercase}
        .filter-btn.active{background:${primaryColor};border-color:${primaryColor};color:white}
        .filter-btn:hover:not(.active){border-color:${primaryColor};color:${primaryColor}}
        .badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase}
        .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:100;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px);animation:fadeIn .15s ease}
        .modal{background:#ffffff;border:1px solid #d8cfb8;border-radius:12px;padding:32px;width:100%;max-width:520px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.25)}
        .input{background:#ffffff;border:1px solid #d8cfb8;color:#1c1c26;padding:10px 14px;border-radius:6px;font-family:inherit;font-size:16px;width:100%;transition:border-color .2s;min-width:0}
        .input:focus{outline:none;border-color:${primaryColor}}
        .btn-red{background:${primaryColor};color:white;border:none;padding:10px 24px;border-radius:6px;font-family:inherit;font-size:14px;font-weight:700;letter-spacing:1px;text-transform:uppercase;cursor:pointer;transition:all .2s}
        .btn-red:hover{filter:brightness(1.15)}
        .btn-ghost{background:transparent;color:#888;border:1px solid #d8cfb8;padding:10px 20px;border-radius:6px;font-family:inherit;font-size:14px;cursor:pointer;transition:all .2s}
        .btn-ghost:hover{border-color:#999;color:#222}
        .btn-ghost-onbrand{background:rgba(255,255,255,.2);color:#fff;border:1px solid rgba(255,255,255,.5);padding:10px 20px;border-radius:6px;font-family:inherit;font-size:14px;cursor:pointer;transition:all .2s}
        .btn-ghost-onbrand:hover{background:rgba(255,255,255,.32)}
        .btn-sm{background:#e7e0d0;border:1px solid #d8cfb8;color:#888;padding:5px 12px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:12px;transition:all .15s}
        .btn-sm:hover{color:#222;border-color:#999}
        .pill-tab{background:rgba(255,255,255,.22);border:1px solid rgba(255,255,255,.3);color:#fff;padding:10px 22px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:14px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;transition:all .2s;white-space:nowrap;flex-shrink:0}
        .pill-tab.active{background:#fff;border-color:#fff;color:${primaryColor}}
        .pill-tab:hover:not(.active){background:rgba(255,255,255,.28)}
        .admin-corner{position:absolute;top:16px;right:20px;z-index:5;display:flex;align-items:center;gap:8px}
        .bottom-nav{display:none}
        .bottom-nav-btn{flex:0 0 auto;min-width:64px;display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 10px 6px;background:transparent;border:none;color:#888;font-family:inherit;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.3px;cursor:pointer;white-space:nowrap}
        .bottom-nav-btn .bn-icon{display:flex;align-items:center;justify-content:center;height:20px}
        .bottom-nav-btn.active{color:${primaryColor}}
        .filter-toggle{display:none}
        .cal-day{min-height:64px;padding:4px;border:1px solid #e7e0d0;border-radius:4px;transition:background .15s}
        .cal-day.today{border-color:${primaryColor}}
        .cal-day.has-events{background:#ffffff}
        .cal-dot{font-size:10px;padding:1px 4px;border-radius:3px;margin-top:2px;display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;cursor:pointer}
        select.input option{background:#ffffff}
        .settings-row{display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid #e7e0d0}
        .stat-bar{background:${primaryColor};border-radius:4px 4px 0 0;min-width:8px;transition:height .5s ease}
        .toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#ffffff;border:1px solid #d8cfb8;border-radius:8px;padding:12px 24px;font-size:14px;font-weight:700;z-index:999;animation:fadeInUp .2s ease;box-shadow:0 8px 30px rgba(0,0,0,.18);white-space:nowrap}
        @media print{nav,header,.no-print{display:none!important}body{background:white;color:black}.ev-card{border:1px solid #ccc;break-inside:avoid;margin-bottom:8px}.print-title{display:block!important}}
        .print-title{display:none}
        .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
        .grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
        @media (max-width:600px){
          .grid-2,.grid-3{grid-template-columns:1fr}
          .modal{padding:22px 18px}
          .btn-ghost-onbrand,.btn-ghost,.btn-red{padding:9px 14px;font-size:13px}
          .btn-sm{padding:7px 12px;font-size:12px;min-height:32px}
          .ev-card{padding:14px 16px}
          .desktop-tabs,.header-chevron{display:none!important}
          .admin-corner{top:12px;right:12px;gap:6px}
          .admin-corner .btn-ghost-onbrand{padding:7px 11px;font-size:11px}
          main{padding-bottom:92px!important}
          .bottom-nav{display:flex;position:fixed;bottom:0;left:0;right:0;background:#ffffff;border-top:1px solid #e7e0d0;z-index:90;overflow-x:auto;padding-bottom:env(safe-area-inset-bottom,0);box-shadow:0 -2px 10px rgba(0,0,0,.08)}
          .filter-toggle{display:flex;align-items:center;justify-content:space-between;width:100%;background:#ffffff;border:1px solid #d8cfb8;color:#444;padding:12px 16px;border-radius:8px;font-family:inherit;font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;cursor:pointer;margin-bottom:10px}
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
      <header className="no-print" style={{ background:"linear-gradient(135deg,#f5821f,#e8731a)", position:"relative", overflow:"hidden" }}>
        <div style={{ position:"absolute", inset:0, backgroundImage:"radial-gradient(circle,#ffffff35 1px,transparent 1.5px)", backgroundSize:"16px 16px", opacity:.6, pointerEvents:"none" }} />
        <div className="header-chevron" style={{ position:"absolute", top:"50%", right:24, transform:"translateY(-50%)", fontSize:64, fontWeight:900, color:"#ffffff26", pointerEvents:"none", letterSpacing:-10 }}>❯❯❯</div>

        <div className="admin-corner">
          {adminMode ? (
            <>
              <span style={{ fontSize:11, color:"#1d2d6b", background:"#ffffffcc", padding:"3px 10px", borderRadius:12, fontWeight:700, textTransform:"uppercase" }}>{ROLE_LABELS[adminRole]||"Admin"}</span>
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
                <span style={{ fontSize:11, fontWeight:800, letterSpacing:2, textTransform:"uppercase", color:"#1d2d6b" }}>{clubSettings.name}</span>
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
        const cc = categoryColors[ev.category] || primaryColor;
        const days = daysUntil(ev.start_time);
        const d = new Date(ev.start_time);
        return (
          <div className="no-print" style={{ maxWidth:960, margin:"0 auto", padding:"20px 20px 0" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
              <span style={{ color:primaryColor, fontWeight:900 }}>❯❯❯</span>
              <span style={{ fontSize:12, fontWeight:800, letterSpacing:2, color:primaryColor, textTransform:"uppercase" }}>Eerstvolgende</span>
            </div>
            <div onClick={()=>setSelectedEvent(ev)} style={{ display:"flex", borderRadius:10, overflow:"hidden", cursor:"pointer", boxShadow:"0 6px 24px rgba(0,0,0,.12)", animation:"fadeInUp .3s both" }}>
              <div style={{ background:primaryColor, color:"#fff", padding:"18px 26px", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minWidth:90 }}>
                <div style={{ fontSize:36, fontWeight:900, lineHeight:1 }}>{d.getDate()}</div>
                <div style={{ fontSize:13, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>{d.toLocaleDateString("nl-NL",{month:"short"})}</div>
              </div>
              <div style={{ flex:1, background:cc, color:"#fff", padding:"18px 22px" }}>
                <span className="badge" style={{ background:"#ffffff33", color:"#fff", marginBottom:8, display:"inline-block" }}>{ev.category}{days>0?` · ${days} DAGEN`:""}</span>
                <div style={{ fontSize:22, fontWeight:900, textTransform:"uppercase", lineHeight:1.05 }}>{ev.title}</div>
                <div style={{ fontSize:13, marginTop:6, opacity:.9, fontFamily:"Barlow,sans-serif" }}>{formatDate(ev.start_time)} · {formatTime(ev.start_time)}{ev.location?` · ${ev.location}`:""}</div>
                {ev.cost > 0 && <div style={{ fontSize:12, marginTop:6, opacity:.9, fontFamily:"Barlow,sans-serif" }}>💶 €{Number(ev.cost).toFixed(2)}</div>}
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
                      <div style={{ fontSize:12, color:"#666", marginTop:2, fontFamily:"Barlow,sans-serif" }}>{formatDate(ev2.start_time)}</div>
                      <div style={{ marginTop:6, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                        <span className="badge" style={{ background:cc2+"22", color:cc2 }}>{ev2.category}</span>
                        <span style={{ fontSize:11, fontWeight:700, color:days2<=3?primaryColor:"#999" }}>{days2===0?"VANDAAG":days2===1?"MORGEN":`${days2}D`}</span>
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
                  <div style={{ fontSize:13, color:"#666", fontFamily:"Barlow,sans-serif", marginTop:2 }}>{n.body.length>140?n.body.slice(0,140)+"…":n.body}</div>
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
                  <strong style={{ fontFamily:"'Barlow Condensed',sans-serif" }}>{formatDate(b.shift_date)}</strong>{b.time_label?` · ${b.time_label}`:""} — {b.names}
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
            <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:"#444", pointerEvents:"none" }}>🔍</span>
            <input className="input" value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} placeholder="Zoek op naam, locatie, beschrijving..." style={{ paddingLeft:38 }} />
          </div>
          <input className="input" type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={{ width:150 }} title="Vanaf datum" />
          <input className="input" type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} style={{ width:150 }} title="Tot datum" />
          <select className="input" value={locationFilter} onChange={e=>setLocationFilter(e.target.value)} style={{ width:"auto" }}>
            <option>Alles</option>
            {allLocations.map(l=><option key={l}>{l}</option>)}
          </select>
          {activeFilters && <button className="btn-sm" onClick={()=>{ setSearchQuery(""); setDateFrom(""); setDateTo(""); setLocationFilter("Alles"); }}>✕ Reset</button>}
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
          {["Alles",...allCategories].map(cat=>(
            <button key={cat} className={`filter-btn ${filter===cat?"active":""}`} onClick={()=>setFilter(cat)}>{cat}</button>
          ))}
          <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
            <label style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer", fontSize:13, color:"#666", fontFamily:"Barlow,sans-serif" }}>
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
          loading
            ? <div style={{ display:"flex", flexDirection:"column", gap:10 }}>{[0,1,2].map(i=><SkeletonCard key={i} delay={i*0.07} />)}</div>
            : visibleEvents.length===0
              ? (
                <div style={{ textAlign:"center", padding:60 }}>
                  <div style={{ fontSize:48, marginBottom:16 }}>📅</div>
                  <div style={{ color:"#444", fontSize:14, letterSpacing:1, textTransform:"uppercase" }}>Geen evenementen gevonden</div>
                  {activeFilters && <div style={{ color:"#555", fontSize:13, fontFamily:"Barlow,sans-serif", marginTop:8 }}>Pas de zoekfilters aan</div>}
                  {canEdit && <button className="btn-red" style={{ marginTop:20 }} onClick={openNew}>Eerste evenement toevoegen</button>}
                </div>
              )
              : Object.entries(grouped).map(([month,evs]) => (
                <div key={month} style={{ marginBottom:36 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14 }}>
                    <span style={{ fontSize:11, fontWeight:700, letterSpacing:3, textTransform:"uppercase", color:primaryColor }}>{month}</span>
                    <div style={{ flex:1, height:1, background:"#e7e0d0" }} />
                    <span style={{ fontSize:11, color:"#333" }}>{evs.length} activiteit{evs.length!==1?"en":""}</span>
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                    {evs.map((ev,idx) => {
                      const cc = categoryColors[ev.category] || primaryColor;
                      const past = !isUpcoming(ev.start_time);
                      return (
                        <div
                          key={ev.id}
                          className={`ev-card ${ev.hidden?"hidden-ev":""} ${dragOverId===ev.id?"drag-over":""}`}
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
                            <div style={{ background:cc, color:"#fff", borderRadius:8, width:60, height:60, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                              <div style={{ fontSize:24, fontWeight:900, lineHeight:1 }}>{new Date(ev.start_time).getDate()}</div>
                              <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:1 }}>{new Date(ev.start_time).toLocaleDateString("nl-NL",{month:"short"})}</div>
                            </div>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6, flexWrap:"wrap" }}>
                                <span className="badge" style={{ background:cc+"22", color:cc }}>{ev.category}</span>
                                {ev.hidden && <span className="badge" style={{ background:"#33300022", color:"#888" }}>Verborgen</span>}
                                {!past && daysUntil(ev.start_time)<=3 && <span className="badge" style={{ background:primaryColor+"22", color:primaryColor }}>{daysUntil(ev.start_time)===0?"Vandaag!":daysUntil(ev.start_time)===1?"Morgen":`${daysUntil(ev.start_time)}d`}</span>}
                                {ev.cost > 0 && <span style={{ fontSize:11, color:"#52b788", fontFamily:"Barlow,sans-serif" }}>💶 €{Number(ev.cost).toFixed(2)}</span>}
                                {ev.sponsor_name && <span style={{ fontSize:11, color:"#888", fontFamily:"Barlow,sans-serif" }}>🤝 {ev.sponsor_name}</span>}
                              </div>
                              <div style={{ fontSize:20, fontWeight:800, textTransform:"uppercase", lineHeight:1.1 }}>{ev.title}</div>
                              {ev.description && <div style={{ fontSize:14, color:"#666", marginTop:4, fontFamily:"Barlow,sans-serif", lineHeight:1.4 }}>{ev.description.length>100?ev.description.slice(0,100)+"…":ev.description}</div>}
                              <div style={{ marginTop:8, display:"flex", gap:12, flexWrap:"wrap" }}>
                                <span style={{ fontSize:13, color:"#888", fontFamily:"Barlow,sans-serif" }}>🕐 {formatTime(ev.start_time)}{ev.end_time?` – ${formatTime(ev.end_time)}`:""}</span>
                                {ev.location && <span style={{ fontSize:13, color:"#888", fontFamily:"Barlow,sans-serif" }}>📍 {ev.location}</span>}
                                <span style={{ fontSize:13, color:"#555", fontFamily:"Barlow,sans-serif" }}>👥 {(attendees[ev.id]||[]).length} aangemeld</span>
                              </div>
                              {ev.sponsor_logo && <img src={ev.sponsor_logo} alt={ev.sponsor_name} style={{ height:24, marginTop:8, objectFit:"contain" }} onError={e=>e.target.style.display="none"} />}
                            </div>
                            <span style={{ fontSize:22, color:"#bbb", flexShrink:0 }}>›</span>
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
              ))
        )}

        {/* NIEUWS */}
        {tab==="nieuws" && (
          <div>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20, flexWrap:"wrap", gap:10 }}>
              <div style={{ fontSize:13, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:primaryColor }}>Mededelingen</div>
              {canEdit && <button className="btn-red" onClick={openNewNews}>+ Mededeling plaatsen</button>}
            </div>
            {news.length === 0 ? (
              <div style={{ textAlign:"center", padding:60 }}>
                <div style={{ fontSize:48, marginBottom:16 }}>📢</div>
                <div style={{ color:"#444", fontSize:14, letterSpacing:1, textTransform:"uppercase" }}>Nog geen mededelingen</div>
                {canEdit && <button className="btn-red" style={{ marginTop:20 }} onClick={openNewNews}>Eerste mededeling plaatsen</button>}
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {news.map(n => (
                  <div key={n.id} style={{ background:"#ffffff", border:"1px solid #e7e0d0", borderLeft:`4px solid ${n.pinned?primaryColor:"#d8cfb8"}`, borderRadius:8, padding:"16px 20px" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:10, flexWrap:"wrap" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        {n.pinned && <span title="Vastgepind">📌</span>}
                        <span style={{ fontSize:18, fontWeight:800, textTransform:"uppercase" }}>{n.title}</span>
                      </div>
                      <span style={{ fontSize:12, color:"#888", fontFamily:"Barlow,sans-serif" }}>{new Date(n.created_at).toLocaleDateString("nl-NL", { day:"numeric", month:"long", year:"numeric" })}</span>
                    </div>
                    <div style={{ fontSize:14, color:"#555", fontFamily:"Barlow,sans-serif", marginTop:8, lineHeight:1.5, whiteSpace:"pre-wrap" }}>{n.body}</div>
                    {canEdit && (
                      <div style={{ marginTop:12, display:"flex", gap:6 }}>
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
        {tab==="bardienst" && (
          <div>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20, flexWrap:"wrap", gap:10 }}>
              <div style={{ fontSize:13, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:primaryColor }}>Bardienstrooster</div>
              {canEdit && <button className="btn-red" onClick={openNewBardienst}>+ Bardienst toevoegen</button>}
            </div>
            {bardienst.length === 0 ? (
              <div style={{ textAlign:"center", padding:60 }}>
                <div style={{ fontSize:48, marginBottom:16 }}>🍺</div>
                <div style={{ color:"#444", fontSize:14, letterSpacing:1, textTransform:"uppercase" }}>Nog geen bardiensten ingepland</div>
                {canEdit && <button className="btn-red" style={{ marginTop:20 }} onClick={openNewBardienst}>Eerste bardienst toevoegen</button>}
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {bardienst.map(b => {
                  const d = new Date(b.shift_date);
                  const inThisWeek = d >= thisWeekStart && d < thisWeekEnd;
                  const past = d < thisWeekStart;
                  return (
                    <div key={b.id} style={{ background:"#ffffff", border:"1px solid #e7e0d0", borderLeft:`4px solid ${inThisWeek?primaryColor:"#d8cfb8"}`, borderRadius:8, padding:"14px 20px", opacity:past?.5:1, display:"flex", alignItems:"center", gap:16, flexWrap:"wrap" }}>
                      <div style={{ minWidth:100 }}>
                        <div style={{ fontSize:15, fontWeight:800, textTransform:"uppercase" }}>{formatDate(b.shift_date)}</div>
                        {b.time_label && <div style={{ fontSize:12, color:"#888", fontFamily:"Barlow,sans-serif" }}>{b.time_label}</div>}
                      </div>
                      <div style={{ flex:1, minWidth:180 }}>
                        <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                          {b.names.split(",").map(n=>n.trim()).filter(Boolean).map((n,i)=>(
                            <span key={i} style={{ background:primaryColor+"22", color:primaryColor, borderRadius:20, padding:"3px 12px", fontSize:13, fontWeight:700 }}>{n}</span>
                          ))}
                        </div>
                        {b.note && <div style={{ fontSize:13, color:"#666", fontFamily:"Barlow,sans-serif", marginTop:6 }}>{b.note}</div>}
                      </div>
                      {inThisWeek && <span className="badge" style={{ background:primaryColor+"22", color:primaryColor }}>Deze week</span>}
                      {canEdit && (
                        <div style={{ display:"flex", gap:6 }}>
                          <button className="btn-sm" onClick={()=>openEditBardienst(b)}>Bewerken</button>
                          {canDelete && <button className="btn-sm" onClick={()=>handleDeleteBardienst(b.id)} style={{ color:"#e63946" }}>Verwijderen</button>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

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
                  <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                    <button className="btn-sm" onClick={()=>setCalDate(d=>{ const m=d.month===0?11:d.month-1; return {year:d.month===0?d.year-1:d.year,month:m}; })}>←</button>
                    <span style={{ fontSize:20, fontWeight:700, minWidth:180, textAlign:"center", textTransform:"uppercase" }}>{MONTHS_NL[calDate.month]} {calDate.year}</span>
                    <button className="btn-sm" onClick={()=>setCalDate(d=>{ const m=d.month===11?0:d.month+1; return {year:d.month===11?d.year+1:d.year,month:m}; })}>→</button>
                  </div>
                  <div style={{ display:"flex", gap:8 }}>
                    <button className="btn-sm" onClick={()=>setCalDate({year:new Date().getFullYear(),month:new Date().getMonth()})}>Vandaag</button>
                    <button className="btn-sm" onClick={()=>window.print()}>🖨 Afdrukken</button>
                  </div>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2, marginBottom:4 }}>
                  {DAYS_NL.map(d=><div key={d} style={{ textAlign:"center", fontSize:11, fontWeight:700, color:"#555", padding:"6px 0", textTransform:"uppercase", letterSpacing:1 }}>{d}</div>)}
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2 }}>
                  {calDays.map((day,i) => {
                    if (!day) return <div key={`e${i}`} />;
                    const dayEvs = calEvents.filter(ev => new Date(ev.start_time).getDate()===day.getDate());
                    const isToday = day.toDateString()===new Date().toDateString();
                    return (
                      <div key={day.toISOString()} className={`cal-day ${isToday?"today":""} ${dayEvs.length?"has-events":""}`}>
                        <div style={{ fontSize:12, color:isToday?primaryColor:"#555", fontWeight:isToday?700:400, padding:"2px 4px" }}>{day.getDate()}</div>
                        {dayEvs.map(ev => {
                          const cc = categoryColors[ev.category]||primaryColor;
                          return <span key={ev.id} className="cal-dot" style={{ background:cc+"33", color:cc }} onClick={()=>setSelectedEvent(ev)} title={ev.title}>{ev.title}</span>;
                        })}
                      </div>
                    );
                  })}
                </div>
                <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginTop:16 }}>
                  {allCategories.map(cat=><span key={cat} style={{ display:"flex", alignItems:"center", gap:5, fontSize:12, color:"#666", fontFamily:"Barlow,sans-serif" }}><span style={{ width:10, height:10, borderRadius:2, background:categoryColors[cat]||primaryColor, display:"inline-block" }}/>{cat}</span>)}
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
            <div style={{ fontSize:13, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:primaryColor, marginBottom:20 }}>Evenementenarchief ({pastEvents.length} evenementen)</div>
            {pastEvents.length===0
              ? <div style={{ color:"#444", fontSize:14, fontFamily:"Barlow,sans-serif" }}>Nog geen verleden evenementen</div>
              : <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {[...pastEvents].reverse().map(ev => {
                    const cc = categoryColors[ev.category]||primaryColor;
                    const att = (attendees[ev.id]||[]).length;
                    return (
                      <div key={ev.id} onClick={()=>setSelectedEvent(ev)} style={{ background:"#ffffff", border:`1px solid #e7e0d0`, borderLeft:`3px solid ${cc}`, borderRadius:6, padding:"12px 16px", display:"flex", alignItems:"center", gap:12, flexWrap:"wrap", cursor:"pointer" }}>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:16, fontWeight:700, textTransform:"uppercase" }}>{ev.title}</div>
                          <div style={{ fontSize:13, color:"#555", fontFamily:"Barlow,sans-serif", marginTop:2 }}>{formatDate(ev.start_time)} · {ev.location}</div>
                        </div>
                        <span className="badge" style={{ background:cc+"22", color:cc }}>{ev.category}</span>
                        {att>0 && <span style={{ fontSize:13, color:"#888", fontFamily:"Barlow,sans-serif" }}>👥 {att}</span>}
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
                    <div key={ev.id} style={{ background:"#ffffff", border:"1px solid #e7e0d0", borderLeft:"3px solid #6a4c93", borderRadius:6, padding:"12px 16px", display:"flex", alignItems:"center", gap:12, opacity:.6, flexWrap:"wrap" }}>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:15, fontWeight:700, textTransform:"uppercase" }}>{ev.title}</div>
                        <div style={{ fontSize:13, color:"#555", fontFamily:"Barlow,sans-serif" }}>{formatDate(ev.start_time)}</div>
                      </div>
                      <button className="btn-sm" onClick={()=>handleArchive(ev)}>Herstellen</button>
                      {canDelete && <button className="btn-sm" onClick={()=>handleDelete(ev.id)} style={{ color:"#e63946" }}>Verwijderen</button>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* STATISTIEKEN (admin) */}
        {tab==="statistieken" && adminMode && (
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:24 }}>
              <span style={{ fontSize:18, fontWeight:700, textTransform:"uppercase" }}>Evenementen per maand</span>
              <select className="input" value={statsYear} onChange={e=>setStatsYear(Number(e.target.value))} style={{ width:"auto", fontSize:14 }}>
                {[...new Set(events.map(e=>new Date(e.start_time).getFullYear()))].sort().reverse().map(y=><option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div style={{ display:"flex", alignItems:"flex-end", gap:6, height:160, marginBottom:8 }}>
              {statsMonths.map(m => (
                <div key={m.month} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
                  <div style={{ fontSize:12, color:primaryColor, fontWeight:700 }}>{m.count||""}</div>
                  <div className="stat-bar" style={{ width:"100%", height:m.count?(m.count/statsMax*120+8):4 }} />
                  <div style={{ fontSize:10, color:"#555", fontFamily:"Barlow,sans-serif", textTransform:"uppercase" }}>{m.month}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop:32 }}>
              <div style={{ fontSize:13, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:"#555", marginBottom:16 }}>Per categorie {statsYear}</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:10 }}>
                {allCategories.map(cat => {
                  const cc = categoryColors[cat]||primaryColor;
                  const count = events.filter(e=>e.category===cat&&new Date(e.start_time).getFullYear()===statsYear).length;
                  return (
                    <div key={cat} style={{ background:"#ffffff", border:`1px solid ${cc}33`, borderLeft:`3px solid ${cc}`, borderRadius:6, padding:"14px 16px" }}>
                      <div style={{ fontSize:11, color:cc, fontWeight:700, textTransform:"uppercase", letterSpacing:1, marginBottom:4 }}>{cat}</div>
                      <div style={{ fontSize:32, fontWeight:900, color:cc }}>{count}</div>
                      <div style={{ fontSize:12, color:"#555", fontFamily:"Barlow,sans-serif" }}>evenementen</div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ marginTop:32, background:"#ffffff", border:"1px solid #e7e0d0", borderRadius:8, padding:20 }}>
              <div style={{ fontSize:13, fontWeight:700, textTransform:"uppercase", letterSpacing:2, marginBottom:12 }}>Totale aanwezigheid {statsYear}</div>
              <div style={{ fontSize:40, fontWeight:900, color:primaryColor }}>
                {events.filter(e=>new Date(e.start_time).getFullYear()===statsYear).reduce((s,e)=>s+(attendees[e.id]||[]).length,0)}
              </div>
              <div style={{ fontSize:13, color:"#555", fontFamily:"Barlow,sans-serif" }}>aanmeldingen via de kalender</div>
            </div>
          </div>
        )}

        {/* DASHBOARD (admin) */}
        {tab==="dashboard" && adminMode && (
          <AdminDashboard
            events={events} attendees={attendees} bardienst={bardienst} news={news} ideas={ideas} pinsList={pinsList}
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
            <div style={{ fontSize:12, color:"#888", fontFamily:"Barlow,sans-serif", marginBottom:20 }}>Alleen beheerders zien deze ideeën — ze zijn niet zichtbaar voor bezoekers.</div>
            {ideas.length === 0 ? (
              <div style={{ textAlign:"center", padding:60 }}>
                <div style={{ fontSize:48, marginBottom:16 }}>💡</div>
                <div style={{ color:"#444", fontSize:14, letterSpacing:1, textTransform:"uppercase" }}>Nog geen ideeën binnengekomen</div>
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {ideas.map(idea => (
                  <div key={idea.id} style={{ background:"#ffffff", border:"1px solid #e7e0d0", borderLeft:`4px solid ${primaryColor}`, borderRadius:8, padding:"14px 20px" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:10, flexWrap:"wrap" }}>
                      <div>
                        <div style={{ fontSize:13, fontWeight:700, color:primaryColor }}>{idea.name || "Anoniem"}</div>
                        <div style={{ fontSize:12, color:"#888", fontFamily:"Barlow,sans-serif" }}>{new Date(idea.created_at).toLocaleString("nl-NL")}</div>
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
        return (
          <div className="modal-overlay" onClick={()=>setSelectedEvent(null)}>
            <div className="modal" style={{ maxWidth:580 }} onClick={e=>e.stopPropagation()}>
              {ev.image_url && (
                <div style={{ margin:"-32px -32px 20px", overflow:"hidden", borderRadius:"12px 12px 0 0", height:180 }}>
                  <img src={ev.image_url} alt={ev.title} style={{ width:"100%", height:"100%", objectFit:"cover" }} onError={e=>e.target.parentElement.style.display="none"} />
                </div>
              )}
              <div style={{ borderLeft:`4px solid ${cc}`, paddingLeft:16, marginBottom:20 }}>
                <span className="badge" style={{ background:cc+"22", color:cc, marginBottom:8, display:"inline-block" }}>{ev.category}</span>
                {ev.hidden && <span className="badge" style={{ background:"#33300022", color:"#888", marginLeft:6 }}>Verborgen</span>}
                <h2 style={{ fontSize:26, fontWeight:900, textTransform:"uppercase", lineHeight:1 }}>{ev.title}</h2>
              </div>
              <div className="grid-2" style={{ marginBottom:16 }}>
                <div style={{ background:"#f5f1e6", borderRadius:8, padding:14 }}>
                  <div style={{ fontSize:10, color:"#444", fontWeight:700, letterSpacing:2, textTransform:"uppercase", marginBottom:4 }}>Datum</div>
                  <div style={{ fontSize:15, fontWeight:700 }}>{formatDate(ev.start_time)}</div>
                </div>
                <div style={{ background:"#f5f1e6", borderRadius:8, padding:14 }}>
                  <div style={{ fontSize:10, color:"#444", fontWeight:700, letterSpacing:2, textTransform:"uppercase", marginBottom:4 }}>Tijd</div>
                  <div style={{ fontSize:15, fontWeight:700 }}>{formatTime(ev.start_time)}{ev.end_time?` – ${formatTime(ev.end_time)}`:""}</div>
                </div>
              </div>
              {ev.location && (
                <div style={{ background:"#f5f1e6", borderRadius:8, padding:14, marginBottom:16 }}>
                  <div style={{ fontSize:10, color:"#444", fontWeight:700, letterSpacing:2, textTransform:"uppercase", marginBottom:4 }}>Locatie</div>
                  <a href={`https://maps.google.com/?q=${encodeURIComponent(ev.location)}`} target="_blank" rel="noopener noreferrer" style={{ fontSize:15, fontWeight:700, color:"#1c1c26", textDecoration:"none", display:"flex", alignItems:"center", gap:8 }}>
                    📍 {ev.location} <span style={{ fontSize:11, color:primaryColor }}>↗ Google Maps</span>
                  </a>
                </div>
              )}
              <WeatherWidget location={ev.location} startTime={ev.start_time} />
              {ev.cost > 0 && (
                <div style={{ background:"#f5f1e6", borderRadius:8, padding:14, marginBottom:16 }}>
                  <div style={{ fontSize:10, color:"#444", fontWeight:700, letterSpacing:2, textTransform:"uppercase", marginBottom:4 }}>Kosten deelname</div>
                  <div style={{ fontSize:24, fontWeight:900, color:"#52b788" }}>€{Number(ev.cost).toFixed(2)}</div>
                </div>
              )}
              {ev.sponsor_name && (
                <div style={{ background:"#f5f1e6", borderRadius:8, padding:14, marginBottom:16, display:"flex", alignItems:"center", gap:12 }}>
                  <div>
                    <div style={{ fontSize:10, color:"#444", fontWeight:700, letterSpacing:2, textTransform:"uppercase", marginBottom:2 }}>Gesponsord door</div>
                    <div style={{ fontSize:15, fontWeight:700 }}>🤝 {ev.sponsor_name}</div>
                  </div>
                  {ev.sponsor_logo && <img src={ev.sponsor_logo} alt={ev.sponsor_name} style={{ height:36, objectFit:"contain", marginLeft:"auto" }} onError={e=>e.target.style.display="none"} />}
                </div>
              )}
              {ev.description && <div style={{ marginBottom:16, fontFamily:"Barlow,sans-serif", fontSize:15, color:"#aaa", lineHeight:1.6 }}>{ev.description}</div>}
              {isUpcoming(ev.start_time) && (
                <div style={{ background:primaryColor+"11", border:`1px solid ${primaryColor}22`, borderRadius:8, padding:10, textAlign:"center", marginBottom:16 }}>
                  <span style={{ color:primaryColor, fontWeight:700, letterSpacing:1, textTransform:"uppercase", fontSize:13 }}>
                    {daysUntil(ev.start_time)===0?"🔥 Vandaag!":daysUntil(ev.start_time)===1?"Morgen!":`Over ${daysUntil(ev.start_time)} dagen`}
                  </span>
                </div>
              )}
              <div style={{ background:"#f5f1e6", borderRadius:8, padding:14, marginBottom:16 }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                  <span style={{ fontSize:13, fontWeight:700 }}>👥 {(attendees[ev.id]||[]).length} aangemeld</span>
                  <button className="btn-sm" onClick={()=>{ setShowAttendees(ev); setSelectedEvent(null); }}>Bekijken / Aanmelden</button>
                </div>
                {(attendees[ev.id]||[]).slice(0,5).map((a,i)=><span key={i} style={{ fontSize:12, color:"#666", fontFamily:"Barlow,sans-serif", marginRight:8 }}>{a.attendee_name}</span>)}
                {(attendees[ev.id]||[]).length>5 && <span style={{ fontSize:12, color:"#444" }}>+{(attendees[ev.id]||[]).length-5} meer</span>}
              </div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                <button className="btn-ghost" onClick={()=>setSelectedEvent(null)}>Sluiten</button>
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
            </div>
          </div>
        );
      })()}

      {showQR && <QRModal event={showQR} onClose={()=>setShowQR(null)} primaryColor={primaryColor} />}
      {showAttendees && <AttendeeModal event={showAttendees} attendees={attendees} onClose={()=>setShowAttendees(null)} onRegister={handleAttend} primaryColor={primaryColor} />}

      {/* FORM MODAL */}
      {showForm && (
        <div className="modal-overlay" onClick={()=>setShowForm(false)}>
          <div className="modal" style={{ maxWidth:640 }} onClick={e=>e.stopPropagation()}>
            <h2 style={{ fontSize:20, fontWeight:900, textTransform:"uppercase", marginBottom:20 }}>{editingEvent?"Bewerken":"Nieuw evenement"}</h2>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div><label style={{ fontSize:11, color:"#555", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Titel *</label><input className="input" value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="Evenementnaam" /></div>
              <div className="grid-2">
                <div><label style={{ fontSize:11, color:"#555", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Start *</label><input className="input" type="datetime-local" value={form.start_time} onChange={e=>setForm(f=>({...f,start_time:e.target.value}))} /></div>
                <div><label style={{ fontSize:11, color:"#555", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Einde</label><input className="input" type="datetime-local" value={form.end_time} onChange={e=>setForm(f=>({...f,end_time:e.target.value}))} /></div>
              </div>
              <div className="grid-2">
                <div><label style={{ fontSize:11, color:"#555", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Categorie</label>
                  <select className="input" value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>
                    {allCategories.map(c=><option key={c}>{c}</option>)}
                  </select>
                </div>
                <div><label style={{ fontSize:11, color:"#555", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Locatie</label><input className="input" value={form.location} onChange={e=>setForm(f=>({...f,location:e.target.value}))} placeholder="Sportpark De Brug" /></div>
              </div>
              <div><label style={{ fontSize:11, color:"#555", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Beschrijving</label><textarea className="input" rows={3} value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="Extra info..." style={{ resize:"vertical" }} /></div>
              <div>
                <label style={{ fontSize:11, color:"#555", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Afbeelding URL</label>
                <input className="input" value={form.image_url} onChange={e=>setForm(f=>({...f,image_url:e.target.value}))} placeholder="https://... (banner/foto)" />
                {form.image_url && <img src={form.image_url} alt="preview" style={{ width:"100%", height:90, objectFit:"cover", borderRadius:6, border:"1px solid #d8cfb8", marginTop:8 }} onError={e=>e.target.style.display="none"} />}
              </div>
              <div className="grid-3">
                <div><label style={{ fontSize:11, color:"#555", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Kosten (€)</label><input className="input" type="number" min="0" step="0.01" value={form.cost} onChange={e=>setForm(f=>({...f,cost:e.target.value}))} placeholder="0.00" /></div>
                <div><label style={{ fontSize:11, color:"#555", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Sponsornaam</label><input className="input" value={form.sponsor_name} onChange={e=>setForm(f=>({...f,sponsor_name:e.target.value}))} placeholder="Bakkerij Jansen" /></div>
                <div><label style={{ fontSize:11, color:"#555", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Sponsorlogo URL</label><input className="input" value={form.sponsor_logo} onChange={e=>setForm(f=>({...f,sponsor_logo:e.target.value}))} placeholder="https://..." /></div>
              </div>
              <div style={{ display:"flex", gap:16, alignItems:"center" }}>
                <label style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer", fontSize:14, fontFamily:"Barlow,sans-serif" }}><input type="checkbox" checked={form.is_public} onChange={e=>setForm(f=>({...f,is_public:e.target.checked}))} style={{ accentColor:primaryColor }} /> Publiek</label>
                <label style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer", fontSize:14, fontFamily:"Barlow,sans-serif" }}><input type="checkbox" checked={form.hidden} onChange={e=>setForm(f=>({...f,hidden:e.target.checked}))} style={{ accentColor:"#888" }} /> Verborgen</label>
              </div>
              <div style={{ display:"flex", gap:10, marginTop:8 }}>
                <button className="btn-red" onClick={handleSave} disabled={saving||!form.title||!form.start_time} style={{ flex:1 }}>{saving?"Opslaan...":editingEvent?"Opslaan":"Toevoegen"}</button>
                <button className="btn-ghost" onClick={()=>setShowForm(false)}>Annuleren</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* BARDIENST FORM MODAL */}
      {showBardienstForm && (
        <div className="modal-overlay" onClick={()=>setShowBardienstForm(false)}>
          <div className="modal" style={{ maxWidth:480 }} onClick={e=>e.stopPropagation()}>
            <h2 style={{ fontSize:20, fontWeight:900, textTransform:"uppercase", marginBottom:20 }}>{editingBardienst?"Bardienst bewerken":"Bardienst toevoegen"}</h2>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div><label style={{ fontSize:11, color:"#555", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Datum *</label><input className="input" type="date" value={bardienstForm.shift_date} onChange={e=>setBardienstForm(f=>({...f,shift_date:e.target.value}))} /></div>
              <div><label style={{ fontSize:11, color:"#555", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Tijd (optioneel)</label><input className="input" value={bardienstForm.time_label} onChange={e=>setBardienstForm(f=>({...f,time_label:e.target.value}))} placeholder="bv. 20:00 – 01:00" /></div>
              <div><label style={{ fontSize:11, color:"#555", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Namen * (komma-gescheiden)</label><input className="input" value={bardienstForm.names} onChange={e=>setBardienstForm(f=>({...f,names:e.target.value}))} placeholder="Jan, Piet, Marie" /></div>
              <div><label style={{ fontSize:11, color:"#555", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Notitie</label><input className="input" value={bardienstForm.note} onChange={e=>setBardienstForm(f=>({...f,note:e.target.value}))} placeholder="Extra info" /></div>
              <div style={{ display:"flex", gap:10, marginTop:8 }}>
                <button className="btn-red" onClick={handleSaveBardienst} disabled={savingBardienst||!bardienstForm.shift_date||!bardienstForm.names} style={{ flex:1 }}>{savingBardienst?"Opslaan...":editingBardienst?"Opslaan":"Toevoegen"}</button>
                <button className="btn-ghost" onClick={()=>setShowBardienstForm(false)}>Annuleren</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* NIEUWS FORM MODAL */}
      {showNewsForm && (
        <div className="modal-overlay" onClick={()=>setShowNewsForm(false)}>
          <div className="modal" style={{ maxWidth:520 }} onClick={e=>e.stopPropagation()}>
            <h2 style={{ fontSize:20, fontWeight:900, textTransform:"uppercase", marginBottom:20 }}>{editingNews?"Mededeling bewerken":"Mededeling plaatsen"}</h2>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div><label style={{ fontSize:11, color:"#555", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Titel *</label><input className="input" value={newsForm.title} onChange={e=>setNewsForm(f=>({...f,title:e.target.value}))} placeholder="Titel van de mededeling" /></div>
              <div><label style={{ fontSize:11, color:"#555", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Tekst *</label><textarea className="input" rows={5} value={newsForm.body} onChange={e=>setNewsForm(f=>({...f,body:e.target.value}))} placeholder="Waar gaat het over..." style={{ resize:"vertical" }} /></div>
              <label style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer", fontSize:14, fontFamily:"Barlow,sans-serif" }}><input type="checkbox" checked={newsForm.pinned} onChange={e=>setNewsForm(f=>({...f,pinned:e.target.checked}))} style={{ accentColor:primaryColor }} /> Vastpinnen bovenaan de agenda</label>
              <div style={{ display:"flex", gap:10, marginTop:8 }}>
                <button className="btn-red" onClick={handleSaveNews} disabled={savingNews||!newsForm.title||!newsForm.body} style={{ flex:1 }}>{savingNews?"Opslaan...":editingNews?"Opslaan":"Plaatsen"}</button>
                <button className="btn-ghost" onClick={()=>setShowNewsForm(false)}>Annuleren</button>
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
            <p style={{ color:"#555", fontSize:14, fontFamily:"Barlow,sans-serif", marginBottom:16 }}>Alleen het bestuur ziet dit — jouw naam is optioneel.</p>
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
        <div className="modal-overlay" onClick={()=>setShowPinModal(false)}>
          <div className="modal" style={{ maxWidth:380 }} onClick={e=>e.stopPropagation()}>
            <h2 style={{ fontSize:22, fontWeight:900, textTransform:"uppercase", marginBottom:6 }}>Beheer</h2>
            <p style={{ color:"#555", fontSize:14, fontFamily:"Barlow,sans-serif", marginBottom:20 }}>Voer je pincode in</p>
            <input className="input" type="password" placeholder="Pincode" value={pinInput} onChange={e=>{ setPinInput(e.target.value); setPinError(false); }} onKeyDown={e=>e.key==="Enter"&&submitPin()} style={{ fontSize:24, letterSpacing:8, textAlign:"center", marginBottom:pinError?8:16 }} autoFocus />
            {pinError && <p style={{ color:"#e63946", fontSize:13, textAlign:"center", marginBottom:16, fontFamily:"Barlow,sans-serif" }}>Verkeerde pincode</p>}
            <div style={{ display:"flex", gap:10 }}>
              <button className="btn-red" onClick={submitPin} style={{ flex:1 }}>Inloggen</button>
              <button className="btn-ghost" onClick={()=>setShowPinModal(false)}>Annuleren</button>
            </div>
          </div>
        </div>
      )}

      {/* SETTINGS MODAL */}
      {showSettings && (
        <div className="modal-overlay" onClick={()=>setShowSettings(false)}>
          <div className="modal" style={{ maxWidth:620 }} onClick={e=>e.stopPropagation()}>
            <h2 style={{ fontSize:20, fontWeight:900, textTransform:"uppercase", marginBottom:20 }}>⚙ Beheerinstellingen</h2>

            <div style={{ fontSize:12, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:primaryColor, marginBottom:12 }}>Clubinstellingen</div>
            <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:24 }}>
              <div className="grid-2">
                <div><label style={{ fontSize:11, color:"#555", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Clubnaam</label><input className="input" value={clubSettings.name} onChange={e=>setClubSettings(s=>({...s,name:e.target.value}))} /></div>
                <div><label style={{ fontSize:11, color:"#555", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Ondertitel</label><input className="input" value={clubSettings.subtitle} onChange={e=>setClubSettings(s=>({...s,subtitle:e.target.value}))} /></div>
              </div>
              <div className="grid-2">
                <div><label style={{ fontSize:11, color:"#555", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Hoofdkleur</label>
                  <div style={{ display:"flex", gap:8 }}>
                    <input className="input" value={clubSettings.primaryColor} onChange={e=>setClubSettings(s=>({...s,primaryColor:e.target.value}))} />
                    <input type="color" value={clubSettings.primaryColor} onChange={e=>setClubSettings(s=>({...s,primaryColor:e.target.value}))} style={{ width:44, height:42, border:"1px solid #d8cfb8", borderRadius:6, padding:2, background:"#f5f1e6", cursor:"pointer" }} />
                  </div>
                </div>
                <div><label style={{ fontSize:11, color:"#555", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Logo URL</label><input className="input" value={clubSettings.logo} onChange={e=>setClubSettings(s=>({...s,logo:e.target.value}))} placeholder="Standaard HHC&#8217;09-logo (laat leeg om te gebruiken)" /></div>
              </div>
            </div>

            <div style={{ fontSize:12, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:primaryColor, marginBottom:12 }}>Categorie kleuren</div>
            <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:24 }}>
              {allCategories.map(cat => (
                <div key={cat} className="settings-row">
                  <span style={{ fontSize:14, fontFamily:"Barlow,sans-serif" }}>{cat}</span>
                  <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                    <input className="input" value={categoryColors[cat]||"#888"} onChange={e=>setCategoryColors(c=>({...c,[cat]:e.target.value}))} style={{ width:100, fontSize:13 }} />
                    <input type="color" value={categoryColors[cat]||"#888"} onChange={e=>setCategoryColors(c=>({...c,[cat]:e.target.value}))} style={{ width:36, height:36, border:"1px solid #d8cfb8", borderRadius:6, padding:2, background:"#f5f1e6", cursor:"pointer" }} />
                  </div>
                </div>
              ))}
              <button className="btn-sm" onClick={()=>setCategoryColors(DEFAULT_COLORS)} style={{ alignSelf:"flex-start", marginTop:4 }}>Reset kleuren</button>
            </div>

            <div style={{ fontSize:12, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:primaryColor, marginBottom:12 }}>Beheerders pincodes</div>
            <div style={{ fontSize:12, color:"#888", fontFamily:"Barlow,sans-serif", marginBottom:10 }}>Pincodes worden gehasht opgeslagen en server-side gecontroleerd — daarom is de code zelf hier niet meer zichtbaar.</div>
            <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:12 }}>
              {pinsList.map(p => (
                <div key={p.id} className="settings-row">
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <span style={{ fontSize:10, background:primaryColor+"22", color:primaryColor, padding:"2px 8px", borderRadius:10, fontWeight:700, textTransform:"uppercase" }}>{ROLE_LABELS[p.role]||p.role}</span>
                    <span style={{ fontSize:12, color:"#888", fontFamily:"Barlow,sans-serif" }}>sinds {new Date(p.created_at).toLocaleDateString("nl-NL")}</span>
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
            <div style={{ fontSize:12, color:"#888", fontFamily:"Barlow,sans-serif", marginBottom:10 }}>Het gratis Supabase-project pauzeert automatisch na 7 dagen zonder activiteit. Test hier de verbinding — dat telt meteen als activiteit.</div>
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
