import { Beer, MapPin, StickyNote, Lightbulb, Settings, ChevronRight, Pin } from "lucide-react";
import { isUpcoming, daysUntil, toDateStr, getUpcomingThursdays, formatDate } from "../lib/dates.js";

// ---- ADMIN DASHBOARD ----
export default function AdminDashboard({ events, attendees, bardienst, news, ideas, pinsList, pinResets, primaryColor, allCategories, categoryColors, onSelectEvent, onGoTab, onNewEvent, onNewBardienst, onNewNews, onOpenSettings }) {
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
    { label:"Komende events", value:upcoming.length },
    { label:"Afgelopen", value:past.length },
    { label:"Deze maand", value:thisMonth.length },
    { label:"Aanmeldingen", value:totalAttendees },
    { label:"Gearchiveerd", value:archived.length },
    { label:"Bardiensten gepland", value:bardienst.length },
    { label:"Mededelingen", value:news.length },
    { label:"Ideeën binnen", value:ideas.length },
  ];

  const attentionItems = [
    ...bardienstGaps.map(date => ({ type:"warn", icon:Beer, text:`Nog niemand ingepland voor bardienst op ${formatDate(date)}`, action:()=>onGoTab("bardienst") })),
    ...(eventsMissingLocation > 0 ? [{ type:"info", icon:MapPin, text:`${eventsMissingLocation} komend${eventsMissingLocation===1?"":"e"} event${eventsMissingLocation===1?"":"s"} zonder locatie`, action:()=>onGoTab("home") }] : []),
    ...(eventsMissingDescription > 0 ? [{ type:"info", icon:StickyNote, text:`${eventsMissingDescription} komend${eventsMissingDescription===1?"":"e"} event${eventsMissingDescription===1?"":"s"} zonder beschrijving`, action:()=>onGoTab("home") }] : []),
    ...(ideas.length > 0 ? [{ type:"idea", icon:Lightbulb, text:`${ideas.length} idee${ideas.length===1?"":"ën"} van leden om te bekijken`, action:()=>onGoTab("ideeen") }] : []),
    ...((pinResets?.length > 0) ? [{ type:"warn", icon:Settings, text:`${pinResets.length} pincode-verzoek${pinResets.length===1?"":"en"} wacht${pinResets.length===1?"":"en"} op afhandeling`, action:onOpenSettings }] : []),
  ];

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end", marginBottom:20, flexWrap:"wrap", gap:8 }}>
        <button className="btn-sm" onClick={onNewEvent}>+ Event</button>
        <button className="btn-sm" onClick={onNewBardienst}>+ Bardienst</button>
        <button className="btn-sm" onClick={onNewNews}>+ Mededeling</button>
        <button className="btn-sm" onClick={onOpenSettings} style={{ display:"flex", alignItems:"center", gap:5 }}><Settings size={13} strokeWidth={1.8} /> Instellingen</button>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:10, marginBottom:28 }}>
        {stats.map(s => (
          <div key={s.label} style={{ background:"var(--color-surface)", border:"1px solid var(--color-border)", borderRadius:"var(--radius-card)", padding:"14px 16px", boxShadow:"var(--shadow-card)", animation:"fadeInUp .3s both" }}>
            <div style={{ fontSize:34, fontWeight:900, color:"var(--color-text)", lineHeight:1 }}>{s.value}</div>
            <div style={{ fontSize:11, color:"var(--color-text-secondary)", fontFamily:"Barlow,sans-serif", marginTop:4, textTransform:"uppercase", letterSpacing:.5 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {attentionItems.length > 0 && (
        <div style={{ marginBottom:28 }}>
          <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:"var(--color-text-secondary)", marginBottom:10 }}>Aandachtspunten</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {attentionItems.map((it, i) => (
              <div key={i} onClick={it.action} style={{ background:"var(--color-surface)", border:`1px solid ${it.type==="warn"?"var(--color-danger)":primaryColor}33`, borderLeft:`3px solid ${it.type==="warn"?"var(--color-danger)":primaryColor}`, borderRadius:"var(--radius-row)", padding:"10px 16px", display:"flex", alignItems:"center", gap:10, cursor:"pointer", fontSize:13, fontFamily:"Barlow,sans-serif" }}>
                <it.icon size={16} strokeWidth={1.8} style={{ color:it.type==="warn"?"var(--color-danger)":primaryColor, flexShrink:0 }} />
                <span style={{ flex:1 }}>{it.text}</span>
                <ChevronRight size={16} style={{ color:"var(--color-text-muted)" }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {nextEvent && (
        <div style={{ marginBottom:28 }}>
          <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:"var(--color-text-secondary)", marginBottom:10 }}>Eerstvolgende event</div>
          <div onClick={()=>onSelectEvent(nextEvent)} style={{ background:"var(--color-surface)", border:`1px solid ${primaryColor}33`, borderRadius:"var(--radius-card)", padding:"16px 20px", cursor:"pointer", boxShadow:"var(--shadow-card)", animation:"fadeInUp .3s .1s both" }}>
            <div style={{ fontSize:18, fontWeight:800, textTransform:"uppercase" }}>{nextEvent.title}</div>
            <div style={{ fontSize:13, color:"var(--color-text-secondary)", fontFamily:"Barlow,sans-serif", marginTop:4 }}>{formatDate(nextEvent.start_time)}{nextEvent.location?` · ${nextEvent.location}`:""}</div>
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
            <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:"var(--color-text-secondary)" }}>Bardienstrooster</div>
            <button className="btn-sm" onClick={()=>onGoTab("bardienst")} style={{ fontSize:11 }}>Alles →</button>
          </div>
          {upcomingBardienst.length === 0 ? (
            <div style={{ fontSize:13, color:"var(--color-text-secondary)", fontFamily:"Barlow,sans-serif" }}>Geen komende bardiensten gepland</div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {upcomingBardienst.map(b => (
                <div key={b.id} style={{ background:"var(--color-surface)", border:"1px solid var(--color-border)", borderRadius:"var(--radius-row)", padding:"8px 12px", fontSize:13, fontFamily:"Barlow,sans-serif" }}>
                  <strong style={{ fontFamily:"'Saira Condensed',sans-serif" }}>{formatDate(b.shift_date)}</strong> — {b.names}
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
            <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:"var(--color-text-secondary)" }}>Laatste mededelingen</div>
            <button className="btn-sm" onClick={()=>onGoTab("nieuws")} style={{ fontSize:11 }}>Alles →</button>
          </div>
          {recentNews.length === 0 ? (
            <div style={{ fontSize:13, color:"var(--color-text-secondary)", fontFamily:"Barlow,sans-serif" }}>Nog geen mededelingen geplaatst</div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {recentNews.map(n => (
                <div key={n.id} style={{ background:"var(--color-surface)", border:"1px solid var(--color-border)", borderRadius:"var(--radius-row)", padding:"8px 12px", fontSize:13, fontFamily:"Barlow,sans-serif", display:"flex", alignItems:"center", gap:6 }}>
                  {n.pinned && <Pin size={12} strokeWidth={2} style={{ color:"var(--color-accent)", flexShrink:0 }} />}<strong style={{ fontFamily:"'Saira Condensed',sans-serif" }}>{n.title}</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {recentIdeas.length > 0 && (
        <div style={{ marginBottom:28 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
            <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:"var(--color-text-secondary)" }}>Nieuwste ideeën</div>
            <button className="btn-sm" onClick={()=>onGoTab("ideeen")} style={{ fontSize:11 }}>Alles →</button>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {recentIdeas.map(idea => (
              <div key={idea.id} style={{ background:"var(--color-surface)", border:"1px solid var(--color-border)", borderLeft:"3px solid #2a9d8f", borderRadius:"var(--radius-row)", padding:"10px 14px", fontSize:13, fontFamily:"Barlow,sans-serif" }}>
                <div style={{ fontWeight:700, color:"#2a9d8f", marginBottom:2 }}>{idea.name || "Anoniem"}</div>
                <div style={{ color:"var(--color-text-secondary)" }}>{idea.message.length>120?idea.message.slice(0,120)+"…":idea.message}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))", gap:20, marginBottom:28 }}>
        <div>
          <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:"var(--color-text-secondary)", marginBottom:12 }}>Verdeling per categorie</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {allCategories.map(cat => {
              const cc = categoryColors[cat]||primaryColor;
              const count = nonArchived.filter(e=>e.category===cat).length;
              const pct = nonArchived.length ? (count/nonArchived.length)*100 : 0;
              return (
                <div key={cat} style={{ display:"flex", alignItems:"center", gap:12 }}>
                  <div style={{ width:90, fontSize:12, color:cc, fontWeight:700, textTransform:"uppercase", flexShrink:0 }}>{cat}</div>
                  <div style={{ flex:1, height:6, background:"var(--color-border)", borderRadius:3, overflow:"hidden" }}>
                    <div style={{ height:"100%", width:`${pct}%`, background:cc, borderRadius:3, transition:"width .6s ease" }} />
                  </div>
                  <div style={{ width:20, fontSize:13, fontWeight:700, color:cc, textAlign:"right", flexShrink:0 }}>{count}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:"var(--color-text-secondary)", marginBottom:12 }}>Meest actieve leden</div>
          {topAttendees.length === 0 ? (
            <div style={{ fontSize:13, color:"var(--color-text-secondary)", fontFamily:"Barlow,sans-serif" }}>Nog geen aanmeldingen</div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {topAttendees.map(([name, count]) => (
                <div key={name} style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ flex:1, fontSize:13, fontFamily:"Barlow,sans-serif" }}>{name}</div>
                  <span style={{ fontSize:12, background:primaryColor+"22", color:primaryColor, borderRadius:"var(--radius-pill)", padding:"1px 9px", fontWeight:700 }}>{count}×</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))", gap:10 }}>
        <div style={{ background:"var(--color-surface)", border:"1px solid var(--color-border)", borderRadius:"var(--radius-card)", padding:16, boxShadow:"var(--shadow-card)" }}>
          <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:"var(--color-text-secondary)", marginBottom:10 }}>Financieel (komend)</div>
          <div style={{ fontSize:28, fontWeight:900, color:"var(--color-success)" }}>€{totalUpcomingCost.toFixed(2)}</div>
          <div style={{ fontSize:12, color:"var(--color-text-secondary)", fontFamily:"Barlow,sans-serif" }}>totaal aan deelnamekosten</div>
          <div style={{ fontSize:12, color:"var(--color-text-secondary)", fontFamily:"Barlow,sans-serif", marginTop:6 }}>{sponsoredCount} event{sponsoredCount===1?"":"s"} met sponsor</div>
        </div>
        <div style={{ background:"var(--color-surface)", border:"1px solid var(--color-border)", borderRadius:"var(--radius-card)", padding:16, boxShadow:"var(--shadow-card)" }}>
          <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:"var(--color-text-secondary)", marginBottom:10 }}>Beheerders</div>
          <div style={{ fontSize:28, fontWeight:900, color:primaryColor }}>{pinsList.length}</div>
          <div style={{ fontSize:12, color:"var(--color-text-secondary)", fontFamily:"Barlow,sans-serif" }}>{pinsByRole.super} beheerder, {pinsByRole.editor} redacteur, {pinsByRole.viewer} bekijker</div>
          <button className="btn-sm" onClick={onOpenSettings} style={{ marginTop:8 }}>Beheren</button>
        </div>
      </div>
    </div>
  );
}
