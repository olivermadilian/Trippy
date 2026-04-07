const avstack = require('../services/aviationstack.service');
const fr24 = require('../services/fr24.service');

/**
 * Flight lookup strategy — parallel combo:
 *
 * 1. Call AviationStack + FR24 simultaneously.
 * 2. Use FR24 results as the base (richer: aircraft type, registration,
 *    actual distance, live status).
 * 3. Enrich matching FR24 flights with AviationStack terminal/gate/carrier data.
 * 4. Append any AviationStack-only flights (future schedules FR24 hasn't seen yet).
 *
 * Either API failing independently will NOT block the other's results.
 * Only a rate-limit error from either API surfaces as a 429.
 */
async function lookup(req, res) {
  const { callsign, date } = req.query;

  if (!callsign) {
    return res.status(400).json({ error: 'callsign query parameter is required (e.g. DL484)' });
  }

  // Run both APIs in parallel — capture settled results so one failure can't
  // swallow the other's data.
  const [avResult, fr24Result] = await Promise.allSettled([
    avstack.lookupFlight(callsign, date),
    fr24.lookupFlight(callsign, date),
  ]);

  // Surface rate-limit errors immediately (429 from either API).
  for (const r of [avResult, fr24Result]) {
    if (r.status === 'rejected' && r.reason?.message?.includes('rate limit')) {
      return res.status(429).json({ error: r.reason.message });
    }
  }

  const avFlights  = (avResult.status  === 'fulfilled' && Array.isArray(avResult.value))  ? avResult.value  : [];
  const fr24Flights = (fr24Result.status === 'fulfilled' && Array.isArray(fr24Result.value)) ? fr24Result.value : [];

  // Build a lookup key: origin + destination + flight date.
  const routeKey = (f) => `${f.origin?.code}-${f.destination?.code}-${f.flight_date}`;

  // Index AviationStack flights by route key for O(1) enrichment lookups.
  const avByRoute = new Map();
  for (const av of avFlights) {
    const k = routeKey(av);
    if (!avByRoute.has(k)) avByRoute.set(k, av);
  }

  // Merge: enrich FR24 flights with AviationStack terminal/gate/carrier where available.
  const enrichedFr24 = fr24Flights.map(f24 => {
    const av = avByRoute.get(routeKey(f24));
    if (!av) return { ...f24, source: 'fr24' };
    return {
      ...f24,
      source: 'fr24+aviationstack',
      carrier: f24.carrier || av.carrier,
      origin: {
        ...f24.origin,
        terminal: f24.origin.terminal ?? av.origin.terminal,
        gate:     f24.origin.gate     ?? av.origin.gate,
      },
      destination: {
        ...f24.destination,
        terminal: f24.destination.terminal ?? av.destination.terminal,
        gate:     f24.destination.gate     ?? av.destination.gate,
      },
    };
  });

  // Append AviationStack-only flights (e.g. future schedules not yet in FR24).
  const fr24Keys = new Set(fr24Flights.map(routeKey));
  const avOnly = avFlights
    .filter(av => !fr24Keys.has(routeKey(av)))
    .map(av => ({ ...av, source: 'aviationstack' }));

  const combined = [...enrichedFr24, ...avOnly];

  if (combined.length === 0) {
    return res.status(404).json({ error: 'No matching flight found' });
  }

  res.json({ flights: combined });
}

module.exports = { lookup };
