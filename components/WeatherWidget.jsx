import { useState, useEffect } from "react";
import { daysUntil } from "../lib/dates.js";
import { getWeatherInfo } from "../lib/utils.js";
import { loadLS, saveLS } from "../lib/storage.js";

// ---- WEATHER WIDGET ----
export default function WeatherWidget({ location, startTime }) {
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
