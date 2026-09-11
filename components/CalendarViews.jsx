import { MONTHS_NL, DAYS_NL, dayInRange, isTimeSet, formatTime, getWeekStart, getCalendarDays } from "../lib/dates.js";

// ---- WEEK VIEW ----
export function WeekView({ events, weekStart, onWeekChange, categoryColors, primaryColor, onEventClick, adminMode }) {
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
            <div key={i} style={{ minHeight:120, background:isToday?primaryColor+"11":"#ffffff", border:`1px solid ${isToday?primaryColor:"#ebe8df"}`, borderRadius:12, padding:"6px 4px" }}>
              <div style={{ fontSize:9, color:isToday?primaryColor:"#56554d", fontWeight:700, textTransform:"uppercase", textAlign:"center", marginBottom:2 }}>{DAYS_NL[i]}</div>
              <div style={{ fontSize:18, fontWeight:900, color:isToday?primaryColor:"#56554d", textAlign:"center", lineHeight:1, marginBottom:6 }}>{day.getDate()}</div>
              {dayEvs.map(ev => {
                const cc = categoryColors[ev.category]||primaryColor;
                return (
                  <div key={ev.id} onClick={()=>onEventClick(ev)} style={{ background:cc+"22", color:cc, fontSize:9, padding:"2px 4px", borderRadius:3, marginBottom:2, cursor:"pointer", overflow:"hidden", whiteSpace:"nowrap", textOverflow:"ellipsis", fontWeight:700 }} title={ev.title}>
                    {isTimeSet(ev) ? `${formatTime(ev.start_time)} ` : ""}{ev.title}
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
export function YearView({ events, year, onYearChange, categoryColors, primaryColor, onEventClick }) {
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
            <div key={name} style={{ background:"#ffffff", border:"1px solid #ebe8df", borderRadius:14, padding:"12px 12px 10px", animation:"fadeInUp .3s both" }}>
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
