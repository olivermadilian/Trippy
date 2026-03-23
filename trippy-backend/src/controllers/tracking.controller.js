const { getFlightPosition } = require('../services/opensky.service');

async function trackFlight(req, res) {
  const { callsign } = req.params;

  if (!callsign) {
    return res.status(400).json({ error: 'Callsign is required' });
  }

  try {
    const position = await getFlightPosition(callsign);
    console.log(`[track] ${callsign} → ${position ? `FOUND at ${position.lat},${position.lng}` : 'NOT FOUND'}`);

    if (!position) {
      return res.json({ tracking: false, position: null });
    }

    res.json({ tracking: true, position });
  } catch (err) {
    console.error(`[track] ${callsign} error:`, err.message);
    res.json({ tracking: false, position: null });
  }
}

module.exports = { trackFlight };
