const sncfService = require('../services/sncf.service');
const dbService = require('../services/db.service');

// Auto-detect railway from train number prefix
const SNCF_PREFIXES = ['TGV', 'TER', 'OUI', 'THA', 'INOUI', 'THAL', 'RER'];
const DB_PREFIXES = ['ICE', 'IC', 'EC', 'RE', 'RB', 'IRE', 'ME', 'FLX'];

function detectSource(trainNumber) {
  const upper = trainNumber.toUpperCase().replace(/\s+/g, '');
  for (const p of SNCF_PREFIXES) {
    if (upper.startsWith(p)) return 'sncf';
  }
  for (const p of DB_PREFIXES) {
    if (upper.startsWith(p)) return 'db';
  }
  return 'db'; // default to DB
}

async function lookup(req, res) {
  const { number, source, date } = req.query;

  if (!number) {
    return res.status(400).json({ error: 'number query parameter is required (e.g. ICE123 or TGV6180)' });
  }

  const resolvedSource = source === 'sncf' ? 'sncf' : source === 'db' ? 'db' : detectSource(number);

  try {
    let results = null;

    if (resolvedSource === 'sncf') {
      results = await sncfService.lookupTrain(number, date);
    } else {
      results = await dbService.lookupTrain(number, date);
    }

    if (!results || results.length === 0) {
      return res.status(404).json({ error: `No train found for "${number}" on ${resolvedSource.toUpperCase()}` });
    }

    res.json({ trains: results, source: resolvedSource });
  } catch (err) {
    const msg = err.message || '';
    const status = msg.includes('rate limit') ? 429
      : msg.includes('not configured') ? 503
      : 400;
    res.status(status).json({ error: msg });
  }
}

module.exports = { lookup };
