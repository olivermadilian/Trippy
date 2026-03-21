const axios = require('axios');

const SNCF_BASE = 'https://api.sncf.com/v1/coverage/sncf';

// Parse Navitia time string "HHMMSS" (possibly > 240000 for overnight) into ISO
function parseNavitiaTime(timeStr, dateStr) {
  if (!timeStr || !dateStr) return null;
  const padded = timeStr.toString().padStart(6, '0');
  const h = parseInt(padded.substring(0, 2));
  const m = parseInt(padded.substring(2, 4));
  const s = parseInt(padded.substring(4, 6));
  const totalSeconds = h * 3600 + m * 60 + s;
  const base = new Date(dateStr + 'T00:00:00Z');
  base.setSeconds(base.getSeconds() + totalSeconds);
  return base.toISOString();
}

async function lookupTrain(trainNumber, date) {
  const apiKey = process.env.SNCF_API_KEY;
  if (!apiKey) throw new Error('SNCF API key not configured. Set SNCF_API_KEY in environment.');

  // Extract numeric headsign from e.g. "TGV6180" → "6180" or "6180"
  const clean = trainNumber.trim().toUpperCase().replace(/\s+/g, '');
  const numericMatch = clean.match(/(\d+)$/);
  if (!numericMatch) throw new Error('Invalid train number format. Expected e.g. TGV6180 or 6180.');
  const headsign = numericMatch[1];

  // Detect train type prefix (everything before the digits)
  const prefix = clean.replace(/\d+$/, '');

  // Build datetime for query (use provided date or today)
  const baseDate = date || new Date().toISOString().substring(0, 10);
  const datetime = baseDate.replace(/-/g, '') + 'T080000'; // 08:00 local

  try {
    const response = await axios.get(`${SNCF_BASE}/vehicle_journeys`, {
      auth: { username: apiKey, password: '' },
      params: {
        headsign,
        datetime,
        data_freshness: 'realtime',
        depth: 2,
        count: 5,
      },
    });

    const journeys = response.data?.vehicle_journeys;
    if (!journeys || journeys.length === 0) return null;

    return journeys.map(vj => {
      const stops = vj.stop_times || [];
      const first = stops[0];
      const last = stops[stops.length - 1];

      const mapStop = (st, isArrival) => {
        if (!st) return null;
        const timeStr = isArrival ? (st.arrival_time || st.departure_time) : (st.departure_time || st.arrival_time);
        const baseTimeStr = isArrival ? (st.base_arrival_time || st.arrival_time) : (st.base_departure_time || st.departure_time);
        const actual = parseNavitiaTime(timeStr, baseDate);
        const scheduled = parseNavitiaTime(baseTimeStr, baseDate);
        const delayMs = actual && scheduled ? new Date(actual) - new Date(scheduled) : 0;
        return {
          name: st.stop_point?.name || null,
          lat: st.stop_point?.coord?.lat ? parseFloat(st.stop_point.coord.lat) : null,
          lng: st.stop_point?.coord?.lon ? parseFloat(st.stop_point.coord.lon) : null,
          scheduled: scheduled || actual,
          actual,
          platform: null, // SNCF Navitia doesn't reliably expose platform
          delay_minutes: Math.round(delayMs / 60000),
        };
      };

      const originStop = mapStop(first, false);
      const destStop = mapStop(last, true);

      const stopovers = stops.map(st => {
        const dep = parseNavitiaTime(st.departure_time || st.arrival_time, baseDate);
        const arr = parseNavitiaTime(st.arrival_time || st.departure_time, baseDate);
        const baseDep = parseNavitiaTime(st.base_departure_time || st.departure_time, baseDate);
        const delayMs = dep && baseDep ? new Date(dep) - new Date(baseDep) : 0;
        return {
          name: st.stop_point?.name || null,
          lat: st.stop_point?.coord?.lat ? parseFloat(st.stop_point.coord.lat) : null,
          lng: st.stop_point?.coord?.lon ? parseFloat(st.stop_point.coord.lon) : null,
          scheduled_arrival: arr,
          actual_arrival: arr,
          scheduled_departure: dep,
          actual_departure: dep,
          platform: null,
          delay_minutes: Math.round(delayMs / 60000),
          cancelled: false,
        };
      });

      const disruptions = response.data?.disruptions || [];
      const status = disruptions.length > 0 ? 'disrupted' : 'on-time';

      return {
        number: vj.headsign || headsign,
        carrier: 'SNCF',
        source: 'sncf',
        train_type: prefix || 'Train',
        status,
        origin: originStop,
        destination: destStop,
        stopovers,
        date: baseDate,
      };
    });
  } catch (err) {
    if (err.response?.status === 401) throw new Error('SNCF API authentication failed — check SNCF_API_KEY');
    if (err.response?.status === 429) throw new Error('SNCF API rate limit exceeded. Try again later.');
    if (err.response?.status === 404) return null;
    throw new Error('SNCF train lookup failed: ' + (err.response?.data?.message || err.message));
  }
}

module.exports = { lookupTrain };
