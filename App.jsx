import { useState, useEffect, useRef } from "react";
import { Home, CalendarDays, Beer, Archive, Lightbulb, Settings, Search, SlidersHorizontal, X, Printer, Clock, MapPin, Users, Euro, ChevronRight, Repeat, Trophy, Megaphone, Pin, Shirt, StickyNote, Trash2, CheckCircle2 } from "lucide-react";
import clubLogo from "./images/logohhc.jpg";
import headerBanner from "./images/header-banner.png";

import { loadLS, saveLS } from "./lib/storage.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, sb, adminApi, getStoredSession } from "./lib/supabase.js";
import {
  MONTHS_NL, DAYS_NL, formatDate, formatTime, isTimeSet, isMultiDay, dayInRange, formatRange, formatRangeCompact,
  toDatetimeLocalStr, localToUtcIso, computeRecurrenceStarts, isUpcoming, daysUntil, toDateStr,
  getNextThursday, getWeekStart, getCalendarDays,
} from "./lib/dates.js";
import { isDirty, contrastWithWhite, handleModalFocus, downloadICS, resizeImageToBase64 } from "./lib/utils.js";

import NavIcon from "./components/NavIcon.jsx";
import SkeletonCard from "./components/SkeletonCard.jsx";
import QRModal from "./components/QRModal.jsx";
import AttendeeModal from "./components/AttendeeModal.jsx";
import WeatherWidget from "./components/WeatherWidget.jsx";
import AdminDashboard from "./components/AdminDashboard.jsx";
import { PhotoLibraryGrid, PhotoPickerModal } from "./components/PhotoLibrary.jsx";
import { WeekView, YearView } from "./components/CalendarViews.jsx";

const BASE_CATEGORIES = ["Evenement", "Vergadering", "Overig"];
const DEFAULT_COLORS = { Evenement:"#F18C21", Vergadering:"#2E3192", Overig:"#2FA8D8" };
const ROLE_LABELS = { viewer:"Bekijker", editor:"Redacteur", super:"Beheerder" };
const DEFAULT_CHECKLIST_ITEMS = ["Bier/frisdrank aangevuld", "Kleingeld/kassa gecontroleerd", "Voorraad koffie/thee", "Afsluiten & apparatuur uit"]; // nieuw #38

// ---- MAIN COMPONENT ----
export default function HHCEvents() {
  const [events, setEvents] = useState([]);
  const [attendees, setAttendees] = useState({});
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [tab, setTab] = useState("home");
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
  const [detailTab, setDetailTab] = useState("details");
  useEffect(() => { if (selectedEvent) setDetailTab("details"); }, [selectedEvent?.id]);
  const [showQR, setShowQR] = useState(null);
  const [showAttendees, setShowAttendees] = useState(null);
  const [calDate, setCalDate] = useState(() => { const d=new Date(); return {year:d.getFullYear(),month:d.getMonth()}; });
  const [calView, setCalView] = useState("month");
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const [statsYear, setStatsYear] = useState(new Date().getFullYear());
  const [archiefView, setArchiefView] = useState("afgelopen");
  const [showFilters, setShowFilters] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [toast, setToast] = useState(null);

  // Search & filters
  const [searchInput, setSearchInput] = useState(""); // verbetering #9: ruwe invoer, gedebouncet naar searchQuery
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [locationFilter, setLocationFilter] = useState("Alles");

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
  const [showMoreSheet, setShowMoreSheet] = useState(false);
  const [ideaName, setIdeaName] = useState("");
  const [ideaMessage, setIdeaMessage] = useState("");
  const [submittingIdea, setSubmittingIdea] = useState(false);

  // Fotobibliotheek
  const [photos, setPhotos] = useState([]);
  const [photosLoaded, setPhotosLoaded] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoPicker, setPhotoPicker] = useState(null); // { onSelect(url) } terwijl de kies-modal open staat

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

  async function loadPhotos() {
    const res = await adminApi({ action:"photos", op:"list", token:adminToken });
    if (res.ok) { setPhotos(res.data?.data || []); setPhotosLoaded(true); }
    else if (res.status === 401) sessionExpired();
  }

  useEffect(() => { if (adminMode && adminToken && !photosLoaded) loadPhotos(); }, [adminMode]);

  async function handleUploadPhoto(file) {
    if (!file || !file.type?.startsWith("image/")) { showToast("Kies een afbeeldingsbestand", "error"); return null; }
    setUploadingPhoto(true);
    try {
      const { base64, contentType } = await resizeImageToBase64(file);
      const res = await adminApi({ action:"photos", op:"upload", token:adminToken, filename:file.name, contentType, dataBase64:base64 });
      if (res.ok) {
        const item = { name:res.data.data.name, url:res.data.data.url, created_at:new Date().toISOString() };
        setPhotos(p => [item, ...p]);
        showToast("Foto geüpload");
        return item.url;
      }
      if (res.status === 401) sessionExpired(); else showToast(res.data?.error || "Upload mislukt", "error");
      return null;
    } catch {
      showToast("Upload mislukt", "error");
      return null;
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleDeletePhoto(name) {
    if (!confirm("Foto verwijderen uit de bibliotheek?")) return;
    const res = await adminApi({ action:"photos", op:"remove", token:adminToken, name });
    if (res.ok) { setPhotos(p => p.filter(ph=>ph.name!==name)); showToast("Foto verwijderd"); }
    else if (res.status === 401) sessionExpired();
    else showToast(res.data?.error || "Kon foto niet verwijderen", "error");
  }

  function openPhotoPicker(onSelect) {
    if (!photosLoaded) loadPhotos();
    setPhotoPicker({ onSelect });
  }

  function choosePhoto(url) {
    if (photoPicker?.onSelect) photoPicker.onSelect(url);
    setPhotoPicker(null);
  }

  async function handleSave() {
    if (!form.title || !form.start_time) return;
    setSaving(true);
    const payload = { ...form, start_time:localToUtcIso(form.start_time), cost:form.cost ? parseFloat(form.cost) : null, end_time:localToUtcIso(form.end_time), series_id:form.series_id || null };

    // Nieuw #1: terugkerende events -- alleen bij het aanmaken van een nieuw event.
    // Genereert losse rijen (elk gewoon een normaal event) i.p.v. herhaling on-the-fly te berekenen,
    // zodat aanmeldingen/QR/bardienst per instantie los blijven werken zoals bij elk ander event.
    if (!editingEvent && recurrence.freq !== "none") {
      const starts = computeRecurrenceStarts(form.start_time, recurrence.freq, recurrence.until, recurrence.count);
      const durationMs = form.end_time ? (new Date(form.end_time) - new Date(form.start_time)) : null;
      const ruleForDisplay = { freq:recurrence.freq, until:recurrence.until||null, count:starts.length };

      const firstPayload = { ...payload, start_time:starts[0].toISOString(), end_time:durationMs!=null?new Date(starts[0].getTime()+durationMs).toISOString():null, recurrence_rule:ruleForDisplay };
      const firstRes = await adminWrite("events", "POST", null, firstPayload);
      if (!firstRes.ok) { setSaving(false); return; }
      const parentId = firstRes.data?.[0]?.id;

      for (const d of starts.slice(1)) {
        const childPayload = { ...payload, start_time:d.toISOString(), end_time:durationMs!=null?new Date(d.getTime()+durationMs).toISOString():null, recurrence_rule:ruleForDisplay, recurrence_parent_id:parentId||null };
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
    const f = { title:ev.title, description:ev.description||"", location:ev.location||"", start_time:ev.start_time?toDatetimeLocalStr(new Date(ev.start_time)):"", end_time:ev.end_time?toDatetimeLocalStr(new Date(ev.end_time)):"", category:ev.category||"Evenement", is_public:ev.is_public!==false, hidden:ev.hidden||false, sponsor_name:ev.sponsor_name||"", sponsor_logo:ev.sponsor_logo||"", image_url:ev.image_url||"", cost:ev.cost!=null?String(ev.cost):"", series_id:ev.series_id||"" };
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
      setPinError(res.status===429 ? (res.data?.error||"Te veel pogingen, probeer het straks opnieuw") : true);
    }
  }

  function logout() {
    adminApi({ action:"logout", token:adminToken });
    setAdminMode(false); setAdminRole(null); setAdminToken(null);
    saveLS("hhc09_admin_session", null);
    if (["statistieken","dashboard","ideeen"].includes(tab)) setTab("home");
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
    { id:"home", label:"Home" },
    { id:"agenda", label:"Agenda" },
    { id:"nieuws", label:"Nieuws" },
    { id:"bardienst", label:"Bardienst" },
    { id:"archief", label:"Archief" },
    ...(adminMode ? [
      { id:"statistieken", label:"Stats" },
      { id:"dashboard", label:"Dashboard" },
      { id:"ideeen", label:`Ideeën${ideas.length?` (${ideas.length})`:""}` },
      { id:"fotos", label:"Foto's" },
    ] : []),
  ];

  // Mobiele bottom nav toont max. 5 items; de rest (+ het idee-formulier) zit achter "Meer".
  const PRIMARY_NAV_IDS = ["home", "agenda", "nieuws", "bardienst"];
  const primaryNavTabs = tabList.filter(t => PRIMARY_NAV_IDS.includes(t.id));
  const moreNavTabs = tabList.filter(t => !PRIMARY_NAV_IDS.includes(t.id));

  const TAB_HEADERS = {
    home: { title:"Home", subtitle:"Wat staat er op de planning?" },
    agenda: { title:"Agenda", subtitle:"Overzicht van alle events en activiteiten." },
    nieuws: { title:"Nieuws", subtitle:"Blijf op de hoogte van het laatste clubnieuws." },
    bardienst: { title:"Bardienst", subtitle:"Samen houden we de bar draaiende!" },
    archief: { title:"Archief", subtitle:"Afgelopen events en meer." },
    statistieken: { title:"Statistieken", subtitle:"Cijfers over de agenda." },
    dashboard: { title:"Dashboard", subtitle:"In één oogopslag het overzicht." },
    ideeen: { title:"Ideeënbus", subtitle:"Deel je idee met de spelerscommissie." },
    fotos: { title:"Foto's", subtitle:"Bibliotheek met afbeeldingen voor events, nieuws en sponsors." },
  };

  return (
    <div style={{ minHeight:"100vh", background:"#F5F7FB", color:"#172033", fontFamily:"'Saira Condensed','Arial Narrow',Arial,sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Saira+Condensed:ital,wght@0,600;0,700;0,800;0,900;1,700;1,800;1,900&family=Barlow:wght@400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        :root{
          --color-primary:#2E3192; --color-primary-hover:#23256E;
          --color-accent:#F18C21; --color-accent-hover:#DB7A12;
          --color-bg:#F5F7FB; --color-surface:#ffffff; --color-surface-muted:#EEF1F8;
          --color-border:#E4E7EF; --color-text:#172033; --color-text-secondary:#667085; --color-text-muted:#98A2B3;
          --color-success:#20A464; --color-warning:#F59E0B; --color-danger:#DC3545;
          --radius-card:16px; --radius-card-featured:20px; --radius-row:14px; --radius-input:11px; --radius-pill:999px;
          --shadow-card:0 2px 6px rgba(16,24,40,.04),0 8px 24px rgba(16,24,40,.06);
          --shadow-card-hover:0 4px 10px rgba(16,24,40,.05),0 14px 32px rgba(16,24,40,.08);
          --shadow-nav:0 -2px 10px rgba(16,24,40,.06);
          --shadow-modal:0 24px 64px rgba(16,24,40,.18);
          --motion-fast:150ms ease-out; --motion-base:180ms ease-out; --motion-sheet:220ms cubic-bezier(.16,1,.3,1);
        }
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:${primaryColor};border-radius:2px}
        @keyframes fadeInUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(200%)}}
        @keyframes sheetUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
        button,.input,select.input{font-family:inherit}
        :focus-visible{outline:2px solid var(--color-accent);outline-offset:2px}
        .ev-card{background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-card);padding:18px 20px;cursor:pointer;transition:box-shadow var(--motion-base),transform var(--motion-base);position:relative;overflow:hidden;animation:fadeInUp .25s ease both;box-shadow:var(--shadow-card)}
        .ev-card:hover{box-shadow:var(--shadow-card-hover);transform:translateY(-2px)}
        .ev-card.hidden-ev{opacity:.5;border-style:dashed}
        .ev-card.drag-over{border-top:2px solid ${primaryColor};transform:translateY(-2px)}
        .ev-card.dragging{opacity:.45;transform:scale(.98);box-shadow:none;cursor:grabbing}
        .filter-btn{background:#fff;border:1.5px solid var(--color-border);color:var(--color-text-secondary);padding:8px 18px;border-radius:var(--radius-pill);cursor:pointer;font-family:'Saira Condensed',sans-serif;font-size:13px;font-weight:700;letter-spacing:.5px;transition:all var(--motion-base);text-transform:uppercase}
        .filter-btn.active{background:var(--fc,${primaryColor});border-color:var(--fc,${primaryColor});color:white}
        .filter-btn:hover:not(.active){border-color:var(--fc,${primaryColor});color:var(--fc,${primaryColor})}
        .badge{display:inline-block;padding:3px 10px;border-radius:var(--radius-pill);font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase}
        .modal-overlay{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:100;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(6px);animation:fadeIn .15s ease}
        .modal{background:var(--color-surface);border:1px solid var(--color-border);border-radius:20px;padding:32px;width:100%;max-width:520px;max-height:90vh;max-height:90dvh;overflow-y:auto;box-shadow:var(--shadow-modal)}
        .modal-actions-sticky{position:sticky;bottom:-32px;margin:8px -32px -32px;padding:14px 32px;background:var(--color-surface);border-top:1px solid var(--color-border)}
        .modal-drag-handle{display:none}
        .input{background:var(--color-surface);border:1px solid var(--color-border);color:var(--color-text);padding:12px 16px;border-radius:var(--radius-input);font-size:16px;width:100%;min-height:46px;transition:border-color var(--motion-base),box-shadow var(--motion-base);min-width:0}
        .input:focus{outline:none;border-color:${primaryColor};box-shadow:0 0 0 3px ${primaryColor}26}
        .btn-red{background:var(--color-accent);color:white;border:none;padding:12px 26px;border-radius:var(--radius-pill);font-family:'Saira Condensed',sans-serif;font-size:16px;font-weight:800;font-style:italic;letter-spacing:.5px;text-transform:uppercase;cursor:pointer;transition:all var(--motion-base);min-height:44px}
        .btn-red:hover{background:var(--color-accent-hover)}
        .btn-red:active{transform:scale(.98)}
        .btn-ghost{background:transparent;color:var(--color-text-secondary);border:1px solid var(--color-border);padding:10px 20px;border-radius:var(--radius-pill);font-size:14px;cursor:pointer;transition:all var(--motion-base)}
        .btn-ghost:hover{border-color:var(--color-text-muted);color:var(--color-text)}
        .btn-ghost-onbrand{background:#ffffff;color:var(--color-primary);border:1px solid var(--color-border);padding:10px 20px;border-radius:var(--radius-pill);font-size:14px;cursor:pointer;transition:all var(--motion-base)}
        .btn-ghost-onbrand:hover{border-color:var(--color-primary)}
        .btn-sm{background:var(--color-surface-muted);border:1px solid var(--color-border);color:var(--color-text-secondary);padding:6px 14px;border-radius:var(--radius-pill);cursor:pointer;font-size:12px;transition:all var(--motion-fast)}
        .btn-sm:hover{color:var(--color-text);border-color:var(--color-text-muted)}
        .pill-tab{background:transparent;border:1px solid var(--color-border);color:#56554d;padding:9px 18px;border-radius:var(--radius-pill);cursor:pointer;font-family:'Saira Condensed',sans-serif;font-size:14px;font-weight:800;font-style:italic;letter-spacing:.5px;text-transform:uppercase;transition:all var(--motion-base);white-space:nowrap;flex-shrink:0}
        .pill-tab.active{background:var(--color-primary);border-color:var(--color-primary);color:#fff}
        .pill-tab:hover:not(.active){border-color:var(--color-primary);color:var(--color-primary)}
        .admin-corner{display:flex;align-items:center;gap:8px}
        .bottom-nav{display:none}
        .bottom-nav-btn{flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 4px 6px;background:transparent;border:none;color:var(--color-text-muted);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.3px;cursor:pointer;white-space:nowrap}
        .bottom-nav-btn .bn-icon{display:flex;align-items:center;justify-content:center;height:26px;width:40px;border-radius:12px;transition:background var(--motion-base)}
        .bottom-nav-btn.active{color:var(--color-accent)}
        .bottom-nav-btn.active .bn-icon{background:var(--color-accent);background:color-mix(in srgb, var(--color-accent) 14%, transparent)}
        .sheet-overlay{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:100;display:flex;align-items:flex-end;justify-content:center;backdrop-filter:blur(6px);animation:fadeIn .15s ease}
        .sheet{background:var(--color-surface);border-radius:20px 20px 0 0;padding:8px 20px 24px;width:100%;max-width:560px;max-height:85vh;max-height:85dvh;overflow-y:auto;box-shadow:var(--shadow-modal);animation:sheetUp var(--motion-sheet) both}
        .sheet-handle{width:36px;height:4px;border-radius:2px;background:var(--color-border);margin:0 auto 16px}
        .sheet-item{display:flex;align-items:center;gap:14px;width:100%;background:transparent;border:none;padding:13px 4px;font-family:'Saira Condensed',sans-serif;font-size:16px;font-weight:700;text-transform:uppercase;color:var(--color-text);cursor:pointer;border-bottom:1px solid var(--color-border);text-align:left}
        .sheet-item:last-child{border-bottom:none}
        .sheet-item:hover{color:var(--color-accent)}
        .filter-pill-input{display:inline-block}
        .filter-pill-input input,.filter-pill-input select{background:var(--color-surface);border:1.5px solid var(--color-border);color:var(--color-text-secondary);padding:7px 14px 7px 32px;border-radius:var(--radius-pill);font-family:'Saira Condensed',sans-serif;font-size:13px;font-weight:700;cursor:pointer;height:auto;min-height:0}
        .cal-day{min-height:70px;padding:4px 2px}
        .cal-dot{font-size:10px;font-weight:700;padding:2px 5px;border-radius:3px;margin-top:4px;display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;cursor:pointer}
        select.input option{background:#ffffff}
        .settings-row{display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--color-border)}
        .stat-bar{background:${primaryColor};border-radius:4px 4px 0 0;min-width:8px;transition:height .5s ease}
        .toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-pill);padding:12px 24px;font-size:14px;font-weight:700;z-index:999;animation:fadeInUp .2s ease;box-shadow:var(--shadow-card-hover);white-space:nowrap}
        @media print{nav,header,.no-print{display:none!important}body{background:white;color:black}.ev-card{border:1px solid #ccc;break-inside:avoid;margin-bottom:8px}.print-title{display:block!important}}
        .print-title{display:none}
        .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
        .grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
        @media (max-width:600px), (max-height:480px) and (pointer:coarse){
          .grid-2,.grid-3{grid-template-columns:1fr}
          .modal{padding:22px 18px}
          .modal-actions-sticky{margin:8px -18px -22px;padding:12px 18px}
          .btn-ghost-onbrand,.btn-ghost,.btn-red{padding:9px 16px;font-size:13px}
          .btn-sm{padding:7px 12px;font-size:12px;min-height:32px}
          .ev-card{padding:14px 16px}
          .desktop-tabs,.header-chevron{display:none!important}
          .admin-corner{gap:6px}
          .admin-corner .btn-ghost-onbrand{padding:7px 11px;font-size:11px}
          main{padding-bottom:92px!important}
          .bottom-nav{display:flex;position:fixed;bottom:0;left:0;right:0;background:#ffffff;border-top:1px solid var(--color-border);z-index:90;padding-bottom:env(safe-area-inset-bottom,0);box-shadow:var(--shadow-nav)}
          .modal-overlay.sheet-mode{align-items:flex-end;padding:0}
          .modal.sheet-mode{border-radius:20px 20px 0 0;max-width:100%;width:100%;animation:sheetUp var(--motion-sheet) both}
          .modal.sheet-mode .modal-drag-handle{display:block;width:36px;height:4px;border-radius:2px;background:var(--color-border);margin:10px auto 0}
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
      <header className="no-print" style={{ background:"#f3f1ea", borderBottom:"1px solid #ebe8df" }}>
        <div style={{ position:"relative", height:170, overflow:"hidden" }}>
          <img src={headerBanner} alt="" style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover" }} />
          <div style={{ position:"absolute", inset:0, background:"linear-gradient(180deg, rgba(15,20,35,.4) 0%, rgba(15,20,35,.5) 45%, #f3f1ea 100%)" }} />
          <div style={{ position:"relative", maxWidth:960, margin:"0 auto", padding:"16px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, minWidth:0 }}>
              <img
                src={clubSettings.logo || clubLogo}
                alt="logo"
                style={{ height:38, width:38, borderRadius:"50%", background:"#fff", padding:2, objectFit:"contain", flexShrink:0, border:"2px solid #ffffffcc" }}
                onError={e=>{ e.target.onerror=null; e.target.src=clubLogo; }}
              />
              <div style={{ minWidth:0 }}>
                <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:900, fontStyle:"italic", fontSize:17, lineHeight:1, color:"#fff", textTransform:"uppercase", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{clubSettings.name}</div>
                <div style={{ fontSize:11, color:"#ffffffcc", fontFamily:"Barlow,sans-serif", marginTop:3 }}>{clubSettings.subtitle}</div>
              </div>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0, flexWrap:"wrap", justifyContent:"flex-end" }}>
              <button onClick={()=>setTab("home")} aria-label="Zoeken" style={{ background:"rgba(255,255,255,.16)", border:"none", color:"#fff", width:36, height:36, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}><Search size={16} strokeWidth={1.8} /></button>
              {adminMode ? (
                <>
                  <span style={{ fontSize:11, color:"#fff", background:"#ffffff33", padding:"3px 10px", borderRadius:999, fontWeight:700, textTransform:"uppercase" }}>{ROLE_LABELS[adminRole]||"Admin"}</span>
                  {canEdit && <button className="btn-red" onClick={openNew} style={{ fontSize:13, padding:"9px 16px" }}>+ Nieuw</button>}
                  {canSettings && <button onClick={()=>setShowSettings(true)} aria-label="Instellingen" style={{ background:"rgba(255,255,255,.16)", border:"none", color:"#fff", width:36, height:36, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}><Settings size={16} strokeWidth={1.8} /></button>}
                  <button onClick={logout} style={{ background:"rgba(255,255,255,.16)", border:"none", color:"#fff", padding:"9px 14px", borderRadius:"var(--radius-pill)", fontSize:12, cursor:"pointer", fontFamily:"Barlow,sans-serif" }}>Uitloggen</button>
                </>
              ) : (
                <button onClick={()=>{ setShowPinModal(true); setPinInput(""); setPinError(false); }} aria-label="Beheer" style={{ background:"rgba(255,255,255,.16)", border:"none", color:"#fff", width:36, height:36, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}><Settings size={16} strokeWidth={1.8} /></button>
              )}
            </div>
          </div>
        </div>

        {TAB_HEADERS[tab] && (
          <div style={{ maxWidth:960, margin:"-38px auto 0", padding:"0 20px 0", position:"relative" }}>
            <h1 style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:900, fontStyle:"italic", fontSize:"clamp(26px,5vw,38px)", letterSpacing:"-.5px", lineHeight:.95, textTransform:"uppercase", color:"#2E3192" }}>{TAB_HEADERS[tab].title}</h1>
            <div style={{ fontSize:13, color:"#76756f", fontFamily:"Barlow,sans-serif", marginTop:6 }}>{TAB_HEADERS[tab].subtitle}</div>
          </div>
        )}

        {/* Desktop pill tabs, attached to the header */}
        <div style={{ maxWidth:960, margin:"0 auto", padding:"0 20px" }}>
          <div className="desktop-tabs" style={{ display:"flex", gap:8, overflowX:"auto", marginTop:tab==="home"?12:20, paddingBottom:2 }}>
            {tabList.map(t => (
              <button key={t.id} className={`pill-tab ${tab===t.id?"active":""}`} onClick={()=>setTab(t.id)}>{t.label}</button>
            ))}
            <button className="pill-tab" onClick={()=>setShowIdeaForm(true)} style={{ marginLeft:"auto" }}>💡 Ik heb ideeën voor spelerscommissie</button>
          </div>
        </div>
      </header>

      {/* Mobile bottom navbar -- Home/Agenda/Nieuws/Bardienst + Meer */}
      <nav className="bottom-nav no-print">
        {primaryNavTabs.map(t => (
          <button key={t.id} className={`bottom-nav-btn ${tab===t.id?"active":""}`} onClick={()=>setTab(t.id)}>
            <span className="bn-icon"><NavIcon name={t.id} /></span>
            <span>{t.label}</span>
          </button>
        ))}
        <button className={`bottom-nav-btn ${moreNavTabs.some(t=>t.id===tab)?"active":""}`} onClick={()=>setShowMoreSheet(true)}>
          <span className="bn-icon"><NavIcon name="meer" /></span>
          <span>Meer</span>
        </button>
      </nav>

      {/* "Meer"-sheet: overige tabs + idee-formulier */}
      {showMoreSheet && (
        <div className="sheet-overlay no-print" onClick={()=>setShowMoreSheet(false)}>
          <div className="sheet" onClick={e=>e.stopPropagation()}>
            <div className="sheet-handle" />
            {moreNavTabs.map(t => (
              <button key={t.id} className="sheet-item" onClick={()=>{ setTab(t.id); setShowMoreSheet(false); }}>
                <NavIcon name={t.id} /> {t.label}
              </button>
            ))}
            <button className="sheet-item" onClick={()=>{ setShowIdeaForm(true); setShowMoreSheet(false); }}>
              <NavIcon name="idee" /> Idee voor spelerscommissie
            </button>
          </div>
        </div>
      )}

      <div className="print-title" style={{ padding:"20px 20px 0", fontSize:24, fontWeight:700 }}>{clubSettings.name} — {clubSettings.subtitle} — {MONTHS_NL[calDate.month]} {calDate.year}</div>

      {/* Search + filter bar -- alleen relevant voor de volledige eventlijst op Home */}
      {tab==="home" && (
      <div className="no-print" style={{ maxWidth:960, margin:"0 auto", padding:"16px 20px 0" }}>
        <div style={{ position:"relative", marginBottom:10 }}>
          <Search size={16} strokeWidth={1.8} style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", color:"var(--color-text-muted)", pointerEvents:"none" }} />
          <input className="input" value={searchInput} onChange={e=>setSearchInput(e.target.value)} placeholder="Zoek een event..." style={{ paddingLeft:40, borderRadius:"var(--radius-pill)" }} />
        </div>
        <button onClick={()=>setShowFilters(v=>!v)} className="no-print" style={{ display:"flex", alignItems:"center", justifyContent:"space-between", width:"100%", background:"var(--color-surface)", border:"1px solid var(--color-border)", borderRadius:"var(--radius-input)", padding:"11px 16px", cursor:"pointer", fontFamily:"'Saira Condensed',sans-serif", fontWeight:700, fontSize:14, color:"var(--color-text)", marginBottom:showFilters?14:0 }}>
          <span style={{ display:"flex", alignItems:"center", gap:8 }}><SlidersHorizontal size={16} strokeWidth={1.8} /> Filter{activeFilters?" (actief)":""}</span>
          <ChevronRight size={16} strokeWidth={1.8} style={{ transform:showFilters?"rotate(90deg)":"none", transition:"transform var(--motion-base)" }} />
        </button>
        {showFilters && (
        <div className="no-print">
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center", marginTop:14, marginBottom:14 }}>
          {["Alles",...allCategories].map(cat=>(
            <button key={cat} className={`filter-btn ${filter===cat?"active":""}`} style={{ "--fc":cat==="Alles"?primaryColor:(categoryColors[cat]||primaryColor), display:"inline-flex", alignItems:"center", gap:6 }} onClick={()=>setFilter(cat)}>
              {filter!==cat && <span style={{ width:8, height:8, borderRadius:"50%", background:cat==="Alles"?primaryColor:(categoryColors[cat]||primaryColor), flexShrink:0 }} />}
              {cat==="Alles" ? "Alle categorieën" : cat}
            </button>
          ))}
          <div className="filter-pill-input" style={{ position:"relative" }}>
            <CalendarDays size={13} strokeWidth={1.8} style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:"var(--color-text-secondary)", pointerEvents:"none" }} />
            <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} title="Vanaf datum" />
          </div>
          <div className="filter-pill-input" style={{ position:"relative" }}>
            <CalendarDays size={13} strokeWidth={1.8} style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:"var(--color-text-secondary)", pointerEvents:"none" }} />
            <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} title="Tot datum" />
          </div>
          <div className="filter-pill-input" style={{ position:"relative" }}>
            <MapPin size={13} strokeWidth={1.8} style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:"var(--color-text-secondary)", pointerEvents:"none" }} />
            <select value={locationFilter} onChange={e=>setLocationFilter(e.target.value)}>
              <option>Alles</option>
              {allLocations.map(l=><option key={l}>{l}</option>)}
            </select>
          </div>
          {activeFilters && <button className="btn-sm" onClick={()=>{ setSearchInput(""); setSearchQuery(""); setDateFrom(""); setDateTo(""); setLocationFilter("Alles"); }} style={{ display:"flex", alignItems:"center", gap:5 }}><X size={13} strokeWidth={2} /> Reset</button>}
        </div>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end", gap:12, flexWrap:"wrap", marginBottom:14 }}>
          <label style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer", fontSize:13, color:"var(--color-text-secondary)", fontFamily:"Barlow,sans-serif" }}>
            <input type="checkbox" checked={showPast} onChange={e=>setShowPast(e.target.checked)} style={{ accentColor:"var(--color-accent)" }} />
            Toon verleden
          </label>
          <button className="btn-sm no-print" onClick={()=>window.print()} style={{ display:"flex", alignItems:"center", gap:5 }}><Printer size={13} strokeWidth={1.8} /> Afdrukken</button>
        </div>
        </div>
        )}
      </div>
      )}

      <main style={{ maxWidth:960, margin:"0 auto", padding:"24px 20px 80px" }}>

        {/* AGENDA-LIJST (nu op Home) */}
        {tab==="home" && (
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
              <button className="btn-sm" onClick={()=>setSelectedEventIds(new Set())} style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:5 }}><X size={13} strokeWidth={2} /> Selectie wissen</button>
            </div>
          )}
          {loading
            ? <div style={{ display:"flex", flexDirection:"column", gap:10 }}>{[0,1,2].map(i=><SkeletonCard key={i} delay={i*0.07} />)}</div>
            : visibleEvents.length===0
              ? (
                <div style={{ textAlign:"center", padding:60 }}>
                  <CalendarDays size={44} strokeWidth={1.5} style={{ color:"var(--color-text-muted)", marginBottom:16 }} />
                  <div style={{ color:"var(--color-text-secondary)", fontSize:14, letterSpacing:1, textTransform:"uppercase" }}>Geen evenementen gevonden</div>
                  {activeFilters && (
                    <>
                      <div style={{ color:"var(--color-text-secondary)", fontSize:13, fontFamily:"Barlow,sans-serif", marginTop:8 }}>Niets gevonden met de huidige filters</div>
                      <button className="btn-sm" style={{ marginTop:14, display:"inline-flex", alignItems:"center", gap:5 }} onClick={()=>{ setSearchInput(""); setSearchQuery(""); setDateFrom(""); setDateTo(""); setLocationFilter("Alles"); setFilter("Alles"); }}><X size={13} strokeWidth={2} /> Filters wissen</button>
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
                            <div style={{ margin:"-18px -20px 14px", overflow:"hidden", borderRadius:"8px 8px 0 0" }}>
                              <img src={ev.image_url} alt={ev.title} style={{ width:"100%", height:"auto", display:"block" }} onError={e=>e.target.parentElement.style.display="none"} />
                            </div>
                          )}
                          <div style={{ display:"flex", alignItems:"center", gap:16 }}>
                            {canEdit && (
                              <input type="checkbox" checked={selectedEventIds.has(ev.id)} onClick={e=>e.stopPropagation()} onChange={()=>toggleEventSelected(ev.id)} style={{ width:18, height:18, accentColor:"var(--color-accent)", flexShrink:0, cursor:"pointer" }} title="Selecteren voor bulkactie" />
                            )}
                            <div style={{ background:cc, color:"#fff", borderRadius:12, width:60, height:60, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                              <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontSize:24, fontWeight:900, lineHeight:1 }}>{new Date(ev.start_time).getDate()}</div>
                              <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:1 }}>{new Date(ev.start_time).toLocaleDateString("nl-NL",{month:"short"})}</div>
                            </div>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6, flexWrap:"wrap" }}>
                                <span className="badge" style={{ background:cc+"22", color:cc }}>{ev.category}</span>
                                {ev.hidden && <span className="badge" style={{ background:"#76756f22", color:"#76756f" }}>Verborgen</span>}
                                {!past && daysUntil(ev.start_time)<=3 && <span className="badge" style={{ background:"#F18C2122", color:"#DB7A12" }}>{daysUntil(ev.start_time)===0?"Vandaag!":daysUntil(ev.start_time)===1?"Morgen":`${daysUntil(ev.start_time)}d`}</span>}
                                {ev.cost > 0 && <span style={{ fontSize:11, color:"var(--color-success)", fontFamily:"Barlow,sans-serif", display:"flex", alignItems:"center", gap:3 }}><Euro size={11} strokeWidth={2} /> {Number(ev.cost).toFixed(2)}</span>}
                                {ev.sponsor_name && <span style={{ fontSize:11, color:"var(--color-text-secondary)", fontFamily:"Barlow,sans-serif" }}>🤝 {ev.sponsor_name}</span>}
                              </div>
                              <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontSize:22, fontWeight:800, textTransform:"uppercase", lineHeight:1 }}>{ev.title}</div>
                              {ev.description && <div style={{ fontSize:14, color:"var(--color-text-secondary)", marginTop:4, fontFamily:"Barlow,sans-serif", lineHeight:1.4 }}>{ev.description.length>100?ev.description.slice(0,100)+"…":ev.description}</div>}
                              <div style={{ marginTop:8, display:"flex", gap:14, flexWrap:"wrap" }}>
                                {isTimeSet(ev) && <span style={{ fontSize:13, color:"var(--color-text-secondary)", fontFamily:"Barlow,sans-serif", display:"flex", alignItems:"center", gap:5 }}><Clock size={13} strokeWidth={1.8} /> {formatTime(ev.start_time)}{ev.end_time?` – ${formatTime(ev.end_time)}`:""}</span>}
                                {ev.location && <span style={{ fontSize:13, color:"var(--color-text-secondary)", fontFamily:"Barlow,sans-serif", display:"flex", alignItems:"center", gap:5 }}><MapPin size={13} strokeWidth={1.8} /> {ev.location}</span>}
                                <span style={{ fontSize:13, color:"var(--color-text-secondary)", fontFamily:"Barlow,sans-serif", display:"flex", alignItems:"center", gap:5 }}><Users size={13} strokeWidth={1.8} /> {(attendees[ev.id]||[]).length} aangemeld</span>
                              </div>
                              {ev.sponsor_logo && <img src={ev.sponsor_logo} alt={ev.sponsor_name} style={{ height:24, marginTop:8, objectFit:"contain" }} onError={e=>e.target.style.display="none"} />}
                            </div>
                            <ChevronRight size={20} strokeWidth={1.8} style={{ color:"var(--color-text-muted)", flexShrink:0 }} />
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
          {canEdit && visibleEvents.length>0 && (
            <button className="btn-red no-print" style={{ width:"100%", marginTop:10 }} onClick={openNew}>+ Event toevoegen</button>
          )}
          </>
        )}

        {/* NIEUWS */}
        {tab==="nieuws" && (
          <div>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, marginBottom:20, flexWrap:"wrap" }}>
              <span style={{ fontSize:13, color:"var(--color-text-secondary)", fontFamily:"Barlow,sans-serif" }}>{news.length} mededeling{news.length!==1?"en":""}</span>
              {canEdit && <button className="btn-red" onClick={openNewNews}>+ Mededeling plaatsen</button>}
            </div>
            {news.length === 0 ? (
              <div style={{ textAlign:"center", padding:60 }}>
                <Megaphone size={44} strokeWidth={1.5} style={{ color:"var(--color-text-muted)", marginBottom:16 }} />
                <div style={{ color:"var(--color-text-secondary)", fontSize:14, letterSpacing:1, textTransform:"uppercase" }}>Nog geen mededelingen</div>
                {canEdit && <button className="btn-red" style={{ marginTop:20 }} onClick={openNewNews}>Eerste mededeling plaatsen</button>}
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {news.map(n => (
                  <div key={n.id} className="ev-card" onClick={()=>setSelectedNews(n)} style={{ borderLeft:n.pinned?"4px solid var(--color-accent)":"1px solid var(--color-border)" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:16 }}>
                      {n.image_url ? (
                        <div style={{ width:60, height:60, borderRadius:12, overflow:"hidden", flexShrink:0 }}>
                          <img src={n.image_url} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} onError={e=>{ e.target.onerror=null; e.target.parentElement.style.display="none"; }} />
                        </div>
                      ) : (
                        <div style={{ width:60, height:60, borderRadius:12, background:n.pinned?"var(--color-accent)":"var(--color-primary)", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><Megaphone size={24} strokeWidth={1.8} /></div>
                      )}
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4, flexWrap:"wrap" }}>
                          {n.pinned && <span className="badge" style={{ background:"#F18C2122", color:"#DB7A12", display:"inline-flex", alignItems:"center", gap:4 }}><Pin size={10} strokeWidth={2} /> Vastgepind</span>}
                          <span style={{ fontSize:12, color:"var(--color-text-muted)" }}>{new Date(n.created_at).toLocaleDateString("nl-NL", { day:"numeric", month:"long", year:"numeric" })}</span>
                        </div>
                        <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontSize:20, fontWeight:800, textTransform:"uppercase", lineHeight:1.1, color:"var(--color-text)" }}>{n.title}</div>
                        <div style={{ fontSize:13, color:"var(--color-text-secondary)", marginTop:4, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{n.body}</div>
                      </div>
                      <ChevronRight size={20} strokeWidth={1.8} style={{ color:"var(--color-text-muted)", flexShrink:0 }} />
                    </div>
                    {canEdit && (
                      <div style={{ marginTop:12, display:"flex", gap:6 }} onClick={e=>e.stopPropagation()}>
                        <button className="btn-sm" onClick={()=>openEditNews(n)}>Bewerken</button>
                        {canDelete && <button className="btn-sm" onClick={()=>handleDeleteNews(n.id)} style={{ color:"var(--color-danger)" }}>Verwijderen</button>}
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
          // Vaste kleuren-spec voor deze pagina (los van de globale --color-primary/--color-accent
          // tokens, zodat een eventuele wijziging daarvan elders in de app dit vastgelegde
          // Bardienst-ontwerp niet per ongeluk meeverandert).
          const BD_NAVY = "#30329B";
          const BD_ORANGE = "#F7941D";
          const BD_SUCCESS = "#24A56A";
          const BD_SUCCESS_BG = "#E8F7EF";
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
            const shiftNames = b.names.split(",").map(n=>n.trim()).filter(Boolean);
            const noShowCount = shiftNames.filter(n => (b.attendance && b.attendance[n])==="no_show").length;
            const presentCount = shiftNames.length - noShowCount;
            return (
              <div key={b.id} className="ev-card" style={{ opacity:isPast?.5:1, cursor:"default", borderRadius:13, boxShadow:"0 2px 8px rgba(20,30,70,.06)" }}>
                <div style={{ display:"flex", alignItems:"center", gap:16 }}>
                  <div style={{ background:cc, color:"#fff", borderRadius:10, width:47, height:48, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                    <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontSize:20, fontWeight:900, lineHeight:1 }}>{d.getDate()}</div>
                    <div style={{ fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:1 }}>{d.toLocaleDateString("nl-NL",{month:"short"})}</div>
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    {team && (
                      <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:900, fontStyle:"italic", fontSize:15, color:team.color, textTransform:"uppercase", marginBottom:3, display:"flex", alignItems:"center", gap:6 }}>
                        <Shirt size={14} strokeWidth={1.8} /> {team.name}
                      </div>
                    )}
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6, flexWrap:"wrap" }}>
                      {isToday && <span className="badge" style={{ background:cc+"22", color:cc }}>Vandaag</span>}
                      {b.time_label && <span style={{ fontSize:13, color:"var(--color-text-secondary)", display:"flex", alignItems:"center", gap:5 }}><Clock size={13} strokeWidth={1.8} /> {b.time_label}</span>}
                      {shiftNames.length>0 && (
                        <span className="badge" style={{ background:presentCount===shiftNames.length?BD_SUCCESS_BG:"#F59E0B1e", color:presentCount===shiftNames.length?BD_SUCCESS:"#B7791F", display:"inline-flex", alignItems:"center", gap:4 }}>
                          <CheckCircle2 size={11} strokeWidth={2} /> {presentCount}/{shiftNames.length} aanwezig
                        </span>
                      )}
                    </div>
                    <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontSize:22, fontWeight:800, textTransform:"uppercase", lineHeight:1, color:"var(--color-text)" }}>{formatDate(b.shift_date)}</div>
                    <div style={{ marginTop:10, display:"flex", flexWrap:"wrap", gap:8 }}>
                      {shiftNames.map((n,i) => {
                        const status = (b.attendance && b.attendance[n]) || "present";
                        const noShow = status === "no_show";
                        return (
                          <span key={i} onClick={canEdit?()=>toggleAttendance(b,n):undefined}
                            title={canEdit?(noShow?"Gemarkeerd als niet gekomen -- klik om te herstellen":"Klik om als 'niet gekomen' te markeren"):undefined}
                            style={{ display:"inline-flex", alignItems:"center", gap:7, background:noShow?"#DC354511":cc+"14", border:`1px solid ${noShow?"#DC354555":cc+"33"}`, borderRadius:"var(--radius-pill)", padding:"3px 12px 3px 3px", fontSize:13, fontWeight:700, color:noShow?"var(--color-danger)":"var(--color-text)", textDecoration:noShow?"line-through":"none", cursor:canEdit?"pointer":"default" }}>
                            <span style={{ width:22, height:22, borderRadius:"50%", background:noShow?"var(--color-danger)":cc, color:"#fff", fontSize:10, fontWeight:800, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>{noShow?"✗":initials(n)}</span>
                            {n}
                          </span>
                        );
                      })}
                    </div>
                    {b.note && <div style={{ fontSize:14, color:"var(--color-text-secondary)", marginTop:8, lineHeight:1.4, display:"flex", alignItems:"flex-start", gap:6 }}><StickyNote size={14} strokeWidth={1.8} style={{ flexShrink:0, marginTop:2 }} /> {b.note}</div>}
                    {/* Nieuw #38: voorraad-checklist */}
                    {(b.checklist||[]).length>0 && (
                      <div style={{ marginTop:10, background:"var(--color-surface-muted)", borderRadius:10, padding:"8px 12px" }}>
                        <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:1, color:"var(--color-text-secondary)", marginBottom:6 }}>Checklist ({checkedCount}/{b.checklist.length})</div>
                        <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                          {b.checklist.map((c,i) => (
                            <label key={i} style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, fontFamily:"Barlow,sans-serif", cursor:canEdit?"pointer":"default", color:c.done?"var(--color-text-secondary)":"var(--color-text)", textDecoration:c.done?"line-through":"none" }}>
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
                    {canDelete && <button className="btn-sm" onClick={()=>handleDeleteBardienst(b.id)} style={{ color:"var(--color-danger)" }}>Verwijderen</button>}
                  </div>
                )}
              </div>
            );
          };
          return (
          <div>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, marginBottom:20, flexWrap:"wrap" }}>
              <span style={{ fontSize:13, color:"var(--color-text-secondary)", fontFamily:"Barlow,sans-serif" }}>{bardienst.length} dienst{bardienst.length!==1?"en":""}</span>
              {canEdit && <button className="btn-red" onClick={openNewBardienst}>+ Bardienst toevoegen</button>}
            </div>
            {bardienst.length === 0 ? (
              <div style={{ textAlign:"center", padding:60 }}>
                <Beer size={44} strokeWidth={1.5} style={{ color:"var(--color-text-muted)", marginBottom:16 }} />
                <div style={{ color:"var(--color-text-secondary)", fontSize:14, letterSpacing:1, textTransform:"uppercase" }}>Nog geen bardiensten ingepland</div>
                {canEdit && <button className="btn-red" style={{ marginTop:20 }} onClick={openNewBardienst}>Eerste bardienst toevoegen</button>}
              </div>
            ) : (
              <div>
                {nextShift && (() => {
                  const d = new Date(nextShift.shift_date);
                  const days = Math.round((new Date(nextShift.shift_date+"T00:00:00") - new Date(todayStr0+"T00:00:00")) / 86400000);
                  const daysLabel = days===0?"Vandaag":days===1?"Morgen":`${days} dagen`;
                  const shiftNames = nextShift.names.split(",").map(n=>n.trim()).filter(Boolean);
                  const noShowCount = shiftNames.filter(n => (nextShift.attendance && nextShift.attendance[n])==="no_show").length;
                  const presentCount = shiftNames.length - noShowCount;
                  return (
                    <div style={{ marginBottom:30 }}>
                      <div style={{ fontSize:12, fontWeight:800, letterSpacing:2, color:"var(--color-text-secondary)", textTransform:"uppercase", marginBottom:10 }}>Eerstvolgende bardienst</div>
                      <div style={{ position:"relative", background:BD_NAVY, borderRadius:17, padding:"22px 24px", overflow:"hidden" }}>
                        <div style={{ position:"absolute", top:-20, right:16, width:130, height:130, backgroundImage:"radial-gradient(rgba(255,255,255,.15) 1px,transparent 1px)", backgroundSize:"12px 12px" }} />
                        <div style={{ position:"relative", display:"flex", alignItems:"center", gap:20, flexWrap:"wrap" }}>
                          <div style={{ background:"#fff", borderRadius:8, width:43, height:43, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                            <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:900, fontSize:21, lineHeight:1, color:BD_NAVY }}>{d.getDate()}</div>
                            <div style={{ fontSize:8, fontWeight:800, color:"var(--color-text-secondary)", textTransform:"uppercase" }}>{d.toLocaleDateString("nl-NL",{month:"short"})}</div>
                          </div>
                          <div style={{ flex:1, minWidth:200 }}>
                            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8, flexWrap:"wrap" }}>
                              <span style={{ background:BD_ORANGE, color:"#fff", fontSize:11, fontWeight:800, letterSpacing:1, textTransform:"uppercase", padding:"3px 11px", borderRadius:"var(--radius-pill)", display:"inline-flex", alignItems:"center", gap:5 }}><Beer size={12} strokeWidth={2} /> Bardienst</span>
                              <span style={{ fontSize:12, fontWeight:800, letterSpacing:1, color:"#fff", textTransform:"uppercase" }}>{daysLabel}</span>
                              {shiftNames.length>0 && (
                                <span style={{ background:BD_SUCCESS_BG, color:BD_SUCCESS, fontSize:11, fontWeight:800, letterSpacing:1, textTransform:"uppercase", padding:"3px 11px", borderRadius:"var(--radius-pill)", display:"inline-flex", alignItems:"center", gap:5 }}><CheckCircle2 size={12} strokeWidth={2} /> {presentCount}/{shiftNames.length} aanwezig</span>
                              )}
                            </div>
                            <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:900, fontStyle:"italic", fontSize:26, lineHeight:1.05, color:"#fff", textTransform:"uppercase" }}>{formatDate(nextShift.shift_date)}</div>
                            <div style={{ fontSize:14, color:"#c9cbef", marginTop:6 }}>{nextShift.time_label || "Tijd volgt"}</div>
                            <div style={{ marginTop:12, display:"flex", flexWrap:"wrap", gap:8 }}>
                              {nextShift.team_id && (() => { const t = teams.find(x=>x.id===nextShift.team_id); return t ? (
                                <span style={{ display:"inline-flex", alignItems:"center", gap:7, background:"#ffffff26", borderRadius:"var(--radius-pill)", padding:"4px 14px", fontSize:13, fontWeight:800, color:"#fff", textTransform:"uppercase" }}><Shirt size={14} strokeWidth={1.8} /> {t.name}</span>
                              ) : null; })()}
                              {shiftNames.map((n,i)=>(
                                <span key={i} style={{ display:"inline-flex", alignItems:"center", gap:7, background:"#ffffff26", borderRadius:"var(--radius-pill)", padding:"3px 12px 3px 3px", fontSize:13, fontWeight:700, color:"#fff" }}>
                                  <span style={{ width:22, height:22, borderRadius:"50%", background:"#fff", color:BD_NAVY, fontSize:10, fontWeight:800, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>{initials(n)}</span>
                                  {n}
                                </span>
                              ))}
                            </div>
                            {nextShift.note && <div style={{ fontSize:13, color:"#c9cbef", marginTop:10, display:"flex", alignItems:"flex-start", gap:6 }}><StickyNote size={13} strokeWidth={1.8} style={{ flexShrink:0, marginTop:2 }} /> {nextShift.note}</div>}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {Object.entries(groupsMap).map(([month, shifts]) => (
                  <div key={month} style={{ marginBottom:30 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14 }}>
                      <span style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:900, fontStyle:"italic", fontSize:22, textTransform:"uppercase", color:BD_NAVY }}>{month}</span>
                      <div style={{ flex:1, height:3, background:BD_ORANGE }} />
                      <span style={{ fontSize:12, fontWeight:700, color:"var(--color-text-muted)", textTransform:"uppercase" }}>{shifts.length} dienst{shifts.length!==1?"en":""}</span>
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                      {shifts.map(b => shiftRow(b, BD_NAVY))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          );
        })()}

        {/* KALENDER (nu op Agenda) */}
        {tab==="agenda" && (
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
                    <button onClick={()=>setCalDate(d=>{ const m=d.month===0?11:d.month-1; return {year:d.month===0?d.year-1:d.year,month:m}; })} style={{ border:"none", cursor:"pointer", background:"var(--color-primary)", color:"#fff", width:36, height:36, borderRadius:"var(--radius-pill)", fontSize:18, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center" }}>‹</button>
                    <span style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:900, fontStyle:"italic", fontSize:30, color:"var(--color-primary)", textTransform:"uppercase", minWidth:220, textAlign:"center" }}>{MONTHS_NL[calDate.month]} {calDate.year}</span>
                    <button onClick={()=>setCalDate(d=>{ const m=d.month===11?0:d.month+1; return {year:d.month===11?d.year+1:d.year,month:m}; })} style={{ border:"none", cursor:"pointer", background:"var(--color-primary)", color:"#fff", width:36, height:36, borderRadius:"var(--radius-pill)", fontSize:18, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center" }}>›</button>
                  </div>
                  <div style={{ display:"flex", gap:8 }}>
                    <button className="btn-red" onClick={()=>setCalDate({year:new Date().getFullYear(),month:new Date().getMonth()})} style={{ padding:"9px 18px", fontSize:14 }}>Vandaag</button>
                    <button className="btn-sm no-print" onClick={()=>window.print()} style={{ display:"flex", alignItems:"center", gap:5 }}><Printer size={13} strokeWidth={1.8} /> Afdrukken</button>
                  </div>
                </div>
                <div style={{ background:"var(--color-surface)", border:"1px solid var(--color-border)", borderRadius:"var(--radius-card)", padding:16, boxShadow:"var(--shadow-card)" }}>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:6, marginBottom:6 }}>
                    {DAYS_NL.map(d=><div key={d} style={{ textAlign:"center", fontSize:11, fontWeight:800, letterSpacing:1, color:"var(--color-text-muted)", padding:"4px 0", textTransform:"uppercase" }}>{d}</div>)}
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:6 }}>
                    {calDays.map((day,i) => {
                      if (!day) return <div key={`e${i}`} />;
                      const dayEvs = calEvents.filter(ev => dayInRange(day, ev.start_time, ev.end_time));
                      const isToday = day.toDateString()===new Date().toDateString();
                      return (
                        <div key={day.toISOString()} className={`cal-day ${isToday?"today":""} ${dayEvs.length?"has-events":""}`}>
                          <div style={{ display:"flex", justifyContent:"flex-end" }}>
                            <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:800, fontSize:14, lineHeight:1, width:24, height:24, display:"flex", alignItems:"center", justifyContent:"center", borderRadius:"50%", color:isToday?"#fff":(dayEvs.length?"var(--color-text)":"var(--color-text-muted)"), background:isToday?"var(--color-accent)":"transparent" }}>{day.getDate()}</div>
                          </div>
                          {dayEvs.slice(0,2).map(ev => {
                            const cc = categoryColors[ev.category]||primaryColor;
                            return <span key={ev.id} className="cal-dot" style={{ background:cc, color:"#fff" }} onClick={()=>setSelectedEvent(ev)} title={ev.title}>{isTimeSet(ev) ? `${formatTime(ev.start_time)} ` : ""}{ev.title}</span>;
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div style={{ display:"flex", gap:18, flexWrap:"wrap", marginTop:16 }}>
                  {allCategories.map(cat=><span key={cat} style={{ display:"flex", alignItems:"center", gap:6, fontSize:13, fontWeight:600, color:"var(--color-text-secondary)" }}><span style={{ width:10, height:10, borderRadius:"50%", background:categoryColors[cat]||primaryColor, display:"inline-block" }}/>{cat}</span>)}
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
            <div style={{ display:"flex", gap:20, borderBottom:"1px solid var(--color-border)", marginBottom:20 }}>
              <button onClick={()=>setArchiefView("afgelopen")} style={{ background:"none", border:"none", cursor:"pointer", padding:"0 0 10px", fontFamily:"'Saira Condensed',sans-serif", fontWeight:800, fontSize:13, letterSpacing:.5, textTransform:"uppercase", color:archiefView==="afgelopen"?"var(--color-primary)":"var(--color-text-secondary)", borderBottom:archiefView==="afgelopen"?"2px solid var(--color-primary)":"2px solid transparent", marginBottom:-1 }}>Afgelopen events</button>
              {adminMode && (
                <button onClick={()=>setArchiefView("gearchiveerd")} style={{ background:"none", border:"none", cursor:"pointer", padding:"0 0 10px", fontFamily:"'Saira Condensed',sans-serif", fontWeight:800, fontSize:13, letterSpacing:.5, textTransform:"uppercase", color:archiefView==="gearchiveerd"?"var(--color-primary)":"var(--color-text-secondary)", borderBottom:archiefView==="gearchiveerd"?"2px solid var(--color-primary)":"2px solid transparent", marginBottom:-1 }}>Gearchiveerd{archivedEvents.length>0?` (${archivedEvents.length})`:""}</button>
              )}
              {canDelete && (
                <button onClick={()=>setArchiefView("prullenbak")} style={{ background:"none", border:"none", cursor:"pointer", padding:"0 0 10px", fontFamily:"'Saira Condensed',sans-serif", fontWeight:800, fontSize:13, letterSpacing:.5, textTransform:"uppercase", color:archiefView==="prullenbak"?"var(--color-primary)":"var(--color-text-secondary)", borderBottom:archiefView==="prullenbak"?"2px solid var(--color-primary)":"2px solid transparent", marginBottom:-1 }}>Prullenbak{trashedEvents.length>0?` (${trashedEvents.length})`:""}</button>
              )}
            </div>

            {archiefView==="afgelopen" && (
              pastEvents.length===0
                ? (
                  <div style={{ textAlign:"center", padding:60 }}>
                    <Archive size={44} strokeWidth={1.5} style={{ color:"var(--color-text-muted)", marginBottom:16 }} />
                    <div style={{ color:"var(--color-text-secondary)", fontSize:14, letterSpacing:1, textTransform:"uppercase" }}>Nog geen verleden evenementen</div>
                  </div>
                )
                : <div style={{ display:"flex", flexDirection:"column", gap:9 }}>
                    {[...pastEvents].reverse().map(ev => {
                      const cc = categoryColors[ev.category]||primaryColor;
                      const att = (attendees[ev.id]||[]).length;
                      const d = new Date(ev.start_time);
                      return (
                        <div key={ev.id} onClick={()=>setSelectedEvent(ev)} style={{ display:"flex", alignItems:"center", gap:14, background:"var(--color-surface)", border:"1px solid var(--color-border)", borderLeft:`4px solid ${cc}`, borderRadius:14, padding:"13px 16px", cursor:"pointer" }}>
                          <div style={{ flex:"none", textAlign:"center", width:50 }}>
                            <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:900, fontSize:22, color:cc, lineHeight:.85 }}>{d.getDate()}</div>
                            <div style={{ fontSize:10, fontWeight:800, color:"var(--color-text-muted)", textTransform:"uppercase" }}>{d.toLocaleDateString("nl-NL",{month:"short"})}</div>
                          </div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:800, fontSize:19, color:"var(--color-text)", textTransform:"uppercase", lineHeight:1 }}>{ev.title}</div>
                            <div style={{ fontSize:13, color:"var(--color-text-secondary)", marginTop:4 }}>{formatDate(ev.start_time)}{ev.location?` · ${ev.location}`:""}</div>
                          </div>
                          <span className="badge" style={{ background:cc+"18", color:cc, flex:"none" }}>{ev.category}</span>
                          {att>0 && <span style={{ fontSize:13, color:"var(--color-text-muted)", flex:"none", display:"flex", alignItems:"center", gap:4 }}><Users size={13} strokeWidth={1.8} /> {att}</span>}
                        </div>
                      );
                    })}
                  </div>
            )}

            {archiefView==="gearchiveerd" && adminMode && (
              archivedEvents.length===0 ? (
                <div style={{ textAlign:"center", padding:60 }}>
                  <Archive size={44} strokeWidth={1.5} style={{ color:"var(--color-text-muted)", marginBottom:16 }} />
                  <div style={{ color:"var(--color-text-secondary)", fontSize:14, letterSpacing:1, textTransform:"uppercase" }}>Niets gearchiveerd</div>
                </div>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {archivedEvents.map(ev => (
                    <div key={ev.id} style={{ background:"var(--color-surface)", border:"1px solid var(--color-border)", borderLeft:"3px solid #6a4c93", borderRadius:14, padding:"12px 16px", display:"flex", alignItems:"center", gap:12, opacity:.6, flexWrap:"wrap" }}>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:15, fontWeight:700, textTransform:"uppercase" }}>{ev.title}</div>
                        <div style={{ fontSize:13, color:"var(--color-text-secondary)", fontFamily:"Barlow,sans-serif" }}>{formatDate(ev.start_time)}</div>
                      </div>
                      <button className="btn-sm" onClick={()=>handleArchive(ev)}>Herstellen</button>
                      {canDelete && <button className="btn-sm" onClick={()=>handleDelete(ev.id)} style={{ color:"var(--color-danger)" }}>Verwijderen</button>}
                    </div>
                  ))}
                </div>
              )
            )}

            {/* Nieuw #179: prullenbak -- zachtverwijderde events, te herstellen of definitief te wissen */}
            {archiefView==="prullenbak" && canDelete && (
              trashedEvents.length===0 ? (
                <div style={{ textAlign:"center", padding:60 }}>
                  <Trash2 size={44} strokeWidth={1.5} style={{ color:"var(--color-text-muted)", marginBottom:16 }} />
                  <div style={{ color:"var(--color-text-secondary)", fontSize:14, letterSpacing:1, textTransform:"uppercase" }}>Prullenbak is leeg</div>
                </div>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {trashedEvents.map(ev => (
                    <div key={ev.id} style={{ background:"var(--color-surface)", border:"1px solid var(--color-border)", borderLeft:"3px solid var(--color-danger)", borderRadius:14, padding:"12px 16px", display:"flex", alignItems:"center", gap:12, opacity:.6, flexWrap:"wrap" }}>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:15, fontWeight:700, textTransform:"uppercase" }}>{ev.title}</div>
                        <div style={{ fontSize:13, color:"var(--color-text-secondary)", fontFamily:"Barlow,sans-serif" }}>{formatDate(ev.start_time)} · verwijderd {formatDate(ev.deleted_at)}</div>
                      </div>
                      <button className="btn-sm" onClick={()=>handleRestoreDeleted(ev.id)}>Herstellen</button>
                      <button className="btn-sm" onClick={()=>handlePermanentDelete(ev.id)} style={{ color:"var(--color-danger)" }}>Definitief verwijderen</button>
                    </div>
                  ))}
                </div>
              )
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
            onSelectEvent={ev=>{ setSelectedEvent(ev); setTab("home"); }}
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
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, marginBottom:20, flexWrap:"wrap" }}>
              <span style={{ fontSize:13, color:"var(--color-text-secondary)", fontFamily:"Barlow,sans-serif" }}>{ideas.length} idee{ideas.length!==1?"ën":""} — alleen zichtbaar voor beheerders</span>
              <button className="btn-red" onClick={()=>setShowIdeaForm(true)}>+ Nieuw idee</button>
            </div>
            {ideas.length === 0 ? (
              <div style={{ textAlign:"center", padding:60 }}>
                <Lightbulb size={44} strokeWidth={1.5} style={{ color:"var(--color-text-muted)", marginBottom:16 }} />
                <div style={{ color:"var(--color-text-secondary)", fontSize:14, letterSpacing:1, textTransform:"uppercase" }}>Nog geen ideeën binnengekomen</div>
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {ideas.map(idea => (
                  <div key={idea.id} className="ev-card" style={{ cursor:"default", borderLeft:`4px solid var(--color-primary)` }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:10, flexWrap:"wrap" }}>
                      <div>
                        <div style={{ fontSize:13, fontWeight:700, color:"var(--color-primary)" }}>{idea.name || "Anoniem"}</div>
                        <div style={{ fontSize:12, color:"var(--color-text-secondary)", fontFamily:"Barlow,sans-serif" }}>{new Date(idea.created_at).toLocaleString("nl-NL")}</div>
                      </div>
                      {canEdit && <button className="btn-sm" onClick={()=>handleRemoveIdea(idea.id)} style={{ color:"var(--color-danger)" }}>Verwijderen</button>}
                    </div>
                    <div style={{ fontSize:15, fontFamily:"Barlow,sans-serif", marginTop:8, lineHeight:1.5, whiteSpace:"pre-wrap" }}>{idea.message}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* FOTOBIBLIOTHEEK (admin) */}
        {tab==="fotos" && adminMode && (
          <div>
            <div style={{ marginBottom:16, fontSize:13, color:"var(--color-text-secondary)", fontFamily:"Barlow,sans-serif" }}>
              {photos.length} foto{photos.length!==1?"'s":""} — te gebruiken bij evenementen, nieuws en sponsorlogo's.
            </div>
            <PhotoLibraryGrid photos={photos} uploadingPhoto={uploadingPhoto} canEdit={canEdit} onUpload={handleUploadPhoto} onDelete={handleDeletePhoto} />
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
          <div className="modal-overlay sheet-mode" onClick={()=>setSelectedEvent(null)}>
            <div className="modal sheet-mode" style={{ maxWidth:640, padding:0, overflow:"hidden" }} onClick={e=>e.stopPropagation()}>
              {!ev.image_url && <div className="modal-drag-handle" />}
              {ev.image_url && (
                <div style={{ position:"relative" }}>
                  <img src={ev.image_url} alt={ev.title} style={{ width:"100%", height:"auto", display:"block" }} onError={e=>e.target.parentElement.style.display="none"} />
                  <div style={{ position:"absolute", inset:0, background:"linear-gradient(180deg, rgba(0,0,0,.1), rgba(0,0,0,.45))", pointerEvents:"none" }} />
                  <div style={{ position:"absolute", top:10, left:"50%", transform:"translateX(-50%)", width:36, height:4, borderRadius:2, background:"#ffffff77" }} />
                  <button onClick={()=>setSelectedEvent(null)} style={{ position:"absolute", top:14, right:14, border:"none", cursor:"pointer", background:"#ffffff33", color:"#fff", width:34, height:34, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center" }} aria-label="Sluiten"><X size={17} strokeWidth={2} /></button>
                  <img src={clubSettings.logo || clubLogo} alt="" style={{ position:"absolute", right:20, bottom:-22, width:52, height:52, borderRadius:"50%", border:"3px solid #fff", background:"#fff", objectFit:"contain" }} onError={e=>{ e.target.onerror=null; e.target.src=clubLogo; }} />
                </div>
              )}
              <div style={{ position:"relative", background:"var(--color-surface)", padding: ev.image_url ? "26px 28px 18px" : "26px 28px 18px" }}>
                <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:14 }}>
                  <div>
                    <span className="badge" style={{ background:cc+"1e", color:cc }}>{ev.category}</span>
                    {ev.hidden && <span className="badge" style={{ background:"var(--color-surface-muted)", color:"var(--color-text-secondary)", marginLeft:6 }}>Verborgen</span>}
                    {(ev.recurrence_rule || ev.recurrence_parent_id) && <span className="badge" style={{ background:"var(--color-surface-muted)", color:"var(--color-text-secondary)", marginLeft:6, display:"inline-flex", alignItems:"center", gap:4 }}><Repeat size={11} strokeWidth={2} /> {ev.recurrence_rule?.freq==="monthly"?"Maandelijks":"Wekelijks"}</span>}
                    {ev.series_id && <span className="badge" style={{ background:"var(--color-surface-muted)", color:"var(--color-text-secondary)", marginLeft:6, display:"inline-flex", alignItems:"center", gap:4 }}><Trophy size={11} strokeWidth={2} /> {eventSeries.find(s=>s.id===ev.series_id)?.title||"Reeks"}</span>}
                    <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:900, fontStyle:"italic", fontSize:32, lineHeight:1, color:"var(--color-text)", textTransform:"uppercase", marginTop:10 }}>{ev.title}</div>
                  </div>
                  {!ev.image_url && (
                    <button onClick={()=>setSelectedEvent(null)} style={{ border:"none", cursor:"pointer", background:"var(--color-surface-muted)", color:"var(--color-text-secondary)", width:34, height:34, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", flex:"none" }} aria-label="Sluiten"><X size={17} strokeWidth={2} /></button>
                  )}
                </div>
              </div>

              <div style={{ display:"flex", padding:"0 28px", borderBottom:"1px solid var(--color-border)" }}>
                {[["details","Details"],["weer","Weer"],["locatie","Locatie"],["aanmeldingen","Aanmeldingen"]].map(([v,l]) => (
                  <button key={v} onClick={()=>setDetailTab(v)} style={{ flex:"1 1 0", background:"none", border:"none", cursor:"pointer", padding:"0 4px 10px", fontFamily:"'Saira Condensed',sans-serif", fontWeight:800, fontSize:12, letterSpacing:.3, textTransform:"uppercase", color:detailTab===v?cc:"var(--color-text-secondary)", borderBottom:detailTab===v?`2px solid ${cc}`:"2px solid transparent", marginBottom:-1 }}>{l}</button>
                ))}
              </div>

              <div style={{ padding:"24px 28px 28px" }}>
              {detailTab==="details" && (
                <>
                  <div className="grid-2" style={{ marginBottom:16 }}>
                    <div style={{ background:"var(--color-surface-muted)", borderRadius:12, padding:14, gridColumn:(isMultiDay(ev)||!isTimeSet(ev))?"1 / -1":undefined }}>
                      <div style={{ fontSize:10, color:"var(--color-text-muted)", fontWeight:800, letterSpacing:2, textTransform:"uppercase", marginBottom:4 }}>Datum{isMultiDay(ev)?" · meerdaags":""}</div>
                      <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:900, fontStyle:"italic", fontSize:19, lineHeight:1.05, color:"var(--color-text)", textTransform:"uppercase" }}>{isMultiDay(ev) ? formatRangeCompact(ev.start_time, ev.end_time) : formatRange(ev.start_time, ev.end_time)}</div>
                    </div>
                    {!isMultiDay(ev) && isTimeSet(ev) && (
                      <div style={{ background:"var(--color-surface-muted)", borderRadius:12, padding:14 }}>
                        <div style={{ fontSize:10, color:"var(--color-text-muted)", fontWeight:800, letterSpacing:2, textTransform:"uppercase", marginBottom:4 }}>Tijd</div>
                        <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:800, fontSize:18, color:"var(--color-text)" }}>{formatTime(ev.start_time)}{ev.end_time?` – ${formatTime(ev.end_time)}`:""}</div>
                      </div>
                    )}
                  </div>
                  {ev.cost > 0 && (
                    <div style={{ background:"var(--color-surface-muted)", borderRadius:12, padding:14, marginBottom:16 }}>
                      <div style={{ fontSize:10, color:"var(--color-text-muted)", fontWeight:800, letterSpacing:2, textTransform:"uppercase", marginBottom:4 }}>Kosten deelname</div>
                      <div style={{ fontSize:24, fontWeight:900, color:"var(--color-success)" }}>€{Number(ev.cost).toFixed(2)}</div>
                    </div>
                  )}
                  {ev.sponsor_name && (
                    <div style={{ background:"var(--color-surface-muted)", borderRadius:12, padding:14, marginBottom:16, display:"flex", alignItems:"center", gap:12 }}>
                      <div>
                        <div style={{ fontSize:10, color:"var(--color-text-muted)", fontWeight:800, letterSpacing:2, textTransform:"uppercase", marginBottom:2 }}>Gesponsord door</div>
                        <div style={{ fontSize:15, fontWeight:700 }}>🤝 {ev.sponsor_name}</div>
                      </div>
                      {ev.sponsor_logo && <img src={ev.sponsor_logo} alt={ev.sponsor_name} style={{ height:36, objectFit:"contain", marginLeft:"auto" }} onError={e=>e.target.style.display="none"} />}
                    </div>
                  )}
                  {ev.description ? <div style={{ fontSize:15, color:"var(--color-text-secondary)", lineHeight:1.6 }}>{ev.description}</div> : <div style={{ fontSize:13, color:"var(--color-text-muted)", fontFamily:"Barlow,sans-serif" }}>Geen beschrijving toegevoegd.</div>}
                </>
              )}
              {detailTab==="weer" && <WeatherWidget location={ev.location} startTime={ev.start_time} />}
              {detailTab==="locatie" && (
                ev.location ? (
                  <a href={`https://maps.google.com/?q=${encodeURIComponent(ev.location)}`} target="_blank" rel="noopener noreferrer" style={{ display:"flex", alignItems:"center", justifyContent:"space-between", background:"var(--color-surface-muted)", borderRadius:12, padding:14, textDecoration:"none" }}>
                    <div>
                      <div style={{ fontSize:10, color:"var(--color-text-muted)", fontWeight:800, letterSpacing:2, textTransform:"uppercase", marginBottom:4 }}>Locatie</div>
                      <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:800, fontSize:18, color:"var(--color-text)", display:"flex", alignItems:"center", gap:7 }}><MapPin size={16} strokeWidth={1.8} /> {ev.location}</div>
                    </div>
                    <span style={{ fontSize:12, fontWeight:700, color:"var(--color-accent)" }}>Maps ↗</span>
                  </a>
                ) : <div style={{ fontSize:13, color:"var(--color-text-muted)", fontFamily:"Barlow,sans-serif" }}>Geen locatie opgegeven.</div>
              )}
              {detailTab==="aanmeldingen" && (
                <>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", background:cc+"18", borderRadius:12, padding:"14px 16px", marginBottom:14, flexWrap:"wrap", gap:8 }}>
                    <span style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:800, fontSize:16, color:cc, display:"flex", alignItems:"center", gap:7 }}><Users size={16} strokeWidth={1.8} /> {(attendees[ev.id]||[]).length} aangemeld</span>
                    {isUpcoming(ev.start_time) && <span style={{ fontSize:12, fontWeight:700, color:cc, textTransform:"uppercase" }}>{daysUntil(ev.start_time)===0?"Vandaag":daysUntil(ev.start_time)===1?"Morgen":`${daysUntil(ev.start_time)} dagen`}</span>}
                  </div>
                  {(attendees[ev.id]||[]).length > 0 ? (
                    <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:16 }}>
                      {attendees[ev.id].map((a,i) => <span key={i} className="badge" style={{ background:"var(--color-surface-muted)", color:"var(--color-text)" }}>{a.attendee_name}</span>)}
                    </div>
                  ) : (
                    <div style={{ fontSize:13, color:"var(--color-text-muted)", fontFamily:"Barlow,sans-serif", marginBottom:16 }}>Nog niemand aangemeld.</div>
                  )}
                  <button className="btn-sm" onClick={()=>{ setShowAttendees(ev); setSelectedEvent(null); }}>Aanmelden</button>
                </>
              )}

              <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginTop:20 }}>
                <button className="btn-red" style={{ flex:1 }} onClick={()=>{ setShowAttendees(ev); setSelectedEvent(null); }}>Ik kom!</button>
                <button className="btn-ghost" onClick={()=>setSelectedEvent(null)}>Sluiten</button>
              </div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginTop:10 }}>
                {canEdit && (
                  <>
                    <button className="btn-sm" onClick={()=>{ setSelectedEvent(null); openEdit(ev); }}>Bewerken</button>
                    <button className="btn-sm" onClick={()=>handleDuplicate(ev)}>Dupliceren</button>
                    <button className="btn-sm" onClick={()=>handleArchive(ev)} style={{ color:"#f4a261" }}>Archiveren</button>
                    {canDelete && <button className="btn-sm" onClick={()=>handleDelete(ev.id)} style={{ color:"var(--color-danger)" }}>Verwijderen</button>}
                  </>
                )}
              </div>
              {related.length>0 && (
                <div style={{ marginTop:22, paddingTop:18, borderTop:"1px solid var(--color-border)" }}>
                  <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:2, color:"var(--color-text-muted)", marginBottom:10 }}>Ook interessant</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                    {related.map(r => {
                      const rc = categoryColors[r.category]||primaryColor;
                      return (
                        <div key={r.id} onClick={()=>setSelectedEvent(r)} style={{ display:"flex", alignItems:"center", gap:10, background:"var(--color-surface-muted)", borderRadius:12, padding:"9px 12px", cursor:"pointer" }}>
                          <span style={{ width:8, height:8, borderRadius:"50%", background:rc, flexShrink:0 }} />
                          <span style={{ flex:1, fontSize:13, fontWeight:700, color:"var(--color-text)" }}>{r.title}</span>
                          <span style={{ fontSize:12, color:"var(--color-text-secondary)", fontFamily:"Barlow,sans-serif" }}>{formatDate(r.start_time)}</span>
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
        <div className="modal-overlay sheet-mode" onClick={closeForm}>
          <div className="modal sheet-mode" style={{ maxWidth:640 }} onClick={e=>e.stopPropagation()} onFocusCapture={handleModalFocus}>
            <div className="modal-drag-handle" />
            <h2 style={{ fontSize:20, fontWeight:900, textTransform:"uppercase", marginBottom:20, color:"var(--color-text)" }}>{editingEvent?"Bewerken":"Nieuw evenement"}</h2>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div><label style={{ fontSize:11, color:"var(--color-text-secondary)", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Titel *</label><input className="input" value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="Evenementnaam" /></div>
              <div className="grid-2">
                {(() => {
                  const [sDate,sTime] = (form.start_time||"").split("T");
                  const startHasTime = !!sTime && sTime!=="00:00";
                  return (
                    <div>
                      <label style={{ fontSize:11, color:"var(--color-text-secondary)", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Start *</label>
                      <div style={{ display:"flex", gap:8 }}>
                        <input className="input" type="date" value={sDate||""} onChange={e=>setForm(f=>({...f,start_time:`${e.target.value}T${sTime||"00:00"}`}))} />
                        {startHasTime && <input className="input" type="time" value={sTime||""} onChange={e=>setForm(f=>({...f,start_time:`${sDate||""}T${e.target.value}`}))} />}
                      </div>
                      <label style={{ display:"flex", alignItems:"center", gap:6, marginTop:6, fontSize:12, color:"var(--color-text-secondary)", fontFamily:"Barlow,sans-serif", cursor:"pointer" }}>
                        <input type="checkbox" checked={!startHasTime} onChange={e=>setForm(f=>{ const [d] = (f.start_time||"").split("T"); return { ...f, start_time:`${d||""}T${e.target.checked?"00:00":"12:00"}` }; })} style={{ accentColor:"var(--color-accent)" }} />
                        Geen specifieke tijd
                      </label>
                    </div>
                  );
                })()}
                {(() => {
                  const [eDate,eTime] = (form.end_time||"").split("T");
                  const endHasTime = !!eTime && eTime!=="00:00";
                  return (
                    <div>
                      <label style={{ fontSize:11, color:"var(--color-text-secondary)", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Einde</label>
                      <div style={{ display:"flex", gap:8 }}>
                        <input className="input" type="date" value={eDate||""} onChange={e=>setForm(f=>({...f,end_time:e.target.value?`${e.target.value}T${eTime||"00:00"}`:""}))} />
                        {endHasTime && <input className="input" type="time" value={eTime||""} onChange={e=>setForm(f=>({...f,end_time:`${eDate||""}T${e.target.value}`}))} />}
                      </div>
                      {form.end_time && (
                        <label style={{ display:"flex", alignItems:"center", gap:6, marginTop:6, fontSize:12, color:"var(--color-text-secondary)", fontFamily:"Barlow,sans-serif", cursor:"pointer" }}>
                          <input type="checkbox" checked={!endHasTime} onChange={e=>setForm(f=>{ const [d] = (f.end_time||"").split("T"); return { ...f, end_time:`${d||""}T${e.target.checked?"00:00":"12:00"}` }; })} style={{ accentColor:"var(--color-accent)" }} />
                          Geen specifieke tijd
                        </label>
                      )}
                    </div>
                  );
                })()}
              </div>
              <div className="grid-2">
                <div><label style={{ fontSize:11, color:"var(--color-text-secondary)", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Categorie</label>
                  <select className="input" value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>
                    {allCategories.map(c=><option key={c}>{c}</option>)}
                  </select>
                </div>
                <div><label style={{ fontSize:11, color:"var(--color-text-secondary)", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Locatie</label><input className="input" value={form.location} onChange={e=>setForm(f=>({...f,location:e.target.value}))} placeholder="Sportpark De Brug" /></div>
              </div>
              <div><label style={{ fontSize:11, color:"var(--color-text-secondary)", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Beschrijving</label><textarea className="input" rows={3} value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="Extra info..." style={{ resize:"vertical" }} /></div>

              {/* Nieuw #3: eventreeksen/toernooien */}
              <div>
                <label style={{ fontSize:11, color:"var(--color-text-secondary)", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Onderdeel van reeks</label>
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
                  <label style={{ fontSize:11, color:"var(--color-text-secondary)", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Herhaling</label>
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
                  {recurrence.freq!=="none" && <div style={{ fontSize:12, color:"var(--color-text-secondary)", fontFamily:"Barlow,sans-serif", marginTop:6 }}>Maakt losse events aan tot de einddatum of het maximum, wat eerder komt.</div>}
                </div>
              )}
              <div>
                <label style={{ fontSize:11, color:"var(--color-text-secondary)", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Afbeelding URL</label>
                <div style={{ display:"flex", gap:8 }}>
                  <input className="input" value={form.image_url} onChange={e=>setForm(f=>({...f,image_url:e.target.value}))} placeholder="https://... (banner/foto)" style={{ flex:1 }} />
                  <button type="button" className="btn-sm" onClick={()=>openPhotoPicker(url=>setForm(f=>({...f,image_url:url})))}>Bibliotheek</button>
                </div>
                {form.image_url && <img src={form.image_url} alt="preview" style={{ width:"100%", height:90, objectFit:"cover", borderRadius:10, border:"1px solid var(--color-border)", marginTop:8 }} onError={e=>e.target.style.display="none"} />}
              </div>
              <div className="grid-3">
                <div><label style={{ fontSize:11, color:"var(--color-text-secondary)", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Kosten (€)</label><input className="input" type="number" min="0" step="0.01" value={form.cost} onChange={e=>setForm(f=>({...f,cost:e.target.value}))} placeholder="0.00" /></div>
                <div><label style={{ fontSize:11, color:"var(--color-text-secondary)", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Sponsornaam</label><input className="input" value={form.sponsor_name} onChange={e=>setForm(f=>({...f,sponsor_name:e.target.value}))} placeholder="Bakkerij Jansen" /></div>
                <div><label style={{ fontSize:11, color:"var(--color-text-secondary)", display:"block", marginBottom:5, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Sponsorlogo URL</label>
                  <div style={{ display:"flex", gap:6 }}>
                    <input className="input" value={form.sponsor_logo} onChange={e=>setForm(f=>({...f,sponsor_logo:e.target.value}))} placeholder="https://..." style={{ flex:1 }} />
                    <button type="button" className="btn-sm" onClick={()=>openPhotoPicker(url=>setForm(f=>({...f,sponsor_logo:url})))}>Kies</button>
                  </div>
                </div>
              </div>
              <div style={{ display:"flex", gap:16, alignItems:"center" }}>
                <label style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer", fontSize:14, fontFamily:"Barlow,sans-serif" }}><input type="checkbox" checked={form.is_public} onChange={e=>setForm(f=>({...f,is_public:e.target.checked}))} style={{ accentColor:"var(--color-accent)" }} /> Publiek</label>
                <label style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer", fontSize:14, fontFamily:"Barlow,sans-serif" }}><input type="checkbox" checked={form.hidden} onChange={e=>setForm(f=>({...f,hidden:e.target.checked}))} style={{ accentColor:"var(--color-text-muted)" }} /> Verborgen</label>
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
          <div className="modal-overlay sheet-mode" onClick={()=>setSelectedNews(null)}>
            <div className="modal sheet-mode" style={{ maxWidth:640, padding:0 }} onClick={e=>e.stopPropagation()}>
              <div style={{ position:"relative", background:cc, padding:"26px 28px", overflow:"hidden" }}>
                <div style={{ position:"absolute", top:-16, right:16, width:120, height:120, backgroundImage:"radial-gradient(#ffffff44 1.5px,transparent 1.6px)", backgroundSize:"14px 14px", pointerEvents:"none" }} />
                <div style={{ position:"absolute", top:10, left:"50%", transform:"translateX(-50%)", width:36, height:4, borderRadius:2, background:"#ffffff55" }} />
                <div style={{ position:"relative", display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:14 }}>
                  <div>
                    {n.pinned && <span style={{ background:"#fff", color:cc, fontSize:11, fontWeight:800, letterSpacing:1, textTransform:"uppercase", padding:"3px 11px", borderRadius:20, display:"inline-flex", alignItems:"center", gap:4 }}><Pin size={11} strokeWidth={2} /> Vastgepind</span>}
                    <div style={{ fontFamily:"'Saira Condensed',sans-serif", fontWeight:900, fontStyle:"italic", fontSize:30, lineHeight:1, color:"#fff", textTransform:"uppercase", marginTop:n.pinned?10:0 }}>{n.title}</div>
                  </div>
                  <button onClick={()=>setSelectedNews(null)} style={{ border:"none", cursor:"pointer", background:"#ffffff33", color:"#fff", width:34, height:34, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", flex:"none" }} aria-label="Sluiten"><X size={17} strokeWidth={2} /></button>
                </div>
              </div>
              <div style={{ padding:"24px 28px 28px" }}>
                <div style={{ fontSize:12, color:"var(--color-text-muted)", marginBottom:16 }}>{new Date(n.created_at).toLocaleDateString("nl-NL", { day:"numeric", month:"long", year:"numeric" })}</div>
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
                <div style={{ fontSize:15, color:"var(--color-text)", lineHeight:1.6, whiteSpace:"pre-wrap" }}>{n.body}</div>
                <div style={{ marginTop:22, display:"flex", gap:8, flexWrap:"wrap" }}>
                  <button className="btn-ghost" onClick={()=>setSelectedNews(null)}>Sluiten</button>
                  {canEdit && <button className="btn-sm" onClick={()=>{ setSelectedNews(null); openEditNews(n); }}>Bewerken</button>}
                  {canDelete && <button className="btn-sm" onClick={()=>{ setSelectedNews(null); handleDeleteNews(n.id); }} style={{ color:"var(--color-danger)" }}>Verwijderen</button>}
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
                      <div style={{ display:"flex", gap:8 }}>
                        <input className="input" value={url} onChange={e=>setNewsForm(f=>({...f,images:f.images.map((u,ui)=>ui===i?e.target.value:u)}))} placeholder="https://... (foto bij het bericht)" style={{ flex:1 }} />
                        <button type="button" className="btn-sm" onClick={()=>openPhotoPicker(u=>setNewsForm(f=>({...f,images:f.images.map((uu,ui)=>ui===i?u:uu)})))}>Bibliotheek</button>
                      </div>
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

      {/* FOTO-KIEZER MODAL */}
      {photoPicker && (
        <PhotoPickerModal
          photos={photos}
          uploadingPhoto={uploadingPhoto}
          canEdit={canEdit}
          onUpload={handleUploadPhoto}
          onSelect={choosePhoto}
          onDelete={handleDeletePhoto}
          onClose={()=>setPhotoPicker(null)}
        />
      )}

      {/* IDEE FORM MODAL */}
      {showIdeaForm && (
        <div className="modal-overlay sheet-mode" onClick={()=>setShowIdeaForm(false)}>
          <div className="modal sheet-mode" style={{ maxWidth:440 }} onClick={e=>e.stopPropagation()}>
            <div className="modal-drag-handle" />
            <h2 style={{ fontSize:20, fontWeight:900, textTransform:"uppercase", marginBottom:6, display:"flex", alignItems:"center", gap:8, color:"var(--color-text)" }}><Lightbulb size={20} strokeWidth={1.8} style={{ color:"var(--color-accent)" }} /> Ideeën voor spelerscommissie</h2>
            <p style={{ color:"var(--color-text-secondary)", fontSize:14, fontFamily:"Barlow,sans-serif", marginBottom:16 }}>Alleen het bestuur ziet dit — jouw naam is optioneel.</p>
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
                {pinError && <p style={{ color:"#e63946", fontSize:13, textAlign:"center", marginBottom:16, fontFamily:"Barlow,sans-serif" }}>{typeof pinError==="string"?pinError:"Verkeerde pincode"}</p>}
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
