const axios = require('axios');

const DB_BASE = 'https://v6.db.transport.rest';

// Major German hub station IDs — most long-distance trains pass through at least one
const HUB_STATIONS = [
  { id: '8011160', name: 'Berlin Hbf' },
  { id: '8000105', name: 'Frankfurt (Main) Hbf' },
  { id: '8000261', name: 'München Hbf' },
  { id: '8002549', name: 'Hamburg Hbf' },
  { id: '8000207', name: 'Köln Hbf' },
];

/**
 * Look up a Deutsche Bahn train by number + date.
 * Strategy: search departures at major German hubs, filter by train name.
 * The DB transport.rest API is free and requires no auth.
 */
async function lookupTrain(number, date) {
  const clean = number.trim();
  if (!clean) return null;

  // Build search patterns: "ICE 123", "123", etc.
  const numericPart = clean.replace(/\D/g, '');
  const when = date ? `${date}T06:00:00+02:00` : undefined;

  // Try hub stations until we find the train
  for (const hub of HUB_STATIONS) {
    try {
      const params = {
        duration: 1440, // 24 hours in minutes
        results: 200,
        linesOfStops: true,
        remarks: true,
      };
      if (when) params.when = when;

      const response = await axios.get(`${DB_BASE}/stops/${hub.id}/departures`, {
        params,
        timeout: 12000,
      });

      const departures = response.data || [];

      // Match by train line name (e.g., "ICE 123", "IC 456", "RE 789")
      const match = departures.find(d => {
        const lineName = (d.line?.name || '').trim();
        const fahrtNr = String(d.line?.fahrtNr || '');
        // Match exact number, or "TYPE number" pattern
        return lineName === clean ||
          fahrtNr === numericPart ||
          lineName.endsWith(` ${numericPart}`) ||
          lineName.replace(/\s+/g, '') === clean.replace(/\s+/g, '');
      });

      if (match) {
        return [await buildTrainResult(match, hub)];
      }
    } catch (err) {
      console.error(`[db] Hub ${hub.name} error:`, err.message);
      continue;
    }
  }

  return null;
}

async function buildTrainResult(departure, originHub) {
  const origin = departure.stop || {};
  const dest = departure.destination || {};
  const line = departure.line || {};

  // Try to get trip details for intermediate stops
  let stops = [];
  if (departure.tripId) {
    try {
      const tripRes = await axios.get(`${DB_BASE}/trips/${encodeURIComponent(departure.tripId)}`, {
        params: { stopovers: true },
        timeout: 8000,
      });
      const trip = tripRes.data?.trip || tripRes.data;
      if (trip?.stopovers) {
        stops = trip.stopovers.map(s => ({
          name: s.stop?.name || null,
          code: null,
          scheduled_arrival: s.plannedArrival || null,
          estimated_arrival: s.arrival || null,
          scheduled_departure: s.plannedDeparture || null,
          estimated_departure: s.departure || null,
          status: s.cancelled ? 'cancelled' : null,
        }));

        // Use trip's actual origin and destination
        const firstStop = trip.stopovers[0];
        const lastStop = trip.stopovers[trip.stopovers.length - 1];

        const delayMs = lastStop?.arrivalDelay || 0;

        return {
          train_number: line.name || String(line.fahrtNr || ''),
          operator: 'db',
          operator_name: 'Deutsche Bahn',
          route_name: `${line.productName || ''} ${line.fahrtNr || ''}`.trim() || null,
          origin: {
            name: firstStop?.stop?.name || origin.name || null,
            code: null,
            lat: firstStop?.stop?.location?.latitude || null,
            lng: firstStop?.stop?.location?.longitude || null,
            scheduled_departure: firstStop?.plannedDeparture || null,
            estimated_departure: firstStop?.departure || null,
            platform: firstStop?.plannedPlatform || null,
          },
          destination: {
            name: lastStop?.stop?.name || dest.name || null,
            code: null,
            lat: lastStop?.stop?.location?.latitude || null,
            lng: lastStop?.stop?.location?.longitude || null,
            scheduled_arrival: lastStop?.plannedArrival || null,
            estimated_arrival: lastStop?.arrival || null,
            platform: lastStop?.plannedPlatform || null,
          },
          status: departure.cancelled ? 'cancelled' : deriveStatus(firstStop, lastStop),
          delay_minutes: Math.max(0, Math.round(delayMs / 60)),
          position: null,
          velocity: null,
          heading: null,
          stops,
        };
      }
    } catch (err) {
      console.error('[db] Trip detail error:', err.message);
    }
  }

  // Fallback without trip details
  const delayMs = departure.delay || 0;
  return {
    train_number: line.name || String(line.fahrtNr || ''),
    operator: 'db',
    operator_name: 'Deutsche Bahn',
    route_name: `${line.productName || ''} ${line.fahrtNr || ''}`.trim() || null,
    origin: {
      name: origin.name || originHub.name,
      code: null,
      lat: origin.location?.latitude || null,
      lng: origin.location?.longitude || null,
      scheduled_departure: departure.plannedWhen || null,
      estimated_departure: departure.when || null,
      platform: departure.plannedPlatform || null,
    },
    destination: {
      name: dest.name || null,
      code: null,
      lat: dest.location?.latitude || null,
      lng: dest.location?.longitude || null,
      scheduled_arrival: null,
      estimated_arrival: null,
      platform: null,
    },
    status: departure.cancelled ? 'cancelled' : 'scheduled',
    delay_minutes: Math.max(0, Math.round(delayMs / 60)),
    position: null,
    velocity: null,
    heading: null,
    stops,
  };
}

/**
 * Track a DB train — re-queries to get real-time delay info.
 */
async function trackTrain(number, date) {
  const trackDate = date || new Date().toISOString().split('T')[0];
  const results = await lookupTrain(number, trackDate);
  if (!results || results.length === 0) return null;

  const train = results[0];
  return {
    operator: 'db',
    train_number: train.train_number,
    route_name: train.route_name,
    lat: null,
    lng: null,
    velocity: null,
    heading: null,
    status: train.status,
    delay_minutes: train.delay_minutes,
    estimated_arrival: train.destination.estimated_arrival,
    origin_code: train.origin.code,
    destination_code: train.destination.code,
  };
}

function deriveStatus(firstStop, lastStop) {
  const now = Date.now();
  const dep = firstStop?.departure || firstStop?.plannedDeparture;
  const arr = lastStop?.arrival || lastStop?.plannedArrival;

  if (dep && arr) {
    const depTime = new Date(dep).getTime();
    const arrTime = new Date(arr).getTime();
    if (now > arrTime) return 'completed';
    if (now >= depTime) return 'active';
  }
  return 'scheduled';
}

module.exports = { lookupTrain, trackTrain };
