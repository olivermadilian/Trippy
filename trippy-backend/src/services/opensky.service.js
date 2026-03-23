const axios = require('axios');

const OPENSKY_BASE = 'https://opensky-network.org/api';

// In-memory cache to avoid hammering OpenSky (rate limit ~10 req/min anonymous)
let stateCache = { data: null, timestamp: 0 };
const CACHE_TTL = 30000; // 30 seconds

// Common IATA → ICAO airline code mappings
// OpenSky uses ICAO callsigns (e.g., DAL484) while we store IATA (e.g., DL484)
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

/**
 * Convert an IATA callsign (e.g., DL484) to ICAO format (e.g., DAL484).
 */
function iataToIcao(callsign) {
  const match = callsign.match(/^([A-Z0-9]{2})(\d+)$/);
  if (!match) return callsign;
  const [, iata, num] = match;
  const icao = IATA_TO_ICAO[iata];
  return icao ? `${icao}${num}` : callsign;
}

/**
 * Refresh the cached OpenSky state data if stale.
 * Returns an array of slim state objects.
 */
async function refreshCache() {
  const now = Date.now();
  if (stateCache.data && (now - stateCache.timestamp) < CACHE_TTL) {
    return stateCache.data;
  }

  try {
    const response = await axios.get(`${OPENSKY_BASE}/states/all`, {
      timeout: 20000,
    });

    if (!response.data?.states) return stateCache.data || [];

    // OpenSky state vector format:
    // [0] icao24, [1] callsign, [2] origin_country, [3] time_position,
    // [4] last_contact, [5] longitude, [6] latitude, [7] baro_altitude,
    // [8] on_ground, [9] velocity, [10] true_track (heading),
    // [11] vertical_rate, [12] sensors, [13] geo_altitude,
    // [14] squawk, [15] spi, [16] position_source

    // Only keep what we need to reduce memory footprint
    const slim = response.data.states
      .filter(s => s[1] && s[5] !== null && s[6] !== null)
      .map(s => ({
        callsign: (s[1] || '').trim().toUpperCase(),
        lng: s[5],
        lat: s[6],
        alt: s[7],
        on_ground: s[8],
        velocity: s[9],
        heading: s[10],
        vrate: s[11],
        last_contact: s[4],
      }));

    stateCache = { data: slim, timestamp: now };
    return slim;
  } catch (err) {
    if (err.response?.status === 429) {
      console.log('OpenSky rate limited');
    } else {
      console.error('OpenSky fetch error:', err.message);
    }
    return stateCache.data || [];
  }
}

/**
 * Look up a flight's live position by callsign.
 * Accepts IATA (DL484) or ICAO (DAL484) format.
 *
 * Returns position data or null if not found / on ground.
 */
async function getFlightPosition(callsign) {
  const clean = callsign.toUpperCase().replace(/\s+/g, '');
  const icaoCallsign = iataToIcao(clean);

  const states = await refreshCache();
  if (!states || states.length === 0) return null;

  // Try ICAO callsign first (exact), then original (exact), then prefix matches
  let match = states.find(s => s.callsign === icaoCallsign);
  if (!match) match = states.find(s => s.callsign === clean);
  if (!match) match = states.find(s => s.callsign.startsWith(icaoCallsign) || s.callsign.startsWith(clean));

  if (!match) return null;
  // Skip aircraft on the ground
  if (match.on_ground) return null;

  return {
    callsign: match.callsign,
    lat: match.lat,
    lng: match.lng,
    altitude_m: match.alt,
    altitude_ft: match.alt ? Math.round(match.alt * 3.281) : null,
    velocity_kts: match.velocity ? Math.round(match.velocity * 1.944) : null,
    heading: match.heading,
    vertical_rate: match.vrate,
    last_contact: match.last_contact,
  };
}

module.exports = { getFlightPosition };
