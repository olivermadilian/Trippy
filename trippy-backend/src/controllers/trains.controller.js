const trains = require('../services/trains');

/** GET /api/trains/operators — list supported train operators */
function operators(req, res) {
  res.json({ operators: trains.listOperators() });
}

/** GET /api/trains/lookup?operator=amtrak&number=91&date=2026-04-10 */
async function lookup(req, res) {
  const { operator, number, date } = req.query;

  if (!operator) return res.status(400).json({ error: 'operator is required (amtrak, sncf, db)' });
  if (!number) return res.status(400).json({ error: 'number is required (train number)' });

  try {
    const results = await trains.lookupTrain(operator, number, date);
    if (!results || results.length === 0) {
      return res.status(404).json({ error: 'No matching train found' });
    }
    res.json({ trains: results });
  } catch (err) {
    const status = err.message.includes('rate limit') ? 429 : 400;
    res.status(status).json({ error: err.message });
  }
}

/** GET /api/trains/track/:operator/:number?date=2026-04-10 */
async function track(req, res) {
  const { operator, number } = req.params;
  const { date } = req.query;

  if (!operator || !number) {
    return res.status(400).json({ error: 'operator and number are required' });
  }

  try {
    const position = await trains.trackTrain(operator, number, date);
    console.log(`[train-track] ${operator}/${number} → ${position ? 'FOUND' : 'NOT FOUND'}`);

    if (!position) {
      return res.json({ tracking: false, position: null });
    }

    res.json({ tracking: true, position });
  } catch (err) {
    console.error(`[train-track] ${operator}/${number} error:`, err.message);
    res.json({ tracking: false, position: null });
  }
}

module.exports = { operators, lookup, track };
