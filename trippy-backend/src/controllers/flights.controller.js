const { lookupFlight } = require('../services/aviationstack.service');

async function lookup(req, res) {
  const { callsign, date } = req.query;

  if (!callsign) {
    return res.status(400).json({ error: 'callsign query parameter is required (e.g. DL484)' });
  }

  try {
    const result = await lookupFlight(callsign, date);
    if (!result) {
      return res.status(404).json({ error: 'No matching flight found' });
    }
    res.json(result);
  } catch (err) {
    const status = err.message.includes('rate limit') ? 429 : 400;
    res.status(status).json({ error: err.message });
  }
}

module.exports = { lookup };
