const axios = require('axios');

const SNCF_BASE = 'https://api.sncf.com/v1/coverage/sncf';

function getAuth() {
  const key = process.env.SNCF_API_KEY;
  if (!key) return null;
  return { username: key, password: '' };
}

/** Parse Navitia datetime "20260411T083700" → ISO "2026-04-11T08:37:00" (local, no Z) */
function parseNavitiaTime(dt) {
  if (!dt || dt.length < 15) return null;
  return `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}T${dt.slice(9, 11)}:${dt.slice(11, 13)}:${dt.slice(13, 15)}`;
}

/** Map Navitia physical_mode / commercial_mode to human-readable service type */
function deriveServiceType(vj) {
  const cm = vj.commercial_mode?.name || vj.commercial_mode?.id || '';
  const pm = vj.physical_mode?.name || vj.physical_mode?.id || '';
  if (/tgv|inoui/i.test(cm)) return 'TGV inOui';
  if (/ouigo/i.test(cm)) return 'OUIGO';
  if (/intercit/i.test(cm)) return 'Intercités';
  if (/ter/i.test(cm) || /ter/i.test(pm)) return 'TER';
  if (/longdistance/i.test(pm)) return 'Intercités';
  if (/rapidtransit/i.test(pm)) return 'TER';
  return cm || 'Train';
}

/**
 * Build a normalized stop from a Navitia stop_time object.
 */
function buildStop(st, index) {
  const sp = st.stop_point || {};
  const uicCode = sp.codes?.find(c => c.type === 'uic8_sncf')?.value?.slice(-5) || null;
  return {
    index,
    stationName: sp.name || null,
    stationId: sp.id || null,
    stationCode: uicCode,
    scheduledArrival: parseNavitiaTime(st.base_arrival_date_time || st.arrival_date_time),
    scheduledDeparture: parseNavitiaTime(st.base_departure_date_time || st.departure_date_time),
    estimatedArrival: null,  // populated in tracking mode
    estimatedDeparture: null,
    delayMinutes: null,
    lat: sp.coord?.lat ? parseFloat(sp.coord.lat) : null,
    lon: sp.coord?.lon ? parseFloat(sp.coord.lon) : null,
    platformNumber: null, // Navitia rarely exposes platform info
  };
}

/**
 * Build a stop with realtime info (for tracking).
 */
function buildStopRealtime(st, index) {
  const stop = buildStop(st, index);
  // Compare base vs actual times
  const baseArr = parseNavitiaTime(st.base_arrival_date_time);
  const actualArr = parseNavitiaTime(st.arrival_date_time);
  const baseDep = parseNavitiaTime(st.base_departure_date_time);
  const actualDep = parseNavitiaTime(st.departure_date_time);

  if (actualArr && baseArr && actualArr !== baseArr) stop.estimatedArrival = actualArr;
  if (actualDep && baseDep && actualDep !== baseDep) stop.estimatedDeparture = actualDep;

  // Compute delay from arrival (more relevant for passengers)
  if (stop.estimatedArrival && stop.scheduledArrival) {
    const diffMs = new Date(stop.estimatedArrival) - new Date(stop.scheduledArrival);
    stop.delayMinutes = Math.max(0, Math.round(diffMs / 60000));
  } else if (stop.estimatedDeparture && stop.scheduledDeparture) {
    const diffMs = new Date(stop.estimatedDeparture) - new Date(stop.scheduledDeparture);
    stop.delayMinutes = Math.max(0, Math.round(diffMs / 60000));
  }

  return stop;
}

/**
 * Compute total duration in minutes between first departure and last arrival.
 */
function computeTotalDuration(stops) {
  if (stops.length < 2) return null;
  const dep = stops[0].scheduledDeparture;
  const arr = stops[stops.length - 1].scheduledArrival;
  if (!dep || !arr) return null;
  return Math.round((new Date(arr) - new Date(dep)) / 60000);
}

/**
 * Look up an SNCF train by number + date using Navitia vehicle_journeys API.
 * Date format: "YYYY-MM-DD"
 */
async function lookupTrain(number, date) {
  const auth = getAuth();
  if (!auth) return null;

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
      const stopTimes = vj.stop_times || [];
      const stops = stopTimes.map((st, i) => buildStop(st, i));
      const totalDuration = computeTotalDuration(stops);

      return {
        match: true,
        trainNumber: vj.headsign || clean,
        operator: 'sncf',
        operatorName: 'SNCF',
        serviceType: deriveServiceType(vj),
        routeName: vj.name || null,
        date: date || null,
        fullRoute: {
          origin: stops[0]?.stationName || null,
          destination: stops[stops.length - 1]?.stationName || null,
          totalDurationMinutes: totalDuration,
          totalStops: stops.length,
        },
        stops,
        // Legacy fields for backwards compatibility during transition
        train_number: vj.headsign || clean,
        operator_name: 'SNCF',
        route_name: vj.name || null,
        origin: {
          name: stops[0]?.stationName || null,
          code: stops[0]?.stationCode || null,
          lat: stops[0]?.lat || null,
          lng: stops[0]?.lon || null,
          scheduled_departure: stops[0]?.scheduledDeparture || null,
          estimated_departure: stops[0]?.estimatedDeparture || null,
          platform: null,
        },
        destination: {
          name: stops[stops.length - 1]?.stationName || null,
          code: stops[stops.length - 1]?.stationCode || null,
          lat: stops[stops.length - 1]?.lat || null,
          lng: stops[stops.length - 1]?.lon || null,
          scheduled_arrival: stops[stops.length - 1]?.scheduledArrival || null,
          estimated_arrival: stops[stops.length - 1]?.estimatedArrival || null,
          platform: null,
        },
        status: deriveStatus(stopTimes),
        delay_minutes: calcDelay(stopTimes[stopTimes.length - 1]),
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
 * Track an SNCF train — re-fetches with realtime freshness.
 * Returns full stops with estimated times and delay info.
 */
async function trackTrain(number, date) {
  const auth = getAuth();
  if (!auth) return null;

  const clean = number.replace(/[^0-9]/g, '').trim();
  if (!clean) return null;

  const trackDate = date || new Date().toISOString().split('T')[0];
  const since = `${trackDate.replace(/-/g, '')}T000000`;
  const until = `${trackDate.replace(/-/g, '')}T235959`;

  try {
    const params = {
      headsign: clean,
      count: 5,
      data_freshness: 'realtime',
      since,
      until,
    };

    const response = await axios.get(`${SNCF_BASE}/vehicle_journeys`, {
      auth,
      params,
      timeout: 12000,
    });

    const journeys = response.data?.vehicle_journeys;
    if (!journeys || journeys.length === 0) return null;

    const vj = journeys[0];
    const stopTimes = vj.stop_times || [];
    const stops = stopTimes.map((st, i) => buildStopRealtime(st, i));

    const maxDelay = Math.max(0, ...stops.map(s => s.delayMinutes || 0));
    const hasDelay = maxDelay > 0;

    return {
      operator: 'sncf',
      train_number: vj.headsign || clean,
      route_name: vj.name || null,
      serviceType: deriveServiceType(vj),
      status: hasDelay ? 'delayed' : deriveStatus(stopTimes),
      maxDelayMinutes: hasDelay ? maxDelay : 0,
      delay_minutes: calcDelay(stopTimes[stopTimes.length - 1]),
      stops,
      lat: null,
      lng: null,
      velocity: null,
      heading: null,
      estimated_arrival: stops[stops.length - 1]?.estimatedArrival || stops[stops.length - 1]?.scheduledArrival,
      origin_code: stops[0]?.stationCode,
      destination_code: stops[stops.length - 1]?.stationCode,
    };
  } catch (err) {
    console.error('[sncf] Track error:', err.message);
    return null;
  }
}

function deriveStatus(stopTimes) {
  if (!stopTimes || stopTimes.length === 0) return 'scheduled';

  const firstStop = stopTimes[0];
  const lastStop = stopTimes[stopTimes.length - 1];
  const baseDep = firstStop?.base_departure_date_time || firstStop?.departure_date_time;
  const baseArr = lastStop?.base_arrival_date_time || lastStop?.arrival_date_time;

  if (!baseDep) return 'scheduled';

  const now = Date.now();
  const depTime = parseNavitiaTime(baseDep);
  const arrTime = parseNavitiaTime(baseArr);

  if (depTime && arrTime) {
    const dep = new Date(depTime).getTime();
    const arr = new Date(arrTime).getTime();
    if (now > arr) return 'completed';
    if (now >= dep) return 'active';
  }

  return 'scheduled';
}

function calcDelay(lastStop) {
  if (!lastStop) return 0;
  const base = lastStop.base_arrival_date_time;
  const actual = lastStop.arrival_date_time;
  if (!base || !actual || base === actual) return 0;

  const baseTime = parseNavitiaTime(base);
  const actualTime = parseNavitiaTime(actual);
  if (!baseTime || !actualTime) return 0;

  const diffMs = new Date(actualTime) - new Date(baseTime);
  return Math.max(0, Math.round(diffMs / 60000));
}

module.exports = { lookupTrain, trackTrain };
