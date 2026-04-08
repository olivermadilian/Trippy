import { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } from "react";
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
    carrier: r.carrier || r.carrier_code || null, carrier_code: r.carrier_code, callsign: r.callsign,
    origin: { code: r.origin.code, airport: r.origin.airport, city: r.origin.city, scheduled: r.origin.scheduled, scheduled_local: r.origin.scheduled_local || null, terminal: r.origin.terminal || null, gate: r.origin.gate || null },
    destination: { code: r.destination.code, airport: r.destination.airport, city: r.destination.city, scheduled: r.destination.scheduled, scheduled_local: r.destination.scheduled_local || null, terminal: r.destination.terminal || null, gate: r.destination.gate || null },
    status: r.status, flight_date: r.flight_date, source: r.source || null,
  };
}
function mapFlightResults(res) {
  return (res.flights || [res]).map(mapFlightLookup);
}

// ═══════════════════════════════════════════════════════════════════
// RESPONSIVE HOOK
// ═══════════════════════════════════════════════════════════════════

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(window.innerWidth > 768);
  useEffect(() => {
    const handler = () => setIsDesktop(window.innerWidth > 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isDesktop;
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
  "--strip-train": "#d4628a",
  "--strip-bus": "#7c6bb4",
  "--danger-text": "#e84233",
  "--danger-border": "rgba(232, 66, 51, 0.4)",
  "--danger-bg": "rgba(232, 66, 51, 0.08)",
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
  "--strip-train": "#b04870",
  "--strip-bus": "#5c4a9a",
  "--danger-text": "#e84233",
  "--danger-border": "rgba(232, 66, 51, 0.4)",
  "--danger-bg": "rgba(232, 66, 51, 0.08)",
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
    try {
      return localStorage.getItem("transponder-theme") || "auto";
    } catch { return "auto"; }
  });
  const [mode, setMode] = useState(() => computeMode(pref));

  const setPref = (newPref) => {
    setPrefState(newPref);
    try { localStorage.setItem("transponder-theme", newPref); } catch {}
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

const FONT = "'B612 Mono', 'B612', monospace";
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

function getTripStatus(trip) { const now = new Date(), s = new Date(trip.start_date), e = new Date(trip.end_date); if (trip.legs?.some(l => isLegLive(l))) return "live"; if (now < s) return "upcoming"; if (now > e) return "completed"; return "active"; }
function formatDateRange(s, e) { if (!s || !e) return ""; const sd = new Date(s + "T00:00:00"), ed = new Date(e + "T00:00:00"), o = { month: "short", day: "numeric" }; return `${sd.toLocaleDateString("en-US", o)} — ${ed.toLocaleDateString("en-US", o)}, ${ed.getFullYear()}`; }
// Format a time string for display. Prefers local time strings (no TZ conversion needed).
// For UTC ISO strings (ending in Z), extracts HH:MM directly to avoid browser TZ issues.
function formatTime(iso) {
  if (!iso) return "—";
  // If it's a local time string (no Z, no offset) — extract HH:MM directly
  if (!iso.endsWith("Z") && !iso.match(/[+-]\d{2}:\d{2}$/)) {
    const m = iso.match(/T(\d{2}):(\d{2})/);
    if (m) { const h = parseInt(m[1]), min = m[2], ampm = h >= 12 ? "PM" : "AM", h12 = h % 12 || 12; return `${h12}:${min} ${ampm}`; }
  }
  // For UTC strings, extract the UTC HH:MM directly (don't let browser convert)
  const m = iso.match(/T(\d{2}):(\d{2})/);
  if (m) { const h = parseInt(m[1]), min = m[2], ampm = h >= 12 ? "PM" : "AM", h12 = h % 12 || 12; return `${h12}:${min} ${ampm}`; }
  return "—";
}
// Display local airport times when available (from API lookup), fall back to stored depart/arrive
function legDepartTime(leg) { return formatTime(leg.metadata?.depart_local || leg.depart_time); }
function legArriveTime(leg) { return formatTime(leg.metadata?.arrive_local || leg.arrive_time); }
// Extract date directly from ISO string (avoids TZ shift)
function formatDate(iso) {
  if (!iso) return "";
  const ds = typeof iso === "string" ? iso.substring(0, 10) : null;
  if (!ds) return "";
  const d = new Date(ds + "T12:00:00"); // noon avoids date shift
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
// Duration: prefer distance-based estimate for flights (avoids cross-timezone errors)
function formatDuration(d, a, origin, destination, legType) {
  // Only use haversine/airspeed estimate for flights — trains/buses use actual times
  if (legType !== "train" && legType !== "bus" && origin?.lat && destination?.lat && origin.lat !== 0 && destination.lat !== 0) {
    const nm = haversineNM(origin.lat, origin.lng, destination.lat, destination.lng);
    const hrs = nm / 460 + 0.5; // avg cruise speed + taxi/climb/descent
    const h = Math.floor(hrs), m = Math.round((hrs - h) * 60);
    return `~${h}H ${m}M`;
  }
  if (!d || !a) return "";
  const ms = new Date(a) - new Date(d);
  if (ms <= 0) return "";
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}H ${m}M` : `${m}M`;
}
function calcNights(leg) { if (leg.metadata?.nights) return leg.metadata.nights; if (!leg.depart_time || !leg.arrive_time) return 1; const ci = leg.depart_time.split("T")[0], co = leg.arrive_time.split("T")[0]; return Math.max(1, Math.round((new Date(co) - new Date(ci)) / 86400000)); }
function interpolateGC(p1, p2, n = 60) { const i = d3.geoInterpolate(p1, p2); return Array.from({ length: n + 1 }, (_, k) => i(k / n)); }
// Check if a leg might be live. Uses a 2-hour buffer after scheduled arrival
// to account for delays (FR24 returns proper UTC times).
const LIVE_BUFFER_MS = 2 * 60 * 60 * 1000; // 2 hours

function isLegLive(leg, realTrackData) {
  if (leg.status === "in_air" || leg.status === "in_transit") return true;
  // If FR24 ADS-B confirms the flight is in the air, trust that
  if (realTrackData) return true;
  // Auto-detect based on scheduled times with generous buffer
  if (leg.type === "flight" && leg.depart_time && leg.arrive_time && leg.status !== "completed" && leg.status !== "cancelled") {
    const now = Date.now(), dep = new Date(leg.depart_time).getTime(), arr = new Date(leg.arrive_time).getTime();
    if (now >= dep && now <= arr + LIVE_BUFFER_MS) return true;
  }
  return false;
}

// Should we probe ADS-B for this leg? More aggressive than isLegLive —
// checks a wide window around the scheduled time for flights and trains.
function shouldProbeTracking(leg) {
  if (!leg || !leg.vehicle_number) return false;
  if (leg.type !== "flight" && leg.type !== "train") return false;
  if (leg.status === "completed" || leg.status === "cancelled") return false;
  if (leg.status === "in_air" || leg.status === "in_transit") return true;
  if (!leg.depart_time || !leg.arrive_time) return false;
  const now = Date.now(), dep = new Date(leg.depart_time).getTime(), arr = new Date(leg.arrive_time).getTime();
  // Probe window: 2 hours before departure through arrival + 3 hours (covers delays)
  return now >= dep - 2 * 3600000 && now <= arr + 3 * 3600000;
}

function getLivePos(leg, realPosition) {
  if (!isLegLive(leg, realPosition)) return null;
  // If we have real tracking data (ADS-B for flights, API for trains), use it
  if (realPosition) {
    // For train tracking without GPS (SNCF/DB), we have delay info but no lat/lng
    if (realPosition.lat != null && realPosition.lng != null) {
      const totalDist = d3.geoDistance([leg.origin.lng, leg.origin.lat], [leg.destination.lng, leg.destination.lat]);
      const coveredDist = d3.geoDistance([leg.origin.lng, leg.origin.lat], [realPosition.lng, realPosition.lat]);
      const progress = totalDist > 0 ? Math.min(1, coveredDist / totalDist) : 0;
      return { lng: realPosition.lng, lat: realPosition.lat, progress, altitude_ft: realPosition.altitude_ft, velocity_kts: realPosition.velocity_kts, velocity: realPosition.velocity, heading: realPosition.heading, eta: realPosition.eta || realPosition.estimated_arrival, delay_minutes: realPosition.delay_minutes, isReal: true };
    }
    // Train with delay info but no GPS — use estimated position + delay data
    if (realPosition.delay_minutes != null || realPosition.estimated_arrival) {
      const dep = new Date(leg.actual_depart || leg.depart_time).getTime(), arr = new Date(realPosition.estimated_arrival || leg.arrive_time).getTime();
      const rawProg = (arr > dep) ? (Date.now() - dep) / (arr - dep) : 0;
      const prog = Math.max(0, Math.min(0.95, rawProg));
      const pos = d3.geoInterpolate([leg.origin.lng, leg.origin.lat], [leg.destination.lng, leg.destination.lat])(prog);
      return { lng: pos[0], lat: pos[1], progress: prog, delay_minutes: realPosition.delay_minutes, estimated_arrival: realPosition.estimated_arrival, isReal: true };
    }
  }
  // Fallback to estimated position based on departure/arrival times
  const dep = new Date(leg.actual_depart || leg.depart_time).getTime(), arr = new Date(leg.arrive_time).getTime();
  // Cap estimated progress at 95% — we can't confirm arrival without real tracking data
  const rawProg = (arr > dep) ? (Date.now() - dep) / (arr - dep) : 0;
  const prog = Math.max(0, Math.min(0.95, rawProg));
  const pos = d3.geoInterpolate([leg.origin.lng, leg.origin.lat], [leg.destination.lng, leg.destination.lat])(prog);
  return { lng: pos[0], lat: pos[1], progress: prog, isReal: false };
}

function useLiveTracking(leg) {
  const [liveData, setLiveData] = useState(null);
  useEffect(() => {
    if (!shouldProbeTracking(leg)) { setLiveData(null); return; }
    let active = true;
    const poll = async () => {
      try {
        let res;
        if (leg.type === "train" && leg.metadata?.operator) {
          res = await api(`/trains/track/${encodeURIComponent(leg.metadata.operator)}/${encodeURIComponent(leg.vehicle_number)}`);
        } else if (leg.type === "flight") {
          res = await api(`/flights/track/${encodeURIComponent(leg.vehicle_number)}`);
        } else { return; }
        if (active && res.tracking && res.position) { setLiveData(res.position); } else if (active) { setLiveData(null); }
      } catch { if (active) setLiveData(null); }
    };
    poll();
    const interval = setInterval(poll, 30000);
    return () => { active = false; clearInterval(interval); };
  }, [leg?.id, leg?.status, leg?.vehicle_number, leg?.type, leg?.metadata?.operator]);
  return liveData;
}

function computePresence(trip) {
  if (!trip.legs?.length) return { mode: "pre", narrative: "No legs yet", subtext: "", progress: null, legType: null, emoji: "🗓" };
  const now = Date.now();
  for (const leg of trip.legs) { if (isLegLive(leg)) { const dep = new Date(leg.actual_depart || leg.depart_time).getTime(), arr = new Date(leg.arrive_time).getTime(), prog = Math.max(0, Math.min(1, (now - dep) / (arr - dep))); return { mode: "transit", narrative: leg.type === "flight" ? `In the air — ${leg.carrier} ${leg.vehicle_number}` : `On the ${leg.vehicle_number || leg.carrier}`, subtext: `${Math.round(prog * 100)}% · ${leg.origin.code || leg.origin.city} → ${leg.destination.code || leg.destination.city}`, progress: prog, legType: leg.type, emoji: leg.type === "flight" ? "✈" : "🚄" }; } }
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
function DatePicker({ value, onChange, placeholder, style: sx }) {
  const { mode } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const parsed = value ? new Date(value + "T12:00:00") : null;
  const [viewYear, setViewYear] = useState(parsed?.getFullYear() || new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed?.getMonth() ?? new Date().getMonth());

  useEffect(() => { if (value) { const d = new Date(value + "T12:00:00"); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); } }, [value]);
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler); return () => document.removeEventListener("mousedown", handler);
  }, []);

  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const display = parsed ? parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toUpperCase() : (placeholder || "SELECT DATE");

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const weeks = [];
  let week = new Array(firstDay).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    week.push(d);
    if (week.length === 7) { weeks.push(week); week = []; }
  }
  if (week.length > 0) { while (week.length < 7) week.push(null); weeks.push(week); }

  const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const dayNames = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  const prevMonth = () => { if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); } else setViewMonth(viewMonth - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); } else setViewMonth(viewMonth + 1); };
  const selectDay = (d) => { const picked = new Date(viewYear, viewMonth, d); onChange(fmt(picked)); setOpen(false); };

  return (
    <div ref={ref} style={{ position: "relative", ...sx }}>
      <button type="button" onClick={() => setOpen(!open)} style={{
        width: "100%", padding: "10px 12px", background: "var(--bg-surface)", border: "1px solid var(--border-primary)",
        borderRadius: 4, fontFamily: FONT, fontSize: "12px", color: value ? "var(--text-primary)" : "var(--text-tertiary)",
        textAlign: "left", cursor: "pointer", letterSpacing: "0.5px",
      }}>{display}</button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50, marginTop: 4,
          background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 6,
          padding: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <button type="button" onClick={prevMonth} style={{ background: "none", border: "none", color: "var(--text-secondary)", fontFamily: FONT, fontSize: "14px", cursor: "pointer", padding: "4px 8px" }}>{"\u25C0"}</button>
            <span style={{ fontFamily: FONT, fontSize: "10px", letterSpacing: "2px", color: "var(--text-primary)", fontWeight: 700 }}>{monthNames[viewMonth]} {viewYear}</span>
            <button type="button" onClick={nextMonth} style={{ background: "none", border: "none", color: "var(--text-secondary)", fontFamily: FONT, fontSize: "14px", cursor: "pointer", padding: "4px 8px" }}>{"\u25B6"}</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 4 }}>
            {dayNames.map(d => <div key={d} style={{ textAlign: "center", fontFamily: FONT, fontSize: "7px", letterSpacing: "1px", color: "var(--text-tertiary)", padding: "2px 0" }}>{d}</div>)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
            {weeks.flat().map((d, i) => {
              if (!d) return <div key={`e${i}`} />;
              const thisDate = fmt(new Date(viewYear, viewMonth, d));
              const isSelected = thisDate === value;
              const isToday = thisDate === fmt(new Date());
              return (
                <button key={i} type="button" onClick={() => selectDay(d)} style={{
                  width: "100%", aspectRatio: "1", display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: FONT, fontSize: "10px", fontWeight: isSelected ? 700 : 400,
                  background: isSelected ? "var(--accent-flight)" : "transparent",
                  color: isSelected ? "var(--bg-primary)" : isToday ? "var(--accent-flight)" : "var(--text-primary)",
                  border: isToday && !isSelected ? "1px solid var(--accent-flight)" : "1px solid transparent",
                  borderRadius: 4, cursor: "pointer",
                }}>{d}</button>
              );
            })}
          </div>
          {value && <button type="button" onClick={() => { onChange(""); setOpen(false); }} style={{ width: "100%", marginTop: 6, padding: "4px 0", background: "none", border: "none", fontFamily: FONT, fontSize: "8px", letterSpacing: "1px", color: "var(--text-tertiary)", cursor: "pointer" }}>CLEAR</button>}
        </div>
      )}
    </div>
  );
}
function Spinner() { return <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />; }
function LoadingScreen() { return <div className="flex items-center justify-center min-h-[60vh]"><Spinner /><span className="ml-3 text-xs tracking-widest" style={{ color: C.textDim, fontFamily: FONT, fontSize: "10px", letterSpacing: "2px" }}>LOADING</span></div>; }

// ═══════════════════════════════════════════════════════════════════
// LANDING PAGE
// ═══════════════════════════════════════════════════════════════════

function LandingPage({ onSignIn }) {
  const isDesktop = useIsDesktop();
  const isMobile = !isDesktop;

  // Edge light positions (20 per side)
  const edgeTops = Array.from({length: 20}, (_, i) => 4 + i * 4);
  const edgeDelaysL = [0,.5,1,1.5,.3,.8,1.3,.1,.6,1.1,1.6,.4,.9,1.4,.2,.7,1.2,1.7,.5,1];
  const edgeDelaysR = [.3,.8,1.3,.1,.6,1.1,1.6,.4,.9,1.4,.2,.7,1.2,1.7,.5,1,1.5,.3,.8,1.3];
  const rendPositions = [6,22,38,54,70,86,102,118];
  const rendDelays = [0,.3,.6,.2,.5,.8,.1,.4];
  const thrPositions = [6,22,38,54,70,86,102,118];
  const thrDelays = [0,.2,.4,.1,.3,.5,.2,.4];
  const heroLineH = isMobile ? 42 : 56;
  const slideAnim = isDesktop ? 'slideDownDesktop' : 'slideDown';

  return (
    <div style={{ background: '#000', minHeight: '100vh', fontFamily: FONT, color: '#b8e8b8', overflow: 'hidden', position: 'relative' }}>

      {/* ══ INFRASTRUCTURE ══ */}
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
        {isMobile && (
          <div style={{ position: 'absolute', top: 0, left: 0, width: '75%', height: '100%', background: 'linear-gradient(to right, #000 0%, #000 40%, rgba(0,0,0,0.88) 60%, rgba(0,0,0,0.5) 80%, transparent 100%)', zIndex: 1 }}/>
        )}
        <div style={{ position: 'absolute', width: isDesktop ? 340 : 280, height: '300%', top: '-60%', left: isDesktop ? '55%' : '78%', transform: 'translateX(-50%) rotate(-25deg)', transformOrigin: 'center' }}>

          {/* ── Runway ── */}
          <div style={{ position: 'absolute', left: 0, top: 0, width: isDesktop ? 170 : 140, height: '100%', background: '#060806', borderLeft: '2px solid #0a1a0a', borderRight: '1px solid #0a1a0a' }}>
            {/* Center dashes */}
            {Array.from({length: 50}, (_, i) => (
              <div key={`rd-${i}`} style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: `${2 + i * 1.96}%`, width: 5, height: 40, background: '#1a2a1a', borderRadius: 1 }}/>
            ))}
            {/* Edge lights L */}
            {edgeTops.map((top, i) => (
              <div key={`el-l-${i}`} style={{ position: 'absolute', left: 6, top: `${top}%`, width: 5, height: 5, borderRadius: '50%', background: '#e8e4de', animation: `ew 3s ease-in-out infinite`, animationDelay: `${edgeDelaysL[i]}s` }}/>
            ))}
            {/* Edge lights R */}
            {edgeTops.map((top, i) => (
              <div key={`el-r-${i}`} style={{ position: 'absolute', right: 6, top: `${top}%`, width: 5, height: 5, borderRadius: '50%', background: '#e8e4de', animation: `ew 3s ease-in-out infinite`, animationDelay: `${edgeDelaysR[i]}s` }}/>
            ))}
            {/* Runway end (red) */}
            <div style={{ position: 'absolute', top: '18%', left: 0, width: '100%' }}>
              {rendPositions.map((left, i) => (
                <div key={`rl-${i}`} style={{ position: 'absolute', left, width: 6, height: 6, borderRadius: '50%', background: '#e84233', animation: `er 2.5s ease-in-out infinite`, animationDelay: `${rendDelays[i]}s` }}/>
              ))}
            </div>
            {/* Threshold (green) */}
            <div style={{ position: 'absolute', bottom: '20%', left: 0, width: '100%' }}>
              {thrPositions.map((left, i) => (
                <div key={`tl-${i}`} style={{ position: 'absolute', left, width: 7, height: 7, borderRadius: '50%', background: '#22c55e', animation: `tg 2s ease-in-out infinite`, animationDelay: `${thrDelays[i]}s` }}/>
              ))}
            </div>
            {/* Approach strobes */}
            <div style={{ position: 'absolute', bottom: '11%', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 8 }}>
              <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#e84233', animation: 'prg 2s ease-in-out infinite' }}/>
              {[0,.1,.2].map((d, i) => <div key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff', animation: `ss 2s ease-in-out infinite`, animationDelay: `${d}s` }}/>)}
              <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#e84233', animation: 'prg 2s ease-in-out infinite' }}/>
            </div>
            <div style={{ position: 'absolute', bottom: '8%', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 8 }}>
              {[0,1].map(i => <div key={`ar1-${i}`} style={{ width: 4, height: 4, borderRadius: '50%', background: '#e84233', animation: 'prg 2s ease-in-out infinite' }}/>)}
              {[.3,.4].map((d, i) => <div key={`as1-${i}`} style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff', animation: `ss 2s ease-in-out infinite`, animationDelay: `${d}s` }}/>)}
              {[0,1].map(i => <div key={`ar2-${i}`} style={{ width: 4, height: 4, borderRadius: '50%', background: '#e84233', animation: 'prg 2s ease-in-out infinite' }}/>)}
            </div>
            <div style={{ position: 'absolute', bottom: '5%', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 8 }}>
              {[.5,.6].map((d, i) => <div key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff', animation: `ss 2s ease-in-out infinite`, animationDelay: `${d}s` }}/>)}
            </div>
            {/* PAPI */}
            <div style={{ position: 'absolute', bottom: '22%', left: -28, display: 'flex', gap: 5 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#e84233', animation: 'prg 3s ease-in-out infinite' }}/>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#e84233', animation: 'prg 3s ease-in-out infinite' }}/>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#e8e4de', animation: 'pwg 3s ease-in-out infinite', animationDelay: '0.5s' }}/>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#e8e4de', animation: 'pwg 3s ease-in-out infinite', animationDelay: '0.5s' }}/>
            </div>
            <div style={{ position: 'absolute', bottom: '22%', right: -28, display: 'flex', gap: 5 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#e8e4de', animation: 'pwg 3s ease-in-out infinite', animationDelay: '0.5s' }}/>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#e8e4de', animation: 'pwg 3s ease-in-out infinite', animationDelay: '0.5s' }}/>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#e84233', animation: 'prg 3s ease-in-out infinite' }}/>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#e84233', animation: 'prg 3s ease-in-out infinite' }}/>
            </div>
            {/* Taxiway lights */}
            {[35,44,53,62].map((top, i) => (
              <div key={`txb-${i}`} style={{ position: 'absolute', left: -20, top: `${top}%`, width: 4, height: 4, borderRadius: '50%', background: '#3878c8', animation: `txb 4s ease-in-out infinite`, animationDelay: `${i * 0.5}s` }}/>
            ))}
            {[38,47].map((top, i) => (
              <div key={`txa-${i}`} style={{ position: 'absolute', left: -14, top: `${top}%`, width: 3, height: 3, borderRadius: '50%', background: '#c9993a', animation: `txa 3s ease-in-out infinite`, animationDelay: `${i * 1 + 0.3}s` }}/>
            ))}
            {/* Runway number */}
            <div style={{ position: 'absolute', bottom: '14%', left: '50%', transform: 'translateX(-50%)', fontSize: 26, fontWeight: 700, color: '#0f1f0f', letterSpacing: 8, fontFamily: FONT }}>09</div>
            {/* Plane */}
            <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', animation: 'planeMove 16s linear infinite' }}>
              <svg width="130" height="155" viewBox="0 0 160 190" fill="none">
                <ellipse cx="80" cy="18" rx="9" ry="18" fill="#c8c8c0" opacity="0.75"/>
                <rect x="71" y="18" width="18" height="110" rx="5" fill="#c8c8c0" opacity="0.65"/>
                <ellipse cx="80" cy="128" rx="9" ry="10" fill="#c8c8c0" opacity="0.6"/>
                <path d="M71 62 L6 86 L6 92 L71 78Z" fill="#a0a098" opacity="0.65"/>
                <path d="M89 62 L154 86 L154 92 L89 78Z" fill="#a0a098" opacity="0.65"/>
                <ellipse cx="30" cy="78" rx="5.5" ry="11" fill="#888880" opacity="0.55"/>
                <ellipse cx="130" cy="78" rx="5.5" ry="11" fill="#888880" opacity="0.55"/>
                <path d="M71 130 L38 148 L38 152 L71 140Z" fill="#a0a098" opacity="0.55"/>
                <path d="M89 130 L122 148 L122 152 L89 140Z" fill="#a0a098" opacity="0.55"/>
                <path d="M77 118 L80 118 L80 155 L77 155Z" fill="#b0b0a8" opacity="0.55"/>
                <circle cx="3" cy="90" r="3.5" fill="#e84233" opacity="0.85"><animate attributeName="opacity" values="0.3;1;0.3" dur="1s" repeatCount="indefinite"/></circle>
                <circle cx="157" cy="90" r="3.5" fill="#22c55e" opacity="0.85"><animate attributeName="opacity" values="0.3;1;0.3" dur="1s" repeatCount="indefinite"/></circle>
                <circle cx="80" cy="70" r="2.5" fill="#e84233" opacity="0.75"><animate attributeName="opacity" values="0.1;1;0.1" dur="0.8s" repeatCount="indefinite"/></circle>
              </svg>
            </div>
          </div>

          {/* Divider */}
          <div style={{ position: 'absolute', left: isDesktop ? 168 : 138, top: 0, width: 3, height: '100%', background: '#000' }}/>

          {/* ── Train Track ── */}
          <div style={{ position: 'absolute', right: 0, top: 0, width: isDesktop ? 130 : 110, height: '100%', background: '#040404' }}>
            {/* Ballast — centered */}
            <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 0, width: 50, height: '100%', background: 'repeating-linear-gradient(to bottom, #060608 0px, #080810 2px, #060608 4px)', opacity: 0.5 }}/>
            {/* Ties — centered */}
            <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 0, width: 42, height: '100%', background: 'repeating-linear-gradient(to bottom, transparent 0px, transparent 10px, #0c0c10 10px, #0c0c10 13px)' }}/>
            {/* Rails — centered ±10px */}
            <div style={{ position: 'absolute', top: 0, left: 'calc(50% - 10px)', width: 2, height: '100%', background: '#1e1e22' }}/>
            <div style={{ position: 'absolute', top: 0, left: 'calc(50% + 10px)', width: 2, height: '100%', background: '#1e1e22' }}/>
            {/* Signals — right of center */}
            {[{top:'18%',g:true},{top:'42%',g:false},{top:'65%',g:true}].map((s, i) => (
              <div key={`tsig-${i}`} style={{ position: 'absolute', left: 'calc(50% + 22px)', top: s.top, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#22c55e', opacity: s.g ? 1 : 0.1, animation: s.g ? 'sg 4s ease-in-out infinite' : 'none' }}/>
                <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#e84233', opacity: s.g ? 0.1 : 1, animation: !s.g ? 'sr 4s ease-in-out infinite' : 'none' }}/>
              </div>
            ))}
            {/* Train — centered on rails */}
            <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', animation: 'trainMove 18s linear infinite' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <div style={{ width: 24, height: 36, borderRadius: '7px 7px 2px 2px', position: 'relative', background: 'linear-gradient(to bottom, #d4628a, #a84068)' }}>
                  <div style={{ position: 'absolute', top: 3, left: '50%', transform: 'translateX(-50%)', width: 7, height: 7, borderRadius: '50%', background: '#f0d0e0', boxShadow: '0 0 12px rgba(212,98,138,0.8), 0 0 28px rgba(212,98,138,0.4)' }}/>
                </div>
                {Array.from({length: 4}, (_, i) => (
                  <div key={`tc-${i}`} style={{ width: 24, height: 26, borderRadius: 2, background: 'linear-gradient(to right, #1a1a2a, #22223a)', position: 'relative' }}>
                    <div style={{ position: 'absolute', top: 5, left: 2, right: 2, height: 4, background: 'rgba(200,200,255,0.1)', borderRadius: 1 }}/>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ══ NAV ══ */}
      <nav style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: isDesktop ? '20px 40px' : '14px 20px', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(74,255,74,0.06)' }}>
        <div style={{ fontSize: 10, letterSpacing: 4, color: '#4aff4a', fontWeight: 600, fontFamily: FONT }}>TRANSPONDER</div>
        <button onClick={onSignIn} style={{ height: isDesktop ? 40 : 38, padding: isDesktop ? '0 20px' : '0 18px', border: '1px solid #22c55e', borderRadius: 8, background: '#22c55e', color: '#000', fontSize: 9, letterSpacing: 2, fontFamily: FONT, fontWeight: 500, cursor: 'pointer' }}>GET STARTED</button>
      </nav>

      {/* ══ CONTENT ══ */}
      <div style={{ position: 'relative', zIndex: 2, maxWidth: isDesktop ? 560 : undefined, padding: isDesktop ? '0 40px' : undefined }}>

        {/* ── Hero ── */}
        <section style={{ padding: isDesktop ? '100px 0 60px' : '90px 20px 40px', maxWidth: isDesktop ? 560 : 380 }}>
          <div style={{ marginBottom: 24 }}>
            {/* Line 1 track (bottom→top): FR → DE → EN. At -84: EN (State 1), -42: DE (State 2), 0: FR (State 3) */}
            <div style={{ display: 'block', height: heroLineH, overflowX: 'visible', overflowY: 'clip', position: 'relative', marginBottom: 4 }}>
              <div style={{ display: 'flex', flexDirection: 'column', animation: `${slideAnim} 9s cubic-bezier(0.4, 0, 0.2, 1) infinite`, transform: `translateY(-${heroLineH * 2}px)` }}>
                <div style={{ fontSize: isDesktop ? 44 : 'clamp(22px, 7vw, 28px)', fontWeight: 700, letterSpacing: -0.5, lineHeight: `${heroLineH}px`, whiteSpace: 'nowrap', flexShrink: 0, height: heroLineH, color: '#d4c8ff', fontFamily: FONT }}>Suivez vols et trains.</div>
                <div style={{ fontSize: isDesktop ? 44 : 'clamp(22px, 7vw, 28px)', fontWeight: 700, letterSpacing: -0.5, lineHeight: `${heroLineH}px`, whiteSpace: 'nowrap', flexShrink: 0, height: heroLineH, color: '#c8e0ff', fontFamily: FONT }}>Fl&uuml;ge und Z&uuml;ge tracken.</div>
                <div style={{ fontSize: isDesktop ? 44 : 'clamp(22px, 7vw, 28px)', fontWeight: 700, letterSpacing: -0.5, lineHeight: `${heroLineH}px`, whiteSpace: 'nowrap', flexShrink: 0, height: heroLineH, color: '#e8e4de', fontFamily: FONT }}>Track flights and trains.</div>
              </div>
            </div>
            {/* Line 2 track (bottom→top): DE → EN → FR. At -84: FR (State 1), -42: EN (State 2), 0: DE (State 3) */}
            <div style={{ display: 'block', height: heroLineH, overflowX: 'visible', overflowY: 'clip', position: 'relative', marginBottom: 4 }}>
              <div style={{ display: 'flex', flexDirection: 'column', animation: `${slideAnim} 9s cubic-bezier(0.4, 0, 0.2, 1) infinite`, transform: `translateY(-${heroLineH * 2}px)` }}>
                <div style={{ fontSize: isDesktop ? 44 : 'clamp(22px, 7vw, 28px)', fontWeight: 700, letterSpacing: -0.5, lineHeight: `${heroLineH}px`, whiteSpace: 'nowrap', flexShrink: 0, height: heroLineH, color: '#c8e0ff', fontFamily: FONT }}>Ein Code pro Reise.</div>
                <div style={{ fontSize: isDesktop ? 44 : 'clamp(22px, 7vw, 28px)', fontWeight: 700, letterSpacing: -0.5, lineHeight: `${heroLineH}px`, whiteSpace: 'nowrap', flexShrink: 0, height: heroLineH, color: '#e8e4de', fontFamily: FONT }}>Every trip gets a code.</div>
                <div style={{ fontSize: isDesktop ? 44 : 'clamp(22px, 7vw, 28px)', fontWeight: 700, letterSpacing: -0.5, lineHeight: `${heroLineH}px`, whiteSpace: 'nowrap', flexShrink: 0, height: heroLineH, color: '#d4c8ff', fontFamily: FONT }}>Un code par voyage.</div>
              </div>
            </div>
            {/* Line 3 track (bottom→top): EN → FR → DE. At -84: DE (State 1), -42: FR (State 2), 0: EN (State 3) */}
            <div style={{ display: 'block', height: heroLineH, overflowX: 'visible', overflowY: 'clip', position: 'relative', marginBottom: 4 }}>
              <div style={{ display: 'flex', flexDirection: 'column', animation: `${slideAnim} 9s cubic-bezier(0.4, 0, 0.2, 1) infinite`, transform: `translateY(-${heroLineH * 2}px)` }}>
                <div style={{ fontSize: isDesktop ? 44 : 'clamp(22px, 7vw, 28px)', fontWeight: 700, letterSpacing: -0.5, lineHeight: `${heroLineH}px`, whiteSpace: 'nowrap', flexShrink: 0, height: heroLineH, color: '#e8e4de', fontFamily: FONT }}>Follow your people.</div>
                <div style={{ fontSize: isDesktop ? 44 : 'clamp(22px, 7vw, 28px)', fontWeight: 700, letterSpacing: -0.5, lineHeight: `${heroLineH}px`, whiteSpace: 'nowrap', flexShrink: 0, height: heroLineH, color: '#d4c8ff', fontFamily: FONT }}>Suivez vos proches.</div>
                <div style={{ fontSize: isDesktop ? 44 : 'clamp(22px, 7vw, 28px)', fontWeight: 700, letterSpacing: -0.5, lineHeight: `${heroLineH}px`, whiteSpace: 'nowrap', flexShrink: 0, height: heroLineH, color: '#c8e0ff', fontFamily: FONT }}>Folge deinen Leuten.</div>
              </div>
            </div>
          </div>

          <p style={{ fontSize: isDesktop ? 15 : 14, color: '#5a7a5a', lineHeight: 1.7, opacity: 0, animation: 'fadeUp 0.6s ease forwards', animationDelay: '0.6s', fontFamily: FONT }}>
            <strong style={{ color: '#c8e8c8', fontWeight: 600 }}>Transponder</strong> lets you combine flights, trains, and hotels into one trip. Each trip gets a squawk code you can share with anyone. They follow along with real-time updates — no app needed.
          </p>

          <div style={{ display: 'flex', gap: 8, marginTop: 22, flexWrap: 'wrap', opacity: 0, animation: 'fadeUp 0.5s ease forwards', animationDelay: '1.0s' }}>
            {[['FLIGHTS','#22c55e'],['TRAINS','#d4628a'],['HOTELS','#c9993a'],['BUSES','#7c6bb4']].map(([label, color]) => (
              <span key={label} style={{ padding: '7px 14px', borderRadius: 4, fontSize: 9, letterSpacing: 2, fontWeight: 500, border: `1px solid ${color}`, color, fontFamily: FONT }}>{label}</span>
            ))}
          </div>
        </section>

        <div style={{ width: 40, height: 1, background: '#1a2a1a', margin: isDesktop ? '40px 0' : '40px 20px' }}/>

        {/* ── Features ── */}
        <section style={{ padding: isDesktop ? '0 0 40px' : '0 20px 40px', display: 'flex', flexDirection: 'column', gap: 36, maxWidth: isDesktop ? 520 : 380 }}>
          {[
            { icon: '\u2708', label: 'FILE', text: 'Start with the dates, then layer in flights, trains, and stays. The more detail you add, the better it gets \u2014 and everything stays updated as plans change.' },
            { icon: '\u25B6', label: 'EN ROUTE', text: 'Your trip is live. Stay on top of every leg as it happens \u2014 flight delays, train changes, gate updates. Everything in one place, updating as you go.' },
            { icon: '\u25CE', label: 'TRACK', text: 'Each trip gets a 4-digit squawk code. Share it and choose what others see \u2014 from live flight progress and train arrivals to city-level check-ins or exact locations.' },
          ].map((f, i) => (
            <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={{ width: 42, height: 42, border: '1.5px solid #22c55e', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#4aff4a', fontSize: 15 }}>{f.icon}</div>
              <div>
                <div style={{ fontSize: 9, letterSpacing: 3, color: '#4aff4a', marginBottom: 4, fontFamily: FONT }}>{f.label}</div>
                <div style={{ fontSize: 12, color: '#3a5a3a', lineHeight: 1.6, fontFamily: FONT }}>{f.text}</div>
              </div>
            </div>
          ))}
        </section>

        <div style={{ width: 40, height: 1, background: '#1a2a1a', margin: isDesktop ? '40px 0' : '40px 20px' }}/>

        {/* ── Networks ── */}
        <section style={{ padding: isDesktop ? '0 0 40px' : '0 20px 40px', maxWidth: isDesktop ? 520 : 380 }}>
          <div style={{ fontSize: 8, letterSpacing: 3, color: '#22c55e', marginBottom: 16, fontFamily: FONT }}>ACTIVE AND PLANNED NETWORKS</div>
          <div style={{ fontSize: 12, color: '#3a5a3a', lineHeight: 1.6, marginBottom: 16, fontFamily: FONT }}>Track the train from Paris to Marseille like a flight from JFK to LAX.</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { name: 'SNCF', color: '#d4628a', detail: 'TGV \u00B7 Intercit\u00E9s \u00B7 TER \u00B7 French rail', status: 'LIVE', live: true },
              { name: 'DEUTSCHE BAHN', color: '#e84233', detail: 'ICE \u00B7 IC \u00B7 Regional \u00B7 German rail', status: 'LIVE', live: true },
              { name: 'NATIONAL RAIL', color: '#e8e4de', detail: 'Avanti \u00B7 LNER \u00B7 GWR \u00B7 UK rail', status: 'COMING SOON', live: false },
              { name: 'AMTRAK', color: '#3878c8', detail: 'Northeast Regional \u00B7 Acela', status: 'COMING SOON', live: false },
            ].map((n, i) => (
              <div key={i} style={{ border: '1px solid #1a2a1a', borderRadius: 8, padding: '12px 14px', background: '#050a05', display: 'flex', alignItems: 'center', gap: 12, borderLeft: `3px solid ${n.color}` }}>
                <div style={{ width: 34, height: 34, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 13, border: `1px solid ${n.color}`, color: n.color }}>{'\u25CA'}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: n.color, marginBottom: 2, fontFamily: FONT }}>{n.name}</div>
                  <div style={{ fontSize: 7, color: '#2a4a2a', lineHeight: 1.4, fontFamily: FONT }}>{n.detail}</div>
                </div>
                <span style={{ fontSize: 7, letterSpacing: 1, padding: '3px 7px', borderRadius: 3, whiteSpace: 'nowrap', fontFamily: FONT, color: n.live ? '#22c55e' : '#c9993a', border: `1px solid ${n.live ? '#1a2a1a' : '#1e1e14'}` }}>{n.status}</span>
              </div>
            ))}
          </div>
        </section>

        <div style={{ width: 40, height: 1, background: '#1a2a1a', margin: isDesktop ? '40px 0' : '40px 20px' }}/>

        {/* ── App Preview ── */}
        <section style={{ padding: '20px 20px 40px', display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: isDesktop ? 260 : 240, background: '#0a0a0c', borderRadius: 28, padding: 6, border: '3px solid #1a1a1e', position: 'relative', boxShadow: '0 16px 50px rgba(0,0,0,0.5), 0 0 0 1px #0f0f12 inset' }}>
            <div style={{ position: 'absolute', top: 6, left: '50%', transform: 'translateX(-50%)', width: 70, height: 18, background: '#0a0a0c', borderRadius: '0 0 10px 10px', zIndex: 2, border: '2px solid #1a1a1e', borderTop: 'none' }}/>
            <div style={{ background: '#000', borderRadius: 22, overflow: 'hidden', padding: '28px 10px 10px' }}>
              <div style={{ fontSize: 6, letterSpacing: 2, color: '#2a5a2a', marginBottom: 3, fontFamily: FONT }}>FLIGHT PLAN FILED</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#b8e8b8', fontFamily: FONT }}>PV Spring Break</div>
                <div style={{ fontSize: 6, color: '#c9993a', border: '1px solid #2a2a18', padding: '2px 5px', borderRadius: 2, background: '#12120a', fontFamily: FONT }}>T-6D</div>
              </div>
              <div style={{ height: 60, background: '#000', borderRadius: 3, marginBottom: 5, overflow: 'hidden', border: '1px solid #0f1a0f' }}>
                <svg width="100%" height="100%" viewBox="0 0 216 60">
                  <defs><pattern id="mg7" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M 12 0 L 0 0 0 12" fill="none" stroke="#081008" strokeWidth="0.5"/></pattern></defs>
                  <rect width="100%" height="100%" fill="url(#mg7)"/>
                  <path d="M 30,24 Q 108,4 190,42" fill="none" stroke="#22c55e" strokeWidth="1.5" opacity="0.7"/>
                  <circle cx="30" cy="24" r="2" fill="#4aff4a"/><circle cx="190" cy="42" r="2" fill="#4aff4a"/>
                  <text x="18" y="18" fill="#4aff4a" fontFamily={FONT} fontSize="6" fontWeight="600">LAX</text>
                  <text x="180" y="56" fill="#4aff4a" fontFamily={FONT} fontSize="6" fontWeight="600">PVR</text>
                </svg>
              </div>
              <div style={{ borderRadius: 2, padding: '4px 6px', background: '#050a05', marginBottom: 3, border: '1px solid #1a2a1a', borderLeft: '2px solid #22c55e' }}>
                <div style={{ fontSize: 5, color: '#22c55e', letterSpacing: 1, marginBottom: 2, fontFamily: FONT }}>FLIGHT &middot; AA2987</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#b8e8b8', fontFamily: FONT }}>LAX</span>
                  <span style={{ fontSize: 5, color: '#1a3a1a', fontFamily: FONT }}>2H 58M</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#b8e8b8', fontFamily: FONT }}>PVR</span>
                </div>
              </div>
              <div style={{ borderRadius: 2, padding: '4px 6px', background: '#0a0806', marginBottom: 3, border: '1px solid #1e1e14', borderLeft: '2px solid #c9993a' }}>
                <div style={{ fontSize: 5, color: '#c9993a', letterSpacing: 1, marginBottom: 1, fontFamily: FONT }}>GROUND STOP &middot; 4N</div>
                <div style={{ fontSize: 8, fontWeight: 600, color: '#d4c8a0', fontFamily: FONT }}>One&Only Mandarina</div>
              </div>
              <div style={{ borderRadius: 2, padding: '4px 6px', background: '#0a0508', border: '1px solid #1e141a', borderLeft: '2px solid #d4628a' }}>
                <div style={{ fontSize: 5, color: '#d4628a', letterSpacing: 1, marginBottom: 2, fontFamily: FONT }}>TRAIN &middot; TGV 6123</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#b8e8b8', fontFamily: FONT }}>CDG</span>
                  <span style={{ fontSize: 5, color: '#1a3a1a', fontFamily: FONT }}>1H 56M</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#b8e8b8', fontFamily: FONT }}>LYS</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div style={{ width: 40, height: 1, background: '#1a2a1a', margin: isDesktop ? '40px 0' : '40px 20px' }}/>

        {/* ── CTA ── */}
        <section style={{ padding: isDesktop ? '20px 0 60px' : '20px 20px 60px', maxWidth: isDesktop ? 520 : 380 }}>
          <div style={{ fontSize: 20, fontWeight: 600, color: '#e8e4de', marginBottom: 16, lineHeight: 1.2, fontFamily: FONT }}>Ready to track your next trip?</div>
          <button onClick={onSignIn} style={{ width: '100%', height: 50, border: 'none', borderRadius: 10, background: '#22c55e', color: '#000', fontSize: 11, letterSpacing: 3, fontFamily: FONT, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.44 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            SIGN UP WITH GOOGLE
          </button>
          <div style={{ fontSize: 8, color: '#2a4a2a', textAlign: 'center', marginTop: 10, lineHeight: 1.5, fontFamily: FONT }}>Create your account now. We'll let you know<br/>when Transponder is ready for takeoff.</div>
        </section>

        {/* ── Footer ── */}
        <footer style={{ padding: isDesktop ? '32px 40px' : '24px 20px', borderTop: '1px solid #0f1a0f', display: 'flex', justifyContent: 'space-between', fontSize: 8, color: '#1a3a1a', letterSpacing: 1, fontFamily: FONT }}>
          <span>TRANSPONDER &middot; 2026</span>
          <span>BUILT IN AUBERVILLE LA MANUEL</span>
        </footer>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// PRE-LAUNCH CONFIRMATION
// ═══════════════════════════════════════════════════════════════════

const PRE_LAUNCH = true; // flip to false on launch day
const PRE_LAUNCH_BYPASS = ['jgmadilian@gmail.com', 'omadilian@gmail.com'];

function PreLaunchConfirmation({ onSignOut }) {
  return (
    <div style={{ background: '#000', minHeight: '100vh', fontFamily: FONT, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ fontSize: 11, letterSpacing: 4, color: '#4aff4a', fontWeight: 600, marginBottom: 40 }}>TRANSPONDER</div>
      <div style={{ fontSize: 22, fontWeight: 600, color: '#e8e4de', marginBottom: 16 }}>You're on the list.</div>
      <div style={{ fontSize: 12, color: '#3a5a3a', lineHeight: 1.6, textAlign: 'center', marginBottom: 32 }}>We'll send you an email when<br/>Transponder is ready for takeoff.</div>
      <button onClick={onSignOut} style={{ fontSize: 9, color: '#22c55e', background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer', fontFamily: FONT, letterSpacing: 1 }}>BACK TO TRANSPONDERAPP.COM</button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SQUAWK MODAL
// ═══════════════════════════════════════════════════════════════════

function SquawkModal({ trip, onClose }) {
  const { mode } = useTheme();
  const isDesktop = useIsDesktop();
  const [copied, setCopied] = useState(null);
  const [viewers, setViewers] = useState([]);
  const [error, setError] = useState(null);
  const [revokeConfirm, setRevokeConfirm] = useState(null);

  const squawk = trip.squawk_code;

  useEffect(() => {
    api(`/squawk/trip/${trip.id}`).then(data => {
      const followers = data?.followers || [];
      setViewers(followers);
    }).catch(() => {});
  }, [trip.id]);

  const revoke = async (codeId) => {
    try { await api(`/squawk/${codeId}`, { method: "DELETE" }); setViewers(v => v.filter(c => c.id !== codeId)); setRevokeConfirm(null); } catch (e) { setError(e.message); }
  };

  const copy = (type) => {
    const text = type === "code" ? squawk : `Track my trip on Transponder! Enter code ${squawk} at transponderapp.com`;
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(type); setTimeout(() => setCopied(null), 2000);
  };

  const timeAgo = (dateStr) => {
    if (!dateStr) return "";
    const ms = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (d > 0) return `${d}d`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: mode === "night" ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.3)" }} onClick={onClose}>
      <div className="w-full" style={{ background: "var(--bg-primary)", borderTop: "1px solid var(--border-primary)", borderRadius: "16px 16px 0 0", maxHeight: "85vh", overflowY: "auto", maxWidth: isDesktop ? 480 : undefined, margin: isDesktop ? "0 auto" : undefined }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "20px 16px 24px" }}>
          {/* Drag handle */}
          <div style={{ width: 36, height: 4, background: "var(--border-primary)", borderRadius: 2, margin: "0 auto 16px" }} />

          {/* Header row */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
            <div>
              <p style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "3px", color: "var(--text-secondary)" }}>TRANSPONDER</p>
              <p style={{ fontFamily: FONT, fontSize: "14px", fontWeight: 600, color: "var(--text-heading)", marginTop: 2 }}>Share Trip</p>
            </div>
            <button onClick={onClose} style={{ width: 32, height: 32, border: "1px solid var(--border-primary)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--nav-text)", fontFamily: FONT, fontSize: "16px", background: "transparent" }}>{"\u00D7"}</button>
          </div>

          {/* Description */}
          <p style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: 16 }}>Share your squawk code with someone — they enter it, your trip appears in their feed.</p>

          {error && <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 6, background: "var(--danger-bg)", color: "var(--danger-text)", fontFamily: FONT, fontSize: "9px" }}>{error}</div>}

          {/* Squawk code section */}
          <p style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "3px", color: "var(--text-tertiary)", textAlign: "center", marginBottom: 10 }}>SQUAWK CODE</p>

          {squawk ? (
            <>
              {/* Four digit cells */}
              <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 16 }}>
                {squawk.split("").map((ch, i) => (
                  <div key={i} style={{ width: 52, height: 52, border: "1.5px solid var(--accent-flight)", borderRadius: 6, background: "var(--bg-card)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, fontSize: "22px", fontWeight: 700, color: "var(--accent-flight-bright)" }}>{ch}</div>
                ))}
              </div>

              {/* Action buttons */}
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <button onClick={() => copy("code")} style={{ flex: 1, height: 44, border: "1px solid var(--border-primary)", borderRadius: 8, background: "var(--nav-bg)", color: "var(--accent-flight-bright)", fontFamily: FONT, fontSize: "9px", letterSpacing: "2px", cursor: "pointer" }}>{copied === "code" ? "COPIED" : "COPY CODE"}</button>
                <button onClick={() => copy("msg")} style={{ flex: 1, height: 44, border: "1px solid var(--accent-flight)", borderRadius: 8, background: "var(--squawk-bg)", color: "var(--squawk-text)", fontFamily: FONT, fontSize: "9px", letterSpacing: "2px", cursor: "pointer" }}>{copied === "msg" ? "COPIED" : "COPY MESSAGE"}</button>
              </div>
            </>
          ) : (
            <p style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-tertiary)", textAlign: "center", marginBottom: 16 }}>No squawk code assigned</p>
          )}

          {/* Divider + viewer list */}
          <div style={{ borderTop: "1px solid var(--border-subtle)", margin: "12px 0" }} />
          <p style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "3px", color: "var(--text-tertiary)", marginBottom: 8 }}>TRACKING {"\u00B7"} {viewers.length} VIEWER{viewers.length !== 1 ? "S" : ""}</p>

          {viewers.map((v, i) => (
            <div key={v.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: i < viewers.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 28, height: 28, borderRadius: "50%", border: "1px solid var(--border-primary)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, fontSize: "11px", fontWeight: 600, color: "var(--nav-text)" }}>{(v.claimed_by || "?").charAt(0).toUpperCase()}</div>
                <div>
                  <p style={{ fontFamily: FONT, fontSize: "11px", fontWeight: 500, color: "var(--text-heading)" }}>{v.claimed_by || "Unknown"}</p>
                  <p style={{ fontFamily: FONT, fontSize: "8px", color: "var(--text-tertiary)" }}>Linked {timeAgo(v.claimed_at)} ago</p>
                </div>
              </div>
              {revokeConfirm === v.id ? (
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => setRevokeConfirm(null)} style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "1px", color: "var(--text-tertiary)", padding: "4px 8px", background: "transparent", border: "none", cursor: "pointer" }}>CANCEL</button>
                  <button onClick={() => revoke(v.id)} style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "1px", color: "var(--danger-text)", padding: "4px 10px", border: "1px solid var(--danger-border)", borderRadius: 4, background: "var(--danger-bg)", cursor: "pointer" }}>REVOKE</button>
                </div>
              ) : (
                <button onClick={() => setRevokeConfirm(v.id)} style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "1px", color: "var(--danger-text)", padding: "4px 10px", border: "1px solid var(--danger-border)", borderRadius: 4, background: "transparent", cursor: "pointer" }}>REVOKE</button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SQUAWK ENTRY
// ═══════════════════════════════════════════════════════════════════

function SquawkEntry({ onClaim }) {
  const [code, setCode] = useState(["", "", "", ""]);
  const [status, setStatus] = useState(null); // null | "checking" | "success" | "error"
  const [error, setError] = useState(null);
  const [claimedTrip, setClaimedTrip] = useState(null);
  const refs = useRef([]);

  const handleChange = (i, val) => {
    const v = val.replace(/[^0-9]/g, "").slice(-1);
    const n = [...code]; n[i] = v; setCode(n); setStatus(null); setError(null);
    if (v && i < 3) refs.current[i + 1]?.focus();
  };
  const handleKey = (i, e) => {
    if (e.key === "Backspace" && !code[i] && i > 0) { refs.current[i - 1]?.focus(); const n = [...code]; n[i - 1] = ""; setCode(n); }
    if (e.key === "Enter" && code.every(c => c)) submit();
  };
  const handlePaste = (e) => {
    e.preventDefault();
    const p = e.clipboardData.getData("text").replace(/[^0-9]/g, "").slice(0, 4);
    const n = [...code]; for (let i = 0; i < 4; i++) n[i] = p[i] || ""; setCode(n);
    if (p.length === 4) refs.current[3]?.focus();
  };

  const submit = async () => {
    if (code.some(c => !c)) return;
    setStatus("checking"); setError(null);
    try {
      const res = await api("/squawk/claim", { method: "POST", body: JSON.stringify({ code: code.join("") }) });
      setClaimedTrip(res?.trip_title || "Trip");
      setStatus("success");
      setTimeout(() => { onClaim(); setCode(["", "", "", ""]); setStatus(null); setClaimedTrip(null); }, 3000);
    } catch (e) {
      setStatus("error"); setError("Invalid code \u2014 check and try again");
      setTimeout(() => { setCode(["", "", "", ""]); setStatus(null); setError(null); refs.current[0]?.focus(); }, 2000);
    }
  };

  const full = code.every(c => c);

  // Success state
  if (status === "success") {
    return (
      <div style={{ textAlign: "center", padding: "16px 0" }}>
        <div style={{ width: 48, height: 48, borderRadius: "50%", border: "2px solid var(--accent-flight)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px" }}>
          <span style={{ fontSize: "20px", color: "var(--accent-flight-bright)" }}>{"\u2713"}</span>
        </div>
        <p style={{ fontFamily: FONT, fontSize: "11px", letterSpacing: "3px", color: "var(--accent-flight-bright)", fontWeight: 500, marginBottom: 4 }}>LINKED</p>
        <p style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-secondary)" }}>{claimedTrip} added to your feed</p>
      </div>
    );
  }

  return (
    <div style={{ textAlign: "center", padding: "8px 0" }}>
      <p style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "3px", color: "var(--text-secondary)", marginBottom: 4 }}>ENTER SQUAWK CODE</p>
      <p style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-tertiary)", lineHeight: 1.5, marginBottom: 16 }}>Enter a 4-digit code to track someone's trip in your feed.</p>

      {/* Four input cells */}
      <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 16 }}>
        {code.map((ch, i) => (
          <input
            key={i} ref={el => refs.current[i] = el}
            type="text" inputMode="numeric"
            value={ch} onChange={e => handleChange(i, e.target.value)}
            onKeyDown={e => handleKey(i, e)} onPaste={i === 0 ? handlePaste : undefined}
            maxLength={1}
            style={{
              width: 52, height: 52, textAlign: "center", fontFamily: FONT, fontSize: "22px", fontWeight: 700,
              border: `1.5px solid ${status === "error" ? "var(--danger-text)" : ch ? "var(--accent-flight)" : "var(--border-primary)"}`,
              borderRadius: 6, background: "var(--bg-card)",
              color: ch ? "var(--accent-flight-bright)" : "var(--text-tertiary)",
              outline: "none", caretColor: "var(--accent-flight)",
            }}
          />
        ))}
      </div>

      {error && <p style={{ fontFamily: FONT, fontSize: "9px", color: "var(--danger-text)", marginBottom: 12 }}>{error}</p>}

      {/* CLAIM button */}
      <button onClick={submit} disabled={!full || status === "checking"}
        style={{
          width: "100%", height: 48, borderRadius: 10, fontFamily: FONT, fontSize: "11px", letterSpacing: "3px", fontWeight: 500, cursor: full ? "pointer" : "default",
          background: full ? "var(--squawk-bg)" : "var(--bg-surface)",
          color: full ? "var(--squawk-text)" : "var(--text-tertiary)",
          border: full ? "none" : "1px solid var(--border-subtle)",
        }}>
        {status === "checking" ? <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Spinner /> CHECKING</span> : "CLAIM"}
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD — Global Radar Map
// ═══════════════════════════════════════════════════════════════════

function DashboardMap({ trips, filter, heroTripId, hoveredTripId }) {
  const svgRef = useRef(null), containerRef = useRef(null), zoomRef = useRef(null);
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

    // Fixed background
    svg.append("rect").attr("width", w).attr("height", h).attr("fill", "var(--bg-map)");
    svg.append("rect").attr("width", w * 3).attr("height", h * 3).attr("x", -w).attr("y", -h).attr("fill", "url(#dash-grid)");

    // Zoomable content group
    const g = svg.append("g").attr("class", "map-content");

    const land = topojson.feature(worldData, worldData.objects.land);
    const borders = topojson.mesh(worldData, worldData.objects.countries, (a, b) => a !== b);
    if (isDay) {
      g.append("path").datum(land).attr("d", path).attr("fill", "var(--map-land)").attr("stroke", "var(--map-land-stroke)").attr("stroke-width", 0.8);
      g.append("path").datum(borders).attr("d", path).attr("fill", "none").attr("stroke", "var(--map-land-stroke)").attr("stroke-width", 0.5);
    } else {
      g.append("path").datum(borders).attr("d", path).attr("fill", "none").attr("stroke", "var(--map-grid)").attr("stroke-width", 0.5);
    }

    // Ghost arcs (non-hero trips)
    trips.forEach(trip => {
      if (trip.id === heroTripId) return;
      const isHovered = hoveredTripId && trip.id === hoveredTripId;
      trip.legs?.forEach(leg => {
        if (leg.type === "hotel" || leg.origin?.lat == null || leg.destination?.lat == null) return;
        const coords = leg.type === "flight" ? interpolateGC([leg.origin.lng, leg.origin.lat], [leg.destination.lng, leg.destination.lat]) : [[leg.origin.lng, leg.origin.lat], [leg.destination.lng, leg.destination.lat]];
        const lineGen = d3.line().x(d => proj(d)[0]).y(d => proj(d)[1]).curve(leg.type === "flight" ? d3.curveBasis : d3.curveLinear);
        g.append("path").datum(coords).attr("d", lineGen).attr("fill", "none").attr("stroke", "var(--map-arc)").attr("stroke-width", isHovered ? 2 : 1).attr("opacity", isHovered ? 0.7 : 0.13);
      });
      const gc = new Map();
      trip.legs?.forEach(l => {
        if (l.type === "hotel") return;
        if (l.origin?.lat != null) gc.set(`${l.origin.lat},${l.origin.lng}`, { code: l.origin.code, coords: [l.origin.lng, l.origin.lat] });
        if (l.destination?.lat != null) gc.set(`${l.destination.lat},${l.destination.lng}`, { code: l.destination.code, coords: [l.destination.lng, l.destination.lat] });
      });
      gc.forEach(c => {
        const [x, y] = proj(c.coords);
        g.append("circle").attr("cx", x).attr("cy", y).attr("r", 2).attr("fill", "var(--map-arc)").attr("opacity", 0.18);
        if (c.code) g.append("text").attr("x", x).attr("y", y - 8).attr("text-anchor", "middle").attr("fill", "var(--map-label)").attr("font-size", "7px").attr("font-family", FONT).attr("opacity", 0.18).text(c.code);
      });
    });

    // Hero trip
    const heroTrip = trips.find(t => t.id === heroTripId);
    if (heroTrip) {
      heroTrip.legs?.forEach(leg => {
        if (leg.type === "hotel" && leg.origin?.lat != null) {
          const [hx, hy] = proj([leg.origin.lng, leg.origin.lat]);
          g.append("circle").attr("cx", hx).attr("cy", hy).attr("r", 22).attr("fill", "var(--map-dwell-glow)");
          g.append("circle").attr("cx", hx).attr("cy", hy).attr("r", 16).attr("fill", "var(--accent-hotel)").attr("opacity", 0.08);
        }
      });

      let isFirst = true;
      heroTrip.legs?.forEach(leg => {
        if (leg.type === "hotel" || leg.origin?.lat == null || leg.destination?.lat == null) return;
        const coords = leg.type === "flight" ? interpolateGC([leg.origin.lng, leg.origin.lat], [leg.destination.lng, leg.destination.lat]) : [[leg.origin.lng, leg.origin.lat], [leg.destination.lng, leg.destination.lat]];
        const lineGen = d3.line().x(d => proj(d)[0]).y(d => proj(d)[1]).curve(leg.type === "flight" ? d3.curveBasis : d3.curveLinear);
        if (isFirst) {
          g.append("path").datum(coords).attr("d", lineGen).attr("fill", "none").attr("stroke", "var(--map-arc)").attr("stroke-width", 2.5).attr("stroke-linecap", "round").attr("opacity", 0.7);
          isFirst = false;
        } else {
          g.append("path").datum(coords).attr("d", lineGen).attr("fill", "none").attr("stroke", "var(--map-arc)").attr("stroke-width", 1.2).attr("stroke-dasharray", "5,3").attr("opacity", 0.25);
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
        g.append("circle").attr("cx", x).attr("cy", y).attr("r", 7).attr("fill", "none").attr("stroke", "var(--map-arc)").attr("stroke-width", 0.5).attr("opacity", 0.4);
        g.append("circle").attr("cx", x).attr("cy", y).attr("r", 3.5).attr("fill", "var(--map-dot)");
        g.append("text").attr("x", x).attr("y", y - 12).attr("text-anchor", "middle").attr("fill", "var(--map-label)").attr("font-size", "9px").attr("font-family", FONT).attr("font-weight", 600).text(city.code || city.city);
      });

      const liveLeg = heroTrip.legs?.find(l => isLegLive(l));
      if (liveLeg) {
        const lp = getLivePos(liveLeg);
        if (lp) {
          const [px, py] = proj([lp.lng, lp.lat]);
          const ping = g.append("circle").attr("cx", px).attr("cy", py).attr("r", 5).attr("fill", "none").attr("stroke", "var(--map-arc)").attr("stroke-width", 1.5).attr("opacity", 0);
          (function anim() { ping.attr("r", 5).attr("opacity", 0.6).transition().duration(1800).ease(d3.easeQuadOut).attr("r", 22).attr("opacity", 0).on("end", anim); })();
          g.append("circle").attr("cx", px).attr("cy", py).attr("r", 5).attr("fill", "var(--map-arc)").attr("filter", "url(#dash-glow)");
          g.append("circle").attr("cx", px).attr("cy", py).attr("r", 2).attr("fill", "var(--bg-primary)");
        }
      }
    }

    // Fixed label (not zoomable)
    const isPast = filter === "completed";
    const cnt = trips.length;
    const countText = cnt === 0 ? "NO FLIGHT PLANS FILED" : `${cnt} FLIGHT PLAN${cnt !== 1 ? "S" : ""} ${isPast ? "ARCHIVED" : "FILED"}`;
    svg.append("text").attr("x", w / 2).attr("y", h - 10).attr("text-anchor", "middle").attr("fill", "var(--map-distance)").attr("font-size", "8px").attr("font-family", FONT).attr("letter-spacing", "2px").text(countText);

    // Zoom behavior
    const zoom = d3.zoom().scaleExtent([0.5, 6]).on("zoom", (event) => { g.attr("transform", event.transform); });
    svg.call(zoom);
    svg.on("dblclick.zoom", null);
    zoomRef.current = zoom;
  }, [trips, filter, heroTripId, hoveredTripId, mode]);

  useEffect(() => { draw(); const h = () => draw(); window.addEventListener("resize", h); return () => window.removeEventListener("resize", h); }, [draw]);

  return (
    <div ref={containerRef} className="w-full" style={{ height: "100%", minHeight: 195, background: "var(--bg-map)", borderBottom: mode === "day" ? "1px solid var(--border-subtle)" : "none", touchAction: "none" }}>
      <svg ref={svgRef} className="w-full h-full" style={{ cursor: "grab" }} />
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
  if (counts.train) items.push({ color: "var(--strip-train)", label: `${counts.train} TRAIN${counts.train !== 1 ? "S" : ""}` });
  if (counts.bus) items.push({ color: "var(--strip-bus)", label: `${counts.bus} BUS${counts.bus !== 1 ? "ES" : ""}` });
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
// FOLLOWING TAB
// ═══════════════════════════════════════════════════════════════════

function FollowingTab({ following, setFollowing, fetchData, navigate, mode }) {
  const [personFilter, setPersonFilter] = useState(null);
  const [unfollowConfirm, setUnfollowConfirm] = useState(null);
  const [compactCode, setCompactCode] = useState("");
  const [claimStatus, setClaimStatus] = useState(null);
  const [claimError, setClaimError] = useState(null);
  const [claimedTrip, setClaimedTrip] = useState(null);

  const travelers = useMemo(() => {
    const map = new Map();
    following.forEach(t => {
      const name = t.traveler?.display_name || t.traveler?.name || "Unknown";
      const key = name.toLowerCase();
      if (!map.has(key)) map.set(key, { name, initial: name.charAt(0).toUpperCase() });
    });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [following]);

  const filtered = useMemo(() => {
    if (!personFilter) return following;
    return following.filter(t => {
      const name = (t.traveler?.display_name || t.traveler?.name || "Unknown").toLowerCase();
      return name === personFilter.toLowerCase();
    });
  }, [following, personFilter]);

  const liveFol = filtered.filter(t => {
    const p = computePresence(t);
    return p.mode === "transit";
  });
  const dwellingFol = filtered.filter(t => {
    const p = computePresence(t);
    return p.mode === "dwelling";
  });
  const upcomingFol = filtered.filter(t => {
    const p = computePresence(t);
    return p.mode === "pre";
  }).sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
  const completeFol = filtered.filter(t => {
    const p = computePresence(t);
    return p.mode === "post";
  }).sort((a, b) => new Date(b.end_date) - new Date(a.end_date));

  const tracked = [...dwellingFol, ...upcomingFol, ...completeFol];

  const handleCompactClaim = async () => {
    if (compactCode.length < 4) return;
    setClaimStatus("checking"); setClaimError(null);
    try {
      const res = await api("/squawk/claim", { method: "POST", body: JSON.stringify({ code: compactCode }) });
      const tripName = res?.trip_title || "Trip";
      // Check if already following
      const alreadyFollowing = following.some(t => t.id === res?.trip_id);
      if (alreadyFollowing) {
        setClaimedTrip(tripName); setClaimStatus("already");
        setTimeout(() => { setCompactCode(""); setClaimStatus(null); setClaimedTrip(null); }, 3000);
      } else {
        setClaimedTrip(tripName); setClaimStatus("success");
        setTimeout(() => { fetchData(); setCompactCode(""); setClaimStatus(null); setClaimedTrip(null); }, 2500);
      }
    } catch (e) {
      const msg = e?.message || "";
      if (msg.toLowerCase().includes("already")) {
        setClaimedTrip("Trip"); setClaimStatus("already");
        setTimeout(() => { setCompactCode(""); setClaimStatus(null); setClaimedTrip(null); }, 3000);
      } else {
        setClaimStatus("error"); setClaimError("Invalid code");
        setTimeout(() => { setCompactCode(""); setClaimStatus(null); setClaimError(null); }, 2000);
      }
    }
  };

  const handleUnfollow = async (tripId) => {
    try {
      await api(`/trips/following/${tripId}`, { method: "DELETE" });
      setFollowing(prev => prev.filter(t => t.id !== tripId));
      setUnfollowConfirm(null);
    } catch { /* silently fail, keep in list */ }
  };

  const getActiveLeg = (trip) => {
    const now = Date.now();
    return trip.legs?.find(l => {
      if (isLegLive(l)) return true;
      const dep = new Date(l.depart_time).getTime();
      const arr = new Date(l.arrive_time).getTime();
      return now >= dep && now <= arr && l.type !== "hotel";
    });
  };

  const getName = (trip) => (trip.traveler?.display_name || trip.traveler?.name || "Unknown");

  const getCardOpacity = (presence) => {
    if (presence.mode === "transit") return 1;
    if (presence.mode === "post") return mode === "night" ? 0.45 : 0.4;
    return mode === "night" ? 0.75 : 0.7;
  };

  const getStatusLabel = (trip, presence) => {
    if (presence.mode === "transit") return { text: "EN ROUTE", color: "var(--accent-flight-bright)", pulse: true };
    if (presence.mode === "dwelling") return { text: "ON GROUND", color: "var(--accent-hotel)", pulse: false };
    if (presence.mode === "post") return { text: "COMPLETE", color: "var(--text-tertiary)", pulse: false };
    const now = Date.now();
    const first = trip.legs?.[0];
    if (first) {
      const d = Math.ceil((new Date(first.depart_time).getTime() - now) / 86400000);
      return { text: `SCHEDULED \u00B7 T-${d}D`, color: "var(--accent-countdown, var(--text-secondary))", pulse: false };
    }
    return { text: "SCHEDULED", color: "var(--text-secondary)", pulse: false };
  };

  const renderCard = (trip) => {
    const presence = computePresence(trip);
    const opacity = getCardOpacity(presence);
    const status = getStatusLabel(trip, presence);
    const activeLeg = presence.mode === "transit" ? getActiveLeg(trip) : null;
    const name = getName(trip);
    const isConfirming = unfollowConfirm === trip.id;

    const flightCount = trip.legs?.filter(l => l.type === "flight").length || 0;
    const hotelCount = trip.legs?.filter(l => l.type === "hotel").length || 0;
    const trainCount = trip.legs?.filter(l => l.type === "train").length || 0;
    const busCount = trip.legs?.filter(l => l.type === "bus").length || 0;

    return (
      <div key={trip.id} className="tappable-card" style={{ opacity, border: "1px solid var(--border-primary)", borderRadius: 6, padding: 12, background: "var(--bg-card)", borderLeftWidth: 3, borderLeftColor: presence.mode === "transit" ? "var(--strip-flight)" : presence.mode === "dwelling" ? "var(--strip-hotel)" : "var(--border-primary)", borderLeftStyle: "solid" }}>
        <button onClick={() => navigate("shared", { tripId: trip.id })} className="w-full text-left" style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 24, height: 24, borderRadius: "50%", border: "1px solid var(--border-primary)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, fontSize: "9px", fontWeight: 700, color: "var(--accent-flight)", background: "var(--bg-surface)", flexShrink: 0 }}>{name.charAt(0).toUpperCase()}</div>
              <span style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "1px", color: "var(--text-secondary)", textTransform: "uppercase" }}>{name}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {status.pulse && <span style={{ width: 6, height: 6, borderRadius: "50%", background: status.color, animation: "live-pulse 2s ease-in-out infinite", flexShrink: 0 }} />}
              <span style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "1px", color: status.color, fontWeight: 500 }}>{status.text}</span>
            </div>
          </div>

          <p style={{ fontFamily: FONT, fontSize: "14px", fontWeight: 600, color: "var(--text-heading)", marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{trip.title}</p>

          <p style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-secondary)", marginBottom: 8 }}>{formatDateRange(trip.start_date, trip.end_date)}</p>

          {activeLeg && (() => {
            const dep = new Date(activeLeg.actual_depart || activeLeg.depart_time).getTime();
            const arr = new Date(activeLeg.arrive_time).getTime();
            const prog = Math.max(0, Math.min(1, (Date.now() - dep) / (arr - dep)));
            return (
              <div style={{ border: "1px solid var(--border-primary)", borderRadius: 4, padding: "8px 10px", background: "var(--bg-surface)", marginBottom: 8 }}>
                <p style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "1px", color: "var(--accent-flight)", marginBottom: 6 }}>
                  {activeLeg.origin?.code || "?"} {"\u2192"} {activeLeg.destination?.code || "?"} {"\u00B7"} {activeLeg.vehicle_number || activeLeg.carrier || ""}
                </p>
                <div style={{ height: 4, borderRadius: 2, background: "var(--border-primary)", marginBottom: 4 }}>
                  <div style={{ height: "100%", borderRadius: 2, background: "var(--accent-flight)", width: `${prog * 100}%` }} />
                </div>
                <p style={{ fontFamily: FONT, fontSize: "8px", color: "var(--text-tertiary)" }}>
                  Lands at {formatTime(activeLeg.metadata?.arrive_local || activeLeg.arrive_time)} local {"\u00B7"} {Math.round(prog * 100)}%
                </p>
              </div>
            );
          })()}

          {presence.mode === "dwelling" && (
            <p style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-secondary)", marginBottom: 8 }}>
              In the {presence.narrative.includes("in ") ? presence.narrative.split("in ")[1] : "local"} area
            </p>
          )}

          <div style={{ marginBottom: 8 }}>
            <InlineRoute legs={trip.legs} codeSize="12px" />
          </div>
        </button>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {flightCount > 0 && <span style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--strip-flight)" }} /><span style={{ fontFamily: FONT, fontSize: "8px", color: "var(--text-tertiary)" }}>{flightCount} FLIGHT{flightCount !== 1 ? "S" : ""}</span></span>}
            {hotelCount > 0 && <span style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--strip-hotel)" }} /><span style={{ fontFamily: FONT, fontSize: "8px", color: "var(--text-tertiary)" }}>{hotelCount} HOTEL{hotelCount !== 1 ? "S" : ""}</span></span>}
            {trainCount > 0 && <span style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--strip-train)" }} /><span style={{ fontFamily: FONT, fontSize: "8px", color: "var(--text-tertiary)" }}>{trainCount} TRAIN{trainCount !== 1 ? "S" : ""}</span></span>}
            {busCount > 0 && <span style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--strip-bus)" }} /><span style={{ fontFamily: FONT, fontSize: "8px", color: "var(--text-tertiary)" }}>{busCount} BUS{busCount !== 1 ? "ES" : ""}</span></span>}
          </div>
          <div style={{ minWidth: 44, minHeight: 44, display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
            {isConfirming ? (
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <button onClick={(e) => { e.stopPropagation(); setUnfollowConfirm(null); }} style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "1px", color: "var(--text-secondary)", background: "none", border: "none", cursor: "pointer", padding: "8px 6px", minHeight: 44 }}>KEEP</button>
                <span style={{ color: "var(--text-tertiary)", fontSize: "8px" }}>|</span>
                <button onClick={(e) => { e.stopPropagation(); handleUnfollow(trip.id); }} style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "1px", color: "#e84233", fontWeight: 500, background: "none", border: "none", cursor: "pointer", padding: "8px 6px", minHeight: 44 }}>UNFOLLOW</button>
              </div>
            ) : (
              <button onClick={(e) => { e.stopPropagation(); setUnfollowConfirm(trip.id); }} style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "1px", color: "var(--text-tertiary)", textDecoration: "underline", textUnderlineOffset: "2px", background: "none", border: "none", cursor: "pointer", padding: "8px 0", minHeight: 44 }}>UNFOLLOW</button>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (following.length === 0) {
    return (
      <div className="px-4 py-4">
        <SquawkEntry onClaim={fetchData} />
        <div className="mt-6" style={{ border: "1px dashed var(--border-primary)", borderRadius: 6, padding: "20px 14px", textAlign: "center" }}>
          <p style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "1px", color: "var(--text-tertiary)" }}>NO FOLLOWED TRIPS {"\u00B7"} ENTER A SQUAWK CODE TO START</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
        {claimStatus === "success" || claimStatus === "already" ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "8px 0" }}>
            <span style={{ color: "var(--accent-flight-bright)", fontSize: "14px" }}>{"\u2713"}</span>
            <span style={{ fontFamily: FONT, fontSize: "11px", letterSpacing: "3px", color: "var(--accent-flight-bright)", fontWeight: 500 }}>{claimStatus === "already" ? "ALREADY TRACKING" : "LINKED"}</span>
            <span style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-secondary)" }}>{claimStatus === "already" ? `${claimedTrip} is already in your feed` : claimedTrip}</span>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="text" value={compactCode}
              onChange={e => { const v = e.target.value.replace(/[^0-9]/g, "").slice(0, 4); setCompactCode(v); setClaimStatus(null); setClaimError(null); }}
              onKeyDown={e => { if (e.key === "Enter" && compactCode.length === 4) handleCompactClaim(); }}
              placeholder="Enter 4-digit code..."
              maxLength={4}
              style={{ flex: 1, border: `1px solid ${claimStatus === "error" ? "#e84233" : "var(--border-primary)"}`, borderRadius: 6, padding: "10px 12px", background: "var(--bg-card)", fontFamily: FONT, fontSize: "11px", color: "var(--text-primary)", letterSpacing: "1px", outline: "none" }}
            />
            <button
              onClick={handleCompactClaim}
              disabled={compactCode.length < 4 || claimStatus === "checking"}
              style={{ height: 40, padding: "0 14px", borderRadius: 6, border: "none", fontFamily: FONT, fontSize: "9px", letterSpacing: "2px", fontWeight: 500, cursor: compactCode.length === 4 ? "pointer" : "default", background: compactCode.length === 4 ? "var(--squawk-bg)" : "var(--bg-surface)", color: compactCode.length === 4 ? "var(--squawk-text)" : "var(--text-tertiary)", whiteSpace: "nowrap" }}
            >{claimStatus === "checking" ? <Spinner /> : "CLAIM"}</button>
          </div>
        )}
        {claimError && <p style={{ fontFamily: FONT, fontSize: "8px", color: "#e84233", marginTop: 4 }}>{claimError}</p>}
      </div>

      {travelers.length > 0 && (
        <div className="no-scrollbar" style={{ display: "flex", gap: 6, padding: "10px 16px", overflowX: "auto", borderBottom: "1px solid var(--border-subtle)", WebkitOverflowScrolling: "touch" }}>
          <button onClick={() => setPersonFilter(null)} style={{ padding: "8px 14px", borderRadius: 20, fontFamily: FONT, fontSize: "8px", letterSpacing: "1px", fontWeight: !personFilter ? 500 : 400, background: !personFilter ? "var(--squawk-bg)" : "transparent", color: !personFilter ? "var(--squawk-text)" : "var(--nav-text)", border: `1px solid ${!personFilter ? "var(--accent-flight)" : "var(--border-primary)"}`, cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap" }}>ALL</button>
          {travelers.map(t => (
            <button key={t.name} onClick={() => setPersonFilter(t.name)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 20, fontFamily: FONT, fontSize: "8px", letterSpacing: "1px", fontWeight: personFilter === t.name ? 500 : 400, background: personFilter === t.name ? "var(--squawk-bg)" : "transparent", color: personFilter === t.name ? "var(--squawk-text)" : "var(--nav-text)", border: `1px solid ${personFilter === t.name ? "var(--accent-flight)" : "var(--border-primary)"}`, cursor: "pointer", minHeight: 44, whiteSpace: "nowrap" }}>
              <span style={{ width: 18, height: 18, borderRadius: "50%", border: `1px solid ${personFilter === t.name ? "var(--squawk-text)" : "var(--border-primary)"}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, fontSize: "8px", fontWeight: 600, flexShrink: 0 }}>{t.initial}</span>
              {t.name.toUpperCase()}
            </button>
          ))}
        </div>
      )}

      <div style={{ padding: "12px 16px" }}>
        {liveFol.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#e84233", animation: "live-pulse 2s ease-in-out infinite", flexShrink: 0 }} />
              <span style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "3px", color: "var(--text-secondary)", fontWeight: 700 }}>LIVE NOW</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {liveFol.map(trip => renderCard(trip))}
            </div>
          </div>
        )}

        {tracked.length > 0 && (
          <div>
            <p style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "3px", color: "var(--text-tertiary)", marginBottom: 10 }}>TRACKED TRIPS</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {tracked.map(trip => renderCard(trip))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD PAGE
// ═══════════════════════════════════════════════════════════════════

function DashboardPage() {
  const { navigate } = useRouter();
  const { mode } = useTheme();
  const isDesktop = useIsDesktop();
  const [filter, setFilter] = useState("all");
  const [tab, setTab] = useState("my_trips");
  const [trips, setTrips] = useState([]);
  const [following, setFollowing] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hoveredTripId, setHoveredTripId] = useState(null);

  const [refreshing, setRefreshing] = useState(false);
  const [badgePulse, setBadgePulse] = useState(false);
  const fetchData = async () => {
    setLoading(true); setError(null);
    try { const [my, fol] = await Promise.all([api("/trips"), api("/trips/following")]); setTrips((my || []).map(mapTrip)); setFollowing((fol || []).map(mapTrip)); } catch (e) { setError(e.message); }
    setLoading(false);
  };
  const fetchDataWithPulse = async () => { await fetchData(); setBadgePulse(true); setTimeout(() => setBadgePulse(false), 400); };
  const refresh = async () => { setRefreshing(true); try { const [my, fol] = await Promise.all([api("/trips"), api("/trips/following")]); setTrips((my || []).map(mapTrip)); setFollowing((fol || []).map(mapTrip)); } catch {} setRefreshing(false); };
  useEffect(() => { fetchData(); }, []);
  // Scroll memory: restore position on mount
  useEffect(() => { const saved = sessionStorage.getItem("dashboard-scroll"); if (saved) { setTimeout(() => { window.scrollTo(0, parseInt(saved)); sessionStorage.removeItem("dashboard-scroll"); }, 100); } }, [loading]);
  // Save scroll pos before navigating away
  const navWithScroll = (page, params) => { sessionStorage.setItem("dashboard-scroll", String(window.scrollY)); navigate(page, params); };

  // Pull-to-refresh
  const pullRef = useRef({ startY: 0, pulling: false });
  useEffect(() => {
    const onStart = (e) => { if (window.scrollY <= 0) pullRef.current = { startY: e.touches[0].clientY, pulling: true }; };
    const onMove = (e) => { if (!pullRef.current.pulling) return; const dy = e.touches[0].clientY - pullRef.current.startY; if (dy > 80 && !refreshing) { pullRef.current.pulling = false; refresh(); } };
    const onEnd = () => { pullRef.current.pulling = false; };
    window.addEventListener("touchstart", onStart, { passive: true }); window.addEventListener("touchmove", onMove, { passive: true }); window.addEventListener("touchend", onEnd);
    return () => { window.removeEventListener("touchstart", onStart); window.removeEventListener("touchmove", onMove); window.removeEventListener("touchend", onEnd); };
  }, [refreshing]);

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
      {/* Pull-to-refresh spinner */}
      {refreshing && <div style={{ display: "flex", justifyContent: "center", padding: "12px 0" }}><Spinner /></div>}
      {/* Tab bar + filters */}
      <div style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <div className="flex items-center" style={{ padding: isDesktop ? "0 24px" : "14px 16px 0" }}>
          {/* Tabs */}
          {[{ key: "my_trips", label: "MY ITINERARIES" }, { key: "following", label: "FOLLOWING" }].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} className="relative" style={{ fontFamily: FONT, fontSize: "10px", letterSpacing: "3px", fontWeight: tab === t.key ? 500 : 400, color: tab === t.key ? "var(--accent-flight-bright)" : "var(--text-tertiary)", height: isDesktop ? 48 : 44, display: "flex", alignItems: "center", marginRight: 24, paddingBottom: isDesktop ? 0 : 12 }}>
              {t.label}{t.key === "following" && following.length > 0 && (
                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 18, height: 18, borderRadius: 9, padding: "0 5px", marginLeft: 6, border: "1px solid var(--accent-flight)", fontFamily: FONT, fontSize: "9px", fontWeight: 600, color: "var(--accent-flight-bright)", animation: badgePulse ? "badge-pulse 0.4s ease-in-out" : "none" }}>{following.length}</span>
              )}
              {tab === t.key && <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: "var(--accent-flight-bright)" }} />}
            </button>
          ))}

          {/* Desktop: inline divider + filters */}
          {isDesktop && tab === "my_trips" && (
            <>
              <div style={{ width: 1, height: 16, background: "var(--border-primary)", margin: "0 20px" }} />
              {filters.map(f => (
                <button key={f.key} onClick={() => setFilter(f.key)} style={{ padding: "8px 12px", fontFamily: FONT, fontSize: "9px", letterSpacing: "2px", color: filter === f.key ? "var(--accent-flight-bright)" : "var(--text-tertiary)", position: "relative", height: 48, display: "flex", alignItems: "center", background: "transparent", border: "none", cursor: "pointer" }}>
                  {f.label}
                  {filter === f.key && <div className="absolute bottom-0 left-2 right-2 h-px" style={{ background: "var(--accent-flight)" }} />}
                </button>
              ))}
            </>
          )}
        </div>

        {/* Mobile: filters on own row */}
        {!isDesktop && tab === "my_trips" && (
          <div className="flex" style={{ padding: "10px 16px", borderTop: "1px solid var(--border-subtle)" }}>
            {filters.map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)} className="flex-1 text-center relative" style={{ padding: "8px 0", fontFamily: FONT, fontSize: "9px", letterSpacing: "2px", color: filter === f.key ? "var(--accent-flight-bright)" : "var(--text-tertiary)", minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {f.label}
                {filter === f.key && <div className="absolute bottom-0 left-2 right-2 h-px" style={{ background: "var(--accent-flight)" }} />}
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === "following" ? (
        isDesktop ? (
          <div style={{ display: "flex", flex: 1, overflow: "hidden", height: "calc(100vh - 105px)" }}>
            <div style={{ width: 400, minWidth: 360, flexShrink: 0, borderRight: "1px solid var(--border-primary)", overflowY: "auto", padding: "16px 20px" }}>
              <FollowingTab following={following} setFollowing={setFollowing} fetchData={fetchDataWithPulse} navigate={navWithScroll} mode={mode} />
            </div>
            <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
              <DashboardMap trips={following} filter="all" heroTripId={null} hoveredTripId={null} />
            </div>
          </div>
        ) : (
          <FollowingTab following={following} setFollowing={setFollowing} fetchData={fetchDataWithPulse} navigate={navWithScroll} mode={mode} />
        )
      ) : (
        isDesktop ? (
          <div style={{ display: "flex", flex: 1, overflow: "hidden", height: "calc(100vh - 105px)" }}>
            <div style={{ width: 400, minWidth: 360, flexShrink: 0, borderRight: "1px solid var(--border-primary)", overflowY: "auto", padding: "16px 20px" }}>
              {/* Trip cards — desktop left panel */}
              <div>
            {trips.length === 0 ? (
              <button onClick={() => navWithScroll("create")} className="w-full text-left tappable-card" style={{ border: "1px dashed var(--border-primary)", borderRadius: 6, padding: "24px 14px", textAlign: "center" }}>
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
                      <div key={trip.id} onMouseEnter={() => setHoveredTripId(trip.id)} onMouseLeave={() => setHoveredTripId(null)}>
                      <button onClick={() => navWithScroll("detail", { tripId: trip.id })} className="w-full text-left tappable-card" style={{ opacity: 0.5, border: "1px solid var(--border-primary)", borderLeft: "3px solid var(--strip-flight)", borderRadius: 6, padding: 14, background: "var(--bg-card)", boxShadow: hoveredTripId === trip.id ? "0 0 0 2px var(--accent-flight)" : "none" }}>
                        <div className="flex items-center justify-between mb-1">
                          <h3 style={{ fontFamily: FONT, fontSize: "14px", fontWeight: 600, color: "var(--text-heading)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{trip.title}</h3>
                        </div>
                        <p style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-secondary)", letterSpacing: "0.5px", marginBottom: 6 }}>{formatDateRange(trip.start_date, trip.end_date)}</p>
                        <InlineRoute legs={trip.legs} codeSize="14px" />
                        <div className="mt-2"><DashLegIndicators legs={trip.legs} showTotal={false} /></div>
                      </button>
                      </div>
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
                      const liveLeg = trip.legs?.find(l => isLegLive(l));
                      const livePos = liveLeg ? getLivePos(liveLeg) : null;
                      return (
                        <div key={trip.id} onMouseEnter={() => setHoveredTripId(trip.id)} onMouseLeave={() => setHoveredTripId(null)}>
                        <button onClick={() => navWithScroll("detail", { tripId: trip.id })} className="w-full text-left mb-2 tappable-card" style={{ border: "1px solid var(--border-primary)", borderLeft: "3px solid var(--strip-flight)", borderRadius: 6, padding: 14, background: "var(--bg-card)", boxShadow: hoveredTripId === trip.id ? "0 0 0 2px var(--accent-flight)" : "none" }}>
                          <div className="flex items-center justify-between mb-2">
                            <h3 style={{ fontFamily: FONT, fontSize: "16px", fontWeight: 600, color: "var(--text-heading)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{trip.title}</h3>
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
                                {[liveLeg.carrier, liveLeg.vehicle_number, liveLeg.arrive_time ? `LANDS ${formatTime(liveLeg.metadata?.arrive_local || liveLeg.arrive_time)}` : null].filter(Boolean).join(" · ")}
                              </p>
                            </>
                          )}
                        </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Next Departure (hero card) */}
                {nextDep && (
                  <div className="mb-4" onMouseEnter={() => setHoveredTripId(nextDep.id)} onMouseLeave={() => setHoveredTripId(null)}>
                    <p style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "3px", color: "var(--text-secondary)", marginBottom: 10, fontWeight: 700 }}>NEXT DEPARTURE</p>
                    <button onClick={() => navWithScroll("detail", { tripId: nextDep.id })} className="w-full text-left tappable-card" style={{ border: "1px solid var(--border-primary)", borderLeft: "3px solid var(--strip-flight)", borderRadius: 6, padding: 14, background: "var(--bg-card)", boxShadow: hoveredTripId === nextDep.id ? "0 0 0 2px var(--accent-flight)" : "none" }}>
                      <div className="flex items-center justify-between mb-1">
                        <h3 style={{ fontFamily: FONT, fontSize: "16px", fontWeight: 600, color: "var(--text-heading)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, marginRight: 8 }}>{nextDep.title}</h3>
                        <span className="px-2.5 py-1 shrink-0" style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "1px", color: "var(--accent-countdown)", border: "1px solid var(--accent-hotel-dim)", borderRadius: 4, fontWeight: 500 }}>{getCountdown(nextDep).text}</span>
                      </div>
                      <p style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-secondary)", letterSpacing: "0.5px", marginBottom: 8 }}>{formatDateRange(nextDep.start_date, nextDep.end_date)}</p>
                      {nextDep.legs?.length > 0 ? (<><div style={{ marginBottom: 8 }}><InlineRoute legs={nextDep.legs} codeSize="16px" /></div>
                      <DashLegIndicators legs={nextDep.legs} showTotal={true} /></>) : <p style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "1px", color: "var(--text-tertiary)" }}>NO LEGS FILED</p>}
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
                          <div key={trip.id} onMouseEnter={() => setHoveredTripId(trip.id)} onMouseLeave={() => setHoveredTripId(null)}>
                          <button onClick={() => navWithScroll("detail", { tripId: trip.id })} className="w-full text-left tappable-card" style={{ opacity: mode === "day" ? 0.55 : 0.65, border: "1px solid var(--border-primary)", borderLeft: "3px solid var(--strip-flight)", borderRadius: 6, padding: 14, background: "var(--bg-card)", boxShadow: hoveredTripId === trip.id ? "0 0 0 2px var(--accent-flight)" : "none" }}>
                            <div className="flex items-center justify-between mb-1">
                              <h3 style={{ fontFamily: FONT, fontSize: "14px", fontWeight: 600, color: "var(--text-heading)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, marginRight: 8 }}>{trip.title}</h3>
                              {shortCd && <span style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-secondary)" }}>{shortCd}</span>}
                            </div>
                            <p style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-secondary)", letterSpacing: "0.5px", marginBottom: 6 }}>{formatDateRange(trip.start_date, trip.end_date)}</p>
                            {trip.legs?.length > 0 ? (<><InlineRoute legs={trip.legs} codeSize="14px" /><div className="mt-2"><DashLegIndicators legs={trip.legs} showTotal={false} /></div></>) : <p style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "1px", color: "var(--text-tertiary)" }}>NO LEGS FILED</p>}
                          </button>
                          </div>
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
                        <div key={trip.id} onMouseEnter={() => setHoveredTripId(trip.id)} onMouseLeave={() => setHoveredTripId(null)}>
                        <button onClick={() => navWithScroll("detail", { tripId: trip.id })} className="w-full text-left" style={{ opacity: 0.5, border: "1px solid var(--border-primary)", borderLeft: "3px solid var(--strip-flight)", borderRadius: 6, padding: 14, background: "var(--bg-card)", boxShadow: hoveredTripId === trip.id ? "0 0 0 2px var(--accent-flight)" : "none" }}>
                          <div className="flex items-center justify-between mb-1">
                            <h3 style={{ fontFamily: FONT, fontSize: "14px", fontWeight: 600, color: "var(--text-heading)" }}>{trip.title}</h3>
                          </div>
                          <p style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-secondary)", letterSpacing: "0.5px", marginBottom: 6 }}>{formatDateRange(trip.start_date, trip.end_date)}</p>
                          <InlineRoute legs={trip.legs} codeSize="14px" />
                          <div className="mt-2"><DashLegIndicators legs={trip.legs} showTotal={false} /></div>
                        </button>
                        </div>
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
            </div>
            <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
              <DashboardMap trips={mapTripsArr} filter={filter} heroTripId={heroTrip?.id} hoveredTripId={hoveredTripId} />
              {hoveredTripId && (() => {
                const ht = trips.find(t => t.id === hoveredTripId);
                if (!ht) return null;
                return (
                  <div style={{ position: "absolute", bottom: 20, right: 20, background: "var(--bg-primary)", border: "1px solid var(--border-primary)", borderRadius: 8, padding: "12px 16px", maxWidth: 240, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}>
                    <p style={{ fontFamily: FONT, fontSize: "11px", fontWeight: 600, color: "var(--text-heading)", marginBottom: 4 }}>{ht.title}</p>
                    <p style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-secondary)", marginBottom: 2 }}>{formatDateRange(ht.start_date, ht.end_date)}</p>
                    <p style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-tertiary)" }}>{ht.legs?.length || 0} legs</p>
                  </div>
                );
              })()}
            </div>
          </div>
        ) : (
          <>
            {/* Mobile: Global radar map */}
            <DashboardMap trips={mapTripsArr} filter={filter} heroTripId={heroTrip?.id} />

            {/* Mobile: Trip cards */}
            <div className="px-4 py-4">
            {trips.length === 0 ? (
              <button onClick={() => navWithScroll("create")} className="w-full text-left tappable-card" style={{ border: "1px dashed var(--border-primary)", borderRadius: 6, padding: "24px 14px", textAlign: "center" }}>
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
                      <button key={trip.id} onClick={() => navWithScroll("detail", { tripId: trip.id })} className="w-full text-left tappable-card" style={{ opacity: 0.5, border: "1px solid var(--border-primary)", borderLeft: "3px solid var(--strip-flight)", borderRadius: 6, padding: 14, background: "var(--bg-card)" }}>
                        <div className="flex items-center justify-between mb-1">
                          <h3 style={{ fontFamily: FONT, fontSize: "14px", fontWeight: 600, color: "var(--text-heading)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{trip.title}</h3>
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
                {live.length > 0 && (
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-2.5">
                      <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "var(--accent-flight)" }} /><span className="relative inline-flex rounded-full h-2 w-2" style={{ background: "var(--accent-flight)" }} /></span>
                      <p style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "3px", color: "var(--accent-flight-bright)", fontWeight: 700 }}>LIVE NOW</p>
                    </div>
                    {live.map(trip => {
                      const liveLeg = trip.legs?.find(l => isLegLive(l));
                      const livePos = liveLeg ? getLivePos(liveLeg) : null;
                      return (
                        <button key={trip.id} onClick={() => navWithScroll("detail", { tripId: trip.id })} className="w-full text-left mb-2 tappable-card" style={{ border: "1px solid var(--border-primary)", borderLeft: "3px solid var(--strip-flight)", borderRadius: 6, padding: 14, background: "var(--bg-card)" }}>
                          <div className="flex items-center justify-between mb-2">
                            <h3 style={{ fontFamily: FONT, fontSize: "16px", fontWeight: 600, color: "var(--text-heading)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{trip.title}</h3>
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
                                {[liveLeg.carrier, liveLeg.vehicle_number, liveLeg.arrive_time ? `LANDS ${formatTime(liveLeg.metadata?.arrive_local || liveLeg.arrive_time)}` : null].filter(Boolean).join(" · ")}
                              </p>
                            </>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
                {nextDep && (
                  <div className="mb-4">
                    <p style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "3px", color: "var(--text-secondary)", marginBottom: 10, fontWeight: 700 }}>NEXT DEPARTURE</p>
                    <button onClick={() => navWithScroll("detail", { tripId: nextDep.id })} className="w-full text-left tappable-card" style={{ border: "1px solid var(--border-primary)", borderLeft: "3px solid var(--strip-flight)", borderRadius: 6, padding: 14, background: "var(--bg-card)" }}>
                      <div className="flex items-center justify-between mb-1">
                        <h3 style={{ fontFamily: FONT, fontSize: "16px", fontWeight: 600, color: "var(--text-heading)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, marginRight: 8 }}>{nextDep.title}</h3>
                        <span className="px-2.5 py-1 shrink-0" style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "1px", color: "var(--accent-countdown)", border: "1px solid var(--accent-hotel-dim)", borderRadius: 4, fontWeight: 500 }}>{getCountdown(nextDep).text}</span>
                      </div>
                      <p style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-secondary)", letterSpacing: "0.5px", marginBottom: 8 }}>{formatDateRange(nextDep.start_date, nextDep.end_date)}</p>
                      {nextDep.legs?.length > 0 ? (<><div style={{ marginBottom: 8 }}><InlineRoute legs={nextDep.legs} codeSize="16px" /></div>
                      <DashLegIndicators legs={nextDep.legs} showTotal={true} /></>) : <p style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "1px", color: "var(--text-tertiary)" }}>NO LEGS FILED</p>}
                    </button>
                  </div>
                )}
                {otherUpcoming.length > 0 && (
                  <div className="mb-4">
                    <p style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "3px", color: "var(--text-tertiary)", marginBottom: 10 }}>UPCOMING</p>
                    <div className="flex flex-col gap-2">
                      {otherUpcoming.map(trip => {
                        const ms = trip.legs?.[0]?.depart_time ? new Date(trip.legs[0].depart_time).getTime() - Date.now() : 0;
                        const days = Math.max(0, Math.floor(ms / 86400000));
                        const shortCd = ms > 0 ? `T-${days}D` : null;
                        return (
                          <button key={trip.id} onClick={() => navWithScroll("detail", { tripId: trip.id })} className="w-full text-left tappable-card" style={{ opacity: mode === "day" ? 0.55 : 0.65, border: "1px solid var(--border-primary)", borderLeft: "3px solid var(--strip-flight)", borderRadius: 6, padding: 14, background: "var(--bg-card)" }}>
                            <div className="flex items-center justify-between mb-1">
                              <h3 style={{ fontFamily: FONT, fontSize: "14px", fontWeight: 600, color: "var(--text-heading)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, marginRight: 8 }}>{trip.title}</h3>
                              {shortCd && <span style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-secondary)" }}>{shortCd}</span>}
                            </div>
                            <p style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-secondary)", letterSpacing: "0.5px", marginBottom: 6 }}>{formatDateRange(trip.start_date, trip.end_date)}</p>
                            {trip.legs?.length > 0 ? (<><InlineRoute legs={trip.legs} codeSize="14px" /><div className="mt-2"><DashLegIndicators legs={trip.legs} showTotal={false} /></div></>) : <p style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "1px", color: "var(--text-tertiary)" }}>NO LEGS FILED</p>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {filter === "all" && past.length > 0 && (
                  <div>
                    <p style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "3px", color: "var(--text-tertiary)", marginBottom: 10 }}>PAST</p>
                    <div className="flex flex-col gap-2">
                      {past.map(trip => (
                        <button key={trip.id} onClick={() => navWithScroll("detail", { tripId: trip.id })} className="w-full text-left" style={{ opacity: 0.5, border: "1px solid var(--border-primary)", borderLeft: "3px solid var(--strip-flight)", borderRadius: 6, padding: 14, background: "var(--bg-card)" }}>
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
        )
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
  let totalNM = 0, airHrs = 0, hotelNights = 0;
  (legs || []).forEach(l => {
    if (l.type === "hotel") { hotelNights += calcNights(l); return; }
    if (l.origin?.lat != null && l.destination?.lat != null) {
      const nm = haversineNM(l.origin.lat, l.origin.lng, l.destination.lat, l.destination.lng);
      totalNM += nm;
      // Only estimate air time for flights (not trains/buses)
      if (l.type === "flight" && nm > 0) airHrs += nm / 460 + 0.5;
    }
  });
  const airH = Math.floor(airHrs), airM = Math.round((airHrs - airH) * 60);
  return { totalNM: Math.round(totalNM), airTime: airHrs > 0 ? `~${airH}H ${airM}M` : "0H", hotelNights };
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

const STRIP_COLORS = { flight: "var(--strip-flight)", hotel: "var(--strip-hotel)", train: "var(--strip-train)", bus: "var(--strip-bus)" };

// ═══════════════════════════════════════════════════════════════════
// ROUTE SUMMARY BAR
// ═══════════════════════════════════════════════════════════════════

function RouteSummaryBar({ legs }) {
  if (!legs?.length) return null;
  const segments = [];
  legs.forEach((leg, i) => {
    const isHotel = leg.type === "hotel";
    if (isHotel) {
      segments.push({ type: "hotel", label: `${calcNights(leg)}N`, city: leg.origin?.city });
    } else {
      const dur = formatDuration(leg.depart_time, leg.arrive_time, leg.origin, leg.destination, leg.type);
      const oLabel = leg.type === "train" ? (leg.origin?.city || leg.origin?.code || "?") : (leg.origin?.code || leg.origin?.city?.slice(0, 3)?.toUpperCase() || "?");
      const dLabel = leg.type === "train" ? (leg.destination?.city || leg.destination?.code || "?") : (leg.destination?.code || leg.destination?.city?.slice(0, 3)?.toUpperCase() || "?");
      segments.push({ type: "transport", origin: oLabel, destination: dLabel, duration: dur, legType: leg.type });
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

function TripMap({ trip, activeLegIndex, mode, isSharedView, liveTrackData, mapTick }) {
  const svgRef = useRef(null), containerRef = useRef(null), zoomRef = useRef(null);
  const draw = useCallback(() => {
    const el = containerRef.current, svg = d3.select(svgRef.current); if (!el) return;
    const w = el.clientWidth, h = el.clientHeight; svg.attr("width", w).attr("height", h).selectAll("*").remove();
    const isDay = mode === "day";
    const defs = svg.append("defs");
    const glow = defs.append("filter").attr("id", "glow").attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%");
    glow.append("feGaussianBlur").attr("stdDeviation", "4").attr("result", "b");
    const gm = glow.append("feMerge"); gm.append("feMergeNode").attr("in", "b"); gm.append("feMergeNode").attr("in", "SourceGraphic");

    const gridSize = 34;
    defs.append("pattern").attr("id", "radar-grid").attr("width", gridSize).attr("height", gridSize).attr("patternUnits", "userSpaceOnUse")
      .append("path").attr("d", `M ${gridSize} 0 L 0 0 0 ${gridSize}`).attr("fill", "none").attr("stroke", "var(--map-grid)").attr("stroke-width", 0.5);

    // Fixed background + grid (doesn't pan/zoom)
    svg.append("rect").attr("width", w).attr("height", h).attr("fill", "var(--bg-map)");
    svg.append("rect").attr("width", w * 3).attr("height", h * 3).attr("x", -w).attr("y", -h).attr("fill", "url(#radar-grid)");

    const allC = []; trip.legs?.forEach(l => { if (l.origin?.lat != null) allC.push([l.origin.lng, l.origin.lat]); if (l.destination?.lat != null) allC.push([l.destination.lng, l.destination.lat]); });
    if (allC.length === 0) {
      svg.append("text").attr("x", w / 2).attr("y", h / 2).attr("text-anchor", "middle").attr("fill", "var(--text-tertiary)").attr("font-size", "10px").attr("font-family", FONT).text("No route data");
      return;
    }

    const pad = 40, proj = d3.geoMercator().fitExtent([[pad, pad], [w - pad, h - pad]], { type: "MultiPoint", coordinates: allC }), path = d3.geoPath(proj);

    // Zoomable content group
    const g = svg.append("g").attr("class", "map-content");

    // Land
    const land = topojson.feature(worldData, worldData.objects.land);
    const borders = topojson.mesh(worldData, worldData.objects.countries, (a, b) => a !== b);
    if (isDay) {
      g.append("path").datum(land).attr("d", path).attr("fill", "var(--map-land)").attr("stroke", "var(--map-land-stroke)").attr("stroke-width", 0.8);
      g.append("path").datum(borders).attr("d", path).attr("fill", "none").attr("stroke", "var(--map-land-stroke)").attr("stroke-width", 0.5);
    } else {
      g.append("path").datum(borders).attr("d", path).attr("fill", "none").attr("stroke", "var(--map-grid)").attr("stroke-width", 0.5);
    }

    // Hotel dwell glow
    trip.legs?.forEach(leg => {
      if (leg.type === "hotel" && leg.origin?.lat != null) {
        const [hx, hy] = proj([leg.origin.lng, leg.origin.lat]);
        const glowR = isSharedView ? 35 : 22, innerR = isSharedView ? 26 : 16;
        g.append("circle").attr("cx", hx).attr("cy", hy).attr("r", glowR).attr("fill", "var(--map-dwell-glow)");
        g.append("circle").attr("cx", hx).attr("cy", hy).attr("r", innerR).attr("fill", "var(--accent-hotel)").attr("opacity", 0.08);
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
        g.append("path").datum(coords).attr("d", lineGen).attr("fill", "none").attr("stroke", "var(--map-arc)").attr("stroke-width", 2.5).attr("stroke-linecap", "round");
        isFirstTransport = false;
      } else {
        g.append("path").datum(coords).attr("d", lineGen).attr("fill", "none").attr("stroke", "var(--map-arc)").attr("stroke-width", 1.5).attr("stroke-dasharray", "6,4").attr("opacity", 0.3);
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
      g.append("circle").attr("cx", x).attr("cy", y).attr("r", 12).attr("fill", "none").attr("stroke", "var(--map-arc)").attr("stroke-width", 0.3).attr("opacity", 0.2);
      g.append("circle").attr("cx", x).attr("cy", y).attr("r", 7).attr("fill", "none").attr("stroke", "var(--map-arc)").attr("stroke-width", 0.5).attr("opacity", 0.4);
      g.append("circle").attr("cx", x).attr("cy", y).attr("r", 3.5).attr("fill", "var(--map-dot)");
      g.append("text").attr("x", x).attr("y", y - 14).attr("text-anchor", "middle").attr("fill", "var(--map-label)").attr("font-size", "11px").attr("font-family", FONT).attr("font-weight", 600).attr("letter-spacing", "1px").text(city.code || city.city);
    });

    // Live position dot
    const aLeg = trip.legs?.[activeLegIndex];
    if (aLeg) {
      const lp = getLivePos(aLeg, liveTrackData);
      if (lp) {
        const [px, py] = proj([lp.lng, lp.lat]);
        const ping = g.append("circle").attr("cx", px).attr("cy", py).attr("r", 5).attr("fill", "none").attr("stroke", "var(--map-arc)").attr("stroke-width", 1.5).attr("opacity", 0);
        (function anim() { ping.attr("r", 5).attr("opacity", 0.6).transition().duration(1800).ease(d3.easeQuadOut).attr("r", 22).attr("opacity", 0).on("end", anim); })();
        g.append("circle").attr("cx", px).attr("cy", py).attr("r", 5).attr("fill", "var(--map-arc)").attr("filter", "url(#glow)");
        g.append("circle").attr("cx", px).attr("cy", py).attr("r", 2).attr("fill", "var(--bg-primary)");
      }
    }

    // Distance label (fixed, not zoomable)
    const stats = computeTripStats(trip.legs);
    if (stats.totalNM > 0) {
      svg.append("text").attr("x", w / 2).attr("y", 20).attr("text-anchor", "middle").attr("fill", "var(--map-distance)").attr("font-size", "8px").attr("font-family", FONT).attr("letter-spacing", "1px").text(`${stats.totalNM.toLocaleString()} NM`);
    }

    // Zoom behavior
    const zoom = d3.zoom().scaleExtent([0.5, 8]).on("zoom", (event) => {
      g.attr("transform", event.transform);
    });
    svg.call(zoom);
    svg.on("dblclick.zoom", null); // disable double-click zoom
    zoomRef.current = zoom;

  }, [trip, activeLegIndex, mode, liveTrackData, mapTick]);

  useEffect(() => { draw(); const h = () => draw(); window.addEventListener("resize", h); return () => window.removeEventListener("resize", h); }, [draw]);

  const resetZoom = useCallback(() => {
    const svg = d3.select(svgRef.current);
    if (zoomRef.current) svg.transition().duration(500).call(zoomRef.current.transform, d3.zoomIdentity);
  }, []);

  // Coordinate overlay
  const firstLeg = trip.legs?.[0], lastLeg = trip.legs?.[trip.legs.length - 1];
  const originCoord = firstLeg?.origin?.lat != null ? formatCoord(firstLeg.origin.lat, firstLeg.origin.lng) : null;
  const destCoord = lastLeg?.destination?.lat != null ? formatCoord(lastLeg.destination.lat, lastLeg.destination.lng) : null;

  return (
    <div ref={containerRef} className="w-full h-full relative" style={{ background: "var(--bg-map)", touchAction: "none" }}>
      <svg ref={svgRef} className="w-full h-full" style={{ cursor: "grab" }} />
      <button onClick={resetZoom} style={{ position: "absolute", bottom: 8, left: 8, background: "var(--bg-surface)", border: "1px solid var(--border-primary)", borderRadius: 4, padding: "4px 8px", fontFamily: FONT, fontSize: "7px", letterSpacing: "1px", color: "var(--text-secondary)", cursor: "pointer" }}>RESET</button>
      {(originCoord || destCoord) && (
        <div className="absolute top-2 right-2" style={{ fontFamily: FONT, fontSize: "8px", color: "var(--map-distance)", letterSpacing: "0.5px", lineHeight: 1.6, textAlign: "right", pointerEvents: "none" }}>
          {originCoord && <div>{originCoord}</div>}
          {destCoord && destCoord !== originCoord && <div>{destCoord}</div>}
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
// PLACE AUTOCOMPLETE
// ═══════════════════════════════════════════════════════════════════

function PlaceAutocomplete({ value, onChange, onSelect, placeholder, types }) {
  const { mode } = useTheme();
  const [suggestions, setSuggestions] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (containerRef.current && !containerRef.current.contains(e.target)) setShowDropdown(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const doSearch = async (query) => {
    if (!query || query.length < 2) { setSuggestions([]); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ query });
      if (types) params.set("types", types);
      const data = await api(`/places/autocomplete?${params}`);
      setSuggestions(data.predictions || []);
      setShowDropdown(true);
    } catch { setSuggestions([]); }
    setLoading(false);
  };

  const handleChange = (e) => {
    const v = e.target.value;
    onChange(v);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(v), 300);
  };

  const handleSelect = async (pred) => {
    setShowDropdown(false);
    onChange(pred.mainText || pred.description);
    try {
      const details = await api(`/places/details?placeId=${pred.placeId}`);
      onSelect(details);
    } catch { /* use text only */ }
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={value}
        onChange={handleChange}
        onFocus={() => { if (suggestions.length > 0) setShowDropdown(true); }}
        placeholder={placeholder}
        className="w-full px-3 py-2.5 rounded border outline-none text-sm transition-colors"
        style={{ background: "var(--bg-surface)", borderColor: "var(--border-primary)", color: "var(--text-primary)", fontFamily: FONT, colorScheme: mode === "night" ? "dark" : "light" }}
      />
      {loading && <span className="absolute right-2 top-2.5"><Spinner /></span>}
      {showDropdown && suggestions.length > 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 rounded border overflow-hidden shadow-lg" style={{ background: "var(--bg-surface)", borderColor: "var(--border-primary)", maxHeight: 220, overflowY: "auto" }}>
          {suggestions.map((s, i) => (
            <button key={i} onClick={() => handleSelect(s)} className="w-full text-left px-3 py-2.5 flex flex-col hover:opacity-80" style={{ borderBottom: i < suggestions.length - 1 ? "1px solid var(--border-primary)" : "none", background: "transparent" }}>
              <span style={{ fontFamily: FONT, fontSize: "12px", color: "var(--text-primary)", fontWeight: 600 }}>{s.mainText}</span>
              <span style={{ fontFamily: FONT, fontSize: "10px", color: "var(--text-tertiary)" }}>{s.secondaryText}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MINI MAP (interactive Google Map embed for location previews)
// ═══════════════════════════════════════════════════════════════════

function MiniMap({ lat, lng, zoom = 15, height = 140, label }) {
  if (!lat || !lng) return null;
  const src = `https://maps.google.com/maps?q=${lat},${lng}&z=${zoom}&output=embed`;
  return (
    <div style={{ borderRadius: 6, overflow: "hidden", border: "1px solid var(--border-primary)", height, position: "relative", background: "var(--bg-surface)" }}>
      <iframe src={src} style={{ width: "100%", height: "100%", border: "none" }} loading="lazy" referrerPolicy="no-referrer-when-downgrade" title="Location map" />
      {label && (
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "6px 8px", background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)", pointerEvents: "none" }}>
          <p style={{ fontFamily: FONT, fontSize: "8px", color: "#fff", letterSpacing: "1px" }}>{label}</p>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SATELLITE MAP (interactive Google Maps trip route)
// ═══════════════════════════════════════════════════════════════════

function SatelliteMap({ trip, height = 280 }) {
  const embedUrl = useMemo(() => {
    if (!trip?.legs?.length) return null;
    // Collect unique waypoint coordinates
    const points = [];
    trip.legs.forEach(leg => {
      if (leg.origin?.lat != null && leg.origin?.lat !== 0) {
        const key = `${leg.origin.lat.toFixed(4)},${leg.origin.lng.toFixed(4)}`;
        if (!points.find(p => p.key === key)) points.push({ key, name: leg.origin.code || leg.origin.city || `${leg.origin.lat},${leg.origin.lng}` });
      }
      if (leg.destination?.lat != null && leg.destination?.lat !== 0) {
        const key = `${leg.destination.lat.toFixed(4)},${leg.destination.lng.toFixed(4)}`;
        if (!points.find(p => p.key === key)) points.push({ key, name: leg.destination.code || leg.destination.city || `${leg.destination.lat},${leg.destination.lng}` });
      }
    });
    if (points.length === 0) return null;
    if (points.length === 1) return `https://maps.google.com/maps?q=${points[0].key}&t=k&z=10&output=embed`;
    // Center on midpoint, show satellite imagery with markers
    const lats = points.map(p => parseFloat(p.key.split(",")[0]));
    const lngs = points.map(p => parseFloat(p.key.split(",")[1]));
    const cLat = ((Math.min(...lats) + Math.max(...lats)) / 2).toFixed(4);
    const cLng = ((Math.min(...lngs) + Math.max(...lngs)) / 2).toFixed(4);
    const markers = points.map(p => `markers=${encodeURIComponent(p.key)}`).join("&");
    return `https://maps.google.com/maps?q=${cLat},${cLng}&t=k&z=4&output=embed`;
  }, [trip?.id, trip?.legs?.length]);

  if (!embedUrl) return (
    <div style={{ width: "100%", height, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-surface)" }}>
      <p style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-tertiary)" }}>No coordinates available</p>
    </div>
  );

  return (
    <div style={{ width: "100%", height, position: "relative", background: "var(--bg-surface)", overflow: "hidden" }}>
      <iframe src={embedUrl} style={{ width: "100%", height: "100%", border: "none" }} loading="lazy" referrerPolicy="no-referrer-when-downgrade" title="Trip route map" />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// DETAIL PAGE (with edit mode)
// ═══════════════════════════════════════════════════════════════════

function DetailPage({ tripId }) {
  const { navigate } = useRouter();
  const { mode } = useTheme();
  const isDesktop = useIsDesktop();
  const [trip, setTrip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeLeg, setActiveLeg] = useState(0);
  const [showShare, setShowShare] = useState(false);
  const [mapView, setMapView] = useState("radar"); // "radar" | "satellite"
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [showLegBuilder, setShowLegBuilder] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showDeleteTrip, setShowDeleteTrip] = useState(false);
  const [deletingTrip, setDeletingTrip] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [bType, setBType] = useState("flight");
  const [bFN, setBFN] = useState(""); const [bLoading, setBLoading] = useState(false); const [bAF, setBAF] = useState(null); const [bErr, setBErr] = useState(null); const [bFlightOptions, setBFlightOptions] = useState(null);
  const [bHN, setBHN] = useState(""); const [bHC, setBHC] = useState(""); const [bHI, setBHI] = useState(""); const [bHO, setBHO] = useState("");
  const [bHPlace, setBHPlace] = useState(null); // { lat, lng, city, address }
  const [bO, setBO] = useState(""); const [bD, setBD] = useState(""); const [bDt, setBDt] = useState(""); const [bTm, setBTm] = useState("");
  const [bOPlace, setBOPlace] = useState(null); const [bDPlace, setBDPlace] = useState(null);
  // Train lookup (detail page)
  const [bTrainOp, setBTrainOp] = useState("amtrak"); const [bTrainNum, setBTrainNum] = useState("");
  const [bTrainLoading, setBTrainLoading] = useState(false); const [bTrainResult, setBTrainResult] = useState(null);
  const [bTrainErr, setBTrainErr] = useState(null); const [bTrainOptions, setBTrainOptions] = useState(null);
  const [bTrainManual, setBTrainManual] = useState(false);
  const resetBuilder = () => {
    const sd = trip?.start_date || "", ed = trip?.end_date || "";
    let defDate = sd;
    if (trip?.legs?.length) {
      const last = trip.legs[trip.legs.length - 1];
      const endIso = last.type === "hotel" ? (last.arrive_time || last.depart_time) : (last.arrive_time || last.depart_time);
      if (endIso) { const d = new Date(endIso.split("T")[0]); d.setDate(d.getDate() + 1); defDate = d.toISOString().split("T")[0]; }
    }
    setBFN(""); setBLoading(false); setBAF(null); setBErr(null); setBFlightOptions(null); setBHN(""); setBHC(""); setBHI(defDate || sd); setBHO(ed); setBHPlace(null); setBO(""); setBD(""); setBDt(defDate || sd); setBTm(""); setBOPlace(null); setBDPlace(null);
    setBTrainOp("amtrak"); setBTrainNum(""); setBTrainLoading(false); setBTrainResult(null); setBTrainErr(null); setBTrainOptions(null); setBTrainManual(false);
  };
  const typeCfg = { flight: { label: "FLIGHT", color: "var(--strip-flight)" }, hotel: { label: "GROUND STOP", color: "var(--strip-hotel)" }, train: { label: "TRAIN", color: "var(--strip-train)" }, bus: { label: "BUS", color: "var(--strip-bus)" } };

  // Live ADS-B tracking for the active leg
  const activeFlightLeg = trip?.legs?.[activeLeg];
  const liveTrackData = useLiveTracking(activeFlightLeg);

  // Periodic tick to refresh estimated position when a leg is live
  const [mapTick, setMapTick] = useState(0);
  useEffect(() => {
    const isLive = activeFlightLeg && isLegLive(activeFlightLeg, liveTrackData);
    if (!isLive) return;
    const interval = setInterval(() => setMapTick(t => t + 1), 30000);
    return () => clearInterval(interval);
  }, [activeFlightLeg?.id, activeFlightLeg?.status]);

  const fetchTrip = async () => { setLoading(true); try { const t = await api(`/trips/${tripId}`); setTrip(mapTrip(t)); } catch (e) { setTrip(null); } setLoading(false); };
  useEffect(() => { fetchTrip(); }, [tripId]);
  useEffect(() => { if (trip) { const li = trip.legs?.findIndex(l => isLegLive(l)); setActiveLeg(li >= 0 ? li : 0); } }, [trip?.id]);

  const enterEdit = () => { if (!trip) return; setEditing(true); setEditTitle(trip.title); setEditStart(trip.start_date); setEditEnd(trip.end_date); };
  const saveEdit = async () => { setSaving(true); try { await api(`/trips/${trip.id}`, { method: "PUT", body: JSON.stringify({ title: editTitle, start_date: editStart, end_date: editEnd }) }); setTrip(prev => ({ ...prev, title: editTitle, start_date: editStart, end_date: editEnd })); setEditing(false); } catch (e) { alert(e.message); } setSaving(false); };
  const cancelEdit = () => { setEditing(false); setShowLegBuilder(false); setConfirmDelete(null); setShowDeleteTrip(false); setDeleteError(null); resetBuilder(); };
  const deleteTrip = async () => { setDeletingTrip(true); setDeleteError(null); try { await api(`/trips/${trip.id}`, { method: "DELETE" }); navigate("dashboard"); } catch { setDeleteError("Failed to delete \u2014 try again"); } setDeletingTrip(false); };
  const removeLeg = async (legId) => { try { await api(`/trips/${trip.id}/legs/${legId}`, { method: "DELETE" }); setTrip(prev => ({ ...prev, legs: prev.legs.filter(l => l.id !== legId) })); setConfirmDelete(null); } catch (e) { alert(e.message); } };
  const moveLeg = async (index, dir) => { const newIdx = index + dir; if (newIdx < 0 || newIdx >= trip.legs.length) return; const legs = [...trip.legs]; [legs[index], legs[newIdx]] = [legs[newIdx], legs[index]]; setTrip(prev => ({ ...prev, legs })); setActiveLeg(newIdx); try { await api(`/trips/${trip.id}/legs/reorder`, { method: "PUT", body: JSON.stringify({ leg_ids: legs.map(l => l.id) }) }); } catch (e) { fetchTrip(); } };
  const [queryDisabled, setQueryDisabled] = useState(false);
  const selectFlightDetail = (af) => { setBAF(af); setBFlightOptions(null); };
  const handleQuery = async () => { if (!bFN.trim() || queryDisabled) return; setBLoading(true); setBErr(null); setBAF(null); setBFlightOptions(null); try { const r = await api(`/flights/lookup?callsign=${bFN.trim().toUpperCase()}${bDt ? `&date=${bDt}` : ""}`); const results = mapFlightResults(r); if (results.length === 1) { setBAF(results[0]); } else if (results.length > 1) { setBFlightOptions(results); } else { setBErr("NO MATCH \u2014 verify callsign"); } } catch (e) { if (e?.message?.includes("429") || e?.message?.toLowerCase().includes("rate")) { setBErr("STAND BY \u2014 too many lookups. Try again in a moment."); setQueryDisabled(true); setTimeout(() => setQueryDisabled(false), 10000); } else { setBErr("NO MATCH \u2014 verify callsign"); } } setBLoading(false); };
  const DETAIL_TRAIN_OPS = [
    { id: "amtrak", name: "Amtrak", country: "US", placeholder: "91" },
    { id: "sncf", name: "SNCF", country: "FR", placeholder: "6213" },
    { id: "db", name: "Deutsche Bahn", country: "DE", placeholder: "ICE 123" },
  ];
  const selectTrainDetail = (train) => { setBTrainResult(train); setBTrainOptions(null); };
  const handleTrainQueryDetail = async () => {
    if (!bTrainNum.trim() || bTrainLoading) return;
    setBTrainLoading(true); setBTrainErr(null); setBTrainResult(null); setBTrainOptions(null);
    try {
      const r = await api(`/trains/lookup?operator=${bTrainOp}&number=${encodeURIComponent(bTrainNum.trim())}${bDt ? `&date=${bDt}` : ""}`);
      const results = r.trains || [];
      if (results.length === 1) { setBTrainResult(results[0]); }
      else if (results.length > 1) { setBTrainOptions(results); }
      else { setBTrainErr("No matching train found"); }
    } catch (e) {
      const msg = e?.message || "";
      if (msg.includes("429")) { setBTrainErr("STAND BY — too many lookups"); }
      else { setBTrainErr("Train not found — verify number"); }
    }
    setBTrainLoading(false);
  };
  const canConfirm = () => {
    if (bType === "flight") return !!bAF;
    if (bType === "hotel") return bHN.trim() && bHI;
    if (bType === "train" && !bTrainManual) return !!bTrainResult;
    return bO.trim() && bD.trim() && bDt;
  };

  const addLeg = async () => {
    let newLeg;
    if (bType === "flight" && bAF) { newLeg = { type: "flight", origin: { code: bAF.origin.code, city: bAF.origin.airport, lat: 0, lng: 0 }, destination: { code: bAF.destination.code, city: bAF.destination.airport, lat: 0, lng: 0 }, depart_time: bAF.origin.scheduled, arrive_time: bAF.destination.scheduled, carrier: bAF.carrier, vehicle_number: bAF.callsign, metadata: { terminal: bAF.origin.terminal || null, gate: bAF.origin.gate || null, depart_local: bAF.origin.scheduled_local || null, arrive_local: bAF.destination.scheduled_local || null } }; }
    else if (bType === "hotel") { const nights = bHO ? Math.max(1, Math.round((new Date(bHO) - new Date(bHI)) / 86400000)) : 1; const hLat = bHPlace?.lat || 0; const hLng = bHPlace?.lng || 0; const hCity = bHPlace?.city || bHN; newLeg = { type: "hotel", origin: { code: null, city: hCity, lat: hLat, lng: hLng }, destination: { code: null, city: hCity, lat: hLat, lng: hLng }, depart_time: `${bHI}T15:00:00Z`, arrive_time: bHO ? `${bHO}T11:00:00Z` : `${bHI}T11:00:00Z`, carrier: bHN, vehicle_number: null, metadata: { nights, confirmation: bHC, address: bHPlace?.address || null } }; }
    else if (bType === "train" && bTrainResult) { const tr = bTrainResult; const userStops = (tr.stops || []).length > 2 ? tr.stops.slice(1, -1) : []; newLeg = { type: "train", origin: { code: tr.origin.code || tr.origin.name, city: tr.origin.name, lat: tr.origin.lat || 0, lng: tr.origin.lng || 0 }, destination: { code: tr.destination.code || tr.destination.name, city: tr.destination.name, lat: tr.destination.lat || 0, lng: tr.destination.lng || 0 }, depart_time: tr.origin.scheduled_departure, arrive_time: tr.destination.scheduled_arrival, carrier: tr.operator_name || bTrainOp, vehicle_number: tr.train_number, metadata: { operator: tr.operator, route_name: tr.route_name, platform: tr.origin.platform, stops: userStops, depart_local: tr.origin.scheduled_departure, arrive_local: tr.destination.scheduled_arrival } }; }
    else { const oLat = bOPlace?.lat || 0; const oLng = bOPlace?.lng || 0; const dLat = bDPlace?.lat || 0; const dLng = bDPlace?.lng || 0; const oCity = bOPlace?.city || bO; const dCity = bDPlace?.city || bD; newLeg = { type: bType, origin: { code: bO.slice(0, 3).toUpperCase(), city: oCity, lat: oLat, lng: oLng }, destination: { code: bD.slice(0, 3).toUpperCase(), city: dCity, lat: dLat, lng: dLng }, depart_time: `${bDt}T${bTm || "08:00"}:00Z`, arrive_time: `${bDt}T12:00:00Z`, carrier: bType === "train" ? "Train" : "Bus", vehicle_number: null, metadata: bType === "train" ? { operator: bTrainOp } : {} }; }
    try {
      const created = await api(`/trips/${trip.id}/legs`, { method: "POST", body: JSON.stringify(legToApi(newLeg)) });
      const mapped = created.origin ? created : mapLeg(created);
      const newLegs = [...trip.legs, mapped].sort((a, b) => new Date(a.depart_time) - new Date(b.depart_time));
      setTrip(prev => ({ ...prev, legs: newLegs }));
      resetBuilder(); setShowLegBuilder(false); setActiveLeg(newLegs.length - 1);
      // Persist sort order
      try { await api(`/trips/${trip.id}/legs/reorder`, { method: "PUT", body: JSON.stringify({ leg_ids: newLegs.map(l => l.id) }) }); } catch {}
    } catch (e) { alert(e.message); }
  };

  if (loading) return <LoadingScreen />;
  if (!trip) return <div className="text-center py-12"><p className="text-xs" style={{ color: "var(--text-secondary)", fontFamily: FONT }}>Trip not found</p><button onClick={() => navigate("dashboard")} className="mt-3 text-xs font-bold tracking-widest" style={{ color: "var(--accent-flight)", fontFamily: FONT }}>DASHBOARD</button></div>;

  const status = getTripStatus(trip);
  const countdown = getCountdown(trip);
  const segmentCount = (trip.legs || []).filter(l => l.type !== "hotel").length;

  const itineraryContent = (
    <>
      <p style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "3px", color: "var(--text-secondary)", marginBottom: 12, fontWeight: 700 }}>FLIGHT PLAN {"\u00B7"} {trip.legs?.length || 0} WAYPOINTS</p>
      <div className="flex flex-col">
        {trip.legs?.map((leg, i) => {
          const isHotel = leg.type === "hotel";
          const isLive = isLegLive(leg);
          const stripColor = STRIP_COLORS[leg.type] || "var(--strip-flight)";
          const isDeleting = confirmDelete === leg.id;
          const cardBg = isHotel ? "var(--bg-card-hotel)" : "var(--bg-card)";
          const dur = isHotel ? "" : formatDuration(leg.depart_time, leg.arrive_time, leg.origin, leg.destination);
          const nights = isHotel ? calcNights(leg) : 0;
          return (
            <div key={leg.id} className="flex">
              <div className="flex flex-col items-center" style={{ width: 28 }}>
                <div className="flex items-center justify-center" style={{ width: isHotel ? 8 : 10, height: isHotel ? 8 : 10, borderRadius: "50%", border: `2px solid ${isHotel ? "var(--strip-hotel)" : "var(--timeline-dot-border)"}`, background: "var(--timeline-dot-bg)", flexShrink: 0 }} />
                {i < trip.legs.length - 1 && <div style={{ width: 1.5, flex: 1, background: "var(--timeline-rail)", minHeight: 20 }} />}
              </div>
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
                    {leg.type === "train" ? (
                      <>
                        <div className="flex items-center justify-between mb-1">
                          <span style={{ fontFamily: FONT, fontSize: "16px", fontWeight: 700, color: "var(--text-heading)", letterSpacing: "1px", maxWidth: "40%", lineHeight: 1.2 }}>{leg.origin?.city || leg.origin?.code || "?"}</span>
                          <div className="flex flex-col items-center flex-1 mx-3">
                            <span style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-tertiary)" }}>{dur}</span>
                            <div style={{ width: "100%", height: 0, borderTop: "1px solid var(--border-subtle)", marginTop: 4 }} />
                          </div>
                          <span style={{ fontFamily: FONT, fontSize: "16px", fontWeight: 700, color: "var(--text-heading)", letterSpacing: "1px", maxWidth: "40%", lineHeight: 1.2, textAlign: "right" }}>{leg.destination?.city || leg.destination?.code || "?"}</span>
                        </div>
                        <div className="flex items-center justify-between mb-2">
                          <span style={{ fontFamily: FONT, fontSize: "10px", color: "var(--text-secondary)" }}>{legDepartTime(leg)}</span>
                          <span style={{ fontFamily: FONT, fontSize: "10px", color: "var(--text-secondary)" }}>{legArriveTime(leg)}</span>
                        </div>
                        {leg.metadata?.stops?.length > 0 && (
                          <div className="mb-2 pt-2" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                            <div className="flex items-center" style={{ position: "relative", height: 20 }}>
                              <div style={{ position: "absolute", top: 4, left: 0, right: 0, height: 2, background: "var(--border-subtle)", borderRadius: 1 }} />
                              <div style={{ position: "relative", width: 8, height: 8, borderRadius: "50%", background: "var(--strip-train)", border: "2px solid var(--strip-train)", flexShrink: 0, zIndex: 1 }} />
                              <div style={{ flex: 1, display: "flex", justifyContent: "space-evenly" }}>
                                {leg.metadata.stops.map((s, si) => (
                                  <div key={si} style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", zIndex: 1 }}>
                                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--bg-card)", border: "2px solid var(--strip-train)" }} />
                                  </div>
                                ))}
                              </div>
                              <div style={{ position: "relative", width: 8, height: 8, borderRadius: "50%", background: "var(--strip-train)", border: "2px solid var(--strip-train)", flexShrink: 0, zIndex: 1 }} />
                            </div>
                            <div className="flex items-start mt-1" style={{ gap: 2 }}>
                              <span style={{ fontFamily: FONT, fontSize: "7px", color: "var(--text-tertiary)", letterSpacing: "0.5px", flexShrink: 0, width: 8 }} />
                              <div style={{ flex: 1, display: "flex", justifyContent: "space-evenly", textAlign: "center" }}>
                                {leg.metadata.stops.map((s, si) => (
                                  <span key={si} style={{ fontFamily: FONT, fontSize: "7px", color: "var(--text-tertiary)", letterSpacing: "0.5px", maxWidth: `${Math.floor(100 / leg.metadata.stops.length)}%`, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                                ))}
                              </div>
                              <span style={{ fontFamily: FONT, fontSize: "7px", color: "var(--text-tertiary)", flexShrink: 0, width: 8 }} />
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="flex items-center justify-between mb-2">
                          <span style={{ fontFamily: FONT, fontSize: "24px", fontWeight: 700, color: "var(--text-heading)", letterSpacing: "2px" }}>{leg.origin?.code || leg.origin?.city?.slice(0, 3)?.toUpperCase() || "?"}</span>
                          <div className="flex flex-col items-center flex-1 mx-3">
                            <span style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-tertiary)" }}>{dur}</span>
                            <div style={{ width: "100%", height: 0, borderTop: "1px solid var(--border-subtle)", marginTop: 4 }} />
                          </div>
                          <span style={{ fontFamily: FONT, fontSize: "24px", fontWeight: 700, color: "var(--text-heading)", letterSpacing: "2px" }}>{leg.destination?.code || leg.destination?.city?.slice(0, 3)?.toUpperCase() || "?"}</span>
                        </div>
                        <div className="flex items-center justify-between mb-2">
                          <span style={{ fontFamily: FONT, fontSize: "10px", color: "var(--text-secondary)" }}>{legDepartTime(leg)}</span>
                          <span style={{ fontFamily: FONT, fontSize: "10px", color: "var(--text-secondary)" }}>{legArriveTime(leg)}</span>
                        </div>
                      </>
                    )}
                    {isLive && i === activeLeg && (() => {
                      const livePos = getLivePos(leg, liveTrackData);
                      return livePos ? (
                        <div className="mb-2 pt-2" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                          <div className="flex items-center gap-2">
                            <div style={{ width: 80, height: 4, borderRadius: 2, background: "var(--border-primary)", overflow: "hidden" }}>
                              <div style={{ width: `${livePos.progress * 100}%`, height: "100%", borderRadius: 2, background: "var(--accent-flight)" }} />
                            </div>
                            <span style={{ fontFamily: FONT, fontSize: "9px", fontWeight: 700, color: "var(--text-secondary)" }}>{Math.round(livePos.progress * 100)}%</span>
                            <span style={{ fontFamily: FONT, fontSize: "7px", letterSpacing: "1px", color: livePos.isReal ? "var(--accent-flight)" : "var(--text-tertiary)" }}>{livePos.isReal ? "LIVE" : "EST"}</span>
                          </div>
                          {livePos.isReal && livePos.altitude_ft && (
                            <div className="flex gap-3 mt-1">
                              <span style={{ fontFamily: FONT, fontSize: "8px", color: "var(--text-tertiary)" }}>FL{Math.round(livePos.altitude_ft / 100)}</span>
                              {livePos.velocity_kts && <span style={{ fontFamily: FONT, fontSize: "8px", color: "var(--text-tertiary)" }}>{livePos.velocity_kts} KTS</span>}
                              {livePos.heading != null && <span style={{ fontFamily: FONT, fontSize: "8px", color: "var(--text-tertiary)" }}>HDG {Math.round(livePos.heading)}&deg;</span>}
                            </div>
                          )}
                          {livePos.isReal && livePos.delay_minutes != null && !livePos.altitude_ft && (
                            <div className="flex gap-3 mt-1">
                              <span style={{ fontFamily: FONT, fontSize: "8px", color: livePos.delay_minutes > 0 ? "var(--accent-countdown)" : "var(--accent-flight)" }}>{livePos.delay_minutes > 0 ? `+${livePos.delay_minutes} MIN DELAY` : "ON TIME"}</span>
                              {livePos.velocity && <span style={{ fontFamily: FONT, fontSize: "8px", color: "var(--text-tertiary)" }}>{livePos.velocity} MPH</span>}
                              {livePos.estimated_arrival && <span style={{ fontFamily: FONT, fontSize: "8px", color: "var(--text-tertiary)" }}>ETA {formatTime(livePos.estimated_arrival)}</span>}
                            </div>
                          )}
                        </div>
                      ) : null;
                    })()}
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
      {editing && (
        <div className="mt-3">
          {showLegBuilder ? (
            <div className="border rounded" style={{ background: "var(--bg-surface)", borderColor: "var(--border-primary)" }}>
              <div className="flex border-b" style={{ borderColor: "var(--border-primary)" }}>{Object.entries(typeCfg).map(([k, v]) => <button key={k} onClick={() => { setBType(k); resetBuilder(); }} className="flex-1 py-2 text-xs font-bold tracking-widest relative" style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "1px", color: bType === k ? v.color : "var(--text-secondary)", background: "transparent" }}>{v.label}{bType === k && <div className="absolute bottom-0 left-0 right-0 h-px" style={{ background: v.color }} />}</button>)}</div>
              <div className="p-3">
                {bType === "flight" && (<><div className="flex flex-col sm:flex-row gap-2 mb-2"><div className="flex-1"><Label>CALLSIGN</Label><Input type="text" value={bFN} onChange={e => { setBFN(e.target.value); setBAF(null); setBErr(null); }} onKeyDown={e => e.key === "Enter" && handleQuery()} placeholder="DL484" style={{ textTransform: "uppercase", letterSpacing: "1px" }} /></div><div className="flex-1"><Label>DATE</Label><DatePicker value={bDt} onChange={setBDt} /></div><div className="flex items-end"><button onClick={handleQuery} disabled={bLoading || !bFN.trim()} className="w-full sm:w-auto px-4 py-2.5 rounded text-xs font-bold tracking-widest" style={{ background: bFN.trim() ? "var(--bg-surface)" : "var(--bg-surface)", color: bFN.trim() ? "var(--accent-flight)" : "var(--text-tertiary)", border: "1px solid var(--border-primary)", fontFamily: FONT, fontSize: "9px" }}>{bLoading ? <Spinner /> : "QUERY"}</button></div></div>{bAF && <div className="rounded border p-2.5 mb-2" style={{ background: "var(--bg-surface)", borderColor: "var(--accent-flight)" }}><div className="flex items-center gap-2 mb-1"><span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "var(--accent-flight)" }} /><span className="relative inline-flex rounded-full h-2 w-2" style={{ background: "var(--accent-flight)" }} /></span><span className="text-xs font-bold" style={{ color: "var(--accent-flight)", fontFamily: FONT, fontSize: "9px" }}>MATCH</span></div><div className="grid grid-cols-2 gap-x-4 gap-y-0.5">{[["CARRIER", bAF.carrier], ["ROUTE", `${bAF.origin.code} \u2192 ${bAF.destination.code}`], ["DEP", formatTime(bAF.origin.scheduled_local || bAF.origin.scheduled)], ["ARR", formatTime(bAF.destination.scheduled_local || bAF.destination.scheduled)]].map(([l, v]) => <div key={l} className="flex items-baseline gap-1.5"><span className="text-xs" style={{ color: "var(--text-secondary)", fontFamily: FONT, fontSize: "8px", minWidth: 40 }}>{l}</span><span className="text-xs" style={{ color: "var(--text-primary)", fontFamily: FONT }}>{v}</span></div>)}</div></div>}{bErr && <p className="mb-2 text-xs font-bold" style={{ color: "var(--accent-flight)", fontFamily: FONT, fontSize: "9px" }}>{bErr}</p>}{bFlightOptions && (<div className="mb-2"><p style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "2px", color: "var(--accent-flight)", marginBottom: 6 }}>{bFlightOptions.length} FLIGHTS FOUND — SELECT ONE</p><div style={{ display: "flex", flexDirection: "column", gap: 4 }}>{bFlightOptions.map((opt, i) => (<button key={i} onClick={() => selectFlightDetail(opt)} className="tappable-card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderRadius: 4, border: "1px solid var(--border-primary)", background: "var(--bg-surface)", cursor: "pointer", textAlign: "left" }}><span style={{ fontFamily: FONT, fontSize: "11px", fontWeight: 600, color: "var(--accent-flight-bright)" }}>{opt.origin.code} → {opt.destination.code}</span><span style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-secondary)" }}>{opt.origin.scheduled ? formatTime(opt.origin.scheduled_local || opt.origin.scheduled) : "—"} → {opt.destination.scheduled ? formatTime(opt.destination.scheduled_local || opt.destination.scheduled) : "—"}</span></button>))}</div></div>)}</>)}
                {bType === "hotel" && <div className="grid grid-cols-1 sm:grid-cols-2 gap-2"><div className="sm:col-span-2"><Label>PROPERTY</Label><PlaceAutocomplete value={bHN} onChange={setBHN} onSelect={(p) => setBHPlace(p)} placeholder="Park Hyatt Tokyo" types="lodging" />{bHPlace && <p className="mt-1" style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-tertiary)" }}>{bHPlace.address}</p>}{bHPlace?.lat && <div className="mt-2"><MiniMap lat={bHPlace.lat} lng={bHPlace.lng} zoom={15} height={100} label={bHPlace.name || bHN} /></div>}</div><div><Label>CONF NO.</Label><Input value={bHC} onChange={e => setBHC(e.target.value)} placeholder="Optional" /></div><div style={{}}></div><div><Label>CHECK-IN</Label><DatePicker value={bHI} onChange={setBHI} /></div><div><Label>CHECK-OUT</Label><DatePicker value={bHO} onChange={setBHO} /></div></div>}
                {bType === "train" && !bTrainManual && (<div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
                    <div><Label>OPERATOR</Label><select value={bTrainOp} onChange={e => { setBTrainOp(e.target.value); setBTrainResult(null); setBTrainErr(null); setBTrainOptions(null); }} className="w-full px-2.5 py-2 rounded border text-xs" style={{ background: "var(--bg-card)", borderColor: "var(--border-primary)", color: "var(--text-primary)", fontFamily: FONT, fontSize: "11px" }}>{DETAIL_TRAIN_OPS.map(op => <option key={op.id} value={op.id}>{op.name} ({op.country})</option>)}</select></div>
                    <div><Label>TRAIN NO.</Label><Input type="text" value={bTrainNum} onChange={e => { setBTrainNum(e.target.value); setBTrainResult(null); setBTrainErr(null); }} onKeyDown={e => e.key === "Enter" && handleTrainQueryDetail()} placeholder={DETAIL_TRAIN_OPS.find(o => o.id === bTrainOp)?.placeholder || "123"} style={{ textTransform: "uppercase", letterSpacing: "1px" }} /></div>
                    <div className="flex items-end"><button onClick={handleTrainQueryDetail} disabled={bTrainLoading || !bTrainNum.trim()} className="w-full px-4 py-2.5 rounded text-xs font-bold tracking-widest" style={{ border: "1px solid var(--border-primary)", background: "var(--bg-surface)", color: bTrainNum.trim() ? "var(--strip-train)" : "var(--text-tertiary)", fontFamily: FONT, fontSize: "9px" }}>{bTrainLoading ? <Spinner /> : "QUERY"}</button></div>
                  </div>
                  <div className="mb-2"><Label>DATE</Label><DatePicker value={bDt} onChange={setBDt} /></div>
                  {bTrainErr && <p className="mb-2 text-xs font-bold" style={{ color: "var(--strip-train)", fontFamily: FONT, fontSize: "9px" }}>{bTrainErr}</p>}
                  {bTrainOptions && (<div className="mb-2"><p style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "2px", color: "var(--strip-train)", marginBottom: 6 }}>{bTrainOptions.length} TRAINS FOUND — SELECT ONE</p><div style={{ display: "flex", flexDirection: "column", gap: 4 }}>{bTrainOptions.map((opt, i) => (<button key={i} onClick={() => selectTrainDetail(opt)} className="tappable-card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderRadius: 4, border: "1px solid var(--border-primary)", background: "var(--bg-surface)", cursor: "pointer", textAlign: "left" }}><span style={{ fontFamily: FONT, fontSize: "11px", fontWeight: 600, color: "var(--strip-train)" }}>{opt.origin.name?.split(" ")[0] || "?"} → {opt.destination.name?.split(" ")[0] || "?"}</span><span style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-secondary)" }}>{opt.route_name || opt.train_number}</span></button>))}</div></div>)}
                  {bTrainResult && (<div className="rounded border p-2.5 mb-2" style={{ background: "var(--bg-surface)", borderColor: "var(--strip-train)" }}><div className="flex items-center gap-2 mb-1"><span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "var(--strip-train)" }} /><span className="relative inline-flex rounded-full h-2 w-2" style={{ background: "var(--strip-train)" }} /></span><span className="text-xs font-bold" style={{ color: "var(--strip-train)", fontFamily: FONT, fontSize: "9px" }}>MATCH</span></div><div className="grid grid-cols-2 gap-x-4 gap-y-0.5">{[["ROUTE", `${bTrainResult.origin.name?.split(",")[0] || "?"} → ${bTrainResult.destination.name?.split(",")[0] || "?"}`], ["TRAIN", bTrainResult.route_name || bTrainResult.train_number], ["DEP", bTrainResult.origin.scheduled_departure ? formatTime(bTrainResult.origin.scheduled_departure) : "—"], ["ARR", bTrainResult.destination.scheduled_arrival ? formatTime(bTrainResult.destination.scheduled_arrival) : "—"]].map(([l, v]) => <div key={l} className="flex items-baseline gap-1.5"><span className="text-xs" style={{ color: "var(--text-secondary)", fontFamily: FONT, fontSize: "8px", minWidth: 40 }}>{l}</span><span className="text-xs" style={{ color: "var(--text-primary)", fontFamily: FONT }}>{v}</span></div>)}</div>{bTrainResult.origin.platform && <p className="mt-1" style={{ fontFamily: FONT, fontSize: "8px", color: "var(--text-tertiary)" }}>PLATFORM {bTrainResult.origin.platform}</p>}{bTrainResult.delay_minutes > 0 && <p className="mt-1" style={{ fontFamily: FONT, fontSize: "8px", color: "var(--accent-countdown)" }}>+{bTrainResult.delay_minutes} MIN DELAY</p>}</div>)}
                  <button onClick={() => setBTrainManual(true)} style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "1px", color: "var(--text-tertiary)", background: "none", border: "none", cursor: "pointer", padding: "4px 0", textDecoration: "underline" }}>ENTER MANUALLY</button>
                </div>)}
                {bType === "train" && bTrainManual && (<div className="grid grid-cols-1 sm:grid-cols-2 gap-2"><div><Label>ORIGIN</Label><PlaceAutocomplete value={bO} onChange={setBO} onSelect={(p) => setBOPlace(p)} placeholder="Penn Station, NYC" types="transit_station|train_station|locality" />{bOPlace && <p className="mt-1" style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-tertiary)" }}>{bOPlace.address}</p>}</div><div><Label>DEST</Label><PlaceAutocomplete value={bD} onChange={setBD} onSelect={(p) => setBDPlace(p)} placeholder="Union Station, DC" types="transit_station|train_station|locality" />{bDPlace && <p className="mt-1" style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-tertiary)" }}>{bDPlace.address}</p>}</div><div><Label>DATE</Label><DatePicker value={bDt} onChange={setBDt} /></div><div><Label>TIME (OPT)</Label><Input type="time" value={bTm} onChange={e => setBTm(e.target.value)} /></div><div className="sm:col-span-2"><button onClick={() => setBTrainManual(false)} style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "1px", color: "var(--text-tertiary)", background: "none", border: "none", cursor: "pointer", padding: "4px 0", textDecoration: "underline" }}>LOOK UP TRAIN</button></div></div>)}
                {bType === "bus" && <div className="grid grid-cols-1 sm:grid-cols-2 gap-2"><div><Label>ORIGIN</Label><PlaceAutocomplete value={bO} onChange={setBO} onSelect={(p) => setBOPlace(p)} placeholder="Port Authority, NYC" types="transit_station|bus_station|locality" />{bOPlace && <p className="mt-1" style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-tertiary)" }}>{bOPlace.address}</p>}</div><div><Label>DEST</Label><PlaceAutocomplete value={bD} onChange={setBD} onSelect={(p) => setBDPlace(p)} placeholder="South Station, Boston" types="transit_station|bus_station|locality" />{bDPlace && <p className="mt-1" style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-tertiary)" }}>{bDPlace.address}</p>}</div><div><Label>DATE</Label><DatePicker value={bDt} onChange={setBDt} /></div><div><Label>TIME (OPT)</Label><Input type="time" value={bTm} onChange={e => setBTm(e.target.value)} /></div></div>}
                <div className="flex items-center justify-between mt-3 pt-3 pb-1" style={{ borderTop: "1px solid var(--border-primary)", position: "sticky", bottom: 0, background: "var(--bg-surface)", zIndex: 2 }}><button onClick={() => { setShowLegBuilder(false); resetBuilder(); }} className="px-4 py-3 rounded text-xs font-bold tracking-widest" style={{ color: "var(--text-secondary)", fontFamily: FONT, fontSize: "10px" }}>CANCEL</button><button onClick={addLeg} disabled={!canConfirm()} className="px-6 py-3 rounded text-xs font-bold tracking-widest" style={{ background: canConfirm() ? "var(--accent-flight)" : "var(--bg-surface)", color: canConfirm() ? "var(--bg-primary)" : "var(--text-tertiary)", fontFamily: FONT, fontSize: "10px" }}>ADD LEG</button></div>
              </div>
            </div>
          ) : <button onClick={() => { resetBuilder(); setShowLegBuilder(true); }} className="w-full py-3 rounded border border-dashed text-xs font-bold tracking-widest" style={{ borderColor: "var(--accent-hotel-dim)", color: "var(--accent-hotel)", fontFamily: FONT, fontSize: "9px", letterSpacing: "2px" }}>+ ADD LEG</button>}
        </div>
      )}
    </>
  );

  const deleteSection = editing ? (
    <div style={{ padding: "8px 16px 24px", textAlign: "center" }}>
      {showDeleteTrip ? (
        <div>
          <p style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: 12 }}>This will permanently delete this trip and all its legs.</p>
          <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>
            <button onClick={() => { setShowDeleteTrip(false); setDeleteError(null); }} style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "2px", color: "var(--text-secondary)", padding: "10px 20px", border: "1px solid var(--border-primary)", borderRadius: 6, background: "transparent", cursor: "pointer", minHeight: 44 }}>CANCEL</button>
            <button onClick={deleteTrip} disabled={deletingTrip} style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "2px", color: "#fff", padding: "10px 20px", background: "#e84233", borderRadius: 6, border: "none", cursor: "pointer", minHeight: 44 }}>{deletingTrip ? <Spinner /> : "DELETE"}</button>
          </div>
          {deleteError && <p style={{ fontFamily: FONT, fontSize: "9px", color: "#e84233", marginTop: 8 }}>{deleteError}</p>}
        </div>
      ) : (
        <button onClick={() => setShowDeleteTrip(true)} style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "2px", color: "#e84233", background: "transparent", border: "none", cursor: "pointer", padding: "16px 0", minHeight: 44 }}>DELETE FLIGHT PLAN</button>
      )}
    </div>
  ) : null;

  const detailNavBar = (
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
  );

  const detailHeader = (
    <div style={{ padding: isDesktop ? "20px 24px 16px" : undefined }} className={isDesktop ? "" : "px-4 pb-3"}>
      {editing ? (
        <div className="mb-3">
          <div className="mb-3"><Label>DESIGNATION</Label><input type="text" value={editTitle} onChange={e => setEditTitle(e.target.value)} className="w-full px-0 py-1.5 border-0 border-b outline-none text-sm font-bold" style={{ background: "transparent", borderColor: "var(--border-primary)", color: "var(--text-heading)", fontFamily: FONT }} /></div>
          <div className="grid grid-cols-2 gap-3"><div><Label>DEPART</Label><DatePicker value={editStart} onChange={setEditStart} /></div><div><Label>RETURN</Label><DatePicker value={editEnd} onChange={setEditEnd} /></div></div>
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
  );

  const mapModeToggle = (
    <div style={{ display: "flex", justifyContent: "flex-end", padding: isDesktop ? "8px 12px" : "0 16px 4px", position: isDesktop ? "absolute" : undefined, top: isDesktop ? 12 : undefined, right: isDesktop ? 12 : undefined, zIndex: isDesktop ? 5 : undefined }}>
      <div style={{ display: "inline-flex", border: "1px solid var(--border-primary)", borderRadius: 6, overflow: "hidden" }}>
        {[{ key: "radar", label: "RADAR" }, { key: "satellite", label: "SATELLITE" }].map(v => (
          <button key={v.key} onClick={() => setMapView(v.key)}
            style={{ padding: "6px 12px", fontFamily: FONT, fontSize: "8px", letterSpacing: "1.5px", fontWeight: mapView === v.key ? 500 : 400,
              background: mapView === v.key ? "var(--accent-flight)" : "transparent",
              color: mapView === v.key ? "var(--bg-primary)" : "var(--text-tertiary)",
              border: "none", cursor: "pointer", minHeight: 32 }}>
            {v.label}
          </button>
        ))}
      </div>
    </div>
  );

  const mapSection = (
    <div style={{ height: isDesktop ? "100%" : "260px", minHeight: "200px" }}>
      {mapView === "satellite" ? (
        <SatelliteMap trip={trip} height={isDesktop ? "100%" : 260} />
      ) : (
        <TripMap trip={trip} activeLegIndex={activeLeg} mode={mode} liveTrackData={liveTrackData} mapTick={mapTick} />
      )}
    </div>
  );

  return (
    <div style={{ height: isDesktop ? "100vh" : undefined, overflow: isDesktop ? "hidden" : undefined, display: isDesktop ? "flex" : undefined, flexDirection: isDesktop ? "column" : undefined, background: "var(--bg-primary)" }} className={isDesktop ? "" : "min-h-[calc(100vh-48px)] sm:min-h-[calc(100vh-53px)]"}>
      {showShare && <SquawkModal trip={trip} onClose={() => setShowShare(false)} />}

      {/* Nav bar */}
      {detailNavBar}

      {isDesktop ? (
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* Left: Map */}
          <div style={{ flex: 1, position: "relative", overflow: "hidden", minWidth: 400 }}>
            {mapSection}
            {mapModeToggle}
          </div>
          {/* Right: Itinerary */}
          <div style={{ width: 480, minWidth: 420, flexShrink: 0, borderLeft: "1px solid var(--border-primary)", overflowY: "auto" }}>
            <div style={{ position: "sticky", top: 0, background: "var(--bg-primary)", zIndex: 5, borderBottom: "1px solid var(--border-primary)" }}>
              {detailHeader}
              {!editing && <div style={{ padding: "0 24px 16px" }}><RouteSummaryBar legs={trip.legs} /></div>}
            </div>
            <div style={{ padding: "16px 24px 8px" }}>
              {itineraryContent}
            </div>
            {!editing && <StatsFooter legs={trip.legs} />}
            {deleteSection}
          </div>
        </div>
      ) : (
        <>
          {detailHeader}
          {!editing && <div className="px-4 pb-3"><RouteSummaryBar legs={trip.legs} /></div>}
          {mapModeToggle}
          {mapSection}
          <div className="px-4 pt-4 pb-2">
            {itineraryContent}
          </div>
          {!editing && <StatsFooter legs={trip.legs} />}
          {deleteSection}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CREATE PAGE
// ═══════════════════════════════════════════════════════════════════

function CreatePage() {
  const { navigate } = useRouter();
  const { mode } = useTheme();
  const isDesktop = useIsDesktop();

  // Trip details
  const [tripTitle, setTripTitle] = useState("");
  const [tripStart, setTripStart] = useState("");
  const [tripEnd, setTripEnd] = useState("");

  // Legs added to the plan
  const [legs, setLegs] = useState([]);

  // Leg builder state
  const [bType, setBType] = useState("flight");
  // Flight
  const [bFN, setBFN] = useState(""); const [bLoading, setBLoading] = useState(false); const [bAF, setBAF] = useState(null); const [bErr, setBErr] = useState(null); const [bFlightOptions, setBFlightOptions] = useState(null);
  const [fOrigin, setFOrigin] = useState(""); const [fDest, setFDest] = useState("");
  const [fDepart, setFDepart] = useState(""); const [fArrive, setFArrive] = useState("");
  const [fCarrier, setFCarrier] = useState(""); const [fFlightNo, setFFlightNo] = useState("");
  const [fDate, setFDate] = useState(""); const [fArriveDate, setFArriveDate] = useState("");
  // Hotel
  const [hName, setHName] = useState(""); const [hPlace, setHPlace] = useState(null);
  const [hCheckIn, setHCheckIn] = useState(""); const [hCheckOut, setHCheckOut] = useState("");
  const [hLocation, setHLocation] = useState("");
  // Train/Bus
  const [tOrigin, setTOrigin] = useState(""); const [tDest, setTDest] = useState("");
  const [tOPlace, setTOPlace] = useState(null); const [tDPlace, setTDPlace] = useState(null);
  const [tDepart, setTDepart] = useState(""); const [tArrive, setTArrive] = useState("");
  const [tOperator, setTOperator] = useState(""); const [tNumber, setTNumber] = useState("");
  const [tDate, setTDate] = useState("");
  // Train lookup
  const [tLookupOperator, setTLookupOperator] = useState("amtrak");
  const [tLookupNumber, setTLookupNumber] = useState("");
  const [tLookupLoading, setTLookupLoading] = useState(false);
  const [tLookupResult, setTLookupResult] = useState(null);
  const [tLookupError, setTLookupError] = useState(null);
  const [tLookupOptions, setTLookupOptions] = useState(null);
  const [tManualMode, setTManualMode] = useState(false);

  // Validation
  const [valErrors, setValErrors] = useState([]);

  // Filing state
  const [submitting, setSubmitting] = useState(false);
  const [fileError, setFileError] = useState(null);

  // Discard confirmation
  const [showDiscard, setShowDiscard] = useState(false);
  const [addLegFeedback, setAddLegFeedback] = useState(false);
  const [fileFeedback, setFileFeedback] = useState(false);

  const previewRef = useRef(null);

  const hasUnsavedData = tripTitle.trim() || tripStart || tripEnd || legs.length > 0;

  const handleBack = () => {
    if (hasUnsavedData) { setShowDiscard(true); } else { navigate("dashboard"); }
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

  const resetBuilder = () => {
    let defDate = tripStart || "";
    if (legs.length) {
      const last = legs[legs.length - 1];
      const endIso = last.arrive_time || last.depart_time;
      if (endIso) { const d = new Date(endIso.split("T")[0]); d.setDate(d.getDate() + 1); defDate = d.toISOString().split("T")[0]; }
    }
    setBFN(""); setBLoading(false); setBAF(null); setBErr(null); setBFlightOptions(null);
    setFOrigin(""); setFDest(""); setFDepart(""); setFArrive(""); setFCarrier(""); setFFlightNo(""); setFDate(defDate); setFArriveDate("");
    setHName(""); setHPlace(null); setHCheckIn(defDate); setHCheckOut(tripEnd || ""); setHLocation("");
    setTOrigin(""); setTDest(""); setTOPlace(null); setTDPlace(null); setTDepart(""); setTArrive(""); setTOperator(""); setTNumber(""); setTDate(defDate);
    setTLookupOperator("amtrak"); setTLookupNumber(""); setTLookupLoading(false); setTLookupResult(null); setTLookupError(null); setTLookupOptions(null); setTManualMode(false);
    setValErrors([]);
  };

  // Flight lookup
  const [queryDisabled, setQueryDisabled] = useState(false);
  const selectFlight = (af) => {
    setBAF(af); setBFlightOptions(null);
    setFOrigin(af.origin.code || "");
    setFDest(af.destination.code || "");
    // Prefer local times from AviationStack for display; fall back to UTC from FR24
    const depLocal = af.origin.scheduled_local || af.origin.scheduled || "";
    const arrLocal = af.destination.scheduled_local || af.destination.scheduled || "";
    if (depLocal) { setFDepart(depLocal.substring(11, 16)); if (!fDate) setFDate(depLocal.substring(0, 10)); }
    if (arrLocal) { setFArrive(arrLocal.substring(11, 16)); setFArriveDate(arrLocal.substring(0, 10)); }
    setFCarrier(af.carrier || "");
    setFFlightNo(af.callsign || "");
  };
  const handleQuery = async () => {
    if (!bFN.trim() || queryDisabled) return; setBLoading(true); setBErr(null); setBAF(null); setBFlightOptions(null);
    try {
      const r = await api(`/flights/lookup?callsign=${bFN.trim().toUpperCase()}${fDate ? `&date=${fDate}` : ""}`);
      const results = mapFlightResults(r);
      if (results.length === 1) { selectFlight(results[0]); }
      else if (results.length > 1) { setBFlightOptions(results); }
      else { setBErr("Flight not found \u2014 try another callsign or enter manually"); }
    } catch (e) {
      const msg = e?.message || "";
      if (msg.includes("429") || msg.toLowerCase().includes("rate")) { setBErr("STAND BY \u2014 too many lookups. Try again in a moment."); setQueryDisabled(true); setTimeout(() => setQueryDisabled(false), 10000); }
      else { setBErr("Flight not found \u2014 try another callsign or enter manually"); }
    }
    setBLoading(false);
  };

  // Train lookup
  const TRAIN_OPERATORS = [
    { id: "amtrak", name: "Amtrak", country: "US", placeholder: "91" },
    { id: "sncf", name: "SNCF", country: "FR", placeholder: "6213" },
    { id: "db", name: "Deutsche Bahn", country: "DE", placeholder: "ICE 123" },
  ];
  const selectTrain = (train) => {
    setTLookupResult(train); setTLookupOptions(null);
    setTOrigin(train.origin.name || ""); setTDest(train.destination.name || "");
    setTOPlace(train.origin.lat ? { lat: train.origin.lat, lng: train.origin.lng, city: train.origin.name } : null);
    setTDPlace(train.destination.lat ? { lat: train.destination.lat, lng: train.destination.lng, city: train.destination.name } : null);
    if (train.origin.scheduled_departure) { setTDepart(train.origin.scheduled_departure.substring(11, 16)); if (!tDate) setTDate(train.origin.scheduled_departure.substring(0, 10)); }
    if (train.destination.scheduled_arrival) { setTArrive(train.destination.scheduled_arrival.substring(11, 16)); }
    setTOperator(train.operator_name || tLookupOperator);
    setTNumber(train.train_number || "");
  };
  const handleTrainQuery = async () => {
    if (!tLookupNumber.trim() || tLookupLoading) return;
    setTLookupLoading(true); setTLookupError(null); setTLookupResult(null); setTLookupOptions(null);
    try {
      const r = await api(`/trains/lookup?operator=${tLookupOperator}&number=${encodeURIComponent(tLookupNumber.trim())}${tDate ? `&date=${tDate}` : ""}`);
      const results = r.trains || [];
      if (results.length === 1) { selectTrain(results[0]); }
      else if (results.length > 1) { setTLookupOptions(results); }
      else { setTLookupError("No matching train found — try another number or enter manually"); }
    } catch (e) {
      const msg = e?.message || "";
      if (msg.includes("429") || msg.toLowerCase().includes("rate")) { setTLookupError("STAND BY — too many lookups"); }
      else { setTLookupError("Train not found — verify number or enter manually"); }
    }
    setTLookupLoading(false);
  };

  // Build a leg object from current builder state
  const buildLeg = () => {
    if (bType === "flight") {
      // If flight was looked up, use UTC times from API; manual fields show local times for display
      const depTime = bAF?.origin?.scheduled || (fDate && fDepart ? `${fDate}T${fDepart}:00Z` : null);
      const arrTime = bAF?.destination?.scheduled || (fDate && fArrive ? (() => { const ad = fArriveDate || (fArrive < fDepart ? (() => { const d = new Date(`${fDate}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().split("T")[0]; })() : fDate); return `${ad}T${fArrive}:00Z`; })() : null);
      return {
        type: "flight",
        origin: { code: fOrigin.toUpperCase(), city: bAF?.origin?.airport || fOrigin, lat: 0, lng: 0 },
        destination: { code: fDest.toUpperCase(), city: bAF?.destination?.airport || fDest, lat: 0, lng: 0 },
        depart_time: depTime,
        arrive_time: arrTime,
        carrier: fCarrier, vehicle_number: fFlightNo,
        metadata: bAF ? { terminal: bAF.origin.terminal || null, gate: bAF.origin.gate || null, depart_local: bAF.origin.scheduled_local || null, arrive_local: bAF.destination.scheduled_local || null } : {},
      };
    }
    if (bType === "hotel") {
      const nights = hCheckIn && hCheckOut ? Math.max(1, Math.round((new Date(hCheckOut) - new Date(hCheckIn)) / 86400000)) : 1;
      const lat = hPlace?.lat || 0; const lng = hPlace?.lng || 0;
      const city = hPlace?.city || hLocation || hName;
      return {
        type: "hotel",
        origin: { code: null, city, lat, lng }, destination: { code: null, city, lat, lng },
        depart_time: hCheckIn ? `${hCheckIn}T15:00:00Z` : null,
        arrive_time: hCheckOut ? `${hCheckOut}T11:00:00Z` : null,
        carrier: hName, vehicle_number: null,
        metadata: { nights, address: hPlace?.address || null },
      };
    }
    // train or bus
    const oLat = tOPlace?.lat || 0; const oLng = tOPlace?.lng || 0;
    const dLat = tDPlace?.lat || 0; const dLng = tDPlace?.lng || 0;
    // For trains with lookup results, use API times if available
    const trainDepTime = tLookupResult?.origin?.scheduled_departure || (tDate && tDepart ? `${tDate}T${tDepart}:00Z` : (tDate ? `${tDate}T08:00:00Z` : null));
    const trainArrTime = tLookupResult?.destination?.scheduled_arrival || (tDate && tArrive ? `${tDate}T${tArrive}:00Z` : (tDate ? `${tDate}T12:00:00Z` : null));
    return {
      type: bType,
      origin: { code: tOrigin.slice(0, 3).toUpperCase(), city: tOPlace?.city || tOrigin, lat: oLat, lng: oLng },
      destination: { code: tDest.slice(0, 3).toUpperCase(), city: tDPlace?.city || tDest, lat: dLat, lng: dLng },
      depart_time: bType === "train" ? trainDepTime : (tDate && tDepart ? `${tDate}T${tDepart}:00Z` : (tDate ? `${tDate}T08:00:00Z` : null)),
      arrive_time: bType === "train" ? trainArrTime : (tDate && tArrive ? `${tDate}T${tArrive}:00Z` : (tDate ? `${tDate}T12:00:00Z` : null)),
      carrier: tOperator || (bType === "train" ? "Train" : "Bus"), vehicle_number: tNumber || null,
      metadata: bType === "train" && tLookupResult ? { operator: tLookupResult.operator, route_name: tLookupResult.route_name, platform: tLookupResult.origin?.platform } : (bType === "train" && tLookupOperator !== "" && !tManualMode ? { operator: tLookupOperator } : {}),
    };
  };

  // Validate and add leg
  const handleAddLeg = () => {
    const errs = [];
    if (bType === "flight") {
      if (!fOrigin.trim()) errs.push("fOrigin");
      if (!fDest.trim()) errs.push("fDest");
    } else if (bType === "hotel") {
      if (!hName.trim()) errs.push("hName");
    } else {
      if (!tOrigin.trim()) errs.push("tOrigin");
      if (!tDest.trim()) errs.push("tDest");
    }
    if (errs.length > 0) { setValErrors(errs); return; }
    setValErrors([]);
    const leg = buildLeg();
    leg._tempId = Date.now();
    setLegs(prev => [...prev, leg].sort((a, b) => new Date(a.depart_time || 0) - new Date(b.depart_time || 0)));
    resetBuilder();
    setAddLegFeedback(true); setTimeout(() => setAddLegFeedback(false), 1500);
    // Scroll to preview
    setTimeout(() => { previewRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, 100);
  };

  const removeLeg = (idx) => { setLegs(prev => prev.filter((_, i) => i !== idx)); };

  // File the flight plan
  const handleFile = async () => {
    if (!tripTitle.trim()) return;
    setSubmitting(true); setFileError(null);
    try {
      const t = await api("/trips", { method: "POST", body: JSON.stringify({ title: tripTitle, description: "", start_date: tripStart || null, end_date: tripEnd || null }) });
      // Create each leg
      for (const leg of legs) {
        const { _tempId, ...legData } = leg;
        await api(`/trips/${t.id}/legs`, { method: "POST", body: JSON.stringify(legToApi(legData)) });
      }
      setFileFeedback(true);
      setTimeout(() => navigate("detail", { tripId: t.id }), 1000);
    } catch (e) { setFileError("Failed to file flight plan \u2014 check connection and try again"); }
    setSubmitting(false);
  };

  const valBorder = (field) => valErrors.includes(field) ? "#e84233" : "var(--border-primary)";

  // Leg type config for segmented control
  const segTypes = [
    { key: "flight", label: "FLIGHT", activeBg: "var(--accent-flight)", activeColor: "var(--squawk-text)" },
    { key: "hotel", label: "GROUND STOP", activeBg: "var(--accent-hotel)", activeColor: "#fff" },
    { key: "train", label: "TRAIN", activeBg: "var(--strip-train)", activeColor: "#fff" },
    { key: "bus", label: "BUS", activeBg: "var(--strip-bus)", activeColor: "#fff" },
  ];

  // Mini card helpers
  const miniDate = (iso) => { if (!iso) return ""; const d = new Date(iso); return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase(); };
  const miniDuration = (d, a, origin, destination) => {
    if (origin?.lat && destination?.lat && origin.lat !== 0 && destination.lat !== 0) {
      const nm = haversineNM(origin.lat, origin.lng, destination.lat, destination.lng);
      const hrs = nm / 460 + 0.5; const h = Math.floor(hrs), m = Math.round((hrs - h) * 60);
      return `~${h}H ${m}M`;
    }
    if (!d || !a) return ""; const ms = new Date(a) - new Date(d); if (ms <= 0) return "";
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? `${h}H ${m}M` : `${m}M`;
  };

  // Input style helper (for the builder fields)
  const bInput = (overrides = {}) => ({
    background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 4,
    padding: "9px 10px", fontFamily: FONT, fontSize: "12px", color: "var(--text-primary)",
    colorScheme: mode === "night" ? "dark" : "light", outline: "none", width: "100%",
    ...overrides,
  });
  const bLabel = { fontFamily: FONT, fontSize: "7px", letterSpacing: "1.5px", color: "var(--text-tertiary)", marginBottom: 4, display: "block" };

  return (
    <div className="px-4 sm:px-6 py-4" style={{ maxWidth: isDesktop ? 580 : "36rem", margin: "0 auto", padding: isDesktop ? "32px 24px 60px" : undefined }}>
      {/* ── Discard confirmation ── */}
      {showDiscard && (
        <div style={{ position: "fixed", inset: 0, zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.4)" }}>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 10, padding: "24px 20px", maxWidth: 320, width: "90%", textAlign: "center" }}>
            <p style={{ fontFamily: FONT, fontSize: "10px", letterSpacing: "2px", color: "var(--text-heading)", fontWeight: 700, marginBottom: 4 }}>DISCARD FLIGHT PLAN?</p>
            <p style={{ fontFamily: FONT, fontSize: "10px", color: "var(--text-tertiary)", marginBottom: 16 }}>Your unsaved changes will be lost.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowDiscard(false)} className="flex-1" style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "2px", fontWeight: 700, padding: "10px 0", borderRadius: 6, background: "var(--bg-surface)", color: "var(--text-secondary)", border: "1px solid var(--border-primary)", minHeight: 44 }}>KEEP EDITING</button>
              <button onClick={() => navigate("dashboard")} className="flex-1" style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "2px", fontWeight: 700, padding: "10px 0", borderRadius: 6, background: "#e84233", color: "#fff", border: "none", minHeight: 44 }}>DISCARD</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Nav bar ── */}
      <div className="flex items-center justify-between mb-6">
        <button onClick={handleBack} style={{ width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--nav-border)", borderRadius: 8, background: "var(--nav-bg)", color: "var(--nav-text-active)", fontFamily: FONT, fontSize: "16px" }}>{"\u2190"}</button>
        <button onClick={handleBack} style={{ height: 44, padding: "0 16px", border: "1px solid var(--nav-border)", borderRadius: 8, background: "var(--nav-bg)", color: "var(--nav-text)", fontFamily: FONT, fontSize: "10px", letterSpacing: "2px", fontWeight: 500 }}>CANCEL</button>
      </div>

      {/* ── Page title ── */}
      <p style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "3px", color: "var(--accent-flight)", fontWeight: 700, marginBottom: 16 }}>FILE NEW FLIGHT PLAN</p>

      {/* ── Designation ── */}
      <div className="mb-3">
        <p style={{ ...bLabel, fontSize: "8px", letterSpacing: "2px" }}>DESIGNATION</p>
        <div style={{ border: "1px solid var(--border-primary)", borderRadius: 6, padding: "11px 14px", background: "var(--bg-card)" }}>
          <input
            type="text" value={tripTitle} onChange={e => setTripTitle(e.target.value)}
            placeholder="Spring Break, NYC Weekend, Euro Tr..."
            autoFocus
            style={{ width: "100%", background: "transparent", border: "none", outline: "none", fontFamily: FONT, fontSize: "15px", fontWeight: 600, color: "var(--text-heading)" }}
          />
        </div>
      </div>

      {/* ── Quick set pills ── */}
      <div className="mb-3">
        <p style={{ ...bLabel, fontSize: "8px", letterSpacing: "2px" }}>QUICK SET</p>
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }} className="no-scrollbar">
          {quickDates.map(qd => {
            const isActive = tripStart === fmt(qd.start);
            return (
              <button key={qd.label} onClick={() => { setTripStart(fmt(qd.start)); setTripEnd(fmt(addDays(qd.start, qd.days))); }}
                style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "1px", padding: "8px 12px", borderRadius: 6, whiteSpace: "nowrap",
                  background: isActive ? "var(--accent-flight)" : "transparent",
                  color: isActive ? "var(--squawk-text)" : "var(--nav-text)",
                  border: `1px solid ${isActive ? "var(--accent-flight)" : "var(--border-primary)"}`,
                }}>
                {qd.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Date fields ── */}
      <div style={{ display: "flex", gap: 10, marginBottom: 4 }}>
        <div style={{ flex: 1 }}>
          <p style={{ ...bLabel, fontSize: "8px", letterSpacing: "2px" }}>DEPART</p>
          <DatePicker value={tripStart} onChange={setTripStart} placeholder="SELECT" />
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ ...bLabel, fontSize: "8px", letterSpacing: "2px" }}>RETURN</p>
          <DatePicker value={tripEnd} onChange={setTripEnd} placeholder="SELECT" />
        </div>
      </div>
      <p style={{ fontFamily: FONT, fontSize: "8px", color: "var(--text-tertiary)", marginBottom: 12 }}>Dates are optional {"\u2014"} you can set them later.</p>

      {/* ── Divider ── */}
      <div style={{ borderTop: "1px solid var(--border-subtle)", margin: "12px 0" }} />

      {/* ── Leg preview section ── */}
      <div ref={previewRef}>
        <p style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "3px", color: "var(--text-secondary)", fontWeight: 700, marginBottom: 10 }}>
          FLIGHT PLAN {"\u00B7"} {legs.length} WAYPOINT{legs.length !== 1 ? "S" : ""}
        </p>

        {legs.length === 0 ? (
          <div style={{ border: "1px dashed var(--border-primary)", borderRadius: 6, padding: "24px 14px", textAlign: "center", marginBottom: 12 }}>
            <p style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-tertiary)", letterSpacing: "1px" }}>ADD YOUR FIRST LEG BELOW</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
            {legs.map((leg, i) => {
              const isHotel = leg.type === "hotel";
              const stripColors = { flight: "var(--strip-flight)", hotel: "var(--strip-hotel)", train: "var(--strip-train)", bus: "var(--strip-bus)" };
              const accentColors = { flight: "var(--accent-flight)", hotel: "var(--accent-hotel)", train: "var(--strip-train)", bus: "var(--strip-bus)" };
              return (
                <div key={leg._tempId || i} style={{ display: "flex", gap: 4 }}>
                  <div style={{
                    flex: 1, borderRadius: 4, padding: "10px 12px",
                    borderLeft: `3px solid ${stripColors[leg.type]}`,
                    background: isHotel ? "var(--bg-card-hotel)" : "var(--bg-card)",
                    border: `1px solid ${isHotel ? "var(--border-hotel)" : "var(--border-primary)"}`,
                    borderLeftWidth: 3, borderLeftColor: stripColors[leg.type], borderLeftStyle: "solid",
                  }}>
                    <div className="flex items-center justify-between" style={{ marginBottom: 2 }}>
                      <span style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "1.5px", color: accentColors[leg.type] }}>
                        {isHotel ? "GROUND STOP" : leg.type.toUpperCase()} {"\u00B7"} {isHotel ? (leg.metadata?.nights ? `${leg.metadata.nights}N` : "1N") : (leg.vehicle_number || leg.carrier || "")}
                      </span>
                      <span style={{ fontFamily: FONT, fontSize: "8px", color: isHotel ? "var(--accent-hotel-dim)" : "var(--text-secondary)" }}>
                        {isHotel ? `${miniDate(leg.depart_time)}${leg.arrive_time ? ` \u2013 ${miniDate(leg.arrive_time)}` : ""}` : miniDate(leg.depart_time)}
                      </span>
                    </div>
                    {isHotel ? (
                      <p style={{ fontFamily: FONT, fontSize: "13px", fontWeight: 600, color: "var(--accent-hotel-text)" }}>{leg.carrier || leg.origin?.city}</p>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span style={{ fontFamily: FONT, fontSize: "18px", fontWeight: 700, color: "var(--text-heading)", letterSpacing: "1px" }}>{leg.origin?.code || "???"}</span>
                        <span style={{ fontFamily: FONT, fontSize: "8px", color: "var(--text-tertiary)", flex: 1, textAlign: "center" }}>{miniDuration(leg.depart_time, leg.arrive_time, leg.origin, leg.destination)}</span>
                        <span style={{ fontFamily: FONT, fontSize: "18px", fontWeight: 700, color: "var(--text-heading)", letterSpacing: "1px" }}>{leg.destination?.code || "???"}</span>
                      </div>
                    )}
                  </div>
                  <button onClick={() => removeLeg(i)} style={{ width: 40, minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", fontFamily: FONT, fontSize: "16px", color: mode === "night" ? "#4a2020" : "#c0a0a0", cursor: "pointer" }}
                    onMouseEnter={e => e.currentTarget.style.color = "#e84233"} onMouseLeave={e => e.currentTarget.style.color = mode === "night" ? "#4a2020" : "#c0a0a0"}
                  >{"\u2715"}</button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Divider ── */}
      <div style={{ borderTop: "1px solid var(--border-subtle)", margin: "12px 0" }} />

      {/* ── Leg builder ── */}
      <p style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "3px", color: "var(--text-tertiary)", fontWeight: 700, marginBottom: 10 }}>ADD LEG</p>

      {/* Segmented control */}
      <div style={{ display: "flex", border: "1px solid var(--border-primary)", borderRadius: 6, overflow: "hidden", marginBottom: 12 }}>
        {segTypes.map((seg, i) => (
          <button key={seg.key} onClick={() => { setBType(seg.key); resetBuilder(); }}
            style={{
              flex: 1, textAlign: "center", padding: "10px 0", fontFamily: FONT, fontSize: "8px", letterSpacing: "1px", fontWeight: bType === seg.key ? 500 : 400,
              background: bType === seg.key ? seg.activeBg : "transparent",
              color: bType === seg.key ? seg.activeColor : "var(--text-tertiary)",
              border: "none", borderLeft: i > 0 ? "1px solid var(--border-primary)" : "none",
              minHeight: 44, cursor: "pointer",
            }}>
            {seg.label}
          </button>
        ))}
      </div>

      {/* ── FLIGHT FORM ── */}
      {bType === "flight" && (
        <div>
          {/* Callsign lookup */}
          <div style={{ border: "1px solid var(--border-primary)", borderRadius: 6, padding: "10px 12px", background: "var(--bg-card)", marginBottom: 10 }}>
            <p style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "2px", color: "var(--accent-flight)", marginBottom: 6 }}>CALLSIGN LOOKUP</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <input type="text" value={bFN} onChange={e => { setBFN(e.target.value); setBAF(null); setBErr(null); }}
                onKeyDown={e => e.key === "Enter" && handleQuery()}
                placeholder="DL484"
                style={{ ...bInput({ flex: "1 1 120px", textTransform: "uppercase", letterSpacing: "1px", background: "var(--bg-surface)" }) }}
              />
              <input type="date" value={fDate} onChange={e => setFDate(e.target.value)}
                style={{ ...bInput({ flex: "0 0 140px", background: "var(--bg-surface)" }) }}
              />
              <button onClick={handleQuery} disabled={bLoading || !bFN.trim()}
                style={{ height: 40, padding: "0 14px", background: "var(--squawk-bg)", color: "var(--squawk-text)", borderRadius: 6, border: "none", fontFamily: FONT, fontSize: "9px", letterSpacing: "2px", fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" }}>
                {bLoading ? <Spinner /> : "QUERY"}
              </button>
            </div>
            <p style={{ fontFamily: FONT, fontSize: "8px", color: "var(--text-tertiary)", marginTop: 6 }}>Or enter details manually below</p>
            {bErr && <p style={{ fontFamily: FONT, fontSize: "8px", color: "#e84233", marginTop: 4 }}>{bErr}</p>}
            {bFlightOptions && (
              <div style={{ marginTop: 8 }}>
                <p style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "2px", color: "var(--accent-flight)", marginBottom: 6 }}>{bFlightOptions.length} FLIGHTS FOUND — SELECT ONE</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {bFlightOptions.map((opt, i) => (
                    <button key={i} onClick={() => selectFlight(opt)} className="tappable-card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 6, border: "1px solid var(--border-primary)", background: "var(--bg-surface)", cursor: "pointer", textAlign: "left" }}>
                      <div>
                        <span style={{ fontFamily: FONT, fontSize: "12px", fontWeight: 600, color: "var(--accent-flight-bright)", letterSpacing: "1px" }}>{opt.origin.code} → {opt.destination.code}</span>
                        <span style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-secondary)", marginLeft: 10 }}>{opt.carrier}</span>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <span style={{ fontFamily: FONT, fontSize: "10px", color: "var(--text-primary)" }}>{opt.origin.scheduled ? formatTime(opt.origin.scheduled_local || opt.origin.scheduled) : "—"} → {opt.destination.scheduled ? formatTime(opt.destination.scheduled_local || opt.destination.scheduled) : "—"}</span>
                        {opt.flight_date && <span style={{ fontFamily: FONT, fontSize: "8px", color: "var(--text-tertiary)", marginLeft: 8 }}>{opt.flight_date}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Manual fields */}
          <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            <div style={{ flex: 1 }}><p style={bLabel}>ORIGIN</p><input type="text" value={fOrigin} onChange={e => setFOrigin(e.target.value)} placeholder="LAX" style={{ ...bInput({ borderColor: valBorder("fOrigin"), textTransform: "uppercase" }) }} /></div>
            <div style={{ flex: 1 }}><p style={bLabel}>DESTINATION</p><input type="text" value={fDest} onChange={e => setFDest(e.target.value)} placeholder="PVR" style={{ ...bInput({ borderColor: valBorder("fDest"), textTransform: "uppercase" }) }} /></div>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            <div style={{ flex: 1 }}><p style={bLabel}>DEPART</p><input type="time" value={fDepart} onChange={e => setFDepart(e.target.value)} style={bInput()} /></div>
            <div style={{ flex: 1 }}><p style={bLabel}>ARRIVE</p><input type="time" value={fArrive} onChange={e => setFArrive(e.target.value)} style={bInput()} /></div>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            <div style={{ flex: 1 }}><p style={bLabel}>CARRIER</p><input type="text" value={fCarrier} onChange={e => setFCarrier(e.target.value)} placeholder="Delta" style={bInput()} /></div>
            <div style={{ flex: 1 }}><p style={bLabel}>FLIGHT NO.</p><input type="text" value={fFlightNo} onChange={e => setFFlightNo(e.target.value)} placeholder="DL484" style={{ ...bInput({ textTransform: "uppercase" }) }} /></div>
          </div>
          <div style={{ marginBottom: 6 }}><p style={bLabel}>DATE</p><DatePicker value={fDate} onChange={setFDate} /></div>
        </div>
      )}

      {/* ── GROUND STOP FORM ── */}
      {bType === "hotel" && (
        <div>
          <div style={{ marginBottom: 6 }}>
            <p style={bLabel}>HOTEL / ACCOMMODATION</p>
            <PlaceAutocomplete value={hName} onChange={setHName}
              onSelect={(p) => { setHPlace(p); if (p.city) setHLocation(p.city); }}
              placeholder="Search hotel or address..." types="lodging"
            />
            {hPlace?.address && <p style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-tertiary)", marginTop: 4 }}>{hPlace.address}</p>}
            {hPlace?.lat && <div style={{ marginTop: 8 }}><MiniMap lat={hPlace.lat} lng={hPlace.lng} zoom={15} height={120} label={hPlace.name || hName} /></div>}
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            <div style={{ flex: 1 }}><p style={bLabel}>CHECK IN</p><DatePicker value={hCheckIn} onChange={setHCheckIn} /></div>
            <div style={{ flex: 1 }}><p style={bLabel}>CHECK OUT</p><DatePicker value={hCheckOut} onChange={setHCheckOut} /></div>
          </div>
          {hCheckIn && hCheckOut && new Date(hCheckOut) > new Date(hCheckIn) && (
            <p style={{ fontFamily: FONT, fontSize: "8px", color: "var(--accent-hotel)", marginBottom: 6 }}>
              {Math.round((new Date(hCheckOut) - new Date(hCheckIn)) / 86400000)} NIGHTS
            </p>
          )}
          <div style={{ marginBottom: 6 }}>
            <p style={bLabel}>LOCATION</p>
            <input type="text" value={hLocation} onChange={e => setHLocation(e.target.value)} placeholder="City, Country" style={bInput()} />
          </div>
        </div>
      )}

      {/* ── TRAIN FORM ── */}
      {bType === "train" && (
        <div>
          {!tManualMode ? (
            <>
              <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                <div style={{ flex: 1 }}>
                  <p style={bLabel}>OPERATOR</p>
                  <select value={tLookupOperator} onChange={e => { setTLookupOperator(e.target.value); setTLookupResult(null); setTLookupError(null); setTLookupOptions(null); }} style={{ ...bInput(), cursor: "pointer" }}>
                    {TRAIN_OPERATORS.map(op => <option key={op.id} value={op.id}>{op.name} ({op.country})</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <p style={bLabel}>TRAIN NO.</p>
                  <input type="text" value={tLookupNumber} onChange={e => { setTLookupNumber(e.target.value); setTLookupResult(null); setTLookupError(null); }} onKeyDown={e => e.key === "Enter" && handleTrainQuery()} placeholder={TRAIN_OPERATORS.find(o => o.id === tLookupOperator)?.placeholder || "123"} style={{ ...bInput(), textTransform: "uppercase", letterSpacing: "1px" }} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                <div style={{ flex: 1 }}><p style={bLabel}>DATE</p><DatePicker value={tDate} onChange={setTDate} /></div>
                <div style={{ display: "flex", alignItems: "flex-end" }}>
                  <button onClick={handleTrainQuery} disabled={tLookupLoading || !tLookupNumber.trim()} style={{ padding: "9px 16px", borderRadius: 6, border: "1px solid var(--border-primary)", background: "var(--bg-surface)", color: tLookupNumber.trim() ? "var(--strip-train)" : "var(--text-tertiary)", fontFamily: FONT, fontSize: "9px", fontWeight: 700, letterSpacing: "2px", cursor: "pointer" }}>{tLookupLoading ? "..." : "QUERY"}</button>
                </div>
              </div>
              {tLookupError && <p style={{ fontFamily: FONT, fontSize: "9px", color: "var(--strip-train)", marginBottom: 6, fontWeight: 700 }}>{tLookupError}</p>}
              {tLookupOptions && (
                <div style={{ marginBottom: 6 }}>
                  <p style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "2px", color: "var(--strip-train)", marginBottom: 6 }}>{tLookupOptions.length} TRAINS FOUND — SELECT ONE</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {tLookupOptions.map((opt, i) => (
                      <button key={i} onClick={() => selectTrain(opt)} className="tappable-card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderRadius: 4, border: "1px solid var(--border-primary)", background: "var(--bg-surface)", cursor: "pointer", textAlign: "left" }}>
                        <span style={{ fontFamily: FONT, fontSize: "11px", fontWeight: 600, color: "var(--strip-train)" }}>{opt.origin.name?.split(" ")[0] || "?"} → {opt.destination.name?.split(" ")[0] || "?"}</span>
                        <span style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-secondary)" }}>{opt.route_name || opt.train_number}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {tLookupResult && (
                <div style={{ border: "1px solid var(--strip-train)", borderRadius: 6, padding: 10, marginBottom: 6, background: "var(--bg-surface)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--strip-train)", display: "inline-block" }} />
                    <span style={{ fontFamily: FONT, fontSize: "9px", fontWeight: 700, color: "var(--strip-train)", letterSpacing: "1px" }}>MATCH</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 16px" }}>
                    {[["ROUTE", `${tLookupResult.origin.name?.split(",")[0] || "?"} → ${tLookupResult.destination.name?.split(",")[0] || "?"}`], ["TRAIN", tLookupResult.route_name || tLookupResult.train_number], ["DEP", tLookupResult.origin.scheduled_departure ? formatTime(tLookupResult.origin.scheduled_departure) : "—"], ["ARR", tLookupResult.destination.scheduled_arrival ? formatTime(tLookupResult.destination.scheduled_arrival) : "—"]].map(([l, v]) => (
                      <div key={l} style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                        <span style={{ fontFamily: FONT, fontSize: "8px", color: "var(--text-secondary)", minWidth: 36 }}>{l}</span>
                        <span style={{ fontFamily: FONT, fontSize: "10px", color: "var(--text-primary)" }}>{v}</span>
                      </div>
                    ))}
                  </div>
                  {tLookupResult.origin.platform && <div style={{ marginTop: 4 }}><span style={{ fontFamily: FONT, fontSize: "8px", color: "var(--text-tertiary)" }}>PLATFORM {tLookupResult.origin.platform}</span></div>}
                </div>
              )}
              <button onClick={() => setTManualMode(true)} style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "1px", color: "var(--text-tertiary)", background: "none", border: "none", cursor: "pointer", padding: "4px 0", textDecoration: "underline" }}>ENTER MANUALLY</button>
            </>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                <div style={{ flex: 1 }}><p style={bLabel}>ORIGIN</p><PlaceAutocomplete value={tOrigin} onChange={setTOrigin} onSelect={p => setTOPlace(p)} placeholder="Penn Station, NYC" types="transit_station|train_station|locality" /></div>
                <div style={{ flex: 1 }}><p style={bLabel}>DESTINATION</p><PlaceAutocomplete value={tDest} onChange={setTDest} onSelect={p => setTDPlace(p)} placeholder="Union Station, DC" types="transit_station|train_station|locality" /></div>
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                <div style={{ flex: 1 }}><p style={bLabel}>DEPART</p><input type="time" value={tDepart} onChange={e => setTDepart(e.target.value)} style={bInput()} /></div>
                <div style={{ flex: 1 }}><p style={bLabel}>ARRIVE</p><input type="time" value={tArrive} onChange={e => setTArrive(e.target.value)} style={bInput()} /></div>
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                <div style={{ flex: 1 }}><p style={bLabel}>OPERATOR</p><input type="text" value={tOperator} onChange={e => setTOperator(e.target.value)} placeholder="Amtrak, SNCF..." style={bInput()} /></div>
                <div style={{ flex: 1 }}><p style={bLabel}>TRAIN NO.</p><input type="text" value={tNumber} onChange={e => setTNumber(e.target.value)} placeholder="NE Regional 171" style={bInput()} /></div>
              </div>
              <div style={{ marginBottom: 6 }}><p style={bLabel}>DATE</p><DatePicker value={tDate} onChange={setTDate} /></div>
              <button onClick={() => setTManualMode(false)} style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "1px", color: "var(--text-tertiary)", background: "none", border: "none", cursor: "pointer", padding: "4px 0", textDecoration: "underline" }}>LOOK UP TRAIN</button>
            </>
          )}
        </div>
      )}

      {/* ── BUS FORM ── */}
      {bType === "bus" && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            <div style={{ flex: 1 }}><p style={bLabel}>ORIGIN</p><PlaceAutocomplete value={tOrigin} onChange={setTOrigin} onSelect={p => setTOPlace(p)} placeholder="Port Authority, NYC" types="transit_station|bus_station|locality" /></div>
            <div style={{ flex: 1 }}><p style={bLabel}>DESTINATION</p><PlaceAutocomplete value={tDest} onChange={setTDest} onSelect={p => setTDPlace(p)} placeholder="South Station, Boston" types="transit_station|bus_station|locality" /></div>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            <div style={{ flex: 1 }}><p style={bLabel}>DEPART</p><input type="time" value={tDepart} onChange={e => setTDepart(e.target.value)} style={bInput()} /></div>
            <div style={{ flex: 1 }}><p style={bLabel}>ARRIVE</p><input type="time" value={tArrive} onChange={e => setTArrive(e.target.value)} style={bInput()} /></div>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            <div style={{ flex: 1 }}><p style={bLabel}>OPERATOR</p><input type="text" value={tOperator} onChange={e => setTOperator(e.target.value)} placeholder="FlixBus, Greyhound..." style={bInput()} /></div>
            <div style={{ flex: 1 }}><p style={bLabel}>BUS NO.</p><input type="text" value={tNumber} onChange={e => setTNumber(e.target.value)} placeholder="Route 42" style={bInput()} /></div>
          </div>
          <div style={{ marginBottom: 6 }}><p style={bLabel}>DATE</p><DatePicker value={tDate} onChange={setTDate} /></div>
        </div>
      )}

      {/* + ADD TO PLAN button */}
      <button onClick={handleAddLeg}
        style={{ width: "100%", height: 44, border: "1px solid var(--border-primary)", borderRadius: 8, background: "var(--nav-bg)", color: addLegFeedback ? "var(--accent-flight)" : "var(--accent-flight-bright)", fontFamily: FONT, fontSize: "10px", letterSpacing: "2px", fontWeight: 500, cursor: "pointer", margin: "12px 0" }}>
        {addLegFeedback ? "ADDED" : "+ ADD TO PLAN"}
      </button>

      {/* ── Divider ── */}
      <div style={{ borderTop: "1px solid var(--border-subtle)", margin: "12px 0" }} />

      {/* ── FILE FLIGHT PLAN ── */}
      <button onClick={handleFile} disabled={!tripTitle.trim() || submitting}
        style={{
          width: "100%", height: 52, borderRadius: 10, fontFamily: FONT, fontSize: "11px", letterSpacing: "3px", fontWeight: 500, cursor: tripTitle.trim() ? "pointer" : "default",
          background: tripTitle.trim() ? "var(--squawk-bg)" : "var(--bg-surface)",
          color: tripTitle.trim() ? "var(--squawk-text)" : "var(--text-tertiary)",
          border: tripTitle.trim() ? "none" : "1px solid var(--border-subtle)",
        }}>
        {fileFeedback ? "FILED" : submitting ? <span className="flex items-center justify-center gap-2"><Spinner /> FILING...</span> : "FILE FLIGHT PLAN"}
      </button>
      <p style={{ fontFamily: FONT, fontSize: "8px", color: "var(--text-tertiary)", textAlign: "center", marginTop: 8 }}>Saves trip and opens detail view</p>
      {fileError && <p style={{ fontFamily: FONT, fontSize: "9px", color: "#e84233", textAlign: "center", marginTop: 8 }}>{fileError}</p>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SHARED VIEW
// ═══════════════════════════════════════════════════════════════════

function SharedPage({ tripId }) {
  const { navigate } = useRouter();
  const { mode } = useTheme();
  const isDesktop = useIsDesktop();
  const [trip, setTrip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeLeg, setActiveLeg] = useState(0);
  const [mapView, setMapView] = useState("radar");

  useEffect(() => { setLoading(true); api(`/trips/${tripId}`).then(t => setTrip(mapTrip(t))).catch(() => setTrip(null)).finally(() => setLoading(false)); }, [tripId]);
  useEffect(() => { if (trip) { const li = trip.legs?.findIndex(l => isLegLive(l)); setActiveLeg(li >= 0 ? li : 0); } }, [trip?.id]);

  if (loading) return <LoadingScreen />;
  if (!trip) return <div className="text-center py-12"><p style={{ fontFamily: FONT, fontSize: "10px", color: "var(--text-secondary)" }}>Trip not found</p></div>;

  const presence = computePresence(trip);
  const travelerName = trip.traveler?.name || "Traveler";
  const totalLegs = (trip.legs || []).length;
  const tripDays = trip.start_date && trip.end_date ? Math.max(1, Math.round((new Date(trip.end_date) - new Date(trip.start_date)) / 86400000)) : null;

  // Signal status config
  const signalCfg = {
    pre: { badge: "SCHEDULED", badgeColor: "var(--accent-countdown)", borderColor: "var(--accent-countdown)" },
    transit: { badge: "EN ROUTE", badgeColor: "var(--accent-flight-bright)", borderColor: "var(--accent-flight)" },
    dwelling: { badge: "ON GROUND", badgeColor: "var(--accent-hotel)", borderColor: "var(--accent-hotel)" },
    post: { badge: "COMPLETE", badgeColor: "var(--accent-countdown)", borderColor: "var(--accent-countdown)" },
  };
  const signal = signalCfg[presence.mode] || signalCfg.post;

  // Narrative for shared view (privacy-respecting)
  const getSharedNarrative = () => {
    if (presence.mode === "transit") {
      const liveLeg = trip.legs?.find(l => isLegLive(l));
      if (liveLeg) {
        const arrTime = formatTime(liveLeg.metadata?.arrive_local || liveLeg.arrive_time);
        return { main: `Currently airborne. ${liveLeg.origin?.code || liveLeg.origin?.city} \u2192 ${liveLeg.destination?.code || liveLeg.destination?.city} \u00B7 ${liveLeg.carrier} ${liveLeg.vehicle_number || ""}`.trim(), sub: `Lands at ${arrTime} local.` };
      }
      return { main: presence.narrative, sub: "" };
    }
    if (presence.mode === "dwelling") {
      const hotelLeg = trip.legs?.find(l => l.type === "hotel" && new Date(l.depart_time).getTime() <= Date.now() && new Date(l.arrive_time).getTime() >= Date.now());
      const city = hotelLeg?.origin?.city || "destination";
      return { main: `Traveler is in the ${city} area.`, sub: "" };
    }
    if (presence.mode === "pre") {
      const first = trip.legs?.[0];
      const d = first ? Math.ceil((new Date(first.depart_time).getTime() - Date.now()) / 86400000) : 0;
      const fromCity = first?.origin?.code || first?.origin?.city || "";
      return { main: `Traveler departs ${d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`}${fromCity ? ` from ${fromCity}` : ""}.`, sub: "" };
    }
    return { main: "Traveler has returned home. Flight plan archived.", sub: "" };
  };
  const narrative = getSharedNarrative();

  // Inline route for shared view — codes only, no durations
  const sharedRouteItems = (() => {
    const items = [];
    let lastCode = null;
    for (const leg of (trip.legs || [])) {
      if (leg.type === "hotel") { if (items.length > 0 && items[items.length - 1].t === "c") items.push({ t: "h" }); continue; }
      const oc = leg.origin?.code || leg.origin?.city?.slice(0, 3)?.toUpperCase() || "?";
      const dc = leg.destination?.code || leg.destination?.city?.slice(0, 3)?.toUpperCase() || "?";
      if (oc !== lastCode) { if (items.length > 0 && items[items.length - 1].t !== "h") items.push({ t: "f" }); items.push({ t: "c", code: oc }); }
      items.push({ t: "f" });
      items.push({ t: "c", code: dc });
      lastCode = dc;
    }
    return items;
  })();

  const sharedNavBar = (
    <div className="flex items-center justify-between px-4 py-2">
      <button onClick={() => navigate("dashboard")} style={{ width: 44, height: 44, border: "1px solid var(--nav-border)", borderRadius: 8, background: "var(--nav-bg)", color: "var(--nav-text-active)", fontFamily: FONT, fontSize: "16px", display: "flex", alignItems: "center", justifyContent: "center" }}>{"\u2190"}</button>
      <span style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "3px", color: "var(--text-tertiary)" }}>TRACKING</span>
      <div style={{ width: 44 }} />
    </div>
  );

  const sharedTravelerIdentity = (
    <div style={{ padding: "14px 16px 8px", display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ width: 32, height: 32, borderRadius: "50%", border: "1px solid var(--border-primary)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, fontSize: "13px", fontWeight: 600, color: "var(--nav-text)", flexShrink: 0 }}>{travelerName.charAt(0).toUpperCase()}</div>
      <div>
        <p style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "2px", color: "var(--text-tertiary)" }}>TRAVELER'S FLIGHT PLAN</p>
        <p style={{ fontFamily: FONT, fontSize: "16px", fontWeight: 600, color: "var(--text-heading)" }}>{trip.title}</p>
      </div>
    </div>
  );

  const sharedSignalCard = (
    <div style={{ margin: "4px 16px 10px", border: `1px solid ${signal.borderColor}`, borderRadius: 6, padding: 12, background: "var(--bg-card)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "2px", color: "var(--accent-flight)" }}>SIGNAL STATUS</span>
        <span style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "1px", padding: "2px 8px", borderRadius: 3, color: signal.badgeColor, border: `1px solid ${signal.borderColor}`, background: "var(--bg-card)" }}>{signal.badge}</span>
      </div>
      <p style={{ fontFamily: FONT, fontSize: "13px", color: "var(--text-heading)", lineHeight: 1.4 }}>{narrative.main}</p>
      {narrative.sub && <p style={{ fontFamily: FONT, fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.4 }}>{narrative.sub}</p>}
      {presence.progress != null && (
        <div className="flex items-center gap-3 mt-3">
          <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: "var(--border-primary)" }}>
            <div className="h-full rounded-full" style={{ width: `${presence.progress * 100}%`, background: "var(--accent-flight)" }} />
          </div>
          <span style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-secondary)", fontWeight: 700 }}>{Math.round(presence.progress * 100)}%</span>
        </div>
      )}
    </div>
  );

  const sharedMapToggle = (
    <div style={{ display: "flex", justifyContent: "flex-end", padding: isDesktop ? "8px 12px" : "0 16px 4px", position: isDesktop ? "absolute" : undefined, top: isDesktop ? 12 : undefined, right: isDesktop ? 12 : undefined, zIndex: isDesktop ? 5 : undefined }}>
      <div style={{ display: "inline-flex", border: "1px solid var(--border-primary)", borderRadius: 6, overflow: "hidden" }}>
        {[{ key: "radar", label: "RADAR" }, { key: "satellite", label: "SATELLITE" }].map(v => (
          <button key={v.key} onClick={() => setMapView(v.key)}
            style={{ padding: "6px 12px", fontFamily: FONT, fontSize: "8px", letterSpacing: "1.5px", fontWeight: mapView === v.key ? 500 : 400,
              background: mapView === v.key ? "var(--accent-flight)" : "transparent",
              color: mapView === v.key ? "var(--bg-primary)" : "var(--text-tertiary)",
              border: "none", cursor: "pointer", minHeight: 32 }}>
            {v.label}
          </button>
        ))}
      </div>
    </div>
  );

  const sharedMapSection = (
    <div style={{ height: isDesktop ? "100%" : 220, margin: isDesktop ? 0 : "0 16px", borderRadius: isDesktop ? 0 : 8, overflow: "hidden", border: isDesktop ? "none" : "1px solid var(--border-primary)" }}>
      {mapView === "satellite" ? (
        <SatelliteMap trip={trip} height={isDesktop ? "100%" : 220} />
      ) : (
        <TripMap trip={trip} activeLegIndex={activeLeg} mode={mode} isSharedView liveTrackData={null} mapTick={0} />
      )}
    </div>
  );

  const sharedRouteBar = sharedRouteItems.length > 0 ? (
    <div style={{ padding: "0 16px 10px" }}>
      <div className="flex items-center gap-0.5 overflow-x-auto" style={{ paddingBottom: 2 }}>
        {sharedRouteItems.map((it, i) => it.t === "c"
          ? <span key={i} style={{ fontFamily: FONT, fontSize: "14px", fontWeight: 700, color: "var(--accent-flight-bright)", letterSpacing: "1px", flexShrink: 0 }}>{it.code}</span>
          : it.t === "f"
            ? <span key={i} style={{ width: 16, height: 0, borderTop: "1px solid var(--border-primary)", display: "inline-block", flexShrink: 0 }} />
            : <span key={i} style={{ width: 12, height: 0, borderTop: "1px dashed var(--accent-hotel)", opacity: 0.5, display: "inline-block", flexShrink: 0 }} />
        )}
      </div>
    </div>
  ) : null;

  const sharedItinerary = (
    <div style={{ padding: "0 16px 16px" }}>
      <p style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "3px", color: "var(--text-secondary)", fontWeight: 700, marginBottom: 10 }}>ITINERARY</p>
      {trip.legs?.map((leg, i) => {
        const isHotel = leg.type === "hotel";
        const isLive = isLegLive(leg);
        const stripColors = { flight: "var(--strip-flight)", hotel: "var(--strip-hotel)", train: "var(--strip-train)", bus: "var(--strip-bus)" };
        const stripColor = stripColors[leg.type] || "var(--strip-flight)";
        const cardBg = isHotel ? "var(--bg-card-hotel)" : "var(--bg-card)";
        const cardBorder = isHotel ? "var(--border-hotel)" : "var(--border-primary)";
        const nights = isHotel ? calcNights(leg) : 0;
        const city = leg.origin?.city || "Unknown";
        return (
          <div key={leg.id} className="flex">
            <div className="flex flex-col items-center" style={{ width: 28 }}>
              <div style={{ width: isHotel ? 8 : 10, height: isHotel ? 8 : 10, borderRadius: "50%", border: `2px solid ${isHotel ? "var(--strip-hotel)" : "var(--timeline-dot-border)"}`, background: "var(--timeline-dot-bg)", flexShrink: 0 }} />
              {i < trip.legs.length - 1 && <div style={{ width: 1.5, flex: 1, background: "var(--timeline-rail)", minHeight: 20 }} />}
            </div>
            <div className="flex-1 mb-2 ml-2" style={{ borderLeft: `3px solid ${stripColor}`, borderRadius: 4, padding: 12, background: cardBg, border: `1px solid ${cardBorder}`, borderLeftWidth: 3, borderLeftColor: stripColor, borderLeftStyle: "solid" }}>
              {isHotel ? (
                <>
                  <div className="flex items-center justify-between mb-1">
                    <span style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "2px", color: "var(--accent-hotel)", fontWeight: 700 }}>GROUND STOP</span>
                    <span style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-secondary)" }}>{formatDate(leg.depart_time)}{leg.arrive_time ? ` \u2013 ${formatDate(leg.arrive_time)}` : ""}</span>
                  </div>
                  <p style={{ fontFamily: FONT, fontSize: "12px", color: "var(--accent-hotel-dim)", fontStyle: "italic", marginBottom: 4 }}>Accommodation details private</p>
                  <p style={{ fontFamily: FONT, fontSize: "8px", color: "var(--accent-hotel-dim)" }}>
                    {nights ? `${nights} NIGHTS` : ""}{nights && city ? " \u00B7 " : ""}{city ? `${city.toUpperCase()} AREA` : ""}
                  </p>
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
                  {leg.type === "train" ? (
                    <>
                      <div className="flex items-center justify-between mb-1">
                        <span style={{ fontFamily: FONT, fontSize: "16px", fontWeight: 700, color: "var(--text-heading)", letterSpacing: "1px", maxWidth: "40%", lineHeight: 1.2 }}>{leg.origin?.city || leg.origin?.code || "?"}</span>
                        <div className="flex flex-col items-center flex-1 mx-3">
                          <div style={{ width: "100%", height: 0, borderTop: "1px solid var(--border-subtle)" }} />
                        </div>
                        <span style={{ fontFamily: FONT, fontSize: "16px", fontWeight: 700, color: "var(--text-heading)", letterSpacing: "1px", maxWidth: "40%", lineHeight: 1.2, textAlign: "right" }}>{leg.destination?.city || leg.destination?.code || "?"}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span style={{ fontFamily: FONT, fontSize: "10px", color: "var(--text-secondary)" }}>{legDepartTime(leg)}</span>
                        <span style={{ fontFamily: FONT, fontSize: "10px", color: "var(--text-secondary)" }}>{legArriveTime(leg)}</span>
                      </div>
                      <div className="pt-2 mt-2" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                        <span style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-tertiary)" }}>{[leg.carrier, legDepartTime(leg) + " \u2192 " + legArriveTime(leg)].filter(Boolean).join(" \u00B7 ")}</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-2">
                        <span style={{ fontFamily: FONT, fontSize: "24px", fontWeight: 700, color: "var(--text-heading)", letterSpacing: "2px" }}>{leg.origin?.code || leg.origin?.city?.slice(0, 3)?.toUpperCase() || "?"}</span>
                        <div className="flex flex-col items-center flex-1 mx-3">
                          <div style={{ width: "100%", height: 0, borderTop: "1px solid var(--border-subtle)" }} />
                        </div>
                        <span style={{ fontFamily: FONT, fontSize: "24px", fontWeight: 700, color: "var(--text-heading)", letterSpacing: "2px" }}>{leg.destination?.code || leg.destination?.city?.slice(0, 3)?.toUpperCase() || "?"}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span style={{ fontFamily: FONT, fontSize: "10px", color: "var(--text-secondary)" }}>{legDepartTime(leg)}</span>
                        <span style={{ fontFamily: FONT, fontSize: "10px", color: "var(--text-secondary)" }}>{legArriveTime(leg)}</span>
                      </div>
                      <div className="pt-2 mt-2" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                        <span style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-tertiary)" }}>{[leg.carrier, legDepartTime(leg) + " \u2192 " + legArriveTime(leg)].filter(Boolean).join(" \u00B7 ")}</span>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  const sharedStats = (
    <div style={{ padding: "16px", borderTop: "1px solid var(--border-subtle)" }}>
      <div style={{ display: "flex", justifyContent: "center", gap: 40 }}>
        <div style={{ textAlign: "center" }}>
          <p style={{ fontFamily: FONT, fontSize: "18px", fontWeight: 700, color: "var(--stats-value)" }}>{totalLegs}</p>
          <p style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "2px", color: "var(--stats-label)" }}>SEGMENTS</p>
        </div>
        {tripDays && (
          <div style={{ textAlign: "center" }}>
            <p style={{ fontFamily: FONT, fontSize: "18px", fontWeight: 700, color: "var(--stats-value)" }}>{tripDays}</p>
            <p style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "2px", color: "var(--stats-label)" }}>DURATION</p>
          </div>
        )}
      </div>
      <p className="text-center mt-4" style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "3px", color: "var(--text-tertiary)" }}>TRANSPONDER</p>
    </div>
  );

  const sharedDateRange = (
    <div style={{ padding: "10px 16px" }}>
      <p style={{ fontFamily: FONT, fontSize: "9px", color: "var(--text-secondary)", letterSpacing: "0.5px" }}>{formatDateRange(trip.start_date, trip.end_date)}</p>
    </div>
  );

  return (
    <div style={{ height: isDesktop ? "100vh" : undefined, overflow: isDesktop ? "hidden" : undefined, display: isDesktop ? "flex" : undefined, flexDirection: isDesktop ? "column" : undefined, background: "var(--bg-primary)" }} className={isDesktop ? "" : "min-h-[calc(100vh-48px)] sm:min-h-[calc(100vh-53px)]"}>
      {sharedNavBar}
      {isDesktop ? (
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          <div style={{ flex: 1, position: "relative", overflow: "hidden", minWidth: 400 }}>
            {sharedMapSection}
            {sharedMapToggle}
          </div>
          <div style={{ width: 480, minWidth: 420, flexShrink: 0, borderLeft: "1px solid var(--border-primary)", overflowY: "auto" }}>
            <div style={{ position: "sticky", top: 0, background: "var(--bg-primary)", zIndex: 5, borderBottom: "1px solid var(--border-primary)" }}>
              {sharedTravelerIdentity}
              {sharedSignalCard}
            </div>
            {sharedDateRange}
            {sharedRouteBar}
            {sharedItinerary}
            {sharedStats}
          </div>
        </div>
      ) : (
        <>
          {sharedTravelerIdentity}
          {sharedSignalCard}
          {sharedMapToggle}
          {sharedMapSection}
          {sharedDateRange}
          {sharedRouteBar}
          {sharedItinerary}
          {sharedStats}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// NAV RIGHT (avatar + theme toggle)
// ═══════════════════════════════════════════════════════════════════

function ThemeToggle() {
  const { mode, pref, setPref } = useTheme();
  const options = [
    { key: "day", icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
      </svg>
    )},
    { key: "auto", icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><path d="M12 2a7 7 0 0 0 0 20 10 10 0 0 1 0-20"/>
      </svg>
    )},
    { key: "night", icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
      </svg>
    )},
  ];
  return (
    <div style={{ display: "flex", borderRadius: 8, border: "1px solid var(--border-primary)", background: "var(--bg-surface)", overflow: "hidden" }}>
      {options.map(opt => (
        <button key={opt.key} onClick={() => setPref(opt.key)}
          title={opt.key.charAt(0).toUpperCase() + opt.key.slice(1)}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 32, height: 32, border: "none", cursor: "pointer",
            background: pref === opt.key ? "var(--accent-flight)" : "transparent",
            color: pref === opt.key ? "var(--bg-primary)" : "var(--text-tertiary)",
            transition: "all 0.2s ease",
          }}>
          {opt.icon}
        </button>
      ))}
    </div>
  );
}

function NavRight({ user, signOut }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref} style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <ThemeToggle />
      <button onClick={() => setOpen(o => !o)} className="flex items-center justify-center" style={{ width: 36, height: 36, borderRadius: "50%", border: "1px solid var(--nav-border)", background: "var(--nav-bg)", color: "var(--accent-flight-bright)", fontFamily: FONT, fontSize: "12px", fontWeight: 600 }} title="Settings">
        {(user.user_metadata?.name || user.email || "U").charAt(0).toUpperCase()}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 rounded-lg overflow-hidden z-50" style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", minWidth: "140px" }}>
          <button onClick={() => { signOut(); setOpen(false); }} className="w-full text-left px-3 py-2.5 text-xs font-bold tracking-widest" style={{ color: "var(--text-secondary)", fontFamily: FONT, fontSize: "9px", letterSpacing: "1.5px", minHeight: "44px", display: "flex", alignItems: "center" }}>SIGN OUT</button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// APP SHELL
// ═══════════════════════════════════════════════════════════════════

function TransponderApp() {
  const { user, loading: authLoading, signIn, signOut } = useAuth();
  const [route, setRoute] = useState({ page: "dashboard", params: {} });
  const [loaded, setLoaded] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => { setTimeout(() => setLoaded(true), 50); }, []);
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  const navigate = (page, params = {}) => { setRoute({ page, params }); setLoaded(false); setTimeout(() => setLoaded(true), 50); };

  if (authLoading) return <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-primary)" }}><Spinner /></div>;
  if (!user) return <LandingPage onSignIn={signIn} />;
  if (PRE_LAUNCH && !PRE_LAUNCH_BYPASS.includes(user.email)) return <PreLaunchConfirmation onSignOut={signOut} />;

  const isFullWidth = route.page === "detail" || route.page === "dashboard" || route.page === "shared";
  return (
    <RouterContext.Provider value={{ route, navigate }}>
      <div className="min-h-screen" style={{ background: "var(--bg-primary)", fontFamily: FONT }}>
        {offline && (
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 50, padding: "8px 16px", textAlign: "center", background: "rgba(var(--accent-countdown-rgb, 200,160,60), 0.15)", borderBottom: "1px solid rgba(200,160,60,0.3)", transition: "opacity 0.5s ease" }}>
            <span style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "2px", color: "var(--accent-countdown)" }}>NO SIGNAL {"\u2014"} CHECK CONNECTION</span>
          </div>
        )}
        <div className="sticky top-0 z-40 flex items-center justify-between px-4 sm:px-6 h-[48px] sm:h-[53px]" style={{ borderBottom: "1px solid var(--nav-border)", background: "var(--nav-bg)", backdropFilter: "blur(12px)", marginTop: offline ? 34 : 0 }}>
          <button onClick={() => navigate("dashboard")} style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "3px", color: "var(--text-tertiary)", fontWeight: 700 }}>TRANSPONDER</button>
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
  return <ThemeProvider><AuthProvider><TransponderApp /></AuthProvider></ThemeProvider>;
}
