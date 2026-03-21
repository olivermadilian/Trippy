const axios = require('axios');

const DB_API_BASE = 'https://apis.deutschebahn.com/db-api-marketplace/apis/timetables/v1';

// Major German train hubs in priority order (EVA numbers)
const HUBS = [
  { name: 'Frankfurt(Main)Hbf', eva: '8000105' },
  { name: 'Berlin Hbf',         eva: '8011160' },
  { name: 'München Hbf',        eva: '8000261' },
  { name: 'Hamburg Hbf',        eva: '8002549' },
  { name: 'Köln Hbf',           eva: '8000207' },
];

// Hours to search across a day (covers 5am–11pm in 3-hour intervals)
const SEARCH_HOURS = ['05', '08', '11', '14', '17', '20'];

// Parse DB time format yyMMddHHmm → ISO 8601 string
function parseDbTime(str) {
  if (!str || str.length < 10) return null;
  return `20${str.substring(0, 2)}-${str.substring(2, 4)}-${str.substring(4, 6)}T${str.substring(6, 8)}:${str.substring(8, 10)}:00`;
}

// Extract a named attribute value from an XML tag string
function xmlAttr(tagStr, attr) {
  const m = tagStr.match(new RegExp(`\\b${attr}="([^"]*)"`));
  return m ? m[1] : null;
}

// Find a train by category+number in plan XML; returns entry or null
function findTrainInPlan(xml, category, number) {
  const sBlockRe = /<s\s[^>]*id="([^"]*)"[^>]*>([\s\S]*?)<\/s>/g;
  let m;
  while ((m = sBlockRe.exec(xml)) !== null) {
    const id = m[1];
    const inner = m[2];

    const tlM = inner.match(/<tl\s[^>]*\/?>/);
    if (!tlM) continue;
    if (xmlAttr(tlM[0], 'c') !== category || xmlAttr(tlM[0], 'n') !== number) continue;

    const dpM = inner.match(/<dp\s[^>]*\/?>/);
    const arM = inner.match(/<ar\s[^>]*\/?>/);

    return {
      id,
      planned_departure: dpM ? parseDbTime(xmlAttr(dpM[0], 'pt')) : null,
      planned_arrival:   arM ? parseDbTime(xmlAttr(arM[0], 'pt')) : null,
      dep_platform:      dpM ? xmlAttr(dpM[0], 'pp') : null,
      arr_platform:      arM ? xmlAttr(arM[0], 'pp') : null,
      // Future stops after departing this station (journey destination is last element)
      future_stops: dpM ? (xmlAttr(dpM[0], 'ppth') || '').split('|').filter(Boolean) : [],
      // Past stops before arriving at this station (journey origin is first element)
      past_stops:   arM ? (xmlAttr(arM[0], 'ppth') || '').split('|').filter(Boolean) : [],
    };
  }
  return null;
}

// Find real-time changes for a specific train ID in fchg XML
function findChangesById(xml, trainId) {
  const escapedId = trainId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<s[^>]+id="${escapedId}"[^>]*>([\\s\\S]*?)<\\/s>`);
  const m = xml.match(re);
  if (!m) return null;

  const inner = m[1];
  const dpM = inner.match(/<dp\s[^>]*\/?>/);
  const arM = inner.match(/<ar\s[^>]*\/?>/);

  return {
    actual_departure:    dpM ? parseDbTime(xmlAttr(dpM[0], 'ct')) : null,
    actual_arrival:      arM ? parseDbTime(xmlAttr(arM[0], 'ct')) : null,
    actual_dep_platform: dpM ? xmlAttr(dpM[0], 'cp') : null,
    actual_arr_platform: arM ? xmlAttr(arM[0], 'cp') : null,
    cancelled:           inner.includes('cs="c"'),
  };
}

function calcDelayMinutes(actual, planned) {
  if (!actual || !planned) return 0;
  return Math.round((new Date(actual) - new Date(planned)) / 60000);
}

async function lookupTrain(trainNumber, date) {
  const clientId = process.env.DB_CLIENT_ID;
  const apiKey = process.env.DB_API_KEY;
  if (!clientId || !apiKey) {
    throw new Error('DB API credentials not configured. Set DB_CLIENT_ID and DB_API_KEY in environment.');
  }

  const headers = {
    'DB-Client-Id': clientId,
    'DB-Api-Key':   apiKey,
    'Accept':       'application/xml',
  };

  const clean = trainNumber.trim().toUpperCase().replace(/\s+/g, '');
  const numMatch = clean.match(/^([A-Z]+)(\d+)$/);
  if (!numMatch) throw new Error('Invalid train number format. Expected e.g. ICE123 or RE45.');
  const [, category, number] = numMatch;

  const targetDate = date || new Date().toISOString().substring(0, 10);
  const dbDate = targetDate.replace(/-/g, '').substring(2); // YYMMDD

  // Search hubs sequentially (to stay within 20 req/min rate limit).
  // Within each hub, query all search hours in parallel.
  let found = null;
  for (const hub of HUBS) {
    const hourResults = await Promise.allSettled(
      SEARCH_HOURS.map(hour =>
        axios.get(`${DB_API_BASE}/plan/${hub.eva}/${dbDate}/${hour}`, { headers, timeout: 8000 })
          .then(res => findTrainInPlan(res.data, category, number))
          .catch(() => null)
      )
    );

    const match = hourResults.find(r => r.status === 'fulfilled' && r.value !== null);
    if (match) {
      found = { hub, entry: match.value };
      break;
    }
  }

  if (!found) return null;

  const { hub, entry } = found;

  // Fetch real-time changes for the hub station
  let rt = null;
  if (entry.id) {
    try {
      const fchgRes = await axios.get(`${DB_API_BASE}/fchg/${hub.eva}`, { headers, timeout: 8000 });
      rt = findChangesById(fchgRes.data, entry.id);
    } catch {
      // Real-time unavailable — continue with planned data
    }
  }

  const isCancelled = rt?.cancelled || false;
  const depDelay = calcDelayMinutes(rt?.actual_departure, entry.planned_departure);
  const status = isCancelled ? 'cancelled' : depDelay > 1 ? 'delayed' : 'on-time';

  // Reconstruct full route: past_stops → hub station → future_stops
  const originName = entry.past_stops.length > 0 ? entry.past_stops[0] : hub.name;
  const destName   = entry.future_stops.length > 0 ? entry.future_stops[entry.future_stops.length - 1] : hub.name;
  const allStops   = [...entry.past_stops, hub.name, ...entry.future_stops];
  const hubIndex   = entry.past_stops.length;

  return [{
    number:     `${category} ${number}`,
    carrier:    'Deutsche Bahn',
    source:     'db',
    train_type: category,
    status,
    // The hub station is where we have real timing data. Origin/destination are
    // the true journey endpoints (no per-stop timing available from this API call).
    origin: {
      name:          originName,
      lat:           null,
      lng:           null,
      scheduled:     hubIndex === 0 ? entry.planned_departure : null,
      actual:        hubIndex === 0 ? (rt?.actual_departure || entry.planned_departure) : null,
      platform:      hubIndex === 0 ? (rt?.actual_dep_platform || entry.dep_platform) : null,
      delay_minutes: hubIndex === 0 ? depDelay : 0,
    },
    destination: {
      name:          destName,
      lat:           null,
      lng:           null,
      scheduled:     null,
      actual:        null,
      platform:      null,
      delay_minutes: 0,
    },
    // Hub stop carries the real-time departure info even if it's not the journey origin
    hub_stop: {
      name:                hub.name,
      scheduled_departure: entry.planned_departure,
      actual_departure:    rt?.actual_departure || entry.planned_departure,
      platform:            rt?.actual_dep_platform || entry.dep_platform,
      delay_minutes:       depDelay,
    },
    stopovers: allStops.map((name, i) => ({
      name,
      lat:                null,
      lng:                null,
      scheduled_arrival:  i === hubIndex ? entry.planned_arrival  : null,
      actual_arrival:     i === hubIndex ? (rt?.actual_arrival  || entry.planned_arrival)  : null,
      scheduled_departure: i === hubIndex ? entry.planned_departure : null,
      actual_departure:   i === hubIndex ? (rt?.actual_departure || entry.planned_departure) : null,
      platform:           i === hubIndex ? (rt?.actual_dep_platform || entry.dep_platform) : null,
      delay_minutes:      i === hubIndex ? depDelay : 0,
      cancelled:          i === hubIndex ? isCancelled : false,
    })),
    date: targetDate,
  }];
}

module.exports = { lookupTrain };
