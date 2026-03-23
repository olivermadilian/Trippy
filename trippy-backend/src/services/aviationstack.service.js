const axios = require('axios');

const API_BASE = 'http://api.aviationstack.com/v1';

/**
 * Convert a local time string + IANA timezone to proper UTC ISO string.
 * AviationStack returns times like "2026-03-22T17:14:00+00:00" where the
 * time is actually LOCAL but the offset is misleadingly +00:00.
 * We extract the raw time and apply the real timezone.
 */
function toUTC(localTimeStr, timezone) {
  if (!localTimeStr) return null;
  // Extract the date/time portion (ignore any offset AviationStack provides)
  const raw = localTimeStr.replace(/[+-]\d{2}:\d{2}$/, '').replace('Z', '');

  if (!timezone) {
    // No timezone info — return as-is with Z (best we can do)
    return raw + 'Z';
  }

  try {
    // Use Intl to figure out the UTC offset for this timezone at this date/time
    // Create a Date object treating the raw time as UTC temporarily
    const tempDate = new Date(raw + 'Z');

    // Get the timezone offset by comparing UTC format vs local format
    const utcParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).formatToParts(tempDate);

    const localParts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).formatToParts(tempDate);

    const getVal = (parts, type) => parts.find(p => p.type === type)?.value;
    const utcH = parseInt(getVal(utcParts, 'hour'));
    const localH = parseInt(getVal(localParts, 'hour'));
    const utcD = parseInt(getVal(utcParts, 'day'));
    const localD = parseInt(getVal(localParts, 'day'));

    // Calculate offset in hours (local - UTC)
    let offsetHours = localH - utcH;
    if (localD > utcD) offsetHours += 24;
    if (localD < utcD) offsetHours -= 24;

    // The raw time IS local, so to get UTC we subtract the offset
    const localDate = new Date(raw + 'Z');
    localDate.setUTCHours(localDate.getUTCHours() - offsetHours);

    return localDate.toISOString();
  } catch (e) {
    // If timezone conversion fails, return raw with Z
    return raw + 'Z';
  }
}

async function lookupFlight(callsign, date) {
  const clean = callsign.toUpperCase().replace(/\s+/g, '');

  // Parse callsign: "DL484" → airline "DL", flight "484"
  // Supports 2-3 letter airline codes
  const match = clean.match(/^([A-Z]{2,3})(\d+)$/);
  if (!match) {
    throw new Error('Invalid callsign format. Use format like DL484 or NH105.');
  }

  const [, airlineIata, flightNumber] = match;

  const params = {
    access_key: process.env.AVIATIONSTACK_API_KEY,
    flight_iata: `${airlineIata}${flightNumber}`,
  };

  // Add date filter if provided (requires paid AviationStack plan)
  // if (date) {
  //   params.flight_date = date;
  // }

  try {
    const response = await axios.get(`${API_BASE}/flights`, { params });

    const flights = response.data?.data;
    if (!flights || flights.length === 0) {
      return null;
    }

    // Map all matching flights so the user can choose
    const mapped = flights.map(flight => {
      const depTz = flight.departure?.timezone || null;
      const arrTz = flight.arrival?.timezone || null;
      // Store the raw local time for display purposes
      const depLocalRaw = (flight.departure?.scheduled || '').replace(/[+-]\d{2}:\d{2}$/, '').replace('Z', '');
      const arrLocalRaw = (flight.arrival?.scheduled || '').replace(/[+-]\d{2}:\d{2}$/, '').replace('Z', '');
      return {
      callsign: `${flight.airline?.iata || airlineIata}${flight.flight?.number || flightNumber}`,
      carrier: flight.airline?.name || null,
      carrier_code: flight.airline?.iata || airlineIata,
      origin: {
        code: flight.departure?.iata || null,
        airport: flight.departure?.airport || null,
        city: null,
        scheduled: toUTC(flight.departure?.scheduled, depTz),
        scheduled_local: depLocalRaw || null,
        actual: toUTC(flight.departure?.actual, depTz),
        terminal: flight.departure?.terminal || null,
        gate: flight.departure?.gate || null,
        timezone: depTz,
      },
      destination: {
        code: flight.arrival?.iata || null,
        airport: flight.arrival?.airport || null,
        city: null,
        scheduled: toUTC(flight.arrival?.scheduled, arrTz),
        scheduled_local: arrLocalRaw || null,
        actual: toUTC(flight.arrival?.actual, arrTz),
        terminal: flight.arrival?.terminal || null,
        gate: flight.arrival?.gate || null,
        timezone: arrTz,
      },
      aircraft: flight.aircraft?.registration || null,
      aircraft_type: flight.aircraft?.iata || null,
      status: flight.flight_status || null,
      flight_date: flight.flight_date || null,
    };});

    // Deduplicate by route+time (AviationStack sometimes returns duplicates)
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
    throw new Error('Flight lookup failed: ' + (err.response?.data?.error?.message || err.message));
  }
}

module.exports = { lookupFlight };
