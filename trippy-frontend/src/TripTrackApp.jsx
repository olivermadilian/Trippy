import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";
import * as d3 from "d3";
import { supabase } from "./supabase";
import * as topojson from "topojson-client";
import worldData from "world-atlas/countries-110m.json";

// ═══════════════════════════════════════════════════════════════════
// API LAYER (inline — no separate file needed)
// ═══════════════════════════════════════════════════════════════════

const API = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

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
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
  };
  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, signIn, signOut }}>{children}</AuthContext.Provider>;
}

// ═══════════════════════════════════════════════════════════════════
// THEME SYSTEM
// ═══════════════════════════════════════════════════════════════════

const NIGHT_TOKENS = {
  "--bg-primary": "#000000",
  "--bg-card": "#050a05",
  "--bg-card-hotel": "#0a0806",
  "--bg-surface": "#0a100a",
  "--bg-map": "#000000",
  "--border-primary": "#1a2a1a",
  "--border-hotel": "#1e1e14",
  "--border-subtle": "#0f1a0f",
  "--text-primary": "#b8e8b8",
  "--text-secondary": "#2a4a2a",
  "--text-tertiary": "#1a3a1a",
  "--text-heading": "#b8e8b8",
  "--accent-flight": "#22c55e",
  "--accent-flight-bright": "#4aff4a",
  "--accent-hotel": "#c9993a",
  "--accent-hotel-text": "#d4c8a0",
  "--accent-hotel-dim": "#3a3420",
  "--accent-countdown": "#c9993a",
  "--map-grid": "#081008",
  "--map-arc": "#22c55e",
  "--map-arc-return": "rgba(34, 197, 94, 0.3)",
  "--map-label": "#4aff4a",
  "--map-dot": "#4aff4a",
  "--map-dwell-glow": "rgba(201, 153, 58, 0.07)",
  "--map-distance": "#1a3a1a",
  "--map-land": "none",
  "--map-land-stroke": "none",
  "--nav-bg": "#0c120c",
  "--nav-border": "#1a2a1a",
  "--nav-text": "#3a6a3a",
  "--nav-text-active": "#4aff4a",
  "--squawk-bg": "#22c55e",
  "--squawk-text": "#000000",
  "--stats-value": "#4aff4a",
  "--stats-label": "#1a3a1a",
  "--timeline-rail": "#1a2a1a",
  "--timeline-dot-border": "#22c55e",
  "--timeline-dot-bg": "#000000",
  "--strip-flight": "#22c55e",
  "--strip-hotel": "#c9993a",
};

const DAY_TOKENS = {
  "--bg-primary": "#f0f4f2",
  "--bg-card": "#e8eee8",
  "--bg-card-hotel": "#f2eee2",
  "--bg-surface": "#e8eee8",
  "--bg-map": "#e6ece8",
  "--border-primary": "#c8d4c8",
  "--border-hotel": "#d4ccb0",
  "--border-subtle": "#d0dcd4",
  "--text-primary": "#1a1a18",
  "--text-secondary": "#7a8a80",
  "--text-tertiary": "#8a9890",
  "--text-heading": "#1a1a18",
  "--accent-flight": "#1a5c3a",
  "--accent-flight-bright": "#1a5c3a",
  "--accent-hotel": "#c9993a",
  "--accent-hotel-text": "#3a2e0a",
  "--accent-hotel-dim": "#a09878",
  "--accent-countdown": "#7a5a10",
  "--map-grid": "#d4dcd6",
  "--map-arc": "#1a5c3a",
  "--map-arc-return": "rgba(26, 92, 58, 0.3)",
  "--map-label": "#1a5c3a",
  "--map-dot": "#1a5c3a",
  "--map-dwell-glow": "rgba(201, 153, 58, 0.07)",
  "--map-distance": "#8aa890",
  "--map-land": "#dce4de",
  "--map-land-stroke": "#c0ccc4",
  "--nav-bg": "#e8ecea",
  "--nav-border": "#b8c4be",
  "--nav-text": "#5a6a60",
  "--nav-text-active": "#2a2a28",
  "--squawk-bg": "#1a5c3a",
  "--squawk-text": "#eef4ee",
  "--stats-value": "#1a5c3a",
  "--stats-label": "#8a9890",
  "--timeline-rail": "#b8ccbe",
  "--timeline-dot-border": "#1a5c3a",
  "--timeline-dot-bg": "#f0f4f2",
  "--strip-flight": "#1a5c3a",
  "--strip-hotel": "#c9993a",
};

function computeMode(pref) {
  if (pref === "day" || pref === "night") return pref;
  const h = new Date().getHours();
  return (h >= 7 && h < 19) ? "day" : "night";
}

function applyTheme(mode) {
  const tokens = mode === "night" ? NIGHT_TOKENS : DAY_TOKENS;
  Object.entries(tokens).forEach(([key, value]) => {
    document.documentElement.style.setProperty(key, value);
  });
}

const ThemeContext = createContext();
function useTheme() { return useContext(ThemeContext); }

function ThemeProvider({ children }) {
  const [pref, setPrefState] = useState(() => {
    try { return localStorage.getItem("triptrack-theme") || "auto"; } catch { return "auto"; }
  });
  const [mode, setMode] = useState(() => computeMode(pref));

  const setPref = (newPref) => {
    setPrefState(newPref);
    try { localStorage.setItem("triptrack-theme", newPref); } catch {}
    const newMode = computeMode(newPref);
    setMode(newMode);
    applyTheme(newMode);
  };

  useEffect(() => {
    applyTheme(mode);
  }, []);

  useEffect(() => {
    if (pref !== "auto") return;
    const interval = setInterval(() => {
      const newMode = computeMode("auto");
      setMode(prev => {
        if (prev !== newMode) { applyTheme(newMode); return newMode; }
        return prev;
      });
    }, 60000);
    return () => clearInterval(interval);
  }, [pref]);

  return <ThemeContext.Provider value={{ mode, pref, setPref }}>{children}</ThemeContext.Provider>;
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
function Label({ children }) { return <label className="block text-xs font-bold mb-1.5" style={{ color: "var(--text-secondary)", fontFamily: FONT, fontSize: "9px", letterSpacing: "1.5px" }}>{children}</label>; }
function Input(props) { const { mode } = useTheme(); return <input {...props} className={`w-full px-3 py-2.5 rounded border outline-none text-sm transition-colors ${props.className || ""}`} style={{ background: "var(--bg-surface)", borderColor: "var(--border-primary)", color: "var(--text-primary)", fontFamily: FONT, colorScheme: mode === "night" ? "dark" : "light", ...props.style }} />; }
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
// DASHBOARD — Global Radar Map
// ═══════════════════════════════════════════════════════════════════

function DashboardMap({ trips, filter, heroTripId }) {
  const svgRef = useRef(null), containerRef = useRef(null);
  const { mode } = useTheme();

  const draw = useCallback(() => {
    const el = containerRef.current, svg = d3.select(svgRef.current);
    if (!el) return;
    const w = el.clientWidth, h = el.clientHeight;
    svg.attr("width", w).attr("height", h).selectAll("*").remove();
    const isDay = mode === "day";

    const defs = svg.append("defs");
    const glow = defs.append("filter").attr("id", "dash-glow").attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%");
    glow.append("feGaussianBlur").attr("stdDeviation", "4").attr("result", "b");
    const gm = glow.append("feMerge"); gm.append("feMergeNode").attr("in", "b"); gm.append("feMergeNode").attr("in", "SourceGraphic");

    const gridSize = 30;
    defs.append("pattern").attr("id", "dash-grid").attr("width", gridSize).attr("height", gridSize).attr("patternUnits", "userSpaceOnUse")
      .append("path").attr("d", `M ${gridSize} 0 L 0 0 0 ${gridSize}`).attr("fill", "none").attr("stroke", "var(--map-grid)").attr("stroke-width", 0.5);

    const allC = [];
    trips.forEach(t => t.legs?.forEach(l => {
      if (l.origin?.lat != null) allC.push([l.origin.lng, l.origin.lat]);
      if (l.destination?.lat != null) allC.push([l.destination.lng, l.destination.lat]);
    }));

    const pad = 30;
    const proj = allC.length > 0
      ? d3.geoMercator().fitExtent([[pad, pad], [w - pad, h - pad - 20]], { type: "MultiPoint", coordinates: allC })
      : d3.geoMercator().center([-98, 38]).scale(w / 6).translate([w / 2, h / 2]);
    const path = d3.geoPath(proj);

    svg.append("rect").attr("width", w).attr("height", h).attr("fill", "var(--bg-map)");
    svg.append("rect").attr("width", "100%").attr("height", "100%").attr("fill", "url(#dash-grid)");

    const land = topojson.feature(worldData, worldData.objects.land);
    const borders = topojson.mesh(worldData, worldData.objects.countries, (a, b) => a !== b);
    if (isDay) {
      svg.append("path").datum(land).attr("d", path).attr("fill", "var(--map-land)").attr("stroke", "var(--map-land-stroke)").attr("stroke-width", 0.8);
      svg.append("path").datum(borders).attr("d", path).attr("fill", "none").attr("stroke", "var(--map-land-stroke)").attr("stroke-width", 0.5);
    } else {
      svg.append("path").datum(borders).attr("d", path).attr("fill", "none").attr("stroke", "var(--map-grid)").attr("stroke-width", 0.5);
    }

    // Ghost arcs (non-hero trips)
    trips.forEach(trip => {
      if (trip.id === heroTripId) return;
      trip.legs?.forEach(leg => {
        if (leg.type === "hotel" || leg.origin?.lat == null || leg.destination?.lat == null) return;
        const coords = leg.type === "flight" ? interpolateGC([leg.origin.lng, leg.origin.lat], [leg.destination.lng, leg.destination.lat]) : [[leg.origin.lng, leg.origin.lat], [leg.destination.lng, leg.destination.lat]];
        const lineGen = d3.line().x(d => proj(d)[0]).y(d => proj(d)[1]).curve(leg.type === "flight" ? d3.curveBasis : d3.curveLinear);
        svg.append("path").datum(coords).attr("d", lineGen).attr("fill", "none").attr("stroke", "var(--map-arc)").attr("stroke-width", 1).attr("opacity", 0.13);
      });
      const gc = new Map();
      trip.legs?.forEach(l => {
        if (l.type === "hotel") return;
        if (l.origin?.lat != null) gc.set(`${l.origin.lat},${l.origin.lng}`, { code: l.origin.code, coords: [l.origin.lng, l.origin.lat] });
        if (l.destination?.lat != null) gc.set(`${l.destination.lat},${l.destination.lng}`, { code: l.destination.code, coords: [l.destination.lng, l.destination.lat] });
      });
      gc.forEach(c => {
        const [x, y] = proj(c.coords);
        svg.append("circle").attr("cx", x).attr("cy", y).attr("r", 2).attr("fill", "var(--map-arc)").attr("opacity", 0.18);
        if (c.code) svg.append("text").attr("x", x).attr("y", y - 8).attr("text-anchor", "middle").attr("fill", "var(--map-label)").attr("font-size", "7px").attr("font-family", FONT).attr("opacity", 0.18).text(c.code);
      });
    });

    // Hero trip
    const heroTrip = trips.find(t => t.id === heroTripId);
    if (heroTrip) {
      heroTrip.legs?.forEach(leg => {
        if (leg.type === "hotel" && leg.origin?.lat != null) {
          const [hx, hy] = proj([leg.origin.lng, leg.origin.lat]);
          svg.append("circle").attr("cx", hx).attr("cy", hy).attr("r", 22).attr("fill", "var(--map-dwell-glow)");
          svg.append("circle").attr("cx", hx).attr("cy", hy).attr("r", 16).attr("fill", "var(--accent-hotel)").attr("opacity", 0.08);
        }
      });

      let isFirst = true;
      heroTrip.legs?.forEach(leg => {
        if (leg.type === "hotel" || leg.origin?.lat == null || leg.destination?.lat == null) return;
        const coords = leg.type === "flight" ? interpolateGC([leg.origin.lng, leg.origin.lat], [leg.destination.lng, leg.destination.lat]) : [[leg.origin.lng, leg.origin.lat], [leg.destination.lng, leg.destination.lat]];
        const lineGen = d3.line().x(d => proj(d)[0]).y(d => proj(d)[1]).curve(leg.type === "flight" ? d3.curveBasis : d3.curveLinear);
        if (isFirst) {
          svg.append("path").datum(coords).attr("d", lineGen).attr("fill", "none").attr("stroke", "var(--map-arc)").attr("stroke-width", 2.5).attr("stroke-linecap", "round").attr("opacity", 0.7);
          isFirst = false;
        } else {
          svg.append("path").datum(coords).attr("d", lineGen).attr("fill", "none").attr("stroke", "var(--map-arc)").attr("stroke-width", 1.2).attr("stroke-dasharray", "5,3").attr("opacity", 0.25);
        }
      });

      const hc = new Map();
      heroTrip.legs?.forEach(l => {
        if (l.type === "hotel") return;
        if (l.origin?.lat != null) hc.set(`${l.origin.lat},${l.origin.lng}`, { ...l.origin, coords: [l.origin.lng, l.origin.lat] });
        if (l.destination?.lat != null) hc.set(`${l.destination.lat},${l.destination.lng}`, { ...l.destination, coords: [l.destination.lng, l.destination.lat] });
      });
      hc.forEach(city => {
        const [x, y] = proj(city.coords);
        svg.append("circle").attr("cx", x).attr("cy", y).attr("r", 7).attr("fill", "none").attr("stroke", "var(--map-arc)").attr("stroke-width", 0.5).attr("opacity", 0.4);
        svg.append("circle").attr("cx", x).attr("cy", y).attr("r", 3.5).attr("fill", "var(--map-dot)");
        svg.append("text").attr("x", x).attr("y", y - 12).attr("text-anchor", "middle").attr("fill", "var(--map-label)").attr("font-size", "9px").attr("font-family", FONT).attr("font-weight", 600).text(city.code || city.city);
      });

      const liveLeg = heroTrip.legs?.find(l => l.status === "in_air" || l.status === "in_transit");
      if (liveLeg) {
        const lp = getLivePos(liveLeg);
        if (lp) {
          const [px, py] = proj([lp.lng, lp.lat]);
          const ping = svg.append("circle").attr("cx", px).attr("cy", py).attr("r", 5).attr("fill", "none").attr("stroke", "var(--map-arc)").attr("stroke-width", 1.5).attr("opacity", 0);
          (function anim() { ping.attr("r", 5).attr("opacity", 0.6).transition().duration(1800).ease(d3.easeQuadOut).attr("r", 22).attr("opacity", 0).on("end", anim); })();
          svg.append("circle").attr("cx", px).attr("cy", py).attr("r", 5).attr("fill", "var(--map-arc)").attr("filter", "url(#dash-glow)");
          svg.append("circle").attr("cx", px).attr("cy", py).attr("r", 2).attr("fill", "var(--bg-primary)");
        }
      }
    }

    const isPast = filter === "completed";
    const cnt = trips.length;
    const countText = cnt === 0 ? "NO FLIGHT PLANS FILED" : `${cnt} FLIGHT PLAN${cnt !== 1 ? "S" : ""} ${isPast ? "ARCHIVED" : "FILED"}`;
    svg.append("text").attr("x", w / 2).attr("y", h - 10).attr("text-anchor", "middle").attr("fill", "var(--map-distance)").attr("font-size", "8px").attr("font-family", FONT).attr("letter-spacing", "2px").text(countText);
  }, [trips, filter, heroTripId, mode]);

  useEffect(() => { draw(); const h = () => draw(); window.addEventListener("resize", h); return () => window.removeEventListener("resize", h); }, [draw]);

  return (
    <div ref={containerRef} className="w-full" style={{ height: 195, background: "var(--bg-map)", borderBottom: mode === "day" ? "1px solid var(--border-subtle)" : "none" }}>
      <svg ref={svgRef} className="w-full h-full" />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD — Route & Card Helpers
// ═══════════════════════════════════════════════════════════════════

function InlineRoute({ legs, codeSize = "16px" }) {
  if (!legs?.length) return null;
  const items = [];
  let lastCode = null;
  for (const leg of legs) {
    if (leg.type === "hotel") {
      if (items.length > 0 && items[items.length - 1].t === "c") items.push({ t: "h" });
      continue;
    }
    const oc = leg.origin?.code || leg.origin?.city?.slice(0, 3)?.toUpperCase() || "?";
    const dc = leg.destination?.code || leg.destination?.city?.slice(0, 3)?.toUpperCase() || "?";
    if (oc !== lastCode) {
      if (items.length > 0 && items[items.length - 1].t !== "h") items.push({ t: "f" });
      items.push({ t: "c", code: oc });
    }
    items.push({ t: "f" });
    items.push({ t: "c", code: dc });
    lastCode = dc;
  }
  return (
    <div className="flex items-center gap-0.5 overflow-x-auto">
      {items.map((it, i) => it.t === "c"
        ? <span key={i} style={{ fontFamily: FONT, fontSize: codeSize, fontWeight: 700, color: "var(--accent-flight-bright)", letterSpacing: "1px", flexShrink: 0 }}>{it.code}</span>
        : it.t === "f"
          ? <span key={i} style={{ width: 20, height: 0, borderTop: "1px solid var(--border-primary)", display: "inline-block", flexShrink: 0 }} />
          : <span key={i} style={{ width: 14, height: 0, borderTop: "1px dashed var(--accent-hotel)", opacity: 0.5, display: "inline-block", flexShrink: 0 }} />
      )}
    </div>
  );
}

function DashLegIndicators({ legs, showTotal = true }) {
  const counts = { flight: 0, hotel: 0, train: 0, bus: 0 };
  (legs || []).forEach(l => { if (counts[l.type] !== undefined) counts[l.type]++; });
  const total = (legs || []).length;
  const items = [];
  if (counts.flight) items.push({ color: "var(--accent-flight)", label: `${counts.flight} FLIGHT${counts.flight !== 1 ? "S" : ""}` });
  if (counts.hotel) items.push({ color: "var(--accent-hotel)", label: `${counts.hotel} HOTEL${counts.hotel !== 1 ? "S" : ""}` });
  if (counts.train) items.push({ color: "#d4628a", label: `${counts.train} TRAIN${counts.train !== 1 ? "S" : ""}` });
  if (counts.bus) items.push({ color: "#7c6bb4", label: `${counts.bus} BUS${counts.bus !== 1 ? "ES" : ""}` });
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        {items.map((ind, i) => <div key={i} className="flex items-center gap-1"><span style={{ width: 6, height: 6, borderRadius: "50%", background: ind.color, display: "inline-block" }} /><span style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "1px", color: "var(--text-tertiary)" }}>{ind.label}</span></div>)}
      </div>
      {showTotal && <span style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "1px", color: "var(--text-tertiary)" }}>{total} LEG{total !== 1 ? "S" : ""}</span>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD PAGE
// ═══════════════════════════════════════════════════════════════════

function DashboardPage() {
  const { navigate } = useRouter();
  const { mode } = useTheme();
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
  if (error) return <div className="text-center py-12"><p className="text-xs" style={{ color: "var(--accent-flight)", fontFamily: FONT }}>{error}</p><button onClick={fetchData} className="mt-3 text-xs font-bold tracking-widest" style={{ color: "var(--text-secondary)", fontFamily: FONT }}>RETRY</button></div>;

  const live = trips.filter(t => getTripStatus(t) === "live");
  const upcoming = trips.filter(t => { const s = getTripStatus(t); return s === "upcoming" || s === "active"; }).sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
  const past = trips.filter(t => getTripStatus(t) === "completed").sort((a, b) => new Date(b.end_date) - new Date(a.end_date));

  let mapTripsArr;
  if (filter === "all") mapTripsArr = trips;
  else if (filter === "upcoming") mapTripsArr = [...live, ...upcoming];
  else mapTripsArr = past;

  const heroTrip = filter === "completed" ? null : (live[0] || upcoming[0] || null);
  const nextDep = upcoming[0] || null;
  const otherUpcoming = upcoming.slice(1);
  const filters = [{ key: "all", label: "ALL" }, { key: "upcoming", label: "UPCOMING" }, { key: "completed", label: "PAST" }];

  return (
    <div>
      {/* Tab bar */}
      <div className="flex gap-6" style={{ padding: "14px 16px 0", borderBottom: "1px solid var(--border-subtle)" }}>
        {[{ key: "my_trips", label: "MY ITINERARIES" }, { key: "following", label: "FOLLOWING" }].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} className="relative pb-3" style={{ fontFamily: FONT, fontSize: "10px", letterSpacing: "3px", fontWeight: tab === t.key ? 500 : 400, color: tab === t.key ? "var(--accent-flight-bright)" : "var(--text-tertiary)", minHeight: 44, display: "flex", alignItems: "center" }}>
            {t.label}{t.key === "following" && following.length > 0 && <span className="ml-1.5" style={{ color: "var(--accent-hotel)" }}>{following.length}</span>}
            {tab === t.key && <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: "var(--accent-flight-bright)" }} />}
          </button>
        ))}
      </div>

      {tab === "following" ? (
        <div className="px-4 py-4">
          <SquawkEntry onClaim={fetchData} />
          {following.length > 0 ? (
            <div className="mt-6">
              <h3 style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "3px", color: "var(--text-secondary)", marginBottom: 10, fontWeight: 700 }}>ACTIVE FEEDS</h3>
              <div className="flex flex-col gap-1.5">{following.map(trip => { const presence = computePresence(trip); return (
                <button key={trip.id} onClick={() => navigate("shared", { tripId: trip.id })} className="w-full text-left" style={{ borderLeft: `3px solid ${presence.mode === "transit" ? (C[presence.legType] || "var(--strip-flight)") : "var(--border-primary)"}`, borderRadius: 4, background: "var(--bg-card)", padding: "10px 12px" }}>
                  <div className="flex items-center gap-2 mb-1.5"><div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: "var(--bg-surface)", color: "var(--accent-flight)", fontSize: "9px", border: "1px solid var(--border-primary)" }}>{(trip.traveler?.name || "?").charAt(0)}</div><span className="text-xs font-bold" style={{ color: "var(--text-secondary)", fontFamily: FONT }}>{trip.traveler?.name}</span><span style={{ color: "var(--text-tertiary)" }}>{"·"}</span><span className="text-sm font-bold truncate" style={{ color: "var(--text-heading)", fontFamily: FONT }}>{trip.title}</span><StatusBadge status={getTripStatus(trip)} /></div>
                  <div className="flex items-center gap-2 ml-8"><span className="text-sm">{presence.emoji}</span><span className="text-xs truncate" style={{ color: "var(--text-secondary)", fontFamily: FONT }}>{presence.narrative}</span>{presence.progress != null && <div className="flex items-center gap-2 ml-auto shrink-0"><div className="w-16 h-1 rounded-full overflow-hidden" style={{ background: "var(--border-primary)" }}><div className="h-full rounded-full" style={{ width: `${presence.progress * 100}%`, background: C[presence.legType] }} /></div><span className="text-xs font-bold tabular-nums" style={{ color: "var(--text-secondary)", fontFamily: FONT, fontSize: "9px" }}>{Math.round(presence.progress * 100)}%</span></div>}</div>
                </button>); })}</div>
            </div>
          ) : (
            <div className="mt-6" style={{ border: "1px dashed var(--border-primary)", borderRadius: 6, padding: "20px 14px", textAlign: "center" }}>
              <p style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "1px", color: "var(--text-tertiary)" }}>NO FOLLOWED TRIPS {"·"} ENTER A SQUAWK CODE TO START</p>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Filter pills */}
          <div className="flex" style={{ padding: "10px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
            {filters.map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)} className="flex-1 text-center relative" style={{ padding: "8px 0", fontFamily: FONT, fontSize: "9px", letterSpacing: "2px", color: filter === f.key ? "var(--accent-flight-bright)" : "var(--text-tertiary)", minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {f.label}
                {filter === f.key && <div className="absolute bottom-0 left-2 right-2 h-px" style={{ background: "var(--accent-flight)" }} />}
              </button>
            ))}
          </div>

          {/* Global radar map */}
          <DashboardMap trips={mapTripsArr} filter={filter} heroTripId={heroTrip?.id} />

          {/* Trip cards */}
          <div className="px-4 py-4">
            {trips.length === 0 ? (
              <button onClick={() => navigate("create")} className="w-full text-left" style={{ border: "1px dashed var(--border-primary)", borderRadius: 6, padding: "24px 14px", textAlign: "center" }}>
                <p style={{ fontFamily: FONT, fontSize: "12px", letterSpacing: "1px", color: "var(--text-secondary)", marginBottom: 8 }}>FILE YOUR FIRST FLIGHT PLAN</p>
                <p style={{ fontFamily: FONT, fontSize: "16px", fontWeight: 700, letterSpacing: "2px", color: "var(--text-tertiary)", marginBottom: 8 }}>??? {"→"} ???</p>
                <p style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-tertiary)" }}>Tap FILE to begin tracking</p>
              </button>
            ) : filter === "completed" ? (
              past.length > 0 ? (
                <div>
                  <p style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "3px", color: "var(--text-tertiary)", marginBottom: 10 }}>PAST</p>
                  <div className="flex flex-col gap-2">
                    {past.map(trip => (
                      <button key={trip.id} onClick={() => navigate("detail", { tripId: trip.id })} className="w-full text-left" style={{ opacity: 0.5, border: "1px solid var(--border-primary)", borderLeft: "3px solid var(--strip-flight)", borderRadius: 6, padding: 14, background: "var(--bg-card)" }}>
                        <div className="flex items-center justify-between mb-1">
                          <h3 style={{ fontFamily: FONT, fontSize: "14px", fontWeight: 600, color: "var(--text-heading)" }}>{trip.title}</h3>
                        </div>
                        <p style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-secondary)", letterSpacing: "0.5px", marginBottom: 6 }}>{formatDateRange(trip.start_date, trip.end_date)}</p>
                        <InlineRoute legs={trip.legs} codeSize="14px" />
                        <div className="mt-2"><DashLegIndicators legs={trip.legs} showTotal={false} /></div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ border: `1px dashed ${mode === "night" ? "var(--border-subtle)" : "var(--border-primary)"}`, borderRadius: 6, padding: "20px 14px", textAlign: "center" }}>
                  <p style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "1px", color: "var(--text-tertiary)" }}>NO COMPLETED FLIGHT PLANS</p>
                </div>
              )
            ) : (
              <>
                {/* Live Now */}
                {live.length > 0 && (
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-2.5">
                      <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "var(--accent-flight)" }} /><span className="relative inline-flex rounded-full h-2 w-2" style={{ background: "var(--accent-flight)" }} /></span>
                      <p style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "3px", color: "var(--accent-flight-bright)", fontWeight: 700 }}>LIVE NOW</p>
                    </div>
                    {live.map(trip => {
                      const liveLeg = trip.legs?.find(l => l.status === "in_air" || l.status === "in_transit");
                      const livePos = liveLeg ? getLivePos(liveLeg) : null;
                      return (
                        <button key={trip.id} onClick={() => navigate("detail", { tripId: trip.id })} className="w-full text-left mb-2" style={{ border: "1px solid var(--border-primary)", borderLeft: "3px solid var(--strip-flight)", borderRadius: 6, padding: 14, background: "var(--bg-card)" }}>
                          <div className="flex items-center justify-between mb-2">
                            <h3 style={{ fontFamily: FONT, fontSize: "16px", fontWeight: 600, color: "var(--text-heading)" }}>{trip.title}</h3>
                            <span className="inline-flex items-center gap-1.5 px-2 py-1" style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "1px", color: "var(--accent-flight-bright)", border: "1px solid var(--accent-flight)", borderRadius: 4 }}>
                              <span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "var(--accent-flight)" }} /><span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: "var(--accent-flight)" }} /></span>
                              EN ROUTE
                            </span>
                          </div>
                          {liveLeg && (
                            <>
                              <div className="flex items-center gap-2 mb-2">
                                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent-flight)", display: "inline-block" }} />
                                <span style={{ fontFamily: FONT, fontSize: "12px", fontWeight: 600, color: "var(--accent-flight-bright)" }}>{liveLeg.origin?.code || "?"} {"→"} {liveLeg.destination?.code || "?"}</span>
                                {livePos && (
                                  <div className="flex items-center gap-2 ml-auto">
                                    <div style={{ width: 80, height: 4, borderRadius: 2, background: "var(--border-primary)", overflow: "hidden" }}>
                                      <div style={{ width: `${livePos.progress * 100}%`, height: "100%", borderRadius: 2, background: "var(--accent-flight)" }} />
                                    </div>
                                    <span style={{ fontFamily: FONT, fontSize: "9px", fontWeight: 700, color: "var(--text-secondary)" }}>{Math.round(livePos.progress * 100)}%</span>
                                  </div>
                                )}
                              </div>
                              <p style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-tertiary)", letterSpacing: "0.5px" }}>
                                {[liveLeg.carrier, liveLeg.vehicle_number, liveLeg.arrive_time ? `LANDS ${formatTime(liveLeg.arrive_time)}` : null].filter(Boolean).join(" · ")}
                              </p>
                            </>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Next Departure (hero card) */}
                {nextDep && (
                  <div className="mb-4">
                    <p style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "3px", color: "var(--text-secondary)", marginBottom: 10, fontWeight: 700 }}>NEXT DEPARTURE</p>
                    <button onClick={() => navigate("detail", { tripId: nextDep.id })} className="w-full text-left" style={{ border: "1px solid var(--border-primary)", borderLeft: "3px solid var(--strip-flight)", borderRadius: 6, padding: 14, background: "var(--bg-card)" }}>
                      <div className="flex items-center justify-between mb-1">
                        <h3 style={{ fontFamily: FONT, fontSize: "16px", fontWeight: 600, color: "var(--text-heading)" }}>{nextDep.title}</h3>
                        <span className="px-2.5 py-1 shrink-0" style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "1px", color: "var(--accent-countdown)", border: "1px solid var(--accent-hotel-dim)", borderRadius: 4, fontWeight: 500 }}>{getCountdown(nextDep).text}</span>
                      </div>
                      <p style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-secondary)", letterSpacing: "0.5px", marginBottom: 8 }}>{formatDateRange(nextDep.start_date, nextDep.end_date)}</p>
                      <div style={{ marginBottom: 8 }}><InlineRoute legs={nextDep.legs} codeSize="16px" /></div>
                      <DashLegIndicators legs={nextDep.legs} showTotal={true} />
                    </button>
                  </div>
                )}

                {/* Remaining upcoming (compact cards) */}
                {otherUpcoming.length > 0 && (
                  <div className="mb-4">
                    <p style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "3px", color: "var(--text-tertiary)", marginBottom: 10 }}>UPCOMING</p>
                    <div className="flex flex-col gap-2">
                      {otherUpcoming.map(trip => {
                        const ms = trip.legs?.[0]?.depart_time ? new Date(trip.legs[0].depart_time).getTime() - Date.now() : 0;
                        const days = Math.max(0, Math.floor(ms / 86400000));
                        const shortCd = ms > 0 ? `T-${days}D` : null;
                        return (
                          <button key={trip.id} onClick={() => navigate("detail", { tripId: trip.id })} className="w-full text-left" style={{ opacity: mode === "day" ? 0.55 : 0.65, border: "1px solid var(--border-primary)", borderLeft: "3px solid var(--strip-flight)", borderRadius: 6, padding: 14, background: "var(--bg-card)" }}>
                            <div className="flex items-center justify-between mb-1">
                              <h3 style={{ fontFamily: FONT, fontSize: "14px", fontWeight: 600, color: "var(--text-heading)" }}>{trip.title}</h3>
                              {shortCd && <span style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-secondary)" }}>{shortCd}</span>}
                            </div>
                            <p style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-secondary)", letterSpacing: "0.5px", marginBottom: 6 }}>{formatDateRange(trip.start_date, trip.end_date)}</p>
                            <InlineRoute legs={trip.legs} codeSize="14px" />
                            <div className="mt-2"><DashLegIndicators legs={trip.legs} showTotal={false} /></div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Past (when ALL filter) */}
                {filter === "all" && past.length > 0 && (
                  <div>
                    <p style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "3px", color: "var(--text-tertiary)", marginBottom: 10 }}>PAST</p>
                    <div className="flex flex-col gap-2">
                      {past.map(trip => (
                        <button key={trip.id} onClick={() => navigate("detail", { tripId: trip.id })} className="w-full text-left" style={{ opacity: 0.5, border: "1px solid var(--border-primary)", borderLeft: "3px solid var(--strip-flight)", borderRadius: 6, padding: 14, background: "var(--bg-card)" }}>
                          <div className="flex items-center justify-between mb-1">
                            <h3 style={{ fontFamily: FONT, fontSize: "14px", fontWeight: 600, color: "var(--text-heading)" }}>{trip.title}</h3>
                          </div>
                          <p style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-secondary)", letterSpacing: "0.5px", marginBottom: 6 }}>{formatDateRange(trip.start_date, trip.end_date)}</p>
                          <InlineRoute legs={trip.legs} codeSize="14px" />
                          <div className="mt-2"><DashLegIndicators legs={trip.legs} showTotal={false} /></div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Empty states */}
                {filter === "upcoming" && live.length === 0 && upcoming.length === 0 && (
                  <div style={{ border: `1px dashed ${mode === "night" ? "var(--border-subtle)" : "var(--border-primary)"}`, borderRadius: 6, padding: "20px 14px", textAlign: "center" }}>
                    <p style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "1px", color: "var(--text-tertiary)" }}>NO UPCOMING FLIGHT PLANS</p>
                  </div>
                )}
                {filter === "all" && live.length === 0 && upcoming.length === 0 && past.length === 0 && trips.length > 0 && (
                  <div style={{ border: "1px dashed var(--border-primary)", borderRadius: 6, padding: "20px 14px", textAlign: "center" }}>
                    <p style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "1px", color: "var(--text-tertiary)" }}>NO TRIPS MATCH THIS FILTER</p>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// DETAIL HELPERS
// ═══════════════════════════════════════════════════════════════════

function haversineNM(lat1, lon1, lat2, lon2) {
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) / 1.852;
}

function computeTripStats(legs) {
  let totalNM = 0, airMs = 0, hotelNights = 0;
  (legs || []).forEach(l => {
    if (l.type !== "hotel" && l.origin?.lat != null && l.destination?.lat != null) {
      totalNM += haversineNM(l.origin.lat, l.origin.lng, l.destination.lat, l.destination.lng);
      if (l.depart_time && l.arrive_time) airMs += new Date(l.arrive_time) - new Date(l.depart_time);
    }
    if (l.type === "hotel") hotelNights += l.metadata?.nights || (l.depart_time && l.arrive_time ? Math.max(1, Math.round((new Date(l.arrive_time) - new Date(l.depart_time)) / 86400000)) : 1);
  });
  const airH = Math.floor(airMs / 3600000), airM = Math.floor((airMs % 3600000) / 60000);
  return { totalNM: Math.round(totalNM), airTime: `${airH}H ${airM}M`, hotelNights };
}

function getCountdown(trip) {
  const status = getTripStatus(trip);
  if (status === "completed") return { text: "COMPLETE", label: "FLIGHT PLAN ARCHIVED" };
  if (status === "live" || status === "active") return { text: "EN ROUTE", label: "FLIGHT PLAN ACTIVE" };
  const first = trip.legs?.[0];
  if (!first?.depart_time) return { text: "PENDING", label: "FLIGHT PLAN FILED" };
  const ms = new Date(first.depart_time).getTime() - Date.now();
  if (ms <= 0) return { text: "EN ROUTE", label: "FLIGHT PLAN ACTIVE" };
  const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return { text: d >= 1 ? `T-${d}D ${h}H` : `T-${h}H ${m}M`, label: "FLIGHT PLAN FILED" };
}

function formatCoord(lat, lng) {
  const latDir = lat >= 0 ? "N" : "S", lngDir = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}\u00B0${latDir} ${Math.abs(lng).toFixed(2)}\u00B0${lngDir}`;
}

const STRIP_COLORS = { flight: "var(--strip-flight)", hotel: "var(--strip-hotel)", train: "#d4628a", bus: "#7c6bb4" };

// ═══════════════════════════════════════════════════════════════════
// ROUTE SUMMARY BAR
// ═══════════════════════════════════════════════════════════════════

function RouteSummaryBar({ legs }) {
  if (!legs?.length) return null;
  const segments = [];
  legs.forEach((leg, i) => {
    const isHotel = leg.type === "hotel";
    if (isHotel) {
      const nights = leg.metadata?.nights || (leg.depart_time && leg.arrive_time ? Math.max(1, Math.round((new Date(leg.arrive_time) - new Date(leg.depart_time)) / 86400000)) : 1);
      segments.push({ type: "hotel", label: `${nights}N`, city: leg.origin?.city });
    } else {
      const dur = formatDuration(leg.depart_time, leg.arrive_time);
      segments.push({ type: "transport", origin: leg.origin?.code || leg.origin?.city?.slice(0, 3)?.toUpperCase() || "?", destination: leg.destination?.code || leg.destination?.city?.slice(0, 3)?.toUpperCase() || "?", duration: dur, legType: leg.type });
    }
  });

  return (
    <div className="flex items-center gap-1 px-3 py-2 overflow-x-auto" style={{ border: "1px solid var(--border-primary)", borderRadius: "4px", background: "var(--bg-surface)" }}>
      {segments.map((seg, i) => {
        if (seg.type === "hotel") {
          return <div key={i} className="flex items-center gap-1 shrink-0">
            <span style={{ width: 16, height: 0, borderTop: "1px dashed var(--accent-hotel)", display: "inline-block" }} />
            <span style={{ fontFamily: FONT, fontSize: "11px", fontWeight: 600, color: "var(--accent-hotel)" }}>{seg.label}</span>
            <span style={{ width: 16, height: 0, borderTop: "1px dashed var(--accent-hotel)", display: "inline-block" }} />
          </div>;
        }
        return <div key={i} className="flex items-center gap-1 shrink-0">
          <span style={{ fontFamily: FONT, fontSize: "15px", fontWeight: 700, color: "var(--accent-flight-bright)", letterSpacing: "1px" }}>{seg.origin}</span>
          <div className="flex items-center" style={{ minWidth: 32 }}>
            <span style={{ flex: 1, height: 0, borderTop: "1px solid var(--border-primary)", display: "inline-block" }} />
            <span style={{ fontFamily: FONT, fontSize: "8px", color: "var(--text-tertiary)", padding: "0 3px", background: "var(--bg-surface)", whiteSpace: "nowrap" }}>{seg.duration}</span>
            <span style={{ flex: 1, height: 0, borderTop: "1px solid var(--border-primary)", display: "inline-block" }} />
          </div>
          <span style={{ fontFamily: FONT, fontSize: "15px", fontWeight: 700, color: "var(--accent-flight-bright)", letterSpacing: "1px" }}>{seg.destination}</span>
        </div>;
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MAP (radar aesthetic)
// ═══════════════════════════════════════════════════════════════════

function TripMap({ trip, activeLegIndex, mode }) {
  const svgRef = useRef(null), containerRef = useRef(null);
  const draw = useCallback(() => {
    const el = containerRef.current, svg = d3.select(svgRef.current); if (!el) return;
    const w = el.clientWidth, h = el.clientHeight; svg.attr("width", w).attr("height", h).selectAll("*").remove();
    const isDay = mode === "day";
    const defs = svg.append("defs");
    const glow = defs.append("filter").attr("id", "glow").attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%");
    glow.append("feGaussianBlur").attr("stdDeviation", "4").attr("result", "b");
    const gm = glow.append("feMerge"); gm.append("feMergeNode").attr("in", "b"); gm.append("feMergeNode").attr("in", "SourceGraphic");

    // Radar grid pattern
    const gridSize = 34;
    defs.append("pattern").attr("id", "radar-grid").attr("width", gridSize).attr("height", gridSize).attr("patternUnits", "userSpaceOnUse")
      .append("path").attr("d", `M ${gridSize} 0 L 0 0 0 ${gridSize}`).attr("fill", "none").attr("stroke", "var(--map-grid)").attr("stroke-width", 0.5);

    const allC = []; trip.legs?.forEach(l => { if (l.origin?.lat != null) allC.push([l.origin.lng, l.origin.lat]); if (l.destination?.lat != null) allC.push([l.destination.lng, l.destination.lat]); });
    if (allC.length === 0) {
      svg.append("rect").attr("width", w).attr("height", h).attr("fill", "var(--bg-map)");
      svg.append("rect").attr("width", "100%").attr("height", "100%").attr("fill", "url(#radar-grid)");
      svg.append("text").attr("x", w / 2).attr("y", h / 2).attr("text-anchor", "middle").attr("fill", "var(--text-tertiary)").attr("font-size", "10px").attr("font-family", FONT).text("No route data");
      return;
    }

    const pad = 40, proj = d3.geoMercator().fitExtent([[pad, pad], [w - pad, h - pad]], { type: "MultiPoint", coordinates: allC }), path = d3.geoPath(proj);

    // Background + grid
    svg.append("rect").attr("width", w).attr("height", h).attr("fill", "var(--bg-map)");
    svg.append("rect").attr("width", "100%").attr("height", "100%").attr("fill", "url(#radar-grid)");

    // Land
    const land = topojson.feature(worldData, worldData.objects.land);
    const borders = topojson.mesh(worldData, worldData.objects.countries, (a, b) => a !== b);
    if (isDay) {
      svg.append("path").datum(land).attr("d", path).attr("fill", "var(--map-land)").attr("stroke", "var(--map-land-stroke)").attr("stroke-width", 0.8);
      svg.append("path").datum(borders).attr("d", path).attr("fill", "none").attr("stroke", "var(--map-land-stroke)").attr("stroke-width", 0.5);
    } else {
      svg.append("path").datum(borders).attr("d", path).attr("fill", "none").attr("stroke", "var(--map-grid)").attr("stroke-width", 0.5);
    }

    // Hotel dwell glow
    trip.legs?.forEach(leg => {
      if (leg.type === "hotel" && leg.origin?.lat != null) {
        const [hx, hy] = proj([leg.origin.lng, leg.origin.lat]);
        svg.append("circle").attr("cx", hx).attr("cy", hy).attr("r", 22).attr("fill", "var(--map-dwell-glow)");
        svg.append("circle").attr("cx", hx).attr("cy", hy).attr("r", 16).attr("fill", "var(--accent-hotel)").attr("opacity", 0.08);
      }
    });

    // Arcs
    let isFirstTransport = true;
    trip.legs?.forEach((leg, i) => {
      if (leg.origin?.lat == null || leg.destination?.lat == null || (leg.origin.lat === leg.destination.lat && leg.origin.lng === leg.destination.lng)) { if (leg.type !== "hotel") isFirstTransport = false; return; }
      if (leg.type === "hotel") return;
      const coords = leg.type === "flight" ? interpolateGC([leg.origin.lng, leg.origin.lat], [leg.destination.lng, leg.destination.lat]) : [[leg.origin.lng, leg.origin.lat], [leg.destination.lng, leg.destination.lat]];
      const lineGen = d3.line().x(d => proj(d)[0]).y(d => proj(d)[1]).curve(leg.type === "flight" ? d3.curveBasis : d3.curveLinear);
      if (isFirstTransport) {
        svg.append("path").datum(coords).attr("d", lineGen).attr("fill", "none").attr("stroke", "var(--map-arc)").attr("stroke-width", 2.5).attr("stroke-linecap", "round");
        isFirstTransport = false;
      } else {
        svg.append("path").datum(coords).attr("d", lineGen).attr("fill", "none").attr("stroke", "var(--map-arc)").attr("stroke-width", 1.5).attr("stroke-dasharray", "6,4").attr("opacity", 0.3);
      }
    });

    // Airport markers
    const cities = new Map();
    trip.legs?.forEach(l => {
      if (l.origin?.lat != null) cities.set(`${l.origin.lat},${l.origin.lng}`, { ...l.origin, coords: [l.origin.lng, l.origin.lat] });
      if (l.destination?.lat != null) cities.set(`${l.destination.lat},${l.destination.lng}`, { ...l.destination, coords: [l.destination.lng, l.destination.lat] });
    });
    cities.forEach((city) => {
      const [x, y] = proj(city.coords);
      svg.append("circle").attr("cx", x).attr("cy", y).attr("r", 12).attr("fill", "none").attr("stroke", "var(--map-arc)").attr("stroke-width", 0.3).attr("opacity", 0.2);
      svg.append("circle").attr("cx", x).attr("cy", y).attr("r", 7).attr("fill", "none").attr("stroke", "var(--map-arc)").attr("stroke-width", 0.5).attr("opacity", 0.4);
      svg.append("circle").attr("cx", x).attr("cy", y).attr("r", 3.5).attr("fill", "var(--map-dot)");
      svg.append("text").attr("x", x).attr("y", y - 14).attr("text-anchor", "middle").attr("fill", "var(--map-label)").attr("font-size", "11px").attr("font-family", FONT).attr("font-weight", 600).attr("letter-spacing", "1px").text(city.code || city.city);
    });

    // Distance label
    const stats = computeTripStats(trip.legs);
    if (stats.totalNM > 0) {
      svg.append("text").attr("x", w / 2).attr("y", 20).attr("text-anchor", "middle").attr("fill", "var(--map-distance)").attr("font-size", "8px").attr("font-family", FONT).attr("letter-spacing", "1px").text(`${stats.totalNM.toLocaleString()} NM`);
    }

    // Live position dot
    const aLeg = trip.legs?.[activeLegIndex];
    if (aLeg) {
      const lp = getLivePos(aLeg);
      if (lp) {
        const [px, py] = proj([lp.lng, lp.lat]);
        const ping = svg.append("circle").attr("cx", px).attr("cy", py).attr("r", 5).attr("fill", "none").attr("stroke", "var(--map-arc)").attr("stroke-width", 1.5).attr("opacity", 0);
        (function anim() { ping.attr("r", 5).attr("opacity", 0.6).transition().duration(1800).ease(d3.easeQuadOut).attr("r", 22).attr("opacity", 0).on("end", anim); })();
        svg.append("circle").attr("cx", px).attr("cy", py).attr("r", 5).attr("fill", "var(--map-arc)").attr("filter", "url(#glow)");
        svg.append("circle").attr("cx", px).attr("cy", py).attr("r", 2).attr("fill", "var(--bg-primary)");
      }
    }
  }, [trip, activeLegIndex, mode]);

  useEffect(() => { draw(); const h = () => draw(); window.addEventListener("resize", h); return () => window.removeEventListener("resize", h); }, [draw]);

  // Coordinate overlay
  const firstLeg = trip.legs?.[0], lastLeg = trip.legs?.[trip.legs.length - 1];
  const originCoord = firstLeg?.origin?.lat != null ? formatCoord(firstLeg.origin.lat, firstLeg.origin.lng) : null;
  const destCoord = lastLeg?.destination?.lat != null ? formatCoord(lastLeg.destination.lat, lastLeg.destination.lng) : null;

  return (
    <div ref={containerRef} className="w-full h-full relative" style={{ background: "var(--bg-map)" }}>
      <svg ref={svgRef} className="w-full h-full" />
      {(originCoord || destCoord) && (
        <div className="absolute top-2 right-2" style={{ fontFamily: FONT, fontSize: "8px", color: "var(--map-distance)", letterSpacing: "0.5px", lineHeight: 1.6, textAlign: "right" }}>
          {originCoord && <div>{originCoord}</div>}
          {destCoord && <div>{destCoord}</div>}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// STATS FOOTER
// ═══════════════════════════════════════════════════════════════════

function StatsFooter({ legs }) {
  const stats = computeTripStats(legs);
  return (
    <div className="flex justify-around items-center mx-4 my-3 px-3 py-2.5" style={{ border: "1px solid var(--border-subtle)", borderRadius: "6px", background: "var(--bg-surface)" }}>
      <div className="text-center">
        <div style={{ fontFamily: FONT, fontSize: "14px", fontWeight: 600, color: "var(--stats-value)" }}>{stats.totalNM.toLocaleString()}</div>
        <div style={{ fontFamily: FONT, fontSize: "7px", letterSpacing: "2px", color: "var(--stats-label)", marginTop: 2 }}>TOTAL NM</div>
      </div>
      <div style={{ width: 1, height: 28, background: "var(--border-subtle)" }} />
      <div className="text-center">
        <div style={{ fontFamily: FONT, fontSize: "14px", fontWeight: 600, color: "var(--stats-value)" }}>{stats.airTime}</div>
        <div style={{ fontFamily: FONT, fontSize: "7px", letterSpacing: "2px", color: "var(--stats-label)", marginTop: 2 }}>AIR TIME</div>
      </div>
      <div style={{ width: 1, height: 28, background: "var(--border-subtle)" }} />
      <div className="text-center">
        <div style={{ fontFamily: FONT, fontSize: "14px", fontWeight: 600, color: "var(--accent-countdown)" }}>{stats.hotelNights}N</div>
        <div style={{ fontFamily: FONT, fontSize: "7px", letterSpacing: "2px", color: "var(--stats-label)", marginTop: 2 }}>ON GROUND</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// DETAIL PAGE (with edit mode)
// ═══════════════════════════════════════════════════════════════════

function DetailPage({ tripId }) {
  const { navigate } = useRouter();
  const { mode } = useTheme();
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
  const typeCfg = { flight: { label: "FLIGHT", color: "var(--strip-flight)" }, hotel: { label: "GROUND STOP", color: "var(--strip-hotel)" }, train: { label: "TRAIN", color: "#d4628a" }, bus: { label: "BUS", color: "#7c6bb4" } };

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
  if (!trip) return <div className="text-center py-12"><p className="text-xs" style={{ color: "var(--text-secondary)", fontFamily: FONT }}>Trip not found</p><button onClick={() => navigate("dashboard")} className="mt-3 text-xs font-bold tracking-widest" style={{ color: "var(--accent-flight)", fontFamily: FONT }}>DASHBOARD</button></div>;

  const status = getTripStatus(trip);
  const countdown = getCountdown(trip);
  const segmentCount = (trip.legs || []).filter(l => l.type !== "hotel").length;

  return (
    <div className="min-h-[calc(100vh-48px)] sm:min-h-[calc(100vh-53px)]" style={{ background: "var(--bg-primary)" }}>
      {showShare && <SquawkModal trip={trip} onClose={() => setShowShare(false)} />}

      {/* Nav bar */}
      <div className="flex items-center justify-between px-4 py-2">
        <button onClick={() => navigate("dashboard")} className="flex items-center justify-center" style={{ width: 44, height: 44, border: "1px solid var(--nav-border)", borderRadius: 8, background: "var(--nav-bg)", color: "var(--nav-text-active)", fontFamily: FONT, fontSize: "16px" }}>{"\u2190"}</button>
        <div className="flex gap-1.5">
          {editing ? (
            <>
              <button onClick={cancelEdit} className="flex items-center justify-center px-4" style={{ height: 44, border: "1px solid var(--nav-border)", borderRadius: 8, background: "var(--nav-bg)", color: "var(--nav-text)", fontFamily: FONT, fontSize: "10px", letterSpacing: "2px", fontWeight: 700 }}>CANCEL</button>
              <button onClick={saveEdit} disabled={saving} className="flex items-center justify-center px-4" style={{ height: 44, border: "1px solid var(--accent-flight)", borderRadius: 8, background: "var(--accent-flight)", color: "var(--bg-primary)", fontFamily: FONT, fontSize: "10px", letterSpacing: "2px", fontWeight: 700 }}>{saving ? <Spinner /> : "SAVE"}</button>
            </>
          ) : (
            <>
              <button onClick={enterEdit} className="flex items-center justify-center px-4" style={{ height: 44, border: "1px solid var(--nav-border)", borderRadius: 8, background: "var(--nav-bg)", color: "var(--nav-text)", fontFamily: FONT, fontSize: "10px", letterSpacing: "2px", fontWeight: 700 }}>EDIT</button>
              <button onClick={() => setShowShare(true)} className="flex items-center justify-center px-4" style={{ height: 44, border: "1px solid var(--accent-flight)", borderRadius: 8, background: "var(--squawk-bg)", color: "var(--squawk-text)", fontFamily: FONT, fontSize: "10px", letterSpacing: "2px", fontWeight: 700 }}>SQUAWK</button>
            </>
          )}
        </div>
      </div>

      {/* Trip header */}
      <div className="px-4 pb-3">
        {editing ? (
          <div className="mb-3">
            <div className="mb-3"><Label>DESIGNATION</Label><input type="text" value={editTitle} onChange={e => setEditTitle(e.target.value)} className="w-full px-0 py-1.5 border-0 border-b outline-none text-sm font-bold" style={{ background: "transparent", borderColor: "var(--border-primary)", color: "var(--text-heading)", fontFamily: FONT }} /></div>
            <div className="grid grid-cols-2 gap-3"><div><Label>DEPART</Label><Input type="date" value={editStart} onChange={e => setEditStart(e.target.value)} /></div><div><Label>RETURN</Label><Input type="date" value={editEnd} onChange={e => setEditEnd(e.target.value)} /></div></div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-1">
              <span style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "3px", color: "var(--accent-flight)", fontWeight: 700 }}>{countdown.label}</span>
              <span className="px-2.5 py-1" style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "1px", color: status === "live" || status === "active" ? "var(--accent-flight-bright)" : "var(--accent-countdown)", border: `1px solid ${status === "live" || status === "active" ? "var(--accent-flight)" : "var(--accent-hotel-dim)"}`, borderRadius: 4, fontWeight: 500 }}>{countdown.text}</span>
            </div>
            <h1 style={{ fontFamily: FONT, fontSize: "20px", fontWeight: 600, color: "var(--text-heading)", marginBottom: 4 }}>{trip.title}</h1>
            <p style={{ fontFamily: FONT, fontSize: "10px", color: "var(--text-secondary)", letterSpacing: "0.5px" }}>
              {formatDateRange(trip.start_date, trip.end_date)}{trip.legs?.length ? ` \u00B7 ${trip.legs.length} LEGS` : ""}{segmentCount ? ` \u00B7 ${segmentCount} SEGMENTS` : ""}
            </p>
          </>
        )}
      </div>

      {/* Route summary */}
      {!editing && <div className="px-4 pb-3"><RouteSummaryBar legs={trip.legs} /></div>}

      {/* Map */}
      <div style={{ height: "260px", minHeight: "200px" }}>
        <TripMap trip={trip} activeLegIndex={activeLeg} mode={mode} />
      </div>

      {/* Itinerary section */}
      <div className="px-4 pt-4 pb-2">
        <p style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "3px", color: "var(--text-secondary)", marginBottom: 12, fontWeight: 700 }}>FLIGHT PLAN {"\u00B7"} {trip.legs?.length || 0} WAYPOINTS</p>

        <div className="flex flex-col">
          {trip.legs?.map((leg, i) => {
            const isHotel = leg.type === "hotel";
            const isLive = leg.status === "in_air" || leg.status === "in_transit";
            const stripColor = STRIP_COLORS[leg.type] || "var(--strip-flight)";
            const isDeleting = confirmDelete === leg.id;
            const cardBg = isHotel ? "var(--bg-card-hotel)" : "var(--bg-card)";
            const dur = formatDuration(leg.depart_time, leg.arrive_time);
            const nights = leg.metadata?.nights || (leg.depart_time && leg.arrive_time && isHotel ? Math.max(1, Math.round((new Date(leg.arrive_time) - new Date(leg.depart_time)) / 86400000)) : 0);

            return (
              <div key={leg.id} className="flex">
                {/* Timeline rail */}
                <div className="flex flex-col items-center" style={{ width: 28 }}>
                  <div className="flex items-center justify-center" style={{ width: isHotel ? 8 : 10, height: isHotel ? 8 : 10, borderRadius: "50%", border: `2px solid ${isHotel ? "var(--strip-hotel)" : "var(--timeline-dot-border)"}`, background: "var(--timeline-dot-bg)", flexShrink: 0 }} />
                  {i < trip.legs.length - 1 && <div style={{ width: 1.5, flex: 1, background: "var(--timeline-rail)", minHeight: 20 }} />}
                </div>

                {/* Card */}
                <div className="flex-1 mb-2 ml-2" style={{ borderLeft: `3px solid ${stripColor}`, borderRadius: "4px", padding: "12px", background: cardBg }}>
                  {isDeleting ? (
                    <div className="flex items-center justify-between">
                      <span style={{ fontFamily: FONT, fontSize: "11px", fontWeight: 700, color: "var(--accent-flight)" }}>Remove this leg?</span>
                      <div className="flex gap-2">
                        <button onClick={() => setConfirmDelete(null)} style={{ fontFamily: FONT, fontSize: "9px", fontWeight: 700, color: "var(--text-secondary)", letterSpacing: "1px" }}>KEEP</button>
                        <button onClick={() => removeLeg(leg.id)} className="px-2.5 py-1 rounded" style={{ fontFamily: FONT, fontSize: "9px", fontWeight: 700, background: "var(--accent-flight)", color: "var(--bg-primary)", letterSpacing: "1px" }}>REMOVE</button>
                      </div>
                    </div>
                  ) : isHotel ? (
                    <>
                      <div className="flex items-center justify-between mb-1">
                        <span style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "2px", color: "var(--accent-hotel)", fontWeight: 700 }}>GROUND STOP {"\u00B7"} {nights}N</span>
                        <span style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-secondary)" }}>{formatDate(leg.depart_time)}{leg.arrive_time ? ` \u2013 ${formatDate(leg.arrive_time)}` : ""}</span>
                      </div>
                      <p style={{ fontFamily: FONT, fontSize: mode === "night" ? "16px" : "14px", fontWeight: 600, color: "var(--accent-hotel-text)", marginBottom: 2 }}>{leg.carrier}</p>
                      <p style={{ fontFamily: FONT, fontSize: "9px", color: "var(--accent-hotel-dim)" }}>
                        {leg.origin?.city ? leg.origin.city.toUpperCase() : ""}{nights ? ` \u00B7 ${nights} NIGHTS` : ""}
                      </p>
                      {editing && !isLive && (
                        <div className="flex items-center gap-1 mt-2 pt-2" style={{ borderTop: "1px solid var(--border-hotel)" }}>
                          {i > 0 && <button onClick={e => { e.stopPropagation(); moveLeg(i, -1); }} className="p-1" style={{ color: "var(--text-secondary)" }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 15l-6-6-6 6"/></svg></button>}
                          {i < trip.legs.length - 1 && <button onClick={e => { e.stopPropagation(); moveLeg(i, 1); }} className="p-1" style={{ color: "var(--text-secondary)" }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6"/></svg></button>}
                          <button onClick={e => { e.stopPropagation(); setConfirmDelete(leg.id); }} className="p-1 ml-auto" style={{ color: "var(--text-secondary)" }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "2px", color: stripColor, fontWeight: 700 }}>{leg.type.toUpperCase()} {"\u00B7"} {leg.vehicle_number || leg.carrier}</span>
                          {isLive && <span className="inline-flex items-center gap-1"><span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "var(--accent-flight)" }} /><span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: "var(--accent-flight)" }} /></span><span style={{ fontFamily: FONT, fontSize: "8px", fontWeight: 700, color: "var(--accent-flight-bright)" }}>LIVE</span></span>}
                        </div>
                        <span style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-secondary)" }}>{formatDate(leg.depart_time)}</span>
                      </div>
                      <div className="flex items-center justify-between mb-2">
                        <span style={{ fontFamily: FONT, fontSize: "24px", fontWeight: 700, color: "var(--text-heading)", letterSpacing: "2px" }}>{leg.origin?.code || leg.origin?.city?.slice(0, 3)?.toUpperCase() || "?"}</span>
                        <div className="flex flex-col items-center flex-1 mx-3">
                          <span style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-tertiary)" }}>{dur}</span>
                          <div style={{ width: "100%", height: 0, borderTop: "1px solid var(--border-subtle)", marginTop: 4 }} />
                        </div>
                        <span style={{ fontFamily: FONT, fontSize: "24px", fontWeight: 700, color: "var(--text-heading)", letterSpacing: "2px" }}>{leg.destination?.code || leg.destination?.city?.slice(0, 3)?.toUpperCase() || "?"}</span>
                      </div>
                      <div className="flex items-center justify-between mb-2">
                        <span style={{ fontFamily: FONT, fontSize: "10px", color: "var(--text-secondary)" }}>{formatTime(leg.actual_depart || leg.depart_time)} LOCAL</span>
                        <span style={{ fontFamily: FONT, fontSize: "10px", color: "var(--text-secondary)" }}>{formatTime(leg.arrive_time)} LOCAL</span>
                      </div>
                      {(leg.vehicle_number || leg.carrier || Object.keys(leg.metadata || {}).length > 0) && (
                        <div className="flex items-center justify-between pt-2" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                          <span style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-tertiary)" }}>{[leg.vehicle_number, leg.carrier].filter(Boolean).join(" \u00B7 ")}</span>
                          <span style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-tertiary)" }}>{[leg.metadata?.seat ? `SEAT ${leg.metadata.seat}` : null, leg.metadata?.terminal ? `T-${leg.metadata.terminal}` : null, leg.metadata?.gate ? `G${leg.metadata.gate}` : null].filter(Boolean).join(" \u00B7 ")}</span>
                        </div>
                      )}
                      {editing && !isLive && (
                        <div className="flex items-center gap-1 mt-2 pt-2" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                          {i > 0 && <button onClick={e => { e.stopPropagation(); moveLeg(i, -1); }} className="p-1" style={{ color: "var(--text-secondary)" }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 15l-6-6-6 6"/></svg></button>}
                          {i < trip.legs.length - 1 && <button onClick={e => { e.stopPropagation(); moveLeg(i, 1); }} className="p-1" style={{ color: "var(--text-secondary)" }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6"/></svg></button>}
                          <button onClick={e => { e.stopPropagation(); setConfirmDelete(leg.id); }} className="p-1 ml-auto" style={{ color: "var(--text-secondary)" }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Add leg builder (edit mode) */}
        {editing && (
          <div className="mt-3">
            {showLegBuilder ? (
              <div className="border rounded" style={{ background: "var(--bg-surface)", borderColor: "var(--border-primary)" }}>
                <div className="flex border-b" style={{ borderColor: "var(--border-primary)" }}>{Object.entries(typeCfg).map(([k, v]) => <button key={k} onClick={() => { setBType(k); resetBuilder(); }} className="flex-1 py-2 text-xs font-bold tracking-widest relative" style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "1px", color: bType === k ? v.color : "var(--text-secondary)", background: "transparent" }}>{v.label}{bType === k && <div className="absolute bottom-0 left-0 right-0 h-px" style={{ background: v.color }} />}</button>)}</div>
                <div className="p-3">
                  {bType === "flight" && (<><div className="flex flex-col sm:flex-row gap-2 mb-2"><div className="flex-1"><Label>CALLSIGN</Label><Input type="text" value={bFN} onChange={e => { setBFN(e.target.value); setBAF(null); setBErr(null); }} onKeyDown={e => e.key === "Enter" && handleQuery()} placeholder="DL484" style={{ textTransform: "uppercase", letterSpacing: "1px" }} /></div><div className="flex items-end"><button onClick={handleQuery} disabled={bLoading || !bFN.trim()} className="w-full sm:w-auto px-4 py-2.5 rounded text-xs font-bold tracking-widest" style={{ background: bFN.trim() ? "var(--bg-surface)" : "var(--bg-surface)", color: bFN.trim() ? "var(--accent-flight)" : "var(--text-tertiary)", border: "1px solid var(--border-primary)", fontFamily: FONT, fontSize: "9px" }}>{bLoading ? <Spinner /> : "QUERY"}</button></div></div>{bAF && <div className="rounded border p-2.5 mb-2" style={{ background: "var(--bg-surface)", borderColor: "var(--accent-flight)" }}><div className="flex items-center gap-2 mb-1"><span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "var(--accent-flight)" }} /><span className="relative inline-flex rounded-full h-2 w-2" style={{ background: "var(--accent-flight)" }} /></span><span className="text-xs font-bold" style={{ color: "var(--accent-flight)", fontFamily: FONT, fontSize: "9px" }}>MATCH</span></div><div className="grid grid-cols-2 gap-x-4 gap-y-0.5">{[["CARRIER", bAF.carrier], ["ROUTE", `${bAF.origin.code} \u2192 ${bAF.destination.code}`], ["DEP", formatTime(bAF.origin.scheduled)], ["ARR", formatTime(bAF.destination.scheduled)]].map(([l, v]) => <div key={l} className="flex items-baseline gap-1.5"><span className="text-xs" style={{ color: "var(--text-secondary)", fontFamily: FONT, fontSize: "8px", minWidth: 40 }}>{l}</span><span className="text-xs" style={{ color: "var(--text-primary)", fontFamily: FONT }}>{v}</span></div>)}</div></div>}{bErr && <p className="mb-2 text-xs font-bold" style={{ color: "var(--accent-flight)", fontFamily: FONT, fontSize: "9px" }}>{bErr}</p>}</>)}
                  {bType === "hotel" && <div className="grid grid-cols-1 sm:grid-cols-2 gap-2"><div><Label>PROPERTY</Label><Input value={bHN} onChange={e => setBHN(e.target.value)} placeholder="Park Hyatt Tokyo" /></div><div><Label>CONF NO.</Label><Input value={bHC} onChange={e => setBHC(e.target.value)} placeholder="Optional" /></div><div><Label>CHECK-IN</Label><Input type="date" value={bHI} onChange={e => setBHI(e.target.value)} /></div><div><Label>CHECK-OUT</Label><Input type="date" value={bHO} onChange={e => setBHO(e.target.value)} /></div></div>}
                  {(bType === "train" || bType === "bus") && <div className="grid grid-cols-1 sm:grid-cols-2 gap-2"><div><Label>ORIGIN</Label><Input value={bO} onChange={e => setBO(e.target.value)} placeholder="Tokyo" /></div><div><Label>DEST</Label><Input value={bD} onChange={e => setBD(e.target.value)} placeholder="Kyoto" /></div><div><Label>DATE</Label><Input type="date" value={bDt} onChange={e => setBDt(e.target.value)} /></div><div><Label>TIME (OPT)</Label><Input type="time" value={bTm} onChange={e => setBTm(e.target.value)} /></div></div>}
                  <div className="flex items-center justify-between mt-3 pt-2" style={{ borderTop: "1px solid var(--border-primary)" }}><button onClick={() => { setShowLegBuilder(false); resetBuilder(); }} className="text-xs font-bold tracking-widest" style={{ color: "var(--text-secondary)", fontFamily: FONT, fontSize: "9px" }}>CANCEL</button><button onClick={addLeg} disabled={!canConfirm()} className="px-4 py-2 rounded text-xs font-bold tracking-widest" style={{ background: canConfirm() ? "var(--accent-flight)" : "var(--bg-surface)", color: canConfirm() ? "var(--bg-primary)" : "var(--text-tertiary)", fontFamily: FONT, fontSize: "9px" }}>ADD LEG</button></div>
                </div>
              </div>
            ) : <button onClick={() => setShowLegBuilder(true)} className="w-full py-3 rounded border border-dashed text-xs font-bold tracking-widest" style={{ borderColor: "var(--accent-hotel-dim)", color: "var(--accent-hotel)", fontFamily: FONT, fontSize: "9px", letterSpacing: "2px" }}>+ ADD LEG</button>}
          </div>
        )}
      </div>

      {/* Stats footer */}
      {!editing && <StatsFooter legs={trip.legs} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CREATE PAGE
// ═══════════════════════════════════════════════════════════════════

function CreatePage() {
  const { navigate } = useRouter();
  const { mode } = useTheme();
  const [tripTitle, setTripTitle] = useState("");
  const [tripStart, setTripStart] = useState("");
  const [tripEnd, setTripEnd] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [newTripId, setNewTripId] = useState(null);

  const handleSubmit = async () => {
    if (!tripTitle.trim()) return;
    setSubmitting(true);
    try {
      const t = await api("/trips", { method: "POST", body: JSON.stringify({ title: tripTitle, description: "", start_date: tripStart || null, end_date: tripEnd || null }) });
      setNewTripId(t.id);
      setSubmitted(true);
    } catch (e) { alert(e.message); }
    setSubmitting(false);
  };

  // Quick date helpers
  const today = new Date();
  const fmt = (d) => d.toISOString().split("T")[0];
  const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
  const quickDates = [
    { label: "THIS WEEKEND", start: (() => { const d = new Date(today); d.setDate(d.getDate() + ((6 - d.getDay()) % 7 || 7)); return d; })(), days: 2 },
    { label: "NEXT WEEK", start: (() => { const d = new Date(today); d.setDate(d.getDate() + ((8 - d.getDay()) % 7)); return d; })(), days: 5 },
    { label: "IN 2 WEEKS", start: addDays(today, 14), days: 7 },
    { label: "NEXT MONTH", start: (() => { const d = new Date(today); d.setMonth(d.getMonth() + 1, 1); return d; })(), days: 7 },
  ];

  if (submitted) return (
    <div className="text-center py-20 px-4">
      <div className="inline-flex items-center gap-2 mb-4">
        <span className="relative flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "var(--accent-flight)" }} /><span className="relative inline-flex rounded-full h-3 w-3" style={{ background: "var(--accent-flight)" }} /></span>
        <span style={{ fontFamily: FONT, fontSize: "10px", letterSpacing: "2px", fontWeight: 700, color: "var(--accent-flight-bright)" }}>FILED</span>
      </div>
      <h2 className="text-xl font-bold mb-2" style={{ color: "var(--text-heading)", fontFamily: FONT }}>{tripTitle}</h2>
      <p className="text-xs mb-6" style={{ color: "var(--text-secondary)", fontFamily: FONT }}>Add legs from the trip detail page</p>
      <div className="flex gap-3 justify-center flex-col sm:flex-row">
        <button onClick={() => navigate("dashboard")} className="px-4 py-2.5 rounded text-xs font-bold tracking-widest" style={{ background: "var(--bg-surface)", color: "var(--text-secondary)", border: "1px solid var(--border-primary)", fontFamily: FONT, fontSize: "10px", minHeight: 44 }}>DASHBOARD</button>
        {newTripId && <button onClick={() => navigate("detail", { tripId: newTripId })} className="px-4 py-2.5 rounded text-xs font-bold tracking-widest" style={{ background: "var(--squawk-bg)", color: "var(--squawk-text)", fontFamily: FONT, fontSize: "10px", minHeight: 44 }}>ADD LEGS</button>}
      </div>
    </div>
  );

  return (
    <div className="px-4 sm:px-6 py-6" style={{ maxWidth: "32rem", margin: "0 auto" }}>
      {/* Back link */}
      <button onClick={() => navigate("dashboard")} className="flex items-center gap-1 mb-6" style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "2px", color: "var(--text-tertiary)", fontWeight: 700, minHeight: 44 }}>
        {"\u2190"} DASHBOARD
      </button>

      {/* Header */}
      <p style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "3px", color: "var(--accent-flight)", fontWeight: 700, marginBottom: 6 }}>FILE NEW ITINERARY</p>
      <p style={{ fontFamily: FONT, fontSize: "10px", color: "var(--text-tertiary)", marginBottom: 24 }}>Name your trip and set travel dates. Add flights, hotels, and legs after filing.</p>

      {/* Trip name */}
      <div className="mb-6">
        <Label>DESIGNATION</Label>
        <input
          type="text"
          value={tripTitle}
          onChange={e => setTripTitle(e.target.value)}
          placeholder="Spring Break, NYC Weekend, Euro Trip..."
          autoFocus
          className="w-full px-0 py-3 border-0 border-b-2 outline-none text-xl font-bold"
          style={{ background: "transparent", borderColor: tripTitle ? "var(--accent-flight)" : "var(--border-primary)", color: "var(--text-heading)", fontFamily: FONT, transition: "border-color 0.2s" }}
        />
      </div>

      {/* Quick date buttons */}
      <div className="mb-4">
        <Label>QUICK SET</Label>
        <div className="flex gap-2 flex-wrap">
          {quickDates.map(qd => {
            const isActive = tripStart === fmt(qd.start);
            return (
              <button
                key={qd.label}
                onClick={() => { setTripStart(fmt(qd.start)); setTripEnd(fmt(addDays(qd.start, qd.days))); }}
                style={{
                  fontFamily: FONT, fontSize: "8px", letterSpacing: "1px", fontWeight: 700,
                  padding: "8px 12px", borderRadius: 6, minHeight: 36,
                  background: isActive ? "var(--squawk-bg)" : "var(--bg-surface)",
                  color: isActive ? "var(--squawk-text)" : "var(--text-secondary)",
                  border: `1px solid ${isActive ? "var(--accent-flight)" : "var(--border-primary)"}`,
                  transition: "all 0.15s",
                }}
              >
                {qd.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Date inputs */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        <div>
          <Label>DEPART</Label>
          <Input type="date" value={tripStart} onChange={e => setTripStart(e.target.value)} style={{ minHeight: 48, fontSize: "14px", padding: "10px 12px" }} />
        </div>
        <div>
          <Label>RETURN</Label>
          <Input type="date" value={tripEnd} onChange={e => setTripEnd(e.target.value)} style={{ minHeight: 48, fontSize: "14px", padding: "10px 12px" }} />
          {tripStart && tripEnd && new Date(tripEnd) > new Date(tripStart) && (
            <p style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-tertiary)", marginTop: 4 }}>
              {Math.round((new Date(tripEnd) - new Date(tripStart)) / 86400000)} days
            </p>
          )}
        </div>
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={!tripTitle.trim() || submitting}
        className="w-full rounded text-xs font-bold tracking-widest"
        style={{
          height: 52,
          background: tripTitle.trim() ? "var(--squawk-bg)" : "var(--bg-surface)",
          color: tripTitle.trim() ? "var(--squawk-text)" : "var(--text-tertiary)",
          fontFamily: FONT, fontSize: "11px", letterSpacing: "2px",
          border: tripTitle.trim() ? "none" : "1px solid var(--border-primary)",
          transition: "all 0.2s",
        }}
      >
        {submitting ? <span className="flex items-center justify-center gap-2"><Spinner />FILING</span> : "FILE ITINERARY"}
      </button>

      {/* Helper text */}
      <p className="text-center mt-3" style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-tertiary)" }}>
        Dates are optional {"\u2014"} you can always set them later.
      </p>
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
// NAV RIGHT (avatar + theme toggle)
// ═══════════════════════════════════════════════════════════════════

function NavRight({ user, signOut }) {
  const [open, setOpen] = useState(false);
  const { mode, pref, setPref } = useTheme();
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const themeOptions = [
    { key: "auto", label: "AUTO" },
    { key: "day", label: "DAY" },
    { key: "night", label: "NIGHT" },
  ];

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} className="flex items-center justify-center" style={{ width: 36, height: 36, borderRadius: "50%", border: "1px solid var(--nav-border)", background: "var(--nav-bg)", color: "var(--accent-flight-bright)", fontFamily: FONT, fontSize: "12px", fontWeight: 600 }} title="Settings">
        {(user.user_metadata?.name || user.email || "U").charAt(0).toUpperCase()}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 rounded-lg overflow-hidden z-50" style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", minWidth: "160px" }}>
          <div className="px-3 py-2.5" style={{ borderBottom: "1px solid var(--border-primary)" }}>
            <p className="text-xs font-bold tracking-widest mb-2" style={{ color: "var(--text-tertiary)", fontFamily: FONT, fontSize: "8px", letterSpacing: "1.5px" }}>THEME</p>
            <div className="flex gap-0">
              {themeOptions.map(opt => (
                <button key={opt.key} onClick={() => setPref(opt.key)} className="flex-1 relative py-1.5 text-xs font-bold tracking-widest" style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "1px", color: pref === opt.key ? "var(--text-heading)" : "var(--text-tertiary)", minHeight: "44px", minWidth: "44px" }}>
                  {opt.label}
                  {pref === opt.key && <div className="absolute bottom-0 left-1 right-1 h-px" style={{ background: "var(--accent-flight)" }} />}
                </button>
              ))}
            </div>
          </div>
          <button onClick={() => { signOut(); setOpen(false); }} className="w-full text-left px-3 py-2.5 text-xs font-bold tracking-widest" style={{ color: "var(--text-secondary)", fontFamily: FONT, fontSize: "9px", letterSpacing: "1.5px", minHeight: "44px", display: "flex", alignItems: "center" }}>SIGN OUT</button>
        </div>
      )}
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

  if (authLoading) return <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-primary)" }}><Spinner /></div>;
  if (!user) return <LoginPage />;

  const isFullWidth = route.page === "detail" || route.page === "dashboard";
  return (
    <RouterContext.Provider value={{ route, navigate }}>
      <div className="min-h-screen" style={{ background: "var(--bg-primary)", fontFamily: FONT }}>
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
        <div className="sticky top-0 z-40 flex items-center justify-between px-4 sm:px-6 h-[48px] sm:h-[53px]" style={{ borderBottom: "1px solid var(--nav-border)", background: "var(--nav-bg)", backdropFilter: "blur(12px)" }}>
          <button onClick={() => navigate("dashboard")} style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "3px", color: "var(--text-tertiary)", fontWeight: 700 }}>TRIPTRACK</button>
          <div className="flex items-center gap-1.5">
            {route.page === "dashboard" && (
              <button onClick={() => navigate("create")} className="flex items-center justify-center" style={{ height: 44, padding: "0 16px", borderRadius: 8, background: "var(--squawk-bg)", color: "var(--squawk-text)", fontFamily: FONT, fontSize: "10px", letterSpacing: "2px", fontWeight: 700 }}>FILE</button>
            )}
            <NavRight user={user} signOut={signOut} />
          </div>
        </div>
        <div className="transition-all duration-500" style={{ opacity: loaded ? 1 : 0, transform: loaded ? "translateY(0)" : "translateY(8px)", ...(isFullWidth ? {} : { maxWidth: "42rem", margin: "0 auto", padding: "1.5rem 1rem" }) }}>
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
  return <ThemeProvider><AuthProvider><TripTrackApp /></AuthProvider></ThemeProvider>;
}
