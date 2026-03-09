const airports = require('../data/airports.json');
const stations = require('../data/stations.json');

function searchAirports(req, res) {
  const q = (req.query.q || '').toLowerCase().trim();
  if (!q) return res.json(airports);

  const results = airports.filter(a =>
    a.code.toLowerCase().includes(q) ||
    a.name.toLowerCase().includes(q) ||
    a.city.toLowerCase().includes(q) ||
    a.country.toLowerCase().includes(q)
  );
  res.json(results);
}

function getAirport(req, res) {
  const code = req.params.code.toUpperCase();
  const airport = airports.find(a => a.code === code);
  if (!airport) return res.status(404).json({ error: 'Airport not found' });
  res.json(airport);
}

function searchStations(req, res) {
  const q = (req.query.q || '').toLowerCase().trim();
  if (!q) return res.json(stations);

  const results = stations.filter(s =>
    s.name.toLowerCase().includes(q) ||
    s.city.toLowerCase().includes(q) ||
    s.country.toLowerCase().includes(q)
  );
  res.json(results);
}

module.exports = { searchAirports, getAirport, searchStations };
