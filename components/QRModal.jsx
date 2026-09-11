import { formatDate } from "../lib/dates.js";

// ---- QR MODAL ----
export default function QRModal({ event, onClose, primaryColor }) {
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
