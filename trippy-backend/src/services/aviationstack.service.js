const axios = require('axios');

const API_BASE = 'http://api.aviationstack.com/v1';

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
    const mapped = flights.map(flight => ({
      callsign: `${flight.airline?.iata || airlineIata}${flight.flight?.number || flightNumber}`,
      carrier: flight.airline?.name || null,
      carrier_code: flight.airline?.iata || airlineIata,
      origin: {
        code: flight.departure?.iata || null,
        airport: flight.departure?.airport || null,
        city: null,
        scheduled: flight.departure?.scheduled || null,
        actual: flight.departure?.actual || null,
        terminal: flight.departure?.terminal || null,
        gate: flight.departure?.gate || null,
      },
      destination: {
        code: flight.arrival?.iata || null,
        airport: flight.arrival?.airport || null,
        city: null,
        scheduled: flight.arrival?.scheduled || null,
        actual: flight.arrival?.actual || null,
        terminal: flight.arrival?.terminal || null,
        gate: flight.arrival?.gate || null,
      },
      aircraft: flight.aircraft?.registration || null,
      aircraft_type: flight.aircraft?.iata || null,
      status: flight.flight_status || null,
      flight_date: flight.flight_date || null,
    }));

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
