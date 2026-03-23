const axios = require('axios');

const OPENSKY_BASE = 'https://opensky-network.org/api';

// Common IATA → ICAO airline code mappings
const IATA_TO_ICAO = {
  'DL': 'DAL', 'AA': 'AAL', 'UA': 'UAL', 'WN': 'SWA', 'B6': 'JBU',
  'AS': 'ASA', 'NK': 'NKS', 'F9': 'FFT', 'G4': 'AAY', 'HA': 'HAL',
  'BA': 'BAW', 'LH': 'DLH', 'AF': 'AFR', 'KL': 'KLM', 'IB': 'IBE',
  'EK': 'UAE', 'QR': 'QTR', 'SQ': 'SIA', 'CX': 'CPA', 'QF': 'QFA',
  'NH': 'ANA', 'JL': 'JAL', 'TK': 'THY', 'LX': 'SWR', 'OS': 'AUA',
  'SK': 'SAS', 'AY': 'FIN', 'TP': 'TAP', 'AZ': 'ITY', 'EI': 'EIN',
  'AC': 'ACA', 'WS': 'WJA', 'AM': 'AMX', 'LA': 'LAN', 'AV': 'AVA',
  'CM': 'CMP', 'Y4': 'VOI', '4O': 'AIJ', 'FR': 'RYR', 'U2': 'EZY',
  'W6': 'WZZ', 'VY': 'VLG', 'EW': 'EWG', 'PC': 'PGT', 'QS': 'TVS',
  'ET': 'ETH', 'SA': 'SAA', 'KQ': 'KQA', 'MS': 'MSR', 'RJ': 'RJA',
  'SV': 'SVA', 'WY': 'OMA', 'GF': 'GFA', 'AI': 'AIC', '6E': 'IGO',
  'MH': 'MAS', 'GA': 'GIA', 'PR': 'PAL', 'OZ': 'AAR', 'KE': 'KAL',
  'CI': 'CAL', 'BR': 'EVA', 'CZ': 'CSN', 'MU': 'CES', 'CA': 'CCA',
  'HU': 'CHH', 'FM': 'CSH', '3U': 'CSC', 'NZ': 'ANZ', 'FJ': 'FJI',
  'VA': 'VOZ', 'JQ': 'JST',
};

function iataToIcao(callsign) {
  const match = callsign.match(/^([A-Z0-9]{2})(\d+)$/);
  if (!match) return callsign;
  const [, iata, num] = match;
  const icao = IATA_TO_ICAO[iata];
  return icao ? `${icao}${num}` : callsign;
}

// Per-callsign cache to avoid redundant lookups
const flightCache = new Map();
const CACHE_TTL = 30000; // 30 seconds

/**
 * Look up a flight's live position by callsign using multiple strategies:
 * 1. Try bounding-box filtered OpenSky query (small response, fast)
 * 2. Try ADS-B Exchange / other free sources as fallback
 */
async function getFlightPosition(callsign) {
  const clean = callsign.toUpperCase().replace(/\s+/g, '');
  const icaoCallsign = iataToIcao(clean);

  // Check cache
  const cached = flightCache.get(icaoCallsign);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return cached.data;
  }

  let result = null;

  // Strategy 1: Use OpenSky with bounding box regions
  // Query major geographic regions where the flight likely is
  result = await tryOpenSkyRegional(icaoCallsign, clean);

  // Strategy 2: Try the ADSBDB free API (no auth needed, per-callsign lookup)
  if (!result) {
    result = await tryAdsbdb(icaoCallsign, clean);
  }

  // Cache the result (even null, to avoid hammering)
  flightCache.set(icaoCallsign, { data: result, timestamp: Date.now() });

  // Clean old cache entries
  if (flightCache.size > 100) {
    const cutoff = Date.now() - CACHE_TTL * 10;
    for (const [key, val] of flightCache) {
      if (val.timestamp < cutoff) flightCache.delete(key);
    }
  }

  return result;
}

/**
 * Try OpenSky with regional bounding boxes instead of fetching all states.
 * Each region is a much smaller request (~100KB vs ~10MB).
 */
async function tryOpenSkyRegional(icaoCallsign, iataCallsign) {
  // Define regions covering most commercial flight areas
  const regions = [
    // North America
    { lamin: 20, lamax: 55, lomin: -130, lomax: -60 },
    // Europe
    { lamin: 35, lamax: 72, lomin: -15, lomax: 45 },
    // East Asia / Oceania
    { lamin: -45, lamax: 50, lomin: 90, lomax: 180 },
    // Middle East / South Asia
    { lamin: 5, lamax: 45, lomin: 30, lomax: 90 },
    // South America
    { lamin: -55, lamax: 15, lomin: -85, lomax: -30 },
    // Africa
    { lamin: -35, lamax: 38, lomin: -20, lomax: 55 },
  ];

  // Determine which region to try first based on airline code
  const airline = icaoCallsign.replace(/\d+/g, '');
  const naAirlines = ['AAL', 'DAL', 'UAL', 'SWA', 'JBU', 'ASA', 'NKS', 'FFT', 'AAY', 'HAL', 'ACA', 'WJA'];
  const euAirlines = ['BAW', 'DLH', 'AFR', 'KLM', 'IBE', 'RYR', 'EZY', 'WZZ', 'VLG', 'EWG', 'SWR', 'AUA', 'SAS', 'FIN', 'TAP', 'ITY', 'EIN', 'THY', 'PGT'];
  const asiaAirlines = ['SIA', 'CPA', 'QFA', 'ANA', 'JAL', 'AAR', 'KAL', 'CAL', 'EVA', 'CSN', 'CES', 'CCA', 'MAS', 'GIA', 'PAL'];
  const meAirlines = ['UAE', 'QTR', 'SVA', 'OMA', 'GFA', 'RJA', 'MSR', 'AIC', 'IGO', 'ETH'];

  let orderedRegions;
  if (naAirlines.includes(airline)) orderedRegions = [0, 1, 2, 3, 4, 5];
  else if (euAirlines.includes(airline)) orderedRegions = [1, 0, 3, 5, 2, 4];
  else if (asiaAirlines.includes(airline)) orderedRegions = [2, 3, 0, 1, 5, 4];
  else if (meAirlines.includes(airline)) orderedRegions = [3, 1, 2, 5, 0, 4];
  else orderedRegions = [0, 1, 2, 3, 4, 5];

  // Try the most likely region first, then stop
  // Only try max 2 regions to keep response fast
  for (let i = 0; i < Math.min(2, orderedRegions.length); i++) {
    const region = regions[orderedRegions[i]];
    try {
      const response = await axios.get(`${OPENSKY_BASE}/states/all`, {
        params: region,
        timeout: 10000,
      });

      if (!response.data?.states) continue;

      const match = response.data.states.find(s => {
        const cs = (s[1] || '').trim().toUpperCase();
        return cs === icaoCallsign || cs === iataCallsign ||
               cs.startsWith(icaoCallsign) || cs.startsWith(iataCallsign);
      });

      if (match && match[5] !== null && match[6] !== null && !match[8]) {
        return formatState(match);
      }
    } catch (err) {
      // Rate limited or timeout — try next strategy
      if (err.response?.status === 429) break; // Don't retry if rate limited
      continue;
    }
  }

  return null;
}

/**
 * Try ADSBDB — a free ADS-B database with per-callsign lookup.
 * No rate limits documented, returns single flight data.
 * https://www.adsbdb.com/api
 */
async function tryAdsbdb(icaoCallsign, iataCallsign) {
  for (const cs of [icaoCallsign, iataCallsign]) {
    try {
      const response = await axios.get(`https://api.adsbdb.com/v0/callsign/${cs}`, {
        timeout: 8000,
      });

      const aircraft = response.data?.response?.flightroute?.callsign ? response.data.response : null;
      if (!aircraft) continue;

      // ADSBDB returns the route but may not have live position
      // Check if there's an aircraft section with position
      const ac = response.data?.response?.aircraft;
      if (ac && ac.lat !== undefined && ac.lon !== undefined) {
        return {
          callsign: cs,
          lat: parseFloat(ac.lat),
          lng: parseFloat(ac.lon),
          altitude_m: ac.altitude ? parseFloat(ac.altitude) * 0.3048 : null,
          altitude_ft: ac.altitude ? parseInt(ac.altitude) : null,
          velocity_kts: ac.groundspeed ? parseInt(ac.groundspeed) : null,
          heading: ac.heading ? parseFloat(ac.heading) : null,
          vertical_rate: null,
        };
      }
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Format an OpenSky state vector into our position object.
 */
function formatState(s) {
  return {
    callsign: (s[1] || '').trim(),
    lat: s[6],
    lng: s[5],
    altitude_m: s[7],
    altitude_ft: s[7] ? Math.round(s[7] * 3.281) : null,
    velocity_kts: s[9] ? Math.round(s[9] * 1.944) : null,
    heading: s[10],
    vertical_rate: s[11],
    last_contact: s[4],
  };
}

module.exports = { getFlightPosition };
