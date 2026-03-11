import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";
import * as d3 from "d3";
import { supabase } from "./supabase";

// ═══════════════════════════════════════════════════════════════════
// API LAYER (inline — no separate file needed)
// ═══════════════════════════════════════════════════════════════════

const API = "http://localhost:3001/api";

async function api(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token}`,
      ...options.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── Data mappers (API flat legs ↔ frontend nested legs) ──

function mapLeg(a) {
  return {
    id: a.id, type: a.type, status: a.status,
    origin: { code: a.origin_code, city: a.origin_city, lat: a.origin_lat, lng: a.origin_lng },
    destination: { code: a.destination_code, city: a.destination_city, lat: a.destination_lat, lng: a.destination_lng },
    depart_time: a.depart_time, arrive_time: a.arrive_time,
    actual_depart: a.actual_depart, actual_arrive: a.actual_arrive,
    carrier: a.carrier, vehicle_number: a.vehicle_number,
    metadata: a.metadata || {},
  };
}

function legToApi(l) {
  return {
    type: l.type, status: l.status || "scheduled",
    origin_code: l.origin?.code, origin_city: l.origin?.city,
    origin_lat: l.origin?.lat, origin_lng: l.origin?.lng,
    destination_code: l.destination?.code, destination_city: l.destination?.city,
    destination_lat: l.destination?.lat, destination_lng: l.destination?.lng,
    depart_time: l.depart_time, arrive_time: l.arrive_time,
    carrier: l.carrier, vehicle_number: l.vehicle_number,
    metadata: l.metadata || {},
  };
}

function mapTrip(t) {
  return { ...t, legs: (t.legs || []).map(l => l.origin ? l : mapLeg(l)) };
}

function mapFlightLookup(r) {
  return {
    carrier: r.carrier, carrier_code: r.carrier_code, callsign: r.callsign,
    origin: { code: r.origin.code, airport: r.origin.airport, scheduled: r.origin.scheduled, terminal: r.origin.terminal, gate: r.origin.gate },
    destination: { code: r.destination.code, airport: r.destination.airport, scheduled: r.destination.scheduled, terminal: r.destination.terminal, gate: r.destination.gate },
    status: r.status,
  };
}

// ═══════════════════════════════════════════════════════════════════
// AUTH CONTEXT
// ═══════════════════════════════════════════════════════════════════

const AuthContext = createContext();
function useAuth() { return useContext(AuthContext); }

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const signIn = async () => {
    await supabase.auth.signInWithOAuth({ provider: "google" });
  };
  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, signIn, signOut }}>{children}</AuthContext.Provider>;
}

// ═══════════════════════════════════════════════════════════════════
// ROUTER CONTEXT + CONSTANTS
// ═══════════════════════════════════════════════════════════════════

const RouterContext = createContext();
function useRouter() { return useContext(RouterContext); }

const FONT = "'IBM Plex Mono', monospace";
const C = {
  bg: "#0c0c0e", surface: "rgba(255,255,255,0.02)", surfaceHover: "rgba(255,255,255,0.04)",
  border: "rgba(255,255,255,0.06)", borderHover: "rgba(255,255,255,0.12)",
  text: "#e8e4de", textMid: "rgba(255,255,255,0.45)", textDim: "rgba(255,255,255,0.2)", textGhost: "rgba(255,255,255,0.1)",
  red: "#e84233", green: "#22c55e", amber: "#f59e0b",
  flight: "#e84233", train: "#d4628a", bus: "#7c6bb4", hotel: "#c9993a",
};

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function getTripStatus(trip) { const now = new Date(), s = new Date(trip.start_date), e = new Date(trip.end_date); if (trip.legs?.some(l => l.status === "in_air" || l.status === "in_transit")) return "live"; if (now < s) return "upcoming"; if (now > e) return "completed"; return "active"; }
function formatDateRange(s, e) { if (!s || !e) return ""; const sd = new Date(s + "T00:00:00"), ed = new Date(e + "T00:00:00"), o = { month: "short", day: "numeric" }; return `${sd.toLocaleDateString("en-US", o)} — ${ed.toLocaleDateString("en-US", o)}, ${ed.getFullYear()}`; }
function formatTime(iso) { return iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }) : "—"; }
function formatDate(iso) { return iso ? new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : ""; }
function formatDuration(d, a) { if (!d || !a) return ""; const ms = new Date(a) - new Date(d), h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000); return h > 0 ? `${h}H ${m}M` : `${m}M`; }
function interpolateGC(p1, p2, n = 60) { const i = d3.geoInterpolate(p1, p2); return Array.from({ length: n + 1 }, (_, k) => i(k / n)); }
function getLivePos(leg) { if (leg.status !== "in_air" && leg.status !== "in_transit") return null; const dep = new Date(leg.actual_depart || leg.depart_time).getTime(), arr = new Date(leg.arrive_time).getTime(), prog = Math.max(0, Math.min(1, (Date.now() - dep) / (arr - dep))), pos = d3.geoInterpolate([leg.origin.lng, leg.origin.lat], [leg.destination.lng, leg.destination.lat])(prog); return { lng: pos[0], lat: pos[1], progress: prog }; }

function computePresence(trip) {
  if (!trip.legs?.length) return { mode: "pre", narrative: "No legs yet", subtext: "", progress: null, legType: null, emoji: "🗓" };
  const now = Date.now();
  for (const leg of trip.legs) { if (leg.status === "in_air" || leg.status === "in_transit") { const dep = new Date(leg.actual_depart || leg.depart_time).getTime(), arr = new Date(leg.arrive_time).getTime(), prog = Math.max(0, Math.min(1, (now - dep) / (arr - dep))); return { mode: "transit", narrative: leg.type === "flight" ? `In the air — ${leg.carrier} ${leg.vehicle_number}` : `On the ${leg.vehicle_number || leg.carrier}`, subtext: `${Math.round(prog * 100)}% · ${leg.origin.code || leg.origin.city} → ${leg.destination.code || leg.destination.city}`, progress: prog, legType: leg.type, emoji: leg.type === "flight" ? "✈" : "🚄" }; } }
  for (const leg of trip.legs) { if (leg.type === "hotel") { const ci = new Date(leg.depart_time).getTime(), co = new Date(leg.arrive_time).getTime(); if (now >= ci && now <= co) { const h = new Date().getHours(), act = h >= 22 || h < 7 ? "Winding down" : h < 10 ? "Starting the morning" : h < 14 ? "Out and about" : h < 18 ? "Exploring" : "Evening"; return { mode: "dwelling", narrative: `${act} in ${leg.origin.city}`, subtext: `Staying in ${leg.origin.city}`, progress: null, legType: "hotel", emoji: h >= 22 || h < 7 ? "🌙" : "🏙" }; } } }
  const first = trip.legs[0]; if (first && now < new Date(first.depart_time).getTime()) { const d = Math.ceil((new Date(first.depart_time).getTime() - now) / 86400000); return { mode: "pre", narrative: `Starts ${d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`}`, subtext: `${first.origin?.city} → ${trip.legs[trip.legs.length - 1].destination?.city || "adventure"}`, progress: null, legType: null, emoji: "🗓" }; }
  return { mode: "post", narrative: "Trip complete", subtext: "Back home", progress: null, legType: null, emoji: "🏠" };
}

const STATUS_CFG = { live: { label: "LIVE", color: C.red, dot: true }, upcoming: { label: "UPCOMING", color: C.textMid, dot: false }, active: { label: "ACTIVE", color: C.green, dot: false }, completed: { label: "COMPLETED", color: C.textDim, dot: false } };

// ═══════════════════════════════════════════════════════════════════
// MICRO COMPONENTS
// ═══════════════════════════════════════════════════════════════════

function StatusBadge({ status }) { const cfg = STATUS_CFG[status] || STATUS_CFG.upcoming; return <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-bold" style={{ background: `${cfg.color}12`, color: cfg.color, fontFamily: FONT, fontSize: "9px", letterSpacing: "1.5px" }}>{cfg.dot && <span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: cfg.color }} /><span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: cfg.color }} /></span>}{cfg.label}</span>; }
function LegPill({ leg }) { const color = C[leg.type]; const label = leg.type === "hotel" ? "HTL" : `${leg.origin?.code || "?"} → ${leg.destination?.code || "?"}`; return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs" style={{ background: `${color}12`, color, fontFamily: FONT, fontSize: "9px" }}>{leg.type.toUpperCase().slice(0, 3)} <span style={{ opacity: 0.6 }}>{label}</span></span>; }
function Label({ children }) { return <label className="block text-xs font-bold mb-1.5" style={{ color: C.textDim, fontFamily: FONT, fontSize: "9px", letterSpacing: "1.5px" }}>{children}</label>; }
function Input(props) { return <input {...props} className={`w-full px-3 py-2.5 rounded border outline-none text-sm transition-colors ${props.className || ""}`} style={{ background: "rgba(0,0,0,0.3)", borderColor: C.border, color: C.text, fontFamily: FONT, colorScheme: "dark", ...props.style }} />; }
function Spinner() { return <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />; }
function LoadingScreen() { return <div className="flex items-center justify-center min-h-[60vh]"><Spinner /><span className="ml-3 text-xs tracking-widest" style={{ color: C.textDim, fontFamily: FONT, fontSize: "10px", letterSpacing: "2px" }}>LOADING</span></div>; }

// ═══════════════════════════════════════════════════════════════════
// LOGIN PAGE
// ═══════════════════════════════════════════════════════════════════

function LoginPage() {
  const { signIn } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: C.bg }}>
      <div className="w-full max-w-xs text-center">
        <h1 className="text-xs font-bold tracking-widest mb-2" style={{ color: C.textDim, fontFamily: FONT, fontSize: "11px", letterSpacing: "4px" }}>TRIPTRACK</h1>
        <p className="text-xs mb-8" style={{ color: C.textGhost, fontFamily: FONT }}>Track every leg of the journey</p>
        <button onClick={signIn} className="w-full py-3.5 rounded text-xs font-bold tracking-widest" style={{ background: C.red, color: "#fff", fontFamily: FONT, fontSize: "10px", letterSpacing: "2px" }}>
          SIGN IN WITH GOOGLE
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SQUAWK MODAL
// ═══════════════════════════════════════════════════════════════════

function SquawkModal({ trip, onClose }) {
  const [squawk, setSquawk] = useState(null);
  const [copied, setCopied] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [viewers, setViewers] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => { api(`/squawk/trip/${trip.id}`).then(codes => setViewers((codes || []).filter(c => c.claimed_by))).catch(() => {}); }, [trip.id]);

  const generate = async () => {
    setGenerating(true); setCopied(null); setError(null);
    try { const res = await api("/squawk/generate", { method: "POST", body: JSON.stringify({ trip_id: trip.id }) }); setSquawk(res.code); } catch (e) { setError(e.message); }
    setGenerating(false);
  };

  const revoke = async (codeId) => { try { await api(`/squawk/${codeId}`, { method: "DELETE" }); setViewers(v => v.filter(c => c.id !== codeId)); } catch (e) { setError(e.message); } };
  const copy = (type) => { const text = type === "code" ? squawk : `Follow my trip "${trip.title}" on TripTrack.\nSquawk code: ${squawk}`; navigator.clipboard?.writeText(text).catch(() => {}); setCopied(type); setTimeout(() => setCopied(null), 2000); };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }} onClick={onClose}>
      <div className="w-full sm:max-w-sm sm:mx-4 rounded-t-xl sm:rounded-lg overflow-hidden" style={{ background: "#131316", border: `1px solid ${C.border}` }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${C.border}` }}>
          <div><h3 className="text-xs font-bold tracking-widest" style={{ color: C.text, fontFamily: FONT, fontSize: "10px", letterSpacing: "2px" }}>SHARE TRIP</h3><p className="text-xs mt-0.5" style={{ color: C.textDim, fontFamily: FONT, fontSize: "10px" }}>{trip.title}</p></div>
          <button onClick={onClose} className="p-2 -mr-2" style={{ color: C.textDim }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
        </div>
        <div className="px-5 py-5 max-h-[70vh] overflow-y-auto">
          <p className="text-xs mb-5" style={{ color: C.textMid, fontFamily: FONT, fontSize: "11px", lineHeight: 1.6 }}>Generate a one-time squawk code. Send it to someone — they enter it, your trip appears in their feed. Expires in 24 hours.</p>
          {error && <div className="mb-3 px-3 py-2 rounded text-xs" style={{ background: `${C.red}08`, color: C.red, fontFamily: FONT }}>{error}</div>}
          {!squawk ? (
            <button onClick={generate} disabled={generating} className="w-full py-3.5 rounded text-xs font-bold tracking-widest" style={{ background: generating ? C.surface : C.red, color: generating ? C.textDim : "#fff", fontFamily: FONT, fontSize: "10px", letterSpacing: "2px" }}>{generating ? <span className="flex items-center justify-center gap-2"><Spinner />GENERATING</span> : "GENERATE SQUAWK CODE"}</button>
          ) : (
            <div>
              <div className="text-center py-5 rounded mb-4" style={{ background: "rgba(0,0,0,0.4)", border: `1px solid ${C.red}20` }}>
                <p className="text-xs font-bold tracking-widest mb-3" style={{ color: C.textDim, fontFamily: FONT, fontSize: "8px", letterSpacing: "2px" }}>SQUAWK CODE</p>
                <div className="flex items-center justify-center gap-1.5">{squawk.split("").map((ch, i) => <span key={i} className="inline-flex items-center justify-center w-10 h-12 rounded text-lg font-bold" style={{ background: `${C.red}08`, color: C.text, fontFamily: FONT, border: `1px solid ${C.red}18` }}>{ch}</span>)}</div>
                <p className="text-xs mt-3" style={{ color: C.textDim, fontFamily: FONT, fontSize: "9px" }}>24H EXPIRY · SINGLE USE</p>
              </div>
              <div className="flex gap-2 mb-3">
                <button onClick={() => copy("code")} className="flex-1 py-3 rounded text-xs font-bold tracking-widest" style={{ background: copied === "code" ? `${C.green}12` : C.surface, color: copied === "code" ? C.green : C.textMid, border: `1px solid ${copied === "code" ? C.green + "30" : C.border}`, fontFamily: FONT, fontSize: "9px", letterSpacing: "1.5px" }}>{copied === "code" ? "COPIED" : "COPY CODE"}</button>
                <button onClick={() => copy("msg")} className="flex-1 py-3 rounded text-xs font-bold tracking-widest" style={{ background: copied === "msg" ? `${C.green}12` : C.surface, color: copied === "msg" ? C.green : C.textMid, border: `1px solid ${copied === "msg" ? C.green + "30" : C.border}`, fontFamily: FONT, fontSize: "9px", letterSpacing: "1.5px" }}>{copied === "msg" ? "COPIED" : "COPY MESSAGE"}</button>
              </div>
              <button onClick={generate} className="w-full text-center text-xs font-bold tracking-widest py-2" style={{ color: C.textDim, fontFamily: FONT, fontSize: "9px" }}>REGENERATE</button>
            </div>
          )}
          {viewers.length > 0 && (
            <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${C.border}` }}>
              <p className="text-xs font-bold tracking-widest mb-3" style={{ color: C.textDim, fontFamily: FONT, fontSize: "8px", letterSpacing: "2px" }}>SHARED WITH</p>
              {viewers.map(v => (<div key={v.id} className="flex items-center justify-between py-2"><div className="flex items-center gap-2.5"><div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: `${C.red}12`, color: C.red, fontSize: "9px" }}>{(v.claimed_by || "?").charAt(0)}</div><span className="text-xs" style={{ color: C.textMid, fontFamily: FONT }}>{v.claimed_by}</span></div><button onClick={() => revoke(v.id)} className="text-xs font-bold tracking-widest py-1 px-2" style={{ color: C.textDim, fontFamily: FONT, fontSize: "8px" }}>REVOKE</button></div>))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SQUAWK ENTRY
// ═══════════════════════════════════════════════════════════════════

function SquawkEntry({ onClaim }) {
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const refs = useRef([]);

  const handleChange = (i, val) => { const ch = val.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(-1); const n = [...code]; n[i] = ch; setCode(n); setStatus(null); setError(null); if (ch && i < 5) refs.current[i + 1]?.focus(); };
  const handleKey = (i, e) => { if (e.key === "Backspace" && !code[i] && i > 0) { refs.current[i - 1]?.focus(); const n = [...code]; n[i - 1] = ""; setCode(n); } if (e.key === "Enter" && code.every(c => c)) submit(); };
  const handlePaste = (e) => { e.preventDefault(); const p = e.clipboardData.getData("text").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6); const n = [...code]; for (let i = 0; i < 6; i++) n[i] = p[i] || ""; setCode(n); if (p.length === 6) refs.current[5]?.focus(); };

  const submit = async () => {
    if (code.some(c => !c)) return;
    setStatus("checking"); setError(null);
    try { await api("/squawk/claim", { method: "POST", body: JSON.stringify({ code: code.join("") }) }); setStatus("success"); setTimeout(() => { onClaim(); setCode(["", "", "", "", "", ""]); setStatus(null); }, 1200); } catch (e) { setStatus(null); setError(e.message || "Invalid or expired code"); }
  };

  const full = code.every(c => c);
  return (
    <div className="rounded-lg border p-4 sm:p-5" style={{ background: C.surface, borderColor: C.border }}>
      <p className="text-xs font-bold tracking-widest mb-1" style={{ color: C.textDim, fontFamily: FONT, fontSize: "9px", letterSpacing: "2px" }}>ENTER SQUAWK CODE</p>
      <p className="text-xs mb-4" style={{ color: C.textGhost, fontFamily: FONT, fontSize: "10px" }}>Received a code? Enter it to follow a trip.</p>
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
        <div className="flex gap-1.5 justify-center">{code.map((ch, i) => <input key={i} ref={el => refs.current[i] = el} type="text" inputMode="text" autoCapitalize="characters" value={ch} onChange={e => handleChange(i, e.target.value)} onKeyDown={e => handleKey(i, e)} onPaste={i === 0 ? handlePaste : undefined} maxLength={1} className="w-11 h-13 sm:w-9 sm:h-11 text-center rounded border outline-none text-lg sm:text-base font-bold uppercase" style={{ background: ch ? `${C.red}06` : "rgba(0,0,0,0.3)", borderColor: ch ? `${C.red}25` : C.border, color: C.text, fontFamily: FONT, caretColor: C.red }} />)}</div>
        <button onClick={submit} disabled={!full || status === "checking"} className="px-5 py-3 sm:py-2.5 rounded text-xs font-bold tracking-widest" style={{ background: status === "success" ? `${C.green}12` : full ? C.red : C.surface, color: status === "success" ? C.green : full ? "#fff" : C.textGhost, border: status === "success" ? `1px solid ${C.green}25` : "1px solid transparent", fontFamily: FONT, fontSize: "9px", letterSpacing: "1.5px" }}>{status === "checking" ? <span className="flex items-center justify-center gap-2"><Spinner />CHECKING</span> : status === "success" ? "LINKED" : "CLAIM"}</button>
      </div>
      {error && <p className="text-xs mt-2" style={{ color: C.red, fontFamily: FONT }}>{error}</p>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════

function DashboardPage() {
  const { navigate } = useRouter();
  const [filter, setFilter] = useState("all");
  const [tab, setTab] = useState("my_trips");
  const [trips, setTrips] = useState([]);
  const [following, setFollowing] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = async () => {
    setLoading(true); setError(null);
    try { const [my, fol] = await Promise.all([api("/trips"), api("/trips/following")]); setTrips((my || []).map(mapTrip)); setFollowing((fol || []).map(mapTrip)); } catch (e) { setError(e.message); }
    setLoading(false);
  };
  useEffect(() => { fetchData(); }, []);

  if (loading) return <LoadingScreen />;
  if (error) return <div className="text-center py-12"><p className="text-xs" style={{ color: C.red, fontFamily: FONT }}>{error}</p><button onClick={fetchData} className="mt-3 text-xs font-bold tracking-widest" style={{ color: C.textDim, fontFamily: FONT }}>RETRY</button></div>;

  const liveTrips = trips.filter(t => getTripStatus(t) === "live");
  const otherTrips = trips.filter(t => getTripStatus(t) !== "live");
  const filteredOther = filter === "all" ? otherTrips : otherTrips.filter(t => getTripStatus(t) === filter);
  const filters = [{ key: "all", label: "ALL" }, { key: "upcoming", label: "UPCOMING" }, { key: "completed", label: "PAST" }];

  return (
    <div>
      <div className="flex gap-0 mb-6 border-b overflow-x-auto" style={{ borderColor: C.border }}>
        {[{ key: "my_trips", label: "MY ITINERARIES" }, { key: "following", label: "FOLLOWING" }].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} className="px-4 py-2.5 text-xs font-bold tracking-widest relative whitespace-nowrap" style={{ color: tab === t.key ? C.text : C.textDim, fontFamily: FONT, fontSize: "10px", letterSpacing: "2px" }}>
            {t.label}{t.key === "following" && following.length > 0 && <span className="ml-1.5" style={{ color: C.amber }}>{following.length}</span>}
            {tab === t.key && <div className="absolute bottom-0 left-0 right-0 h-px" style={{ background: C.red }} />}
          </button>
        ))}
      </div>

      {tab === "following" ? (
        <div>
          <SquawkEntry onClaim={fetchData} />
          {following.length > 0 && (
            <div className="mt-6">
              <h3 className="text-xs font-bold tracking-widest mb-3" style={{ color: C.textDim, fontFamily: FONT, fontSize: "9px", letterSpacing: "2px" }}>ACTIVE FEEDS</h3>
              <div className="flex flex-col gap-1.5">{following.map(trip => { const presence = computePresence(trip); return (
                <button key={trip.id} onClick={() => navigate("shared", { tripId: trip.id })} className="w-full text-left border-l-2 transition-all" style={{ borderColor: presence.mode === "transit" ? C[presence.legType] : C.border, background: C.surface }}>
                  <div className="px-3 sm:px-4 py-3">
                    <div className="flex items-center gap-2 mb-1.5"><div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: `${C.red}12`, color: C.red, fontSize: "9px" }}>{(trip.traveler?.name || "?").charAt(0)}</div><span className="text-xs font-bold" style={{ color: C.textMid, fontFamily: FONT }}>{trip.traveler?.name}</span><span style={{ color: C.textGhost }}>·</span><span className="text-sm font-bold truncate" style={{ color: C.text, fontFamily: FONT }}>{trip.title}</span><StatusBadge status={getTripStatus(trip)} /></div>
                    <div className="flex items-center gap-2 ml-8"><span className="text-sm">{presence.emoji}</span><span className="text-xs truncate" style={{ color: C.textMid, fontFamily: FONT }}>{presence.narrative}</span>{presence.progress != null && <div className="flex items-center gap-2 ml-auto shrink-0"><div className="w-12 sm:w-16 h-1 rounded-full overflow-hidden" style={{ background: C.border }}><div className="h-full rounded-full" style={{ width: `${presence.progress * 100}%`, background: C[presence.legType] }} /></div><span className="text-xs font-bold tabular-nums" style={{ color: C.textDim, fontFamily: FONT, fontSize: "9px" }}>{Math.round(presence.progress * 100)}%</span></div>}</div>
                  </div>
                </button>); })}</div>
            </div>
          )}
        </div>
      ) : (
        <>
          {liveTrips.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3"><span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: C.red }} /><span className="relative inline-flex rounded-full h-2 w-2" style={{ background: C.red }} /></span><h3 className="text-xs font-bold tracking-widest" style={{ color: C.red, fontFamily: FONT, fontSize: "9px", letterSpacing: "2px" }}>LIVE NOW</h3></div>
              <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${C.red}20`, background: `${C.red}03` }}>
                {liveTrips.map(trip => { const liveLeg = trip.legs?.find(l => l.status === "in_air" || l.status === "in_transit"); const livePos = liveLeg ? getLivePos(liveLeg) : null; return (
                  <button key={trip.id} onClick={() => navigate("detail", { tripId: trip.id })} className="w-full text-left group transition-all">
                    <div className="px-3 sm:px-4 py-3 sm:py-4">
                      <div className="flex items-center gap-2 sm:gap-3 mb-2 flex-wrap"><h3 className="text-sm font-bold" style={{ color: C.text, fontFamily: FONT }}>{trip.title}</h3><StatusBadge status="live" /></div>
                      {liveLeg && <div className="flex items-center gap-2 sm:gap-3 py-2 px-3 rounded" style={{ background: "rgba(0,0,0,0.2)" }}><LegPill leg={liveLeg} /><span className="text-xs truncate hidden sm:inline" style={{ color: C.textMid, fontFamily: FONT }}>{liveLeg.carrier} {liveLeg.vehicle_number}</span>{livePos && <div className="flex items-center gap-2 ml-auto"><div className="w-16 sm:w-24 h-1.5 rounded-full overflow-hidden" style={{ background: C.border }}><div className="h-full rounded-full" style={{ width: `${livePos.progress * 100}%`, background: C[liveLeg.type] }} /></div><span className="text-xs font-bold tabular-nums" style={{ color: C.textMid, fontFamily: FONT, fontSize: "10px" }}>{Math.round(livePos.progress * 100)}%</span></div>}</div>}
                    </div>
                  </button>); })}
              </div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-4">
            <div className="flex gap-1 p-0.5 rounded" style={{ background: C.surface, border: `1px solid ${C.border}` }}>{filters.map(f => <button key={f.key} onClick={() => setFilter(f.key)} className="flex-1 sm:flex-none px-3 py-1.5 rounded text-xs font-bold tracking-widest" style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "1.5px", color: filter === f.key ? C.text : C.textDim, background: filter === f.key ? "rgba(255,255,255,0.06)" : "transparent" }}>{f.label}</button>)}</div>
            <button onClick={() => navigate("create")} className="flex items-center justify-center gap-2 px-4 py-2.5 rounded text-xs font-bold tracking-widest" style={{ background: C.red, color: "#fff", fontFamily: FONT, fontSize: "10px", letterSpacing: "1.5px" }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 5v14m-7-7h14" /></svg>FILE NEW</button>
          </div>

          <div className="flex flex-col gap-1.5">
            {filteredOther.map(trip => { const status = getTripStatus(trip), isDone = status === "completed", cities = []; trip.legs?.forEach(l => { if (l.origin?.city && !cities.includes(l.origin.city)) cities.push(l.origin.city); if (l.destination?.city && !cities.includes(l.destination.city)) cities.push(l.destination.city); }); return (
              <button key={trip.id} onClick={() => navigate("detail", { tripId: trip.id })} className="w-full text-left group border-l-2 transition-all" style={{ borderColor: isDone ? "rgba(255,255,255,0.03)" : C.border, background: C.surface, opacity: isDone ? 0.5 : 1 }}>
                <div className="px-3 sm:px-4 py-3">
                  <div className="flex items-center gap-2 sm:gap-3 mb-1.5 flex-wrap"><h3 className="text-sm font-bold" style={{ color: C.text, fontFamily: FONT }}>{trip.title}</h3><StatusBadge status={status} /></div>
                  <div className="flex items-center gap-2 flex-wrap"><div className="flex items-center gap-1.5 flex-wrap">{cities.slice(0, 4).map((c, i) => <span key={c} className="flex items-center gap-1.5"><span className="text-xs" style={{ color: C.textMid, fontFamily: FONT }}>{c}</span>{i < Math.min(cities.length, 4) - 1 && <span style={{ color: C.textGhost }}>→</span>}</span>)}</div><span className="text-xs" style={{ color: C.textDim, fontFamily: FONT, fontSize: "10px" }}>{trip.legs?.length || 0} LEG{(trip.legs?.length || 0) !== 1 ? "S" : ""}</span></div>
                </div>
              </button>); })}
            {filteredOther.length === 0 && <div className="text-center py-12 rounded" style={{ background: C.surface, border: `1px dashed ${C.border}` }}><p className="text-xs" style={{ color: C.textGhost, fontFamily: FONT }}>{trips.length === 0 ? "No trips yet. File your first itinerary." : "No trips match this filter"}</p></div>}
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MAP
// ═══════════════════════════════════════════════════════════════════

function TripMap({ trip, activeLegIndex }) {
  const svgRef = useRef(null), containerRef = useRef(null);
  const draw = useCallback(() => {
    const el = containerRef.current, svg = d3.select(svgRef.current); if (!el) return;
    const w = el.clientWidth, h = el.clientHeight; svg.attr("width", w).attr("height", h).selectAll("*").remove();
    const defs = svg.append("defs"); const glow = defs.append("filter").attr("id", "glow").attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%"); glow.append("feGaussianBlur").attr("stdDeviation", "4").attr("result", "b"); const gm = glow.append("feMerge"); gm.append("feMergeNode").attr("in", "b"); gm.append("feMergeNode").attr("in", "SourceGraphic");
    const allC = []; trip.legs?.forEach(l => { if (l.origin?.lat) allC.push([l.origin.lng, l.origin.lat]); if (l.destination?.lat) allC.push([l.destination.lng, l.destination.lat]); });
    if (allC.length === 0) { svg.append("rect").attr("width", w).attr("height", h).attr("fill", "#08080a"); svg.append("text").attr("x", w / 2).attr("y", h / 2).attr("text-anchor", "middle").attr("fill", C.textGhost).attr("font-size", "10px").attr("font-family", FONT).text("No route data"); return; }
    const aLeg = trip.legs?.[activeLegIndex]; let focus = allC; if (aLeg) { focus = []; if (aLeg.origin?.lat) focus.push([aLeg.origin.lng, aLeg.origin.lat]); if (aLeg.destination?.lat) focus.push([aLeg.destination.lng, aLeg.destination.lat]); if (aLeg.type === "hotel" && focus.length > 0) { const c = focus[0]; focus = [[c[0] - 2, c[1] - 1.5], [c[0] + 2, c[1] + 1.5]]; } } if (focus.length < 2) focus = allC;
    const pad = 40, proj = d3.geoMercator().fitExtent([[pad, pad], [w - pad, h - pad]], { type: "MultiPoint", coordinates: focus }), path = d3.geoPath(proj);
    svg.append("rect").attr("width", w).attr("height", h).attr("fill", "#08080a"); svg.append("path").datum(d3.geoGraticule().step([10, 10])()).attr("d", path).attr("fill", "none").attr("stroke", "rgba(255,255,255,0.025)").attr("stroke-width", 0.5);
    trip.legs?.forEach((leg, i) => { if (!leg.origin?.lat || !leg.destination?.lat || (leg.origin.lat === leg.destination.lat && leg.origin.lng === leg.destination.lng)) return; const coords = leg.type === "flight" ? interpolateGC([leg.origin.lng, leg.origin.lat], [leg.destination.lng, leg.destination.lat]) : [[leg.origin.lng, leg.origin.lat], [leg.destination.lng, leg.destination.lat]]; const lineGen = d3.line().x(d => proj(d)[0]).y(d => proj(d)[1]).curve(leg.type === "flight" ? d3.curveBasis : d3.curveLinear); const isA = i === activeLegIndex, color = C[leg.type]; svg.append("path").datum(coords).attr("d", lineGen).attr("fill", "none").attr("stroke", color).attr("stroke-width", isA ? 2.5 : 1).attr("stroke-opacity", isA ? 0.9 : 0.12).attr("stroke-dasharray", leg.type === "train" ? "6,4" : leg.type === "bus" ? "3,3" : "none").attr("filter", isA ? "url(#glow)" : "none"); });
    const cities = new Map(); trip.legs?.forEach(l => { if (l.origin?.lat) cities.set(`${l.origin.lat},${l.origin.lng}`, { ...l.origin, coords: [l.origin.lng, l.origin.lat] }); if (l.destination?.lat) cities.set(`${l.destination.lat},${l.destination.lng}`, { ...l.destination, coords: [l.destination.lng, l.destination.lat] }); });
    const activeKeys = new Set(); if (aLeg) { if (aLeg.origin?.lat) activeKeys.add(`${aLeg.origin.lat},${aLeg.origin.lng}`); if (aLeg.destination?.lat) activeKeys.add(`${aLeg.destination.lat},${aLeg.destination.lng}`); }
    cities.forEach((city, key) => { const [x, y] = proj(city.coords), isA = activeKeys.has(key); if (isA) svg.append("circle").attr("cx", x).attr("cy", y).attr("r", 7).attr("fill", "rgba(255,255,255,0.04)"); svg.append("circle").attr("cx", x).attr("cy", y).attr("r", isA ? 3.5 : 2).attr("fill", isA ? C.text : "rgba(255,255,255,0.3)"); svg.append("text").attr("x", x).attr("y", y - (isA ? 12 : 8)).attr("text-anchor", "middle").attr("fill", isA ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.25)").attr("font-size", isA ? "10px" : "8px").attr("font-family", FONT).attr("font-weight", isA ? 700 : 400).attr("letter-spacing", "1px").text(city.code || city.city); });
    if (aLeg) { const lp = getLivePos(aLeg); if (lp) { const [px, py] = proj([lp.lng, lp.lat]), color = C[aLeg.type]; const ping = svg.append("circle").attr("cx", px).attr("cy", py).attr("r", 5).attr("fill", "none").attr("stroke", color).attr("stroke-width", 1.5).attr("opacity", 0); (function anim() { ping.attr("r", 5).attr("opacity", 0.6).transition().duration(1800).ease(d3.easeQuadOut).attr("r", 22).attr("opacity", 0).on("end", anim); })(); svg.append("circle").attr("cx", px).attr("cy", py).attr("r", 5).attr("fill", color).attr("filter", "url(#glow)"); svg.append("circle").attr("cx", px).attr("cy", py).attr("r", 2).attr("fill", "#fff"); } if (aLeg.type === "hotel" && aLeg.origin?.lat) { const [hx, hy] = proj([aLeg.origin.lng, aLeg.origin.lat]); svg.append("rect").attr("x", hx - 44).attr("y", hy + 10).attr("width", 88).attr("height", 18).attr("rx", 2).attr("fill", "rgba(0,0,0,0.7)").attr("stroke", C.hotel).attr("stroke-width", 0.5); svg.append("text").attr("x", hx).attr("y", hy + 22).attr("text-anchor", "middle").attr("fill", C.hotel).attr("font-size", "8px").attr("font-family", FONT).attr("font-weight", 700).text(aLeg.carrier?.length > 16 ? aLeg.carrier.slice(0, 15) + "…" : aLeg.carrier); } }
  }, [trip, activeLegIndex]);
  useEffect(() => { draw(); const h = () => draw(); window.addEventListener("resize", h); return () => window.removeEventListener("resize", h); }, [draw]);
  return <div ref={containerRef} className="w-full h-full" style={{ background: "#08080a" }}><svg ref={svgRef} className="w-full h-full" /></div>;
}

// ═══════════════════════════════════════════════════════════════════
// DETAIL PAGE (with edit mode)
// ═══════════════════════════════════════════════════════════════════

function DetailPage({ tripId }) {
  const { navigate } = useRouter();
  const [trip, setTrip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeLeg, setActiveLeg] = useState(0);
  const [showShare, setShowShare] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [showLegBuilder, setShowLegBuilder] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [saving, setSaving] = useState(false);
  const [bType, setBType] = useState("flight");
  const [bFN, setBFN] = useState(""); const [bLoading, setBLoading] = useState(false); const [bAF, setBAF] = useState(null); const [bErr, setBErr] = useState(null);
  const [bHN, setBHN] = useState(""); const [bHC, setBHC] = useState(""); const [bHI, setBHI] = useState(""); const [bHO, setBHO] = useState("");
  const [bO, setBO] = useState(""); const [bD, setBD] = useState(""); const [bDt, setBDt] = useState(""); const [bTm, setBTm] = useState("");
  const resetBuilder = () => { setBFN(""); setBLoading(false); setBAF(null); setBErr(null); setBHN(""); setBHC(""); setBHI(""); setBHO(""); setBO(""); setBD(""); setBDt(""); setBTm(""); };
  const typeCfg = { flight: { label: "FLIGHT", color: C.flight }, hotel: { label: "HOTEL", color: C.hotel }, train: { label: "TRAIN", color: C.train }, bus: { label: "BUS", color: C.bus } };

  const fetchTrip = async () => { setLoading(true); try { const t = await api(`/trips/${tripId}`); setTrip(mapTrip(t)); } catch (e) { setTrip(null); } setLoading(false); };
  useEffect(() => { fetchTrip(); }, [tripId]);
  useEffect(() => { if (trip) { const li = trip.legs?.findIndex(l => l.status === "in_air" || l.status === "in_transit"); setActiveLeg(li >= 0 ? li : 0); } }, [trip?.id]);

  const enterEdit = () => { if (!trip) return; setEditing(true); setEditTitle(trip.title); setEditStart(trip.start_date); setEditEnd(trip.end_date); };
  const saveEdit = async () => { setSaving(true); try { await api(`/trips/${trip.id}`, { method: "PUT", body: JSON.stringify({ title: editTitle, start_date: editStart, end_date: editEnd }) }); setTrip(prev => ({ ...prev, title: editTitle, start_date: editStart, end_date: editEnd })); setEditing(false); } catch (e) { alert(e.message); } setSaving(false); };
  const cancelEdit = () => { setEditing(false); setShowLegBuilder(false); setConfirmDelete(null); resetBuilder(); };
  const removeLeg = async (legId) => { try { await api(`/trips/${trip.id}/legs/${legId}`, { method: "DELETE" }); setTrip(prev => ({ ...prev, legs: prev.legs.filter(l => l.id !== legId) })); setConfirmDelete(null); } catch (e) { alert(e.message); } };
  const moveLeg = async (index, dir) => { const newIdx = index + dir; if (newIdx < 0 || newIdx >= trip.legs.length) return; const legs = [...trip.legs]; [legs[index], legs[newIdx]] = [legs[newIdx], legs[index]]; setTrip(prev => ({ ...prev, legs })); setActiveLeg(newIdx); try { await api(`/trips/${trip.id}/legs/reorder`, { method: "PUT", body: JSON.stringify({ leg_ids: legs.map(l => l.id) }) }); } catch (e) { fetchTrip(); } };
  const handleQuery = async () => { if (!bFN.trim()) return; setBLoading(true); setBErr(null); setBAF(null); try { const r = await api(`/flights/lookup?callsign=${bFN.trim().toUpperCase()}`); setBAF(mapFlightLookup(r)); } catch (e) { setBErr("NO MATCH — verify callsign"); } setBLoading(false); };
  const canConfirm = () => { if (bType === "flight") return !!bAF; if (bType === "hotel") return bHN.trim() && bHI; return bO.trim() && bD.trim() && bDt; };

  const addLeg = async () => {
    let newLeg;
    if (bType === "flight" && bAF) { newLeg = { type: "flight", origin: { code: bAF.origin.code, city: bAF.origin.airport, lat: 0, lng: 0 }, destination: { code: bAF.destination.code, city: bAF.destination.airport, lat: 0, lng: 0 }, depart_time: bAF.origin.scheduled, arrive_time: bAF.destination.scheduled, carrier: bAF.carrier, vehicle_number: bAF.callsign, metadata: { terminal: bAF.origin.terminal, gate: bAF.origin.gate } }; }
    else if (bType === "hotel") { const nights = bHO ? Math.max(1, Math.round((new Date(bHO) - new Date(bHI)) / 86400000)) : 1; newLeg = { type: "hotel", origin: { code: null, city: bHN, lat: 0, lng: 0 }, destination: { code: null, city: bHN, lat: 0, lng: 0 }, depart_time: `${bHI}T15:00:00Z`, arrive_time: bHO ? `${bHO}T11:00:00Z` : `${bHI}T11:00:00Z`, carrier: bHN, vehicle_number: null, metadata: { nights, confirmation: bHC } }; }
    else { newLeg = { type: bType, origin: { code: bO.slice(0, 3).toUpperCase(), city: bO, lat: 0, lng: 0 }, destination: { code: bD.slice(0, 3).toUpperCase(), city: bD, lat: 0, lng: 0 }, depart_time: `${bDt}T${bTm || "08:00"}:00Z`, arrive_time: `${bDt}T12:00:00Z`, carrier: bType === "train" ? "Train" : "Bus", vehicle_number: null, metadata: {} }; }
    try { const created = await api(`/trips/${trip.id}/legs`, { method: "POST", body: JSON.stringify(legToApi(newLeg)) }); const mapped = created.origin ? created : mapLeg(created); setTrip(prev => ({ ...prev, legs: [...prev.legs, mapped] })); resetBuilder(); setShowLegBuilder(false); setActiveLeg(trip.legs.length); } catch (e) { alert(e.message); }
  };

  if (loading) return <LoadingScreen />;
  if (!trip) return <div className="text-center py-12"><p className="text-xs" style={{ color: C.textDim, fontFamily: FONT }}>Trip not found</p><button onClick={() => navigate("dashboard")} className="mt-3 text-xs font-bold tracking-widest" style={{ color: C.red, fontFamily: FONT }}>DASHBOARD</button></div>;

  const status = getTripStatus(trip);
  return (
    <div style={{ margin: "-1.5rem -1rem" }} className="flex flex-col lg:flex-row min-h-[calc(100vh-48px)] sm:min-h-[calc(100vh-53px)]">
      {showShare && <SquawkModal trip={trip} onClose={() => setShowShare(false)} />}
      <div className="w-full lg:flex-1 relative" style={{ minHeight: "200px", height: "35vh" }}>
        <TripMap trip={trip} activeLegIndex={activeLeg} />
        <div className="absolute top-2 left-2 sm:top-3 sm:left-3 rounded px-2.5 py-2" style={{ background: "rgba(8,8,10,0.85)", border: `1px solid ${C.border}`, backdropFilter: "blur(8px)", maxWidth: "calc(100% - 80px)" }}>
          <div className="flex items-center gap-2"><button onClick={() => navigate("dashboard")} className="text-xs shrink-0" style={{ color: C.textDim, fontFamily: FONT, fontSize: "10px" }}>← BACK</button><span style={{ color: C.textGhost }}>|</span><span className="text-xs font-bold truncate" style={{ color: C.text, fontFamily: FONT }}>{trip.title.toUpperCase()}</span><StatusBadge status={status} /></div>
        </div>
        <div className="absolute top-2 right-2 sm:top-3 sm:right-3 flex gap-1.5">
          {!editing && <button onClick={enterEdit} className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded" style={{ background: "rgba(8,8,10,0.85)", border: `1px solid ${C.border}`, color: C.textMid, fontFamily: FONT, fontSize: "10px", backdropFilter: "blur(8px)" }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M17 3a2.85 2.85 0 114 4L7.5 20.5 2 22l1.5-5.5Z"/></svg><span className="hidden sm:inline">EDIT</span></button>}
          <button onClick={() => setShowShare(true)} className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded" style={{ background: "rgba(8,8,10,0.85)", border: `1px solid ${C.border}`, color: C.textMid, fontFamily: FONT, fontSize: "10px", backdropFilter: "blur(8px)" }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" /></svg><span className="hidden sm:inline">SHARE</span></button>
        </div>
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">{trip.legs?.map((leg, i) => <button key={leg.id} onClick={() => setActiveLeg(i)} className="rounded-full transition-all duration-300" style={{ width: i === activeLeg ? "20px" : "6px", height: "6px", background: i === activeLeg ? C[leg.type] : "rgba(255,255,255,0.15)" }} />)}</div>
      </div>

      <div className="w-full lg:w-96 lg:border-l overflow-y-auto flex-1 lg:flex-none" style={{ borderColor: C.border }}>
        <div className="p-3 sm:p-4">
          {editing && (
            <div className="mb-4 pb-4" style={{ borderBottom: `1px solid ${C.border}` }}>
              <div className="flex items-center justify-between mb-3"><span className="text-xs font-bold tracking-widest" style={{ color: C.amber, fontFamily: FONT, fontSize: "9px", letterSpacing: "2px" }}>EDITING</span><div className="flex gap-2"><button onClick={cancelEdit} className="text-xs font-bold px-2.5 py-1 rounded" style={{ color: C.textDim, fontFamily: FONT, fontSize: "9px" }}>CANCEL</button><button onClick={saveEdit} disabled={saving} className="text-xs font-bold px-3 py-1 rounded" style={{ background: C.green, color: "#fff", fontFamily: FONT, fontSize: "9px" }}>{saving ? <Spinner /> : "SAVE"}</button></div></div>
              <div className="mb-3"><Label>DESIGNATION</Label><input type="text" value={editTitle} onChange={e => setEditTitle(e.target.value)} className="w-full px-0 py-1.5 border-0 border-b outline-none text-sm font-bold" style={{ background: "transparent", borderColor: C.borderHover, color: C.text, fontFamily: FONT }} /></div>
              <div className="grid grid-cols-2 gap-3"><div><Label>DEPART</Label><Input type="date" value={editStart} onChange={e => setEditStart(e.target.value)} /></div><div><Label>RETURN</Label><Input type="date" value={editEnd} onChange={e => setEditEnd(e.target.value)} /></div></div>
            </div>
          )}

          <h2 className="text-xs font-bold tracking-widest mb-3" style={{ color: C.textDim, fontFamily: FONT, fontSize: "9px", letterSpacing: "2px" }}>ITINERARY · {trip.legs?.length || 0} LEGS</h2>
          <div className="flex flex-col gap-1.5">
            {trip.legs?.map((leg, i) => { const color = C[leg.type], isActive = i === activeLeg, isLive = leg.status === "in_air" || leg.status === "in_transit", isHotel = leg.type === "hotel"; const showDate = i === 0 || formatDate(leg.depart_time) !== formatDate(trip.legs[i - 1]?.depart_time); const isDeleting = confirmDelete === leg.id; return (
              <div key={leg.id}>
                {showDate && <p className="text-xs font-bold mb-1.5 mt-1" style={{ color: C.textDim, fontFamily: FONT, fontSize: "9px" }}>{formatDate(leg.depart_time)}</p>}
                <div className={`w-full text-left border-l-2 transition-all ${editing ? "group" : ""}`} style={{ borderColor: isDeleting ? `${C.red}80` : isActive ? color : "rgba(255,255,255,0.03)", background: isDeleting ? `${C.red}08` : isActive ? `${color}06` : "transparent" }}>
                  {isDeleting ? (
                    <div className="px-3 py-3 flex items-center justify-between"><span className="text-xs font-bold" style={{ color: C.red, fontFamily: FONT }}>Remove?</span><div className="flex gap-2"><button onClick={() => setConfirmDelete(null)} className="text-xs font-bold px-2 py-1 rounded" style={{ color: C.textDim, fontFamily: FONT, fontSize: "9px" }}>KEEP</button><button onClick={() => removeLeg(leg.id)} className="text-xs font-bold px-2.5 py-1 rounded" style={{ background: C.red, color: "#fff", fontFamily: FONT, fontSize: "9px" }}>REMOVE</button></div></div>
                  ) : (
                    <button onClick={() => setActiveLeg(i)} className="w-full text-left"><div className="px-3 py-2.5">
                      <div className="flex items-center gap-2 mb-1"><span className="text-xs font-bold" style={{ color, fontFamily: FONT, fontSize: "9px", letterSpacing: "1.5px" }}>{leg.type.toUpperCase()}</span><span className="text-xs truncate" style={{ color: C.textDim, fontFamily: FONT, fontSize: "10px" }}>{leg.carrier}{leg.vehicle_number ? ` · ${leg.vehicle_number}` : ""}</span>{isLive && <span className="flex items-center gap-1 ml-auto shrink-0"><span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: C.red }} /><span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: C.red }} /></span><span className="text-xs font-bold" style={{ color: C.red, fontFamily: FONT, fontSize: "9px" }}>LIVE</span></span>}
                        {editing && !isLive && <div className="flex items-center gap-0.5 ml-auto opacity-0 group-hover:opacity-100 shrink-0">{i > 0 && <button onClick={e => { e.stopPropagation(); moveLeg(i, -1); }} className="p-1.5" style={{ color: C.textDim }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 15l-6-6-6 6"/></svg></button>}{i < trip.legs.length - 1 && <button onClick={e => { e.stopPropagation(); moveLeg(i, 1); }} className="p-1.5" style={{ color: C.textDim }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6"/></svg></button>}<button onClick={e => { e.stopPropagation(); setConfirmDelete(leg.id); }} className="p-1.5" style={{ color: C.textDim }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>}
                      </div>
                      {isHotel ? <div><p className="text-sm font-bold" style={{ color: C.text, fontFamily: FONT }}>{leg.carrier}</p><p className="text-xs mt-0.5" style={{ color: C.textDim, fontFamily: FONT, fontSize: "10px" }}>{leg.origin?.city} · {leg.metadata?.nights}N</p></div>
                      : <div className="flex items-center gap-1.5 flex-wrap"><span className="text-base font-bold" style={{ color: C.text, fontFamily: FONT }}>{leg.origin?.code || leg.origin?.city}</span><span className="text-xs" style={{ color: C.textDim }}>{formatTime(leg.actual_depart || leg.depart_time)}</span><span style={{ color: C.textGhost }}>→</span><span className="text-base font-bold" style={{ color: C.text, fontFamily: FONT }}>{leg.destination?.code || leg.destination?.city}</span><span className="text-xs" style={{ color: C.textDim }}>{formatTime(leg.arrive_time)}</span><span className="text-xs ml-auto" style={{ color: C.textGhost, fontFamily: FONT, fontSize: "10px" }}>{formatDuration(leg.depart_time, leg.arrive_time)}</span></div>}
                      {isActive && !editing && Object.keys(leg.metadata || {}).length > 0 && <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-2 pt-2" style={{ borderTop: `1px solid ${C.border}` }}>{Object.entries(leg.metadata).filter(([,v]) => v).map(([k, v]) => <span key={k} className="text-xs" style={{ fontFamily: FONT, fontSize: "9px" }}><span style={{ color: C.textDim }}>{k.replace(/_/g, " ").toUpperCase()}: </span><span style={{ color: C.textMid }}>{v}</span></span>)}</div>}
                    </div></button>
                  )}
                </div>
              </div>); })}
          </div>

          {editing && (
            <div className="mt-3">
              {showLegBuilder ? (
                <div className="border rounded" style={{ background: C.surface, borderColor: `${typeCfg[bType].color}30` }}>
                  <div className="flex border-b" style={{ borderColor: C.border }}>{Object.entries(typeCfg).map(([k, v]) => <button key={k} onClick={() => { setBType(k); resetBuilder(); }} className="flex-1 py-2 text-xs font-bold tracking-widest relative" style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "1px", color: bType === k ? v.color : C.textDim, background: bType === k ? `${v.color}06` : "transparent" }}>{v.label}{bType === k && <div className="absolute bottom-0 left-0 right-0 h-px" style={{ background: v.color }} />}</button>)}</div>
                  <div className="p-3">
                    {bType === "flight" && (<><div className="flex flex-col sm:flex-row gap-2 mb-2"><div className="flex-1"><Label>CALLSIGN</Label><Input type="text" value={bFN} onChange={e => { setBFN(e.target.value); setBAF(null); setBErr(null); }} onKeyDown={e => e.key === "Enter" && handleQuery()} placeholder="DL484" style={{ textTransform: "uppercase", letterSpacing: "1px" }} /></div><div className="flex items-end"><button onClick={handleQuery} disabled={bLoading || !bFN.trim()} className="w-full sm:w-auto px-4 py-2.5 rounded text-xs font-bold tracking-widest" style={{ background: bFN.trim() ? `${C.red}15` : C.surface, color: bFN.trim() ? C.red : C.textGhost, border: `1px solid ${bFN.trim() ? C.red + "30" : C.border}`, fontFamily: FONT, fontSize: "9px" }}>{bLoading ? <Spinner /> : "QUERY"}</button></div></div>{bAF && <div className="rounded border p-2.5 mb-2" style={{ background: `${C.green}05`, borderColor: `${C.green}20` }}><div className="flex items-center gap-2 mb-1"><span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: C.green }} /><span className="relative inline-flex rounded-full h-2 w-2" style={{ background: C.green }} /></span><span className="text-xs font-bold" style={{ color: C.green, fontFamily: FONT, fontSize: "9px" }}>MATCH</span></div><div className="grid grid-cols-2 gap-x-4 gap-y-0.5">{[["CARRIER", bAF.carrier], ["ROUTE", `${bAF.origin.code} → ${bAF.destination.code}`], ["DEP", formatTime(bAF.origin.scheduled)], ["ARR", formatTime(bAF.destination.scheduled)]].map(([l, v]) => <div key={l} className="flex items-baseline gap-1.5"><span className="text-xs" style={{ color: C.textDim, fontFamily: FONT, fontSize: "8px", minWidth: 40 }}>{l}</span><span className="text-xs" style={{ color: C.textMid, fontFamily: FONT }}>{v}</span></div>)}</div></div>}{bErr && <p className="mb-2 text-xs font-bold" style={{ color: C.red, fontFamily: FONT, fontSize: "9px" }}>{bErr}</p>}</>)}
                    {bType === "hotel" && <div className="grid grid-cols-1 sm:grid-cols-2 gap-2"><div><Label>PROPERTY</Label><Input value={bHN} onChange={e => setBHN(e.target.value)} placeholder="Park Hyatt Tokyo" /></div><div><Label>CONF NO.</Label><Input value={bHC} onChange={e => setBHC(e.target.value)} placeholder="Optional" /></div><div><Label>CHECK-IN</Label><Input type="date" value={bHI} onChange={e => setBHI(e.target.value)} /></div><div><Label>CHECK-OUT</Label><Input type="date" value={bHO} onChange={e => setBHO(e.target.value)} /></div></div>}
                    {(bType === "train" || bType === "bus") && <div className="grid grid-cols-1 sm:grid-cols-2 gap-2"><div><Label>ORIGIN</Label><Input value={bO} onChange={e => setBO(e.target.value)} placeholder="Tokyo" /></div><div><Label>DEST</Label><Input value={bD} onChange={e => setBD(e.target.value)} placeholder="Kyoto" /></div><div><Label>DATE</Label><Input type="date" value={bDt} onChange={e => setBDt(e.target.value)} /></div><div><Label>TIME (OPT)</Label><Input type="time" value={bTm} onChange={e => setBTm(e.target.value)} /></div></div>}
                    <div className="flex items-center justify-between mt-3 pt-2" style={{ borderTop: `1px solid ${C.border}` }}><button onClick={() => { setShowLegBuilder(false); resetBuilder(); }} className="text-xs font-bold tracking-widest" style={{ color: C.textDim, fontFamily: FONT, fontSize: "9px" }}>CANCEL</button><button onClick={addLeg} disabled={!canConfirm()} className="px-4 py-2 rounded text-xs font-bold tracking-widest" style={{ background: canConfirm() ? typeCfg[bType].color : C.surface, color: canConfirm() ? "#fff" : C.textGhost, fontFamily: FONT, fontSize: "9px" }}>ADD LEG</button></div>
                  </div>
                </div>
              ) : <button onClick={() => setShowLegBuilder(true)} className="w-full py-3 rounded border border-dashed text-xs font-bold tracking-widest" style={{ borderColor: `${C.amber}30`, color: C.amber, fontFamily: FONT, fontSize: "9px", letterSpacing: "2px" }}>+ ADD LEG</button>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CREATE PAGE
// ═══════════════════════════════════════════════════════════════════

function CreatePage() {
  const { navigate } = useRouter();
  const [tripTitle, setTripTitle] = useState(""); const [tripStart, setTripStart] = useState(""); const [tripEnd, setTripEnd] = useState("");
  const [submitted, setSubmitted] = useState(false); const [submitting, setSubmitting] = useState(false);
  const [newTripId, setNewTripId] = useState(null);

  const handleSubmit = async () => { if (!tripTitle.trim()) return; setSubmitting(true); try { const t = await api("/trips", { method: "POST", body: JSON.stringify({ title: tripTitle, description: "", start_date: tripStart || null, end_date: tripEnd || null }) }); setNewTripId(t.id); setSubmitted(true); } catch (e) { alert(e.message); } setSubmitting(false); };

  if (submitted) return (
    <div className="text-center py-20 px-4">
      <div className="inline-flex items-center gap-2 mb-4"><span className="relative flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: C.green }} /><span className="relative inline-flex rounded-full h-3 w-3" style={{ background: C.green }} /></span><span className="text-xs font-bold tracking-widest" style={{ color: C.green, fontFamily: FONT, fontSize: "10px", letterSpacing: "2px" }}>FILED</span></div>
      <h2 className="text-xl font-bold mb-2" style={{ color: C.text, fontFamily: FONT }}>{tripTitle}</h2>
      <p className="text-xs mb-6" style={{ color: C.textDim, fontFamily: FONT }}>Add legs from the trip detail page</p>
      <div className="flex gap-3 justify-center flex-col sm:flex-row"><button onClick={() => navigate("dashboard")} className="px-4 py-2.5 rounded text-xs font-bold tracking-widest" style={{ background: C.surface, color: C.textMid, border: `1px solid ${C.border}`, fontFamily: FONT, fontSize: "10px" }}>DASHBOARD</button>{newTripId && <button onClick={() => navigate("detail", { tripId: newTripId })} className="px-4 py-2.5 rounded text-xs font-bold tracking-widest" style={{ background: `${C.red}15`, color: C.red, border: `1px solid ${C.red}30`, fontFamily: FONT, fontSize: "10px" }}>ADD LEGS</button>}</div>
    </div>
  );

  return (
    <div>
      <h1 className="text-xs font-bold tracking-widest mb-8" style={{ color: C.textDim, fontFamily: FONT, fontSize: "10px", letterSpacing: "3px" }}>FILE NEW ITINERARY</h1>
      <div className="mb-8"><Label>DESIGNATION</Label><input type="text" value={tripTitle} onChange={e => setTripTitle(e.target.value)} placeholder="NYC Weekend" className="w-full px-0 py-2 border-0 border-b outline-none text-xl font-bold" style={{ background: "transparent", borderColor: tripTitle ? C.borderHover : C.border, color: C.text, fontFamily: FONT }} /><div className="grid grid-cols-2 gap-4 mt-4"><div><Label>DEPART</Label><Input type="date" value={tripStart} onChange={e => setTripStart(e.target.value)} /></div><div><Label>RETURN</Label><Input type="date" value={tripEnd} onChange={e => setTripEnd(e.target.value)} /></div></div></div>
      <button onClick={handleSubmit} disabled={!tripTitle.trim() || submitting} className="w-full py-3.5 rounded text-xs font-bold tracking-widest" style={{ background: tripTitle.trim() ? C.red : C.surface, color: tripTitle.trim() ? "#fff" : C.textGhost, fontFamily: FONT, fontSize: "11px", letterSpacing: "2px" }}>{submitting ? <span className="flex items-center justify-center gap-2"><Spinner />FILING</span> : "FILE ITINERARY"}</button>
      <p className="text-center text-xs mt-3" style={{ color: C.textGhost, fontFamily: FONT, fontSize: "9px" }}>Add legs after filing from the trip detail page.</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SHARED VIEW
// ═══════════════════════════════════════════════════════════════════

function SharedPage({ tripId }) {
  const { navigate } = useRouter();
  const [trip, setTrip] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { setLoading(true); api(`/trips/${tripId}`).then(t => setTrip(mapTrip(t))).catch(() => setTrip(null)).finally(() => setLoading(false)); }, [tripId]);

  if (loading) return <LoadingScreen />;
  if (!trip) return <div className="text-center py-12"><p className="text-xs" style={{ color: C.textDim, fontFamily: FONT }}>Trip not found</p></div>;

  const presence = computePresence(trip);
  const travelerName = trip.traveler?.name || "Traveler";

  return (
    <div>
      <button onClick={() => navigate("dashboard")} className="text-xs font-bold tracking-widest mb-6 block" style={{ color: C.textDim, fontFamily: FONT, fontSize: "10px" }}>← BACK</button>
      <div className="flex items-center gap-3 mb-6"><div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: `${C.red}15`, color: C.red }}>{travelerName.charAt(0)}</div><div><p className="text-xs font-bold" style={{ color: C.text, fontFamily: FONT }}>{travelerName.toUpperCase()}'S TRIP</p></div></div>
      <h1 className="text-xl sm:text-2xl font-bold mb-1" style={{ color: C.text, fontFamily: FONT }}>{trip.title.toUpperCase()}</h1>
      <p className="text-xs mb-6" style={{ color: C.textDim, fontFamily: FONT, fontSize: "10px" }}>{formatDateRange(trip.start_date, trip.end_date)}</p>
      <div className="rounded border p-4 sm:p-5 mb-6" style={{ background: presence.mode === "transit" ? `${C[presence.legType]}06` : C.surface, borderColor: presence.mode === "transit" ? `${C[presence.legType]}25` : C.border }}><div className="flex items-start gap-3"><span className="text-2xl">{presence.emoji}</span><div className="flex-1 min-w-0"><p className="text-sm font-bold" style={{ color: C.text, fontFamily: FONT }}>{presence.narrative}</p>{presence.subtext && <p className="text-xs mt-1" style={{ color: C.textMid, fontFamily: FONT }}>{presence.subtext}</p>}{presence.progress != null && <div className="flex items-center gap-3 mt-3"><div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: C.border }}><div className="h-full rounded-full" style={{ width: `${presence.progress * 100}%`, background: C[presence.legType] || C.red }} /></div><span className="text-xs font-bold tabular-nums" style={{ color: C.textDim, fontFamily: FONT, fontSize: "10px" }}>{Math.round(presence.progress * 100)}%</span></div>}</div></div></div>
      <h2 className="text-xs font-bold tracking-widest mb-4" style={{ color: C.textDim, fontFamily: FONT, fontSize: "9px", letterSpacing: "2px" }}>ITINERARY</h2>
      {trip.legs?.map((leg, i) => { const color = C[leg.type], isPast = leg.status === "completed", isLive = leg.status === "in_air" || leg.status === "in_transit"; return (
        <div key={leg.id} className="flex gap-3"><div className="flex flex-col items-center" style={{ width: 20 }}><div className="relative flex items-center justify-center" style={{ width: 20, height: 20, flexShrink: 0 }}>{isLive && <span className="absolute inset-0 rounded-full animate-ping" style={{ background: color, opacity: 0.15 }} />}<div className="rounded-full" style={{ width: isLive ? 10 : 6, height: isLive ? 10 : 6, background: isPast ? C.textDim : isLive ? color : C.textGhost }} /></div>{i < trip.legs.length - 1 && <div className="flex-1 w-px" style={{ background: C.border, minHeight: 20 }} />}</div>
          <div className="pb-4 flex-1 min-w-0"><span className="text-xs font-bold" style={{ color: isPast ? C.textDim : color, fontFamily: FONT, fontSize: "9px", letterSpacing: "1.5px" }}>{leg.type.toUpperCase()}</span>{isLive && <span className="text-xs font-bold ml-2 px-1.5 py-0.5 rounded" style={{ background: `${color}12`, color, fontFamily: FONT, fontSize: "8px" }}>NOW</span>}{leg.type === "hotel" ? <p className="text-xs mt-0.5" style={{ color: isPast ? C.textDim : C.textMid, fontFamily: FONT }}>{leg.origin?.city} · {formatDate(leg.depart_time)} — {formatDate(leg.arrive_time)}</p> : <p className="text-xs mt-0.5 truncate" style={{ color: isPast ? C.textDim : C.textMid, fontFamily: FONT }}>{leg.origin?.code || leg.origin?.city} → {leg.destination?.code || leg.destination?.city} · {leg.carrier} {leg.vehicle_number || ""}</p>}</div></div>); })}
      <div className="mt-8 pt-4 text-center" style={{ borderTop: `1px solid ${C.border}` }}><p className="text-xs tracking-widest" style={{ color: C.textGhost, fontFamily: FONT, fontSize: "9px", letterSpacing: "3px" }}>TRIPTRACK</p></div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// APP SHELL
// ═══════════════════════════════════════════════════════════════════

function TripTrackApp() {
  const { user, loading: authLoading, signOut } = useAuth();
  const [route, setRoute] = useState({ page: "dashboard", params: {} });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { setTimeout(() => setLoaded(true), 50); }, []);
  const navigate = (page, params = {}) => { setRoute({ page, params }); setLoaded(false); setTimeout(() => setLoaded(true), 50); };

  if (authLoading) return <div className="min-h-screen flex items-center justify-center" style={{ background: C.bg }}><Spinner /></div>;
  if (!user) return <LoginPage />;

  const isFullWidth = route.page === "detail";
  return (
    <RouterContext.Provider value={{ route, navigate }}>
      <div className="min-h-screen" style={{ background: C.bg, fontFamily: FONT }}>
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
        <div className="fixed inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 50% 30% at 15% 0%, rgba(232,66,51,0.03) 0%, transparent 50%)" }} />
        <div className="sticky top-0 z-40 flex items-center justify-between px-4 sm:px-6 h-[48px] sm:h-[53px]" style={{ borderBottom: `1px solid ${C.border}`, background: "rgba(12,12,14,0.92)", backdropFilter: "blur(12px)" }}>
          <button onClick={() => navigate("dashboard")} className="text-xs font-bold tracking-widest" style={{ color: C.textDim, fontFamily: FONT, fontSize: "10px", letterSpacing: "3px" }}>TRIPTRACK</button>
          <button onClick={signOut} className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.textDim }} title="Sign out">{(user.user_metadata?.name || user.email || "U").charAt(0).toUpperCase()}</button>
        </div>
        <div className={`transition-all duration-500 ${isFullWidth ? "" : "max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8"}`} style={{ opacity: loaded ? 1 : 0, transform: loaded ? "translateY(0)" : "translateY(8px)" }}>
          {route.page === "dashboard" && <DashboardPage />}
          {route.page === "detail" && <DetailPage tripId={route.params.tripId} />}
          {route.page === "create" && <CreatePage />}
          {route.page === "shared" && <SharedPage tripId={route.params.tripId} />}
        </div>
      </div>
    </RouterContext.Provider>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ROOT EXPORT
// ═══════════════════════════════════════════════════════════════════

export default function App() {
  return <AuthProvider><TripTrackApp /></AuthProvider>;
}
