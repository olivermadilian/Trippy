const axios = require('axios');

// AviationStack free tier only supports HTTP; paid plans support HTTPS
const AVSTACK_BASE = process.env.AVIATIONSTACK_HTTPS === 'true'
  ? 'https://api.aviationstack.com/v1'
  : 'http://api.aviationstack.com/v1';

/**
 * Convert a local time string + IANA timezone to a UTC ISO string.
 * e.g. ("2026-04-10T09:30:00", "America/New_York") → "2026-04-10T13:30:00.000Z"
 */
function localToUTC(localTimeStr, timezone) {
  if (!localTimeStr || !timezone) return localTimeStr || null;
  try {
    // Interpret the bare datetime as UTC to get a reference point
    const asUTC = new Date(localTimeStr + 'Z');
    // Format that UTC instant in the target timezone
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).formatToParts(asUTC);
    const p = (type) => parts.find(x => x.type === type)?.value;
    const tzStr = `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}:${p('second')}Z`;
    const asTZ = new Date(tzStr);
    const offsetMs = asTZ - asUTC;
    return new Date(asUTC.getTime() - offsetMs).toISOString();
  } catch {
    return localTimeStr;
  }
}

/**
 * Look up flights by callsign using AviationStack Flights API.
 * Returns schedule data including airline name, terminal, gate, and local times.
 */
async function lookupFlight(callsign, date) {
  const key = process.env.AVIATIONSTACK_API_KEY;
  if (!key) return null; // No key configured — caller should fall back

  const clean = callsign.toUpperCase().replace(/\s+/g, '');

  const params = {
    access_key: key,
    flight_iata: clean,
  };
  if (date) params.flight_date = date;

  try {
    const response = await axios.get(`${AVSTACK_BASE}/flights`, {
      params,
      timeout: 12000,
    });

    const flights = response.data?.data;
    if (!flights || flights.length === 0) return null;

    const mapped = flights.map(f => {
      const dep = f.departure || {};
      const arr = f.arrival || {};

      // Convert local scheduled times to UTC using airport timezones
      const depScheduledLocal = dep.scheduled || null;
      const arrScheduledLocal = arr.scheduled || null;
      const depUTC = localToUTC(depScheduledLocal, dep.timezone);
      const arrUTC = localToUTC(arrScheduledLocal, arr.timezone);

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
          city: null, // AviationStack doesn't return city separately
          lat: null,
          lng: null,
          scheduled: depUTC,
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
          scheduled: arrUTC,
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
    });

    // Deduplicate by route + departure time
    const seen = new Set();
    return mapped.filter(f => {
      const key = `${f.origin.code}-${f.destination.code}-${f.origin.scheduled}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch (err) {
    if (err.response?.status === 429) {
      throw new Error('Flight lookup rate limit exceeded. Try again later.');
    }
    console.error('[aviationstack] Lookup error:', err.message);
    return null; // Return null so caller can fall back to FR24
  }
}

module.exports = { lookupFlight };
