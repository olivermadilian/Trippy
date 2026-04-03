const axios = require('axios');

const SNCF_BASE = 'https://api.sncf.com/v1/coverage/sncf';

function getAuth() {
  const key = process.env.SNCF_API_KEY;
  if (!key) return null;
  return { username: key, password: '' };
}

/**
 * Look up an SNCF train by number + date using Navitia vehicle_journeys API.
 * Date format: "YYYY-MM-DD"
 */
async function lookupTrain(number, date) {
  const auth = getAuth();
  if (!auth) return null;

  // Extract numeric train number (users may type "TGV 6213" or just "6213")
  const clean = number.replace(/[^0-9]/g, '').trim();
  if (!clean) return null;

  const since = date ? `${date.replace(/-/g, '')}T000000` : undefined;
  const until = date ? `${date.replace(/-/g, '')}T235959` : undefined;

  try {
    const params = {
      headsign: clean,
      count: 10,
      data_freshness: 'realtime',
    };
    if (since) params.since = since;
    if (until) params.until = until;

    const response = await axios.get(`${SNCF_BASE}/vehicle_journeys`, {
      auth,
      params,
      timeout: 12000,
    });

    const journeys = response.data?.vehicle_journeys;
    if (!journeys || journeys.length === 0) return null;

    return journeys.map(vj => {
      const stops = vj.stop_times || [];
      const first = stops[0]?.stop_point;
      const last = stops[stops.length - 1]?.stop_point;
      const firstTime = stops[0];
      const lastTime = stops[stops.length - 1];

      return {
        train_number: vj.headsign || clean,
        operator: 'sncf',
        operator_name: 'SNCF',
        route_name: vj.name || null,
        origin: {
          name: first?.name || null,
          code: first?.codes?.find(c => c.type === 'uic8_sncf')?.value?.slice(-5) || null,
          lat: first?.coord?.lat ? parseFloat(first.coord.lat) : null,
          lng: first?.coord?.lon ? parseFloat(first.coord.lon) : null,
          scheduled_departure: parseNavitiaTime(firstTime?.base_departure_date_time || firstTime?.departure_date_time),
          estimated_departure: parseNavitiaTime(firstTime?.departure_date_time),
          platform: null,
        },
        destination: {
          name: last?.name || null,
          code: last?.codes?.find(c => c.type === 'uic8_sncf')?.value?.slice(-5) || null,
          lat: last?.coord?.lat ? parseFloat(last.coord.lat) : null,
          lng: last?.coord?.lon ? parseFloat(last.coord.lon) : null,
          scheduled_arrival: parseNavitiaTime(lastTime?.base_arrival_date_time || lastTime?.arrival_date_time),
          estimated_arrival: parseNavitiaTime(lastTime?.arrival_date_time),
          platform: null,
        },
        status: deriveStatus(firstTime, lastTime),
        delay_minutes: calcDelay(lastTime),
        position: null, // SNCF doesn't provide GPS positions
        velocity: null,
        heading: null,
        stops: stops.map(st => ({
          name: st.stop_point?.name || null,
          code: st.stop_point?.codes?.find(c => c.type === 'uic8_sncf')?.value?.slice(-5) || null,
          scheduled_arrival: parseNavitiaTime(st.base_arrival_date_time || st.arrival_date_time),
          estimated_arrival: parseNavitiaTime(st.arrival_date_time),
          scheduled_departure: parseNavitiaTime(st.base_departure_date_time || st.departure_date_time),
          estimated_departure: parseNavitiaTime(st.departure_date_time),
          status: null,
        })),
      };
    });
  } catch (err) {
    if (err.response?.status === 401) {
      console.error('[sncf] Invalid API key');
    } else {
      console.error('[sncf] Lookup error:', err.message);
    }
    return null;
  }
}

/**
 * Track an SNCF train — re-fetches the vehicle journey with realtime freshness.
 * Returns delay info (no GPS position available from SNCF).
 */
async function trackTrain(number, date) {
  // For tracking, use today's date if none provided
  const trackDate = date || new Date().toISOString().split('T')[0];
  const results = await lookupTrain(number, trackDate);
  if (!results || results.length === 0) return null;

  const train = results[0];
  return {
    operator: 'sncf',
    train_number: train.train_number,
    route_name: train.route_name,
    lat: null,
    lng: null,
    velocity: null,
    heading: null,
    status: train.status,
    delay_minutes: train.delay_minutes,
    estimated_arrival: train.destination.estimated_arrival,
    origin_code: train.origin.code,
    destination_code: train.destination.code,
  };
}

/** Parse Navitia datetime "20260410T083000" → ISO "2026-04-10T08:30:00Z" */
function parseNavitiaTime(dt) {
  if (!dt || dt.length < 15) return null;
  return `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}T${dt.slice(9, 11)}:${dt.slice(11, 13)}:${dt.slice(13, 15)}Z`;
}

function deriveStatus(firstStop, lastStop) {
  // If estimated differs significantly from base, likely in transit or delayed
  const baseDep = firstStop?.base_departure_date_time;
  const actualDep = firstStop?.departure_date_time;
  const baseArr = lastStop?.base_arrival_date_time;
  const actualArr = lastStop?.arrival_date_time;

  if (!baseDep) return 'scheduled';

  const now = new Date();
  const depTime = parseNavitiaTime(actualDep || baseDep);
  const arrTime = parseNavitiaTime(actualArr || baseArr);

  if (depTime && arrTime) {
    const dep = new Date(depTime).getTime();
    const arr = new Date(arrTime).getTime();
    if (now.getTime() > arr) return 'completed';
    if (now.getTime() >= dep) return 'active';
  }

  return 'scheduled';
}

function calcDelay(lastStop) {
  const base = lastStop?.base_arrival_date_time;
  const actual = lastStop?.arrival_date_time;
  if (!base || !actual || base === actual) return 0;

  const baseTime = parseNavitiaTime(base);
  const actualTime = parseNavitiaTime(actual);
  if (!baseTime || !actualTime) return 0;

  const diffMs = new Date(actualTime) - new Date(baseTime);
  return Math.max(0, Math.round(diffMs / 60000));
}

module.exports = { lookupTrain, trackTrain };
