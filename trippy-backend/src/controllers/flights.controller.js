const avstack = require('../services/aviationstack.service');
const fr24    = require('../services/fr24.service');
const amadeus = require('../services/amadeus.service');

/**
 * Flight lookup — three-source combo with smart merging:
 *
 * Past / today:
 *   FR24 (operational base) + AviationStack (terminal/gate enrichment)
 *
 * Future:
 *   Amadeus (schedule base — has UTC times, aircraft type, duration)
 *   + AviationStack flightsFuture (terminal/gate enrichment)
 *   FR24 is called but returns empty for future dates (no wasted quota)
 *
 * Merge priority:
 *   1. FR24-based results (enriched by AviationStack)
 *   2. Amadeus-based results not already in FR24 (enriched by AviationStack)
 *   3. AviationStack-only results not covered by either
 *
 * Any single API failing never blocks the others. Rate-limit errors (429)
 * from any API surface immediately.
 */
async function lookup(req, res) {
  const { callsign, date } = req.query;

  if (!callsign) {
    return res.status(400).json({ error: 'callsign query parameter is required (e.g. DL484)' });
  }

  const today    = new Date().toISOString().split('T')[0];
  const isFuture = date && date > today;

  // Run all relevant APIs in parallel.
  // Amadeus is only called for future dates to preserve the free monthly quota.
  const calls = [
    avstack.lookupFlight(callsign, date),
    fr24.lookupFlight(callsign, date),
    isFuture ? amadeus.lookupFlight(callsign, date) : Promise.resolve(null),
  ];

  const [avResult, fr24Result, amadeusResult] = await Promise.allSettled(calls);

  // Surface rate-limit errors from any source immediately
  for (const r of [avResult, fr24Result, amadeusResult]) {
    if (r.status === 'rejected' && r.reason?.message?.includes('rate limit')) {
      return res.status(429).json({ error: r.reason.message });
    }
  }

  const avFlights     = (avResult.status     === 'fulfilled' && Array.isArray(avResult.value))     ? avResult.value     : [];
  const fr24Flights   = (fr24Result.status   === 'fulfilled' && Array.isArray(fr24Result.value))   ? fr24Result.value   : [];
  const amadeusFlights = (amadeusResult.status === 'fulfilled' && Array.isArray(amadeusResult.value)) ? amadeusResult.value : [];

  // Route key for dedup/matching: origin + destination + flight date
  const routeKey = f => `${f.origin?.code}-${f.destination?.code}-${f.flight_date}`;

  // Index AviationStack flights for O(1) enrichment lookups
  const avByRoute = new Map();
  for (const av of avFlights) {
    const k = routeKey(av);
    if (!avByRoute.has(k)) avByRoute.set(k, av);
  }

  /** Enrich a flight's terminal/gate/carrier from a matching AviationStack result */
  function enrichFromAv(flight, sourceTag) {
    const av = avByRoute.get(routeKey(flight));
    if (!av) return { ...flight, source: sourceTag };
    return {
      ...flight,
      source: `${sourceTag}+aviationstack`,
      carrier: flight.carrier || av.carrier,
      origin: {
        ...flight.origin,
        terminal: flight.origin.terminal ?? av.origin.terminal,
        gate:     flight.origin.gate     ?? av.origin.gate,
      },
      destination: {
        ...flight.destination,
        terminal: flight.destination.terminal ?? av.destination.terminal,
        gate:     flight.destination.gate     ?? av.destination.gate,
      },
    };
  }

  // 1. FR24 results as base (best for past/today)
  const enrichedFr24 = fr24Flights.map(f => enrichFromAv(f, 'fr24'));
  const fr24Keys = new Set(fr24Flights.map(routeKey));

  // 2. Amadeus results not already covered by FR24 (best for future)
  const enrichedAmadeus = amadeusFlights
    .filter(am => !fr24Keys.has(routeKey(am)))
    .map(am => enrichFromAv(am, 'amadeus'));

  const coveredKeys = new Set([...fr24Flights, ...amadeusFlights].map(routeKey));

  // 3. AviationStack-only flights not covered by FR24 or Amadeus
  const avOnly = avFlights
    .filter(av => !coveredKeys.has(routeKey(av)))
    .map(av => ({ ...av, source: 'aviationstack' }));

  const combined = [...enrichedFr24, ...enrichedAmadeus, ...avOnly];

  if (combined.length === 0) {
    return res.status(404).json({ error: 'No matching flight found' });
  }

  res.json({ flights: combined });
}

module.exports = { lookup };
