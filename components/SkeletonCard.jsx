// ---- SKELETON CARD ----
export default function SkeletonCard({ delay = 0 }) {
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
