import { useRef } from "react";
import { ImageIcon, Trash2, X } from "lucide-react";

// ---- FOTOBIBLIOTHEEK ----
export function PhotoLibraryGrid({ photos, uploadingPhoto, canEdit, onUpload, onDelete, onPick, emptyHint }) {
  const fileInputRef = useRef(null);
  return (
    <div>
      {canEdit && (
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16, flexWrap:"wrap" }}>
          <button className="btn-red" type="button" disabled={uploadingPhoto} onClick={()=>fileInputRef.current?.click()}>
            {uploadingPhoto ? "Uploaden..." : "+ Foto uploaden"}
          </button>
          <span style={{ fontSize:12, color:"var(--color-text-secondary)", fontFamily:"Barlow,sans-serif" }}>JPG, PNG of WebP — wordt automatisch verkleind</span>
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display:"none" }} onChange={e=>{ const f=e.target.files?.[0]; if (f) onUpload(f); e.target.value=""; }} />
        </div>
      )}
      {photos.length === 0 ? (
        <div style={{ textAlign:"center", padding:60 }}>
          <ImageIcon size={44} strokeWidth={1.5} style={{ color:"var(--color-text-muted)", marginBottom:16 }} />
          <div style={{ color:"var(--color-text-secondary)", fontSize:14, letterSpacing:1, textTransform:"uppercase" }}>{emptyHint || "Nog geen foto's geüpload"}</div>
        </div>
      ) : (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(120px,1fr))", gap:10 }}>
          {photos.map(p => (
            <div
              key={p.name}
              onClick={()=>onPick && onPick(p.url)}
              style={{ position:"relative", borderRadius:10, overflow:"hidden", border:"1px solid var(--color-border)", aspectRatio:"1", background:"#f2f0ea", cursor:onPick?"pointer":"default" }}
            >
              <img src={p.url} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} loading="lazy" />
              {canEdit && (
                <button
                  type="button"
                  onClick={e=>{ e.stopPropagation(); onDelete(p.name); }}
                  aria-label="Foto verwijderen"
                  style={{ position:"absolute", top:6, right:6, width:26, height:26, borderRadius:"50%", border:"none", background:"#000000aa", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}
                >
                  <Trash2 size={13} strokeWidth={2} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function PhotoPickerModal({ photos, uploadingPhoto, canEdit, onUpload, onSelect, onDelete, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth:640 }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
          <h2 style={{ fontSize:20, fontWeight:900, textTransform:"uppercase" }}>Kies een foto</h2>
          <button type="button" className="btn-ghost" onClick={onClose} style={{ padding:8 }} aria-label="Sluiten"><X size={18} /></button>
        </div>
        <PhotoLibraryGrid
          photos={photos}
          uploadingPhoto={uploadingPhoto}
          canEdit={canEdit}
          onUpload={async f => { const url = await onUpload(f); if (url) onSelect(url); }}
          onDelete={onDelete}
          onPick={onSelect}
          emptyHint="Nog geen foto's — upload er eentje"
        />
      </div>
    </div>
  );
}
