const axios = require('axios');

const AMADEUS_BASE = 'https://api.amadeus.com';

// OAuth2 token cache — Amadeus tokens last 30 minutes
let tokenCache = null;
let tokenExpiry = 0;

async function getToken() {
  if (tokenCache && Date.now() < tokenExpiry) return tokenCache;

  const clientId = process.env.AMADEUS_CLIENT_ID;
  const clientSecret = process.env.AMADEUS_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const response = await axios.post(
    `${AMADEUS_BASE}/v1/security/oauth2/token`,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000,
    }
  );

  tokenCache = response.data.access_token;
  // Subtract 60 s buffer so we never use a nearly-expired token
  tokenExpiry = Date.now() + (response.data.expires_in - 60) * 1000;
  return tokenCache;
}

/**
 * Parse an ISO 8601 duration string (e.g. "PT9H10M") into total seconds.
 */
function parseDuration(dur) {
  if (!dur) return null;
  const m = dur.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return null;
  return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60);
}

/**
 * Map a single Amadeus DatedFlight object to our shared flight shape.
 *
 * Amadeus returns times with full UTC offsets (e.g. "2026-04-15T10:00-04:00"),
 * so we can derive proper UTC by simply calling new Date().
 */
function mapFlight(f, clean, date) {
  const points = f.flightPoints || [];
  const legs   = f.legs || [];
  const leg    = legs[0] || {};

  // First point with a departure = origin; last point with an arrival = destination
  const originPoint = points.find(p => p.departure);
  const destPoint   = [...points].reverse().find(p => p.arrival);
  if (!originPoint || !destPoint) return null;

  const depTiming = originPoint.departure?.timings?.find(t => t.qualifier === 'STD');
  const arrTiming = destPoint.arrival?.timings?.find(t => t.qualifier === 'STA');

  const depStr = depTiming?.value || null;   // "2026-04-15T10:00-04:00"
  const arrStr = arrTiming?.value || null;

  // new Date() handles ISO strings with tz offsets natively
  const depUTC = depStr ? new Date(depStr).toISOString() : null;
  const arrUTC = arrStr ? new Date(arrStr).toISOString() : null;

  const carrierCode = f.flightDesignator?.carrierCode || '';
  const callsign    = `${carrierCode}${f.flightDesignator?.flightNumber || ''}`;

  return {
    fr24_id: null,
    callsign: callsign || clean,
    carrier: carrierCode || null,
    carrier_code: carrierCode || null,
    flight_ended: false,
    origin: {
      code: originPoint.iataCode || null,
      icao: null,
      airport: null,
      city: null,
      lat: null,
      lng: null,
      scheduled: depUTC,
      scheduled_local: depStr,
      terminal: originPoint.departure?.terminal?.code || null,
      gate: originPoint.departure?.gate?.mainGate || null,
    },
    destination: {
      code: destPoint.iataCode || null,
      icao: null,
      airport: null,
      city: null,
      lat: null,
      lng: null,
      scheduled: arrUTC,
      scheduled_local: arrStr,
      terminal: destPoint.arrival?.terminal?.code || null,
      gate: null,
    },
    aircraft: null,
    aircraft_type: leg.aircraftEquipment?.aircraftType || null,
    status: 'scheduled',
    flight_date: date,
    flight_time: parseDuration(leg.scheduledLegDuration),
    actual_distance_km: null,
    circle_distance_km: null,
    category: null,
    source: 'amadeus',
  };
}

/**
 * Look up a future flight schedule using Amadeus Flight Schedule API.
 * Only called for dates strictly after today — returns null for past/today.
 *
 * Requires AMADEUS_CLIENT_ID and AMADEUS_CLIENT_SECRET env vars.
 * Free tier: 2,000 production calls/month — register at developers.amadeus.com
 */
async function lookupFlight(callsign, date) {
  // Amadeus schedules API is future-only
  const today = new Date().toISOString().split('T')[0];
  if (!date || date <= today) return null;

  let token;
  try {
    token = await getToken();
  } catch (err) {
    console.error('[amadeus] Token error:', err.message);
    return null;
  }
  if (!token) return null;

  const clean = callsign.toUpperCase().replace(/\s+/g, '');

  // Split "DL484" → carrierCode="DL", flightNumber="484"
  const match = clean.match(/^([A-Z]{2,3})(\d+)([A-Z]?)$/);
  if (!match) return null;
  const [, carrierCode, flightNumber] = match;

  try {
    const response = await axios.get(`${AMADEUS_BASE}/v2/schedule/flights`, {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        carrierCode,
        flightNumber,
        scheduledDepartureDate: date,
      },
      timeout: 12000,
    });

    const flights = response.data?.data;
    if (!flights || flights.length === 0) return null;

    return flights.map(f => mapFlight(f, clean, date)).filter(Boolean);
  } catch (err) {
    if (err.response?.status === 429) {
      throw new Error('Flight lookup rate limit exceeded. Try again later.');
    }
    console.error('[amadeus] Lookup error:', err.response?.status, err.message);
    return null;
  }
}

module.exports = { lookupFlight };
