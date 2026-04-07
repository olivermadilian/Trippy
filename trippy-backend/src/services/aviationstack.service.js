const axios = require('axios');

// AviationStack free tier only supports HTTP; paid plans support HTTPS
const AVSTACK_BASE = process.env.AVIATIONSTACK_HTTPS === 'true'
  ? 'https://api.aviationstack.com/v1'
  : 'http://api.aviationstack.com/v1';

/**
 * Convert a local time string + IANA timezone to a UTC ISO string.
 * e.g. ("2026-04-10T09:30:00", "America/New_York") → "2026-04-10T13:30:00.000Z"
 *
 * If the string already carries timezone info (Z, +HH:MM, -HH:MM) — which
 * happens on AviationStack's free tier — parse it directly without conversion.
 */
function localToUTC(localTimeStr, timezone) {
  if (!localTimeStr) return null;

  // If the string already has explicit timezone info, parse it as-is.
  if (/Z$|[+-]\d{2}:\d{2}$/.test(localTimeStr)) {
    try {
      const d = new Date(localTimeStr);
      return isNaN(d.getTime()) ? localTimeStr : d.toISOString();
    } catch { return localTimeStr; }
  }

  // Bare local datetime — needs timezone conversion.
  if (!timezone) return localTimeStr;
  try {
    // Treat the local string as UTC to establish a reference point,
    // then compute the actual offset to find the real UTC equivalent.
    const asUTC = new Date(localTimeStr + 'Z');
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).formatToParts(asUTC);
    const p = (type) => parts.find(x => x.type === type)?.value;
    const hour = p('hour') === '24' ? '00' : p('hour'); // guard midnight edge case
    const tzStr = `${p('year')}-${p('month')}-${p('day')}T${hour}:${p('minute')}:${p('second')}Z`;
    const asTZ = new Date(tzStr);
    const offsetMs = asTZ - asUTC;
    return new Date(asUTC.getTime() - offsetMs).toISOString();
  } catch {
    return localTimeStr;
  }
}

/** Shared dedup helper — filters in-place by route+time key */
function dedup(flights) {
  const seen = new Set();
  return flights.filter(f => {
    const k = `${f.origin.code}-${f.destination.code}-${f.origin.scheduled || f.origin.scheduled_local}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Map a /v1/flights response item to the shared flight shape.
 * Field names: departure.iata, departure.scheduled, flight.iata, airline.iata …
 */
function mapCurrentFlight(f, clean) {
  const dep = f.departure || {};
  const arr = f.arrival || {};
  const depScheduledLocal = dep.scheduled || null;
  const arrScheduledLocal = arr.scheduled || null;
  return {
    fr24_id: null,
    callsign: f.flight?.iata || clean,
    carrier: f.airline?.name || null,
    carrier_code: f.airline?.iata || clean.replace(/\d+/g, ''),
    flight_ended: f.flight_status === 'landed',
    origin: {
      code: dep.iata || null,
      icao: dep.icao || null,
      airport: dep.airport || null,
      city: null,
      lat: null,
      lng: null,
      scheduled: localToUTC(depScheduledLocal, dep.timezone),
      scheduled_local: depScheduledLocal,
      terminal: dep.terminal || null,
      gate: dep.gate || null,
    },
    destination: {
      code: arr.iata || null,
      icao: arr.icao || null,
      airport: arr.airport || null,
      city: null,
      lat: null,
      lng: null,
      scheduled: localToUTC(arrScheduledLocal, arr.timezone),
      scheduled_local: arrScheduledLocal,
      terminal: arr.terminal || null,
      gate: arr.gate || null,
    },
    aircraft: null,
    aircraft_type: null,
    status: f.flight_status || 'scheduled',
    flight_date: f.flight_date || (depScheduledLocal ? depScheduledLocal.split('T')[0] : null),
    flight_time: null,
    actual_distance_km: null,
    circle_distance_km: null,
    category: null,
    source: 'aviationstack',
  };
}

/**
 * Map a /v1/flightsFuture response item to the shared flight shape.
 * Field names differ: departure.iataCode, departure.scheduledTime, flight.iataNumber …
 * No timezone is provided, so scheduled_local holds the raw local time string.
 */
function mapFutureFlight(f, clean, date) {
  const dep = f.departure || {};
  const arr = f.arrival || {};
  const depLocal = dep.scheduledTime || null;
  const arrLocal = arr.scheduledTime || null;
  return {
    fr24_id: null,
    callsign: f.flight?.iataNumber || clean,
    carrier: f.airline?.name || null,
    carrier_code: f.airline?.iataCode || clean.replace(/\d+/g, ''),
    flight_ended: false,
    origin: {
      code: dep.iataCode || null,
      icao: dep.icaoCode || null,
      airport: null,
      city: null,
      lat: null,
      lng: null,
      scheduled: null,        // no timezone info → can't derive UTC
      scheduled_local: depLocal,
      terminal: dep.terminal || null,
      gate: dep.gate || null,
    },
    destination: {
      code: arr.iataCode || null,
      icao: arr.icaoCode || null,
      airport: null,
      city: null,
      lat: null,
      lng: null,
      scheduled: null,
      scheduled_local: arrLocal,
      terminal: arr.terminal || null,
      gate: arr.gate || null,
    },
    aircraft: null,
    aircraft_type: null,
    status: f.status || 'scheduled',
    flight_date: date || (depLocal ? depLocal.split('T')[0] : null),
    flight_time: null,
    actual_distance_km: null,
    circle_distance_km: null,
    category: null,
    source: 'aviationstack',
  };
}

/**
 * Look up flights by callsign using AviationStack.
 *
 * Routing:
 *   - Future date  → /v1/flightsFuture  (scheduled data, paid plan, always HTTPS)
 *   - Today / past → /v1/flights         (real-time/historical, free tier compatible)
 */
async function lookupFlight(callsign, date) {
  const key = process.env.AVIATIONSTACK_API_KEY;
  if (!key) return null;

  const clean = callsign.toUpperCase().replace(/\s+/g, '');
  const today = new Date().toISOString().split('T')[0];
  const isFuture = date && date > today;

  if (isFuture) {
    // flightsFuture requires a paid plan and HTTPS regardless of the global setting
    const base = 'https://api.aviationstack.com/v1';
    try {
      const response = await axios.get(`${base}/flightsFuture`, {
        params: { access_key: key, flight_iata: clean, date },
        timeout: 12000,
      });
      const flights = response.data?.data;
      if (!flights || flights.length === 0) return null;
      return dedup(flights.map(f => mapFutureFlight(f, clean, date)));
    } catch (err) {
      if (err.response?.status === 429) {
        throw new Error('Flight lookup rate limit exceeded. Try again later.');
      }
      // 403/402 means the plan doesn't support flightsFuture — log and return null
      console.error('[aviationstack] Future lookup error:', err.response?.status, err.message);
      return null;
    }
  }

  // Current / historical flights
  const params = { access_key: key, flight_iata: clean };
  if (date) params.flight_date = date;

  try {
    const response = await axios.get(`${AVSTACK_BASE}/flights`, {
      params,
      timeout: 12000,
    });
    const flights = response.data?.data;
    if (!flights || flights.length === 0) return null;
    return dedup(flights.map(f => mapCurrentFlight(f, clean)));
  } catch (err) {
    if (err.response?.status === 429) {
      throw new Error('Flight lookup rate limit exceeded. Try again later.');
    }
    console.error('[aviationstack] Lookup error:', err.message);
    return null;
  }
}

module.exports = { lookupFlight };
