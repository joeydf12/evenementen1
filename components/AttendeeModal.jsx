import { useState } from "react";
import { X } from "lucide-react";
import { formatDate } from "../lib/dates.js";
import { loadLS, saveLS } from "../lib/storage.js";

// ---- ATTENDEE MODAL ----
export default function AttendeeModal({ event, attendees, onClose, onRegister, onRemove, primaryColor }) {
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
            : <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>{list.map((a,i)=>(
                <span key={a.id||i} style={{ display:"inline-flex", alignItems:"center", gap:6, background:"#ebe8df", border:"1px solid #e7e4da", borderRadius:20, padding:onRemove?"4px 6px 4px 12px":"4px 12px", fontSize:13, fontFamily:"Barlow,sans-serif" }}>
                  {a.attendee_name}
                  {onRemove && (
                    <button type="button" onClick={()=>onRemove(a.id)} aria-label={`${a.attendee_name} verwijderen`}
                      style={{ border:"none", cursor:"pointer", background:"#00000014", color:"#56554d", width:18, height:18, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, padding:0 }}>
                      <X size={11} strokeWidth={2.5} />
                    </button>
                  )}
                </span>
              ))}</div>
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
