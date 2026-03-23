const axios = require('axios');

const FR24_BASE = 'https://fr24api.flightradar24.com/api';

/** Ensure a datetime string ends with exactly one 'Z' */
function ensureZ(s) {
  if (!s) return null;
  return s.endsWith('Z') ? s : s + 'Z';
}

function getHeaders() {
  return {
    'Authorization': `Bearer ${process.env.FR24_API_KEY}`,
    'Accept': 'application/json',
    'Accept-Version': 'v1',
  };
}

/**
 * Look up flights by flight number (e.g. "AA1111") using FR24 Flight Summary.
 * Returns all matching flights within the date range.
 * Times are already in proper UTC from FR24.
 */
async function lookupFlight(callsign, date) {
  const clean = callsign.toUpperCase().replace(/\s+/g, '');

  // Build date range: if date provided, use that day; otherwise use today ± 1 day
  let dateFrom, dateTo;
  if (date) {
    dateFrom = `${date}T00:00:00`;
    dateTo = `${date}T23:59:59`;
  } else {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    dateFrom = yesterday.toISOString().replace(/\.\d{3}Z$/, '');
    dateTo = tomorrow.toISOString().replace(/\.\d{3}Z$/, '');
  }

  try {
    const response = await axios.get(`${FR24_BASE}/flight-summary/full`, {
      headers: getHeaders(),
      params: {
        flight_datetime_from: dateFrom,
        flight_datetime_to: dateTo,
        flights: clean,
        limit: 10,
        sort: 'desc',
      },
      timeout: 15000,
    });

    const flights = response.data?.data;
    if (!flights || flights.length === 0) {
      return null;
    }

    // Map FR24 response to our format
    const mapped = flights.map(f => ({
      fr24_id: f.fr24_id || null,
      callsign: f.flight || clean,
      carrier: null, // FR24 gives operated_as ICAO code, not name
      carrier_code: f.operated_as || null,
      flight_ended: f.flight_ended === 'true' || f.flight_ended === true,
      origin: {
        code: f.orig_iata || null,
        icao: f.origin_icao || null,
        airport: null,
        scheduled: f.datetime_takeoff ? ensureZ(f.datetime_takeoff) : null,
        terminal: null,
        gate: null,
      },
      destination: {
        code: f.dest_iata || null,
        icao: f.destination_icao || null,
        airport: null,
        scheduled: f.datetime_landed ? ensureZ(f.datetime_landed) : null,
        terminal: null,
        gate: null,
      },
      aircraft: f.reg || null,
      aircraft_type: f.type || null,
      status: f.flight_ended === 'true' || f.flight_ended === true ? 'landed' : 'active',
      flight_date: f.datetime_takeoff ? f.datetime_takeoff.split('T')[0] : null,
      flight_time: f.flight_time || null,
      actual_distance_km: f.actual_distance || null,
      circle_distance_km: f.circle_distance || null,
      category: f.category || null,
    }));

    // Deduplicate by route+takeoff time
    const seen = new Set();
    const unique = mapped.filter(f => {
      const key = `${f.origin.code}-${f.destination.code}-${f.origin.scheduled}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return unique;
  } catch (err) {
    if (err.response?.status === 429) {
      throw new Error('Flight lookup rate limit exceeded. Try again later.');
    }
    if (err.response?.status === 402) {
      throw new Error('Insufficient FR24 API credits.');
    }
    throw new Error('Flight lookup failed: ' + (err.response?.data?.message || err.message));
  }
}

// Per-callsign cache for live tracking
const trackCache = new Map();
const CACHE_TTL = 25000; // 25 seconds

/**
 * Get live position of a flight using FR24 Live Flight Positions.
 * Uses bounding box query and filters by callsign/flight number.
 */
async function getFlightPosition(callsign) {
  const clean = callsign.toUpperCase().replace(/\s+/g, '');

  // Check cache
  const cached = trackCache.get(clean);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return cached.data;
  }

  let result = null;

  // Strategy: Query large regions and filter by flight number
  const regions = [
    // North America: "N,S,W,E"
    '55,20,-130,-60',
    // Europe
    '72,35,-15,45',
    // East Asia / Oceania
    '50,-45,90,180',
    // Middle East / South Asia
    '45,5,30,90',
    // South America
    '15,-55,-85,-30',
    // Africa
    '38,-35,-20,55',
  ];

  // Determine most likely region based on airline prefix
  const naAirlines = ['AA', 'DL', 'UA', 'WN', 'B6', 'AS', 'NK', 'F9', 'G4', 'HA', 'AC', 'WS'];
  const euAirlines = ['BA', 'LH', 'AF', 'KL', 'IB', 'FR', 'U2', 'W6', 'VY', 'SK', 'AY', 'TP', 'AZ', 'EI', 'TK', 'LX', 'OS'];
  const asAirlines = ['SQ', 'CX', 'QF', 'NH', 'JL', 'OZ', 'KE', 'CI', 'BR', 'CZ', 'MU', 'CA', 'MH', 'GA', 'PR'];
  const meAirlines = ['EK', 'QR', 'SV', 'WY', 'GF', 'RJ', 'MS', 'AI', '6E', 'ET'];

  const prefix = clean.replace(/\d+/g, '');
  let order;
  if (naAirlines.includes(prefix)) order = [0, 1, 2, 3, 4, 5];
  else if (euAirlines.includes(prefix)) order = [1, 0, 3, 5, 2, 4];
  else if (asAirlines.includes(prefix)) order = [2, 3, 0, 1, 5, 4];
  else if (meAirlines.includes(prefix)) order = [3, 1, 2, 5, 0, 4];
  else order = [0, 1, 2, 3, 4, 5];

  // Try up to 2 regions
  for (let i = 0; i < Math.min(2, order.length); i++) {
    try {
      console.log(`[fr24] Querying region ${order[i]} for ${clean}...`);
      const response = await axios.get(`${FR24_BASE}/live/flight-positions/full`, {
        headers: getHeaders(),
        params: { bounds: regions[order[i]] },
        timeout: 12000,
      });

      const flights = response.data?.data || [];
      console.log(`[fr24] Region ${order[i]}: ${flights.length} aircraft`);

      // Match by flight number or callsign
      const match = flights.find(f => {
        const flt = (f.flight || '').toUpperCase().replace(/\s+/g, '');
        const cs = (f.callsign || '').toUpperCase().replace(/\s+/g, '');
        return flt === clean || cs === clean;
      });

      if (match) {
        console.log(`[fr24] Match: ${match.flight} at ${match.lat},${match.lon} alt=${match.alt}`);
        result = {
          callsign: match.flight || match.callsign,
          lat: match.lat,
          lng: match.lon,
          altitude_m: match.alt ? Math.round(match.alt * 0.3048) : null,
          altitude_ft: match.alt || null,
          velocity_kts: match.gspeed || null,
          heading: match.track || null,
          vertical_rate: match.vspeed || null,
          eta: match.eta || null,
          source: match.source || 'FR24',
          fr24_id: match.fr24_id || null,
          origin_iata: match.orig_iata || null,
          destination_iata: match.dest_iata || null,
          aircraft_type: match.type || null,
          registration: match.reg || null,
        };
        break;
      }
    } catch (err) {
      console.error(`[fr24] Region ${order[i]} error:`, err.message);
      if (err.response?.status === 429 || err.response?.status === 402) break;
      continue;
    }
  }

  // Cache result
  trackCache.set(clean, { data: result, timestamp: Date.now() });

  // Clean old entries
  if (trackCache.size > 100) {
    const cutoff = Date.now() - CACHE_TTL * 10;
    for (const [key, val] of trackCache) {
      if (val.timestamp < cutoff) trackCache.delete(key);
    }
  }

  return result;
}

module.exports = { lookupFlight, getFlightPosition };
