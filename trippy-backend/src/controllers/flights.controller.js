const avstack = require('../services/aviationstack.service');
const fr24 = require('../services/fr24.service');

/**
 * Flight lookup strategy:
 * 1. Try AviationStack first — has future schedules, airline names, terminals, gates
 * 2. Fall back to FR24 — best for day-of flights with accurate real-time data
 */
async function lookup(req, res) {
  const { callsign, date } = req.query;

  if (!callsign) {
    return res.status(400).json({ error: 'callsign query parameter is required (e.g. DL484)' });
  }

  try {
    // Try AviationStack first (better for advance scheduling)
    let results = await avstack.lookupFlight(callsign, date);

    // Fall back to FR24 if AviationStack returned nothing (no key, no results, or error)
    if (!results || results.length === 0) {
      results = await fr24.lookupFlight(callsign, date);
      // Tag FR24 results with source
      if (results) {
        results = results.map(r => ({ ...r, source: 'fr24' }));
      }
    }

    if (!results || results.length === 0) {
      return res.status(404).json({ error: 'No matching flight found' });
    }

    res.json({ flights: results });
  } catch (err) {
    const status = err.message.includes('rate limit') ? 429 : 400;
    res.status(status).json({ error: err.message });
  }
}

module.exports = { lookup };
