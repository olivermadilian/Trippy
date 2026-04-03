const axios = require('axios');

const AMTRAKER_BASE = 'https://api-v3.amtraker.com/v3';

/**
 * Look up an Amtrak train by number. Returns schedule + live position if active.
 * Amtraker API is free and requires no auth.
 */
async function lookupTrain(number) {
  const clean = number.replace(/\D/g, '');
  if (!clean) return null;

  try {
    const response = await axios.get(`${AMTRAKER_BASE}/trains/${clean}`, { timeout: 10000 });
    const data = response.data;

    // Response is { "91": [ { ...trainObj }, ... ] } or empty object
    const trains = data[clean];
    if (!trains || trains.length === 0) return null;

    return trains.map(t => {
      const stations = t.stations || [];
      const origin = stations[0] || {};
      const destination = stations[stations.length - 1] || {};

      return {
        train_number: String(t.trainNum),
        operator: 'amtrak',
        operator_name: 'Amtrak',
        route_name: t.routeName || null,
        origin: {
          name: t.origName || origin.stationName || null,
          code: t.origCode || origin.code || null,
          lat: origin.lat || null,
          lng: origin.lon || null,
          scheduled_departure: origin.schDep || null,
          estimated_departure: origin.estDep || null,
          platform: null,
        },
        destination: {
          name: t.destName || destination.stationName || null,
          code: t.destCode || destination.code || null,
          lat: destination.lat || null,
          lng: destination.lon || null,
          scheduled_arrival: destination.schArr || null,
          estimated_arrival: destination.estArr || null,
          platform: null,
        },
        status: mapStatus(t.trainState, t.trainTimely),
        delay_minutes: parseDelay(t.trainTimely),
        position: t.lat && t.lon ? { lat: t.lat, lng: t.lon } : null,
        velocity: t.velocity || null,
        heading: t.heading || null,
        stops: stations.map(s => ({
          name: s.stationName || null,
          code: s.code || null,
          scheduled_arrival: s.schArr || null,
          estimated_arrival: s.estArr || null,
          scheduled_departure: s.schDep || null,
          estimated_departure: s.estDep || null,
          status: s.status || null,
        })),
      };
    });
  } catch (err) {
    console.error('[amtrak] Lookup error:', err.message);
    return null;
  }
}

/**
 * Get live tracking data for an Amtrak train. Same endpoint — Amtraker
 * returns real-time GPS position, velocity, heading when train is active.
 */
async function trackTrain(number) {
  const results = await lookupTrain(number);
  if (!results || results.length === 0) return null;

  // Return the first active train, or the first result
  const active = results.find(t => t.status === 'active') || results[0];
  if (!active.position) return null;

  return {
    operator: 'amtrak',
    train_number: active.train_number,
    route_name: active.route_name,
    lat: active.position.lat,
    lng: active.position.lng,
    velocity: active.velocity,
    heading: active.heading,
    status: active.status,
    delay_minutes: active.delay_minutes,
    estimated_arrival: active.destination.estimated_arrival,
    origin_code: active.origin.code,
    destination_code: active.destination.code,
  };
}

function mapStatus(trainState, timely) {
  if (!trainState) return 'scheduled';
  const s = trainState.toLowerCase();
  if (s === 'active') return 'active';
  if (s === 'completed') return 'completed';
  if (s === 'predeparture') return 'scheduled';
  if (s === 'cancelled') return 'cancelled';
  return 'scheduled';
}

function parseDelay(timely) {
  if (!timely) return 0;
  const match = timely.match(/(\d+)\s*(min|hour)/i);
  if (!match) return 0;
  const val = parseInt(match[1]);
  return match[2].toLowerCase().startsWith('hour') ? val * 60 : val;
}

module.exports = { lookupTrain, trackTrain };
