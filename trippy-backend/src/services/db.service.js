const axios = require('axios');

const DB_BASE = 'https://v6.db.transport.rest';

async function lookupTrain(trainNumber, date) {
  // Format: "ICE123" → "ICE 123" for better matching
  const clean = trainNumber.trim().toUpperCase().replace(/\s+/g, '');
  const formatted = clean.replace(/^([A-Z]+)(\d+)$/, '$1 $2');

  const params = {
    query: formatted,
    onlyCurrentlyRunning: false,
  };

  // Pass date as a 'when' ISO timestamp if provided (DB API accepts this for trip search context)
  if (date) {
    params.when = new Date(date + 'T08:00:00').toISOString();
  }

  try {
    const response = await axios.get(`${DB_BASE}/trips`, {
      params,
      headers: { 'Accept': 'application/json' },
      timeout: 10000,
    });

    const trips = response.data?.trips;
    if (!trips || trips.length === 0) return null;

    return trips.map(trip => {
      const stopovers = trip.stopovers || [];
      const first = stopovers[0];
      const last = stopovers[stopovers.length - 1];

      const secToMin = (sec) => sec != null ? Math.round(sec / 60) : 0;

      const mapStop = (sv, isOrigin) => {
        if (!sv) return null;
        return {
          name: sv.stop?.name || null,
          lat: sv.stop?.location?.latitude || null,
          lng: sv.stop?.location?.longitude || null,
          scheduled: isOrigin ? (sv.plannedDeparture || null) : (sv.plannedArrival || null),
          actual: isOrigin ? (sv.departure || sv.plannedDeparture || null) : (sv.arrival || sv.plannedArrival || null),
          platform: isOrigin
            ? (sv.departurePlatform || sv.plannedDeparturePlatform || null)
            : (sv.arrivalPlatform || sv.plannedArrivalPlatform || null),
          delay_minutes: isOrigin ? secToMin(sv.departureDelay) : secToMin(sv.arrivalDelay),
        };
      };

      const stopoversNorm = stopovers.map(sv => ({
        name: sv.stop?.name || null,
        lat: sv.stop?.location?.latitude || null,
        lng: sv.stop?.location?.longitude || null,
        scheduled_arrival: sv.plannedArrival || null,
        actual_arrival: sv.arrival || sv.plannedArrival || null,
        scheduled_departure: sv.plannedDeparture || null,
        actual_departure: sv.departure || sv.plannedDeparture || null,
        platform: sv.arrivalPlatform || sv.departurePlatform || sv.plannedArrivalPlatform || sv.plannedDeparturePlatform || null,
        delay_minutes: secToMin(sv.departureDelay ?? sv.arrivalDelay),
        cancelled: sv.cancelled || false,
      }));

      const firstDep = first?.plannedDeparture || first?.departure || null;
      const tripDate = firstDep
        ? new Date(firstDep).toISOString().substring(0, 10)
        : (date || new Date().toISOString().substring(0, 10));

      const hasDelay = stopovers.some(sv => (sv.departureDelay || 0) > 60 || (sv.arrivalDelay || 0) > 60);
      const status = trip.cancelled ? 'cancelled' : hasDelay ? 'delayed' : 'on-time';

      return {
        number: trip.line?.name || clean,
        carrier: trip.line?.operator?.name || 'Deutsche Bahn',
        source: 'db',
        train_type: trip.line?.productName || trip.line?.product || clean.replace(/\d+/g, '').trim() || 'Train',
        status,
        origin: mapStop(first, true),
        destination: mapStop(last, false),
        stopovers: stopoversNorm,
        date: tripDate,
      };
    });
  } catch (err) {
    if (err.response?.status === 429) throw new Error('DB API rate limit exceeded. Try again later.');
    if (err.response?.status === 404) return null;
    if (err.code === 'ECONNABORTED') throw new Error('DB API request timed out.');
    throw new Error('DB train lookup failed: ' + (err.response?.data?.message || err.message));
  }
}

module.exports = { lookupTrain };
