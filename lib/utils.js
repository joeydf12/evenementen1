// Verbetering #6/#21: vergelijkt een formulierstate met de staat bij het openen,
// om te kunnen waarschuwen voor niet-opgeslagen wijzigingen bij het sluiten.
export function isDirty(current, initial) {
  if (!initial) return false;
  return JSON.stringify(current) !== JSON.stringify(initial);
}

// Verbetering #23: contrast van een categoriekleur tegen witte tekst (WCAG-formule),
// zodat een te lichte kleur in de instellingen gesignaleerd kan worden.
export function hexToRgb(hex) {
  const h = (hex || "").replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  const num = parseInt(full, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}
export function relLuminance([r, g, b]) {
  const [R, G, B] = [r, g, b].map(c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}
export function contrastWithWhite(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 21;
  return 1.05 / (relLuminance(rgb) + 0.05);
}

// Verbetering #34: houdt een net gefocust veld in een modal zichtbaar boven het
// (mobiele) toetsenbord, i.p.v. dat de gebruiker zelf moet scrollen.
export function handleModalFocus(e) {
  const t = e.target;
  if (t && t.matches && t.matches("input,textarea,select")) {
    setTimeout(() => t.scrollIntoView({ block:"center", behavior:"smooth" }), 60);
  }
}

export const WMO_WEATHER = {
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
export function getWeatherInfo(code) { return WMO_WEATHER[code] || { icon:"🌡️", label:"Onbekend" }; }

export function getGoogleCalendarUrl(ev) {
  const fmt = d => new Date(d).toISOString().replace(/[-:]/g,"").slice(0,15) + "Z";
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(ev.title)}&dates=${fmt(ev.start_time)}/${fmt(ev.end_time||ev.start_time)}&details=${encodeURIComponent(ev.description||"")}&location=${encodeURIComponent(ev.location||"")}`;
}

export function generateICS(event) {
  const fmt = d => new Date(d).toISOString().replace(/[-:]/g,"").slice(0,15) + "Z";
  return ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//HHC09//Events//NL","BEGIN:VEVENT",
    `UID:${event.id}@hhc09.nl`,`DTSTART:${fmt(event.start_time)}`,`DTEND:${fmt(event.end_time||event.start_time)}`,
    `SUMMARY:${event.title}`,`DESCRIPTION:${(event.description||"").replace(/\n/g,"\\n")}`,`LOCATION:${event.location||""}`,
    "END:VEVENT","END:VCALENDAR"].join("\r\n");
}

export function downloadICS(event) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([generateICS(event)], { type:"text/calendar" }));
  a.download = `${event.title.replace(/\s+/g,"-")}.ics`;
  a.click(); URL.revokeObjectURL(a.href);
}

// Verkleint een geüploade foto client-side (max 1600px, jpeg/png @82%) zodat
// uploads klein en snel blijven over de Edge Function heen.
export async function resizeImageToBase64(file, maxDim = 1600, quality = 0.82) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("decode failed"));
    el.src = dataUrl;
  });
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d").drawImage(img, 0, 0, w, h);
  const contentType = file.type === "image/png" ? "image/png" : "image/jpeg";
  const outDataUrl = canvas.toDataURL(contentType, quality);
  return { base64: outDataUrl.split(",")[1], contentType };
}
