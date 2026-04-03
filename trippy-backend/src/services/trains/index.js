const amtrak = require('./amtrak.service');
const sncf = require('./sncf.service');
const db = require('./db.service');

const OPERATORS = {
  amtrak: { service: amtrak, name: 'Amtrak', country: 'US', hasPosition: true },
  sncf: { service: sncf, name: 'SNCF', country: 'FR', hasPosition: false },
  db: { service: db, name: 'Deutsche Bahn', country: 'DE', hasPosition: false },
};

/**
 * List supported train operators.
 */
function listOperators() {
  return Object.entries(OPERATORS).map(([id, op]) => ({
    id,
    name: op.name,
    country: op.country,
    hasPosition: op.hasPosition,
  }));
}

/**
 * Look up a train by operator, number, and optional date.
 * Returns normalized array of train results, or null.
 */
async function lookupTrain(operator, number, date) {
  const op = OPERATORS[operator];
  if (!op) throw new Error(`Unsupported operator: ${operator}. Supported: ${Object.keys(OPERATORS).join(', ')}`);
  return op.service.lookupTrain(number, date);
}

/**
 * Get live tracking data for a train.
 * Returns position (Amtrak) or delay info (SNCF, DB), or null if not found.
 */
async function trackTrain(operator, number, date) {
  const op = OPERATORS[operator];
  if (!op) throw new Error(`Unsupported operator: ${operator}`);
  return op.service.trackTrain(number, date);
}

module.exports = { listOperators, lookupTrain, trackTrain };
