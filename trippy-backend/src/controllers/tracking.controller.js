const { getFlightPosition } = require('../services/opensky.service');

async function trackFlight(req, res) {
  const { callsign } = req.params;

  if (!callsign) {
    return res.status(400).json({ error: 'Callsign is required' });
  }

  const position = await getFlightPosition(callsign);

  if (!position) {
    return res.json({ tracking: false, position: null });
  }

  res.json({ tracking: true, position });
}

module.exports = { trackFlight };
