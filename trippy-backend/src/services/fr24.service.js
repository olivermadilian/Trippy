const axios = require('axios');

const FR24_BASE = 'https://fr24api.flightradar24.com/api';

/** Ensure a datetime string ends with exactly one 'Z' */
function ensureZ(s) {
  if (!s) return null;
  return s.endsWith('Z') ? s : s + 'Z';
}

function getHeaders() {
  return {
    'Authorization': `Bearer ${process.env.FR24_API_KEY}`,
    'Accept': 'application/json',
    'Accept-Version': 'v1',
  };
}

/**
 * Airport coordinate cache — fetched from FR24 Airports API on demand.
 * Maps IATA code -> { lat, lng, city, name }
 */
const airportCache = new Map();
const AIRPORT_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
let airportCacheTimestamp = 0;

async function fetchAirportFromFR24(iataCode) {
  if (!iataCode) return null;
  const code = iataCode.toUpperCase();

  // Check cache
  if (airportCache.has(code) && (Date.now() - airportCacheTimestamp) < AIRPORT_CACHE_TTL) {
    return airportCache.get(code);
  }

  try {
    // FR24 airports endpoint uses IATA code
    const response = await axios.get(`${FR24_BASE}/static/airports/${code}/full`, {
      headers: getHeaders(),
      timeout: 8000,
    });

    const data = response.data;
    if (data && data.lat !== undefined) {
      const info = {
        lat: data.lat,
        lng: data.lon,
        city: data.city || null,
        name: data.name || null,
      };
      airportCache.set(code, info);
      airportCacheTimestamp = Date.now();
      return info;
    }
  } catch (err) {
    console.log(`[fr24] Airport lookup failed for ${code}: ${err.message}`);
  }
  return null;
}

// Fallback static data for common airports (used when FR24 API fails)
const AIRPORTS_FALLBACK = {
  ATL: { lat: 33.6407, lng: -84.4277, city: 'Atlanta', name: 'Hartsfield-Jackson Atlanta Intl' },
  LAX: { lat: 33.9425, lng: -118.4081, city: 'Los Angeles', name: 'Los Angeles Intl' },
  ORD: { lat: 41.9742, lng: -87.9073, city: 'Chicago', name: "O'Hare Intl" },
  DFW: { lat: 32.8998, lng: -97.0403, city: 'Dallas/Fort Worth', name: 'Dallas/Fort Worth Intl' },
  DEN: { lat: 39.8561, lng: -104.6737, city: 'Denver', name: 'Denver Intl' },
  JFK: { lat: 40.6413, lng: -73.7781, city: 'New York', name: 'John F. Kennedy Intl' },
  SFO: { lat: 37.6213, lng: -122.3790, city: 'San Francisco', name: 'San Francisco Intl' },
  SEA: { lat: 47.4502, lng: -122.3088, city: 'Seattle', name: 'Seattle-Tacoma Intl' },
  LAS: { lat: 36.0840, lng: -115.1537, city: 'Las Vegas', name: 'Harry Reid Intl' },
  MCO: { lat: 28.4312, lng: -81.3081, city: 'Orlando', name: 'Orlando Intl' },
  EWR: { lat: 40.6895, lng: -74.1745, city: 'Newark', name: 'Newark Liberty Intl' },
  MIA: { lat: 25.7959, lng: -80.2870, city: 'Miami', name: 'Miami Intl' },
  CLT: { lat: 35.2140, lng: -80.9431, city: 'Charlotte', name: 'Charlotte Douglas Intl' },
  PHX: { lat: 33.4373, lng: -112.0078, city: 'Phoenix', name: 'Phoenix Sky Harbor Intl' },
  IAH: { lat: 29.9902, lng: -95.3368, city: 'Houston', name: 'George Bush Intercontinental' },
  BOS: { lat: 42.3656, lng: -71.0096, city: 'Boston', name: 'Logan Intl' },
  MSP: { lat: 44.8848, lng: -93.2223, city: 'Minneapolis', name: 'Minneapolis-Saint Paul Intl' },
  FLL: { lat: 26.0742, lng: -80.1506, city: 'Fort Lauderdale', name: 'Fort Lauderdale-Hollywood Intl' },
  DTW: { lat: 42.2124, lng: -83.3534, city: 'Detroit', name: 'Detroit Metropolitan Wayne County' },
  PHL: { lat: 39.8744, lng: -75.2424, city: 'Philadelphia', name: 'Philadelphia Intl' },
  LGA: { lat: 40.7769, lng: -73.8740, city: 'New York', name: 'LaGuardia' },
  BWI: { lat: 39.1754, lng: -76.6684, city: 'Baltimore', name: 'Baltimore/Washington Intl' },
  SLC: { lat: 40.7884, lng: -111.9778, city: 'Salt Lake City', name: 'Salt Lake City Intl' },
  DCA: { lat: 38.8512, lng: -77.0402, city: 'Washington D.C.', name: 'Ronald Reagan Washington National' },
  IAD: { lat: 38.9531, lng: -77.4565, city: 'Washington D.C.', name: 'Washington Dulles Intl' },
  SAN: { lat: 32.7338, lng: -117.1933, city: 'San Diego', name: 'San Diego Intl' },
  TPA: { lat: 27.9755, lng: -82.5332, city: 'Tampa', name: 'Tampa Intl' },
  PDX: { lat: 45.5898, lng: -122.5951, city: 'Portland', name: 'Portland Intl' },
  HNL: { lat: 21.3187, lng: -157.9225, city: 'Honolulu', name: 'Daniel K. Inouye Intl' },
  AUS: { lat: 30.1975, lng: -97.6664, city: 'Austin', name: 'Austin-Bergstrom Intl' },
  BNA: { lat: 36.1263, lng: -86.6774, city: 'Nashville', name: 'Nashville Intl' },
  MSY: { lat: 29.9934, lng: -90.2580, city: 'New Orleans', name: 'Louis Armstrong New Orleans Intl' },
  RDU: { lat: 35.8776, lng: -78.7875, city: 'Raleigh/Durham', name: 'Raleigh-Durham Intl' },
  STL: { lat: 38.7487, lng: -90.3700, city: 'St. Louis', name: 'St. Louis Lambert Intl' },
  SMF: { lat: 38.6954, lng: -121.5908, city: 'Sacramento', name: 'Sacramento Intl' },
  SJC: { lat: 37.3626, lng: -121.9291, city: 'San Jose', name: 'San Jose Intl' },
  OAK: { lat: 37.7213, lng: -122.2208, city: 'Oakland', name: 'Oakland Intl' },
  PIT: { lat: 40.4915, lng: -80.2329, city: 'Pittsburgh', name: 'Pittsburgh Intl' },
  CLE: { lat: 41.4058, lng: -81.8539, city: 'Cleveland', name: 'Cleveland Hopkins Intl' },
  IND: { lat: 39.7173, lng: -86.2944, city: 'Indianapolis', name: 'Indianapolis Intl' },
  CMH: { lat: 39.9980, lng: -82.8919, city: 'Columbus', name: 'John Glenn Columbus Intl' },
  MCI: { lat: 39.2976, lng: -94.7139, city: 'Kansas City', name: 'Kansas City Intl' },
  MKE: { lat: 42.9472, lng: -87.8966, city: 'Milwaukee', name: 'Milwaukee Mitchell Intl' },
  ANC: { lat: 61.1743, lng: -149.9962, city: 'Anchorage', name: 'Ted Stevens Anchorage Intl' },
  RSW: { lat: 26.5362, lng: -81.7552, city: 'Fort Myers', name: 'Southwest Florida Intl' },
  JAX: { lat: 30.4941, lng: -81.6879, city: 'Jacksonville', name: 'Jacksonville Intl' },
  OMA: { lat: 41.3032, lng: -95.8941, city: 'Omaha', name: 'Eppley Airfield' },
  ABQ: { lat: 35.0402, lng: -106.6090, city: 'Albuquerque', name: 'Albuquerque Intl Sunport' },

  // --- Canada ---
  YYZ: { lat: 43.6777, lng: -79.6248, city: 'Toronto', name: 'Toronto Pearson Intl' },
  YVR: { lat: 49.1967, lng: -123.1815, city: 'Vancouver', name: 'Vancouver Intl' },
  YUL: { lat: 45.4706, lng: -73.7408, city: 'Montreal', name: 'Montreal-Trudeau Intl' },
  YYC: { lat: 51.1215, lng: -114.0076, city: 'Calgary', name: 'Calgary Intl' },
  YEG: { lat: 53.3097, lng: -113.5800, city: 'Edmonton', name: 'Edmonton Intl' },
  YOW: { lat: 45.3225, lng: -75.6692, city: 'Ottawa', name: 'Ottawa Macdonald-Cartier Intl' },
  YWG: { lat: 49.9100, lng: -97.2399, city: 'Winnipeg', name: 'Winnipeg James Armstrong Richardson Intl' },
  YHZ: { lat: 44.8808, lng: -63.5085, city: 'Halifax', name: 'Halifax Stanfield Intl' },

  // --- Mexico / Central America / Caribbean ---
  MEX: { lat: 19.4363, lng: -99.0721, city: 'Mexico City', name: 'Benito Juarez Intl' },
  CUN: { lat: 21.0365, lng: -86.8771, city: 'Cancun', name: 'Cancun Intl' },
  GDL: { lat: 20.5218, lng: -103.3114, city: 'Guadalajara', name: 'Guadalajara Intl' },
  SJO: { lat: 9.9939, lng: -84.2088, city: 'San Jose', name: 'Juan Santamaria Intl' },
  PTY: { lat: 9.0714, lng: -79.3835, city: 'Panama City', name: 'Tocumen Intl' },
  SJU: { lat: 18.4394, lng: -66.0018, city: 'San Juan', name: 'Luis Munoz Marin Intl' },
  NAS: { lat: 25.0390, lng: -77.4662, city: 'Nassau', name: 'Lynden Pindling Intl' },
  MBJ: { lat: 18.5037, lng: -77.9134, city: 'Montego Bay', name: 'Sangster Intl' },
  PUJ: { lat: 18.5674, lng: -68.3634, city: 'Punta Cana', name: 'Punta Cana Intl' },

  // --- South America ---
  GRU: { lat: -23.4356, lng: -46.4731, city: 'Sao Paulo', name: 'Guarulhos Intl' },
  GIG: { lat: -22.8100, lng: -43.2506, city: 'Rio de Janeiro', name: 'Galeao Intl' },
  EZE: { lat: -34.8222, lng: -58.5358, city: 'Buenos Aires', name: 'Ministro Pistarini Intl' },
  SCL: { lat: -33.3930, lng: -70.7858, city: 'Santiago', name: 'Arturo Merino Benitez Intl' },
  BOG: { lat: 4.7016, lng: -74.1469, city: 'Bogota', name: 'El Dorado Intl' },
  LIM: { lat: -12.0219, lng: -77.1143, city: 'Lima', name: 'Jorge Chavez Intl' },
  BSB: { lat: -15.8711, lng: -47.9186, city: 'Brasilia', name: 'Brasilia Intl' },
  CNF: { lat: -19.6244, lng: -43.9719, city: 'Belo Horizonte', name: 'Tancredo Neves Intl' },
  MVD: { lat: -34.8384, lng: -56.0308, city: 'Montevideo', name: 'Carrasco Intl' },
  UIO: { lat: -0.1292, lng: -78.3575, city: 'Quito', name: 'Mariscal Sucre Intl' },
  CCS: { lat: 10.6032, lng: -66.9906, city: 'Caracas', name: 'Simon Bolivar Intl' },
  MDE: { lat: 6.1645, lng: -75.4231, city: 'Medellin', name: 'Jose Maria Cordova Intl' },

  // --- United Kingdom / Ireland ---
  LHR: { lat: 51.4700, lng: -0.4543, city: 'London', name: 'Heathrow' },
  LGW: { lat: 51.1537, lng: -0.1821, city: 'London', name: 'Gatwick' },
  STN: { lat: 51.8860, lng: 0.2389, city: 'London', name: 'Stansted' },
  LTN: { lat: 51.8747, lng: -0.3683, city: 'London', name: 'Luton' },
  MAN: { lat: 53.3537, lng: -2.2750, city: 'Manchester', name: 'Manchester' },
  EDI: { lat: 55.9508, lng: -3.3615, city: 'Edinburgh', name: 'Edinburgh' },
  BHX: { lat: 52.4539, lng: -1.7480, city: 'Birmingham', name: 'Birmingham' },
  BRS: { lat: 51.3827, lng: -2.7191, city: 'Bristol', name: 'Bristol' },
  GLA: { lat: 55.8642, lng: -4.4331, city: 'Glasgow', name: 'Glasgow' },
  DUB: { lat: 53.4264, lng: -6.2499, city: 'Dublin', name: 'Dublin' },
  SNN: { lat: 52.7020, lng: -8.9248, city: 'Shannon', name: 'Shannon' },

  // --- Western Europe ---
  CDG: { lat: 49.0097, lng: 2.5479, city: 'Paris', name: 'Charles de Gaulle' },
  ORY: { lat: 48.7233, lng: 2.3795, city: 'Paris', name: 'Orly' },
  AMS: { lat: 52.3105, lng: 4.7683, city: 'Amsterdam', name: 'Schiphol' },
  FRA: { lat: 50.0379, lng: 8.5622, city: 'Frankfurt', name: 'Frankfurt' },
  MUC: { lat: 48.3537, lng: 11.7750, city: 'Munich', name: 'Munich' },
  ZRH: { lat: 47.4582, lng: 8.5555, city: 'Zurich', name: 'Zurich' },
  BRU: { lat: 50.9010, lng: 4.4856, city: 'Brussels', name: 'Brussels' },
  VIE: { lat: 48.1103, lng: 16.5697, city: 'Vienna', name: 'Vienna Intl' },
  GVA: { lat: 46.2381, lng: 6.1089, city: 'Geneva', name: 'Geneva' },
  DUS: { lat: 51.2895, lng: 6.7668, city: 'Dusseldorf', name: 'Dusseldorf' },
  HAM: { lat: 53.6304, lng: 10.0065, city: 'Hamburg', name: 'Hamburg' },
  CGN: { lat: 50.8659, lng: 7.1427, city: 'Cologne', name: 'Cologne Bonn' },
  TXL: { lat: 52.5597, lng: 13.2877, city: 'Berlin', name: 'Berlin Tegel' },
  BER: { lat: 52.3667, lng: 13.5033, city: 'Berlin', name: 'Berlin Brandenburg' },
  LUX: { lat: 49.6233, lng: 6.2044, city: 'Luxembourg', name: 'Luxembourg' },

  // --- Southern Europe ---
  MAD: { lat: 40.4983, lng: -3.5676, city: 'Madrid', name: 'Adolfo Suarez Madrid-Barajas' },
  BCN: { lat: 41.2974, lng: 2.0833, city: 'Barcelona', name: 'Barcelona-El Prat' },
  FCO: { lat: 41.8003, lng: 12.2389, city: 'Rome', name: 'Leonardo da Vinci-Fiumicino' },
  MXP: { lat: 45.6306, lng: 8.7281, city: 'Milan', name: 'Malpensa' },
  LIN: { lat: 45.4451, lng: 9.2775, city: 'Milan', name: 'Linate' },
  LIS: { lat: 38.7756, lng: -9.1354, city: 'Lisbon', name: 'Humberto Delgado' },
  OPO: { lat: 41.2481, lng: -8.6814, city: 'Porto', name: 'Francisco Sa Carneiro' },
  ATH: { lat: 37.9364, lng: 23.9445, city: 'Athens', name: 'Eleftherios Venizelos' },
  PMI: { lat: 39.5517, lng: 2.7388, city: 'Palma de Mallorca', name: 'Palma de Mallorca' },
  AGP: { lat: 36.6749, lng: -4.4991, city: 'Malaga', name: 'Malaga-Costa del Sol' },
  VLC: { lat: 39.4893, lng: -0.4816, city: 'Valencia', name: 'Valencia' },
  NAP: { lat: 40.8860, lng: 14.2908, city: 'Naples', name: 'Naples Intl' },
  VCE: { lat: 45.5053, lng: 12.3519, city: 'Venice', name: 'Marco Polo' },
  NCE: { lat: 43.6584, lng: 7.2159, city: 'Nice', name: 'Nice Cote d\'Azur' },
  TLS: { lat: 43.6291, lng: 1.3638, city: 'Toulouse', name: 'Toulouse-Blagnac' },
  MRS: { lat: 43.4393, lng: 5.2214, city: 'Marseille', name: 'Marseille Provence' },
  LYS: { lat: 45.7256, lng: 5.0811, city: 'Lyon', name: 'Lyon-Saint Exupery' },

  // --- Northern / Eastern Europe ---
  CPH: { lat: 55.6180, lng: 12.6560, city: 'Copenhagen', name: 'Copenhagen' },
  ARN: { lat: 59.6519, lng: 17.9186, city: 'Stockholm', name: 'Stockholm Arlanda' },
  OSL: { lat: 60.1976, lng: 11.1004, city: 'Oslo', name: 'Oslo Gardermoen' },
  HEL: { lat: 60.3172, lng: 24.9633, city: 'Helsinki', name: 'Helsinki-Vantaa' },
  WAW: { lat: 52.1657, lng: 20.9671, city: 'Warsaw', name: 'Warsaw Chopin' },
  PRG: { lat: 50.1008, lng: 14.2600, city: 'Prague', name: 'Vaclav Havel' },
  BUD: { lat: 47.4298, lng: 19.2611, city: 'Budapest', name: 'Budapest Ferenc Liszt' },
  OTP: { lat: 44.5722, lng: 26.1022, city: 'Bucharest', name: 'Henri Coanda' },
  SOF: { lat: 42.6952, lng: 23.4062, city: 'Sofia', name: 'Sofia' },
  BEG: { lat: 44.8184, lng: 20.3091, city: 'Belgrade', name: 'Nikola Tesla' },
  ZAG: { lat: 45.7430, lng: 16.0688, city: 'Zagreb', name: 'Franjo Tudman' },
  LED: { lat: 59.8003, lng: 30.2625, city: 'Saint Petersburg', name: 'Pulkovo' },
  SVO: { lat: 55.9726, lng: 37.4146, city: 'Moscow', name: 'Sheremetyevo' },
  DME: { lat: 55.4088, lng: 37.9063, city: 'Moscow', name: 'Domodedovo' },
  TLL: { lat: 59.4133, lng: 24.8328, city: 'Tallinn', name: 'Lennart Meri Tallinn' },
  RIX: { lat: 56.9236, lng: 23.9711, city: 'Riga', name: 'Riga Intl' },
  VNO: { lat: 54.6341, lng: 25.2858, city: 'Vilnius', name: 'Vilnius Intl' },
  KRK: { lat: 50.0777, lng: 19.7848, city: 'Krakow', name: 'John Paul II Intl' },

  // --- Turkey ---
  IST: { lat: 41.2753, lng: 28.7519, city: 'Istanbul', name: 'Istanbul' },
  SAW: { lat: 40.8986, lng: 29.3092, city: 'Istanbul', name: 'Sabiha Gokcen' },
  AYT: { lat: 36.8987, lng: 30.8005, city: 'Antalya', name: 'Antalya' },
  ADB: { lat: 38.2924, lng: 27.1570, city: 'Izmir', name: 'Adnan Menderes' },
  ESB: { lat: 40.1281, lng: 32.9951, city: 'Ankara', name: 'Esenboga' },

  // --- Middle East ---
  DXB: { lat: 25.2532, lng: 55.3657, city: 'Dubai', name: 'Dubai Intl' },
  AUH: { lat: 24.4330, lng: 54.6511, city: 'Abu Dhabi', name: 'Abu Dhabi Intl' },
  DOH: { lat: 25.2731, lng: 51.6081, city: 'Doha', name: 'Hamad Intl' },
  RUH: { lat: 24.9576, lng: 46.6988, city: 'Riyadh', name: 'King Khalid Intl' },
  JED: { lat: 21.6796, lng: 39.1565, city: 'Jeddah', name: 'King Abdulaziz Intl' },
  TLV: { lat: 32.0055, lng: 34.8854, city: 'Tel Aviv', name: 'Ben Gurion' },
  AMM: { lat: 31.7226, lng: 35.9932, city: 'Amman', name: 'Queen Alia Intl' },
  BAH: { lat: 26.2708, lng: 50.6336, city: 'Bahrain', name: 'Bahrain Intl' },
  MCT: { lat: 23.5933, lng: 58.2844, city: 'Muscat', name: 'Muscat Intl' },
  KWI: { lat: 29.2266, lng: 47.9689, city: 'Kuwait City', name: 'Kuwait Intl' },
  BEY: { lat: 33.8209, lng: 35.4884, city: 'Beirut', name: 'Rafic Hariri Intl' },
  BGW: { lat: 33.2625, lng: 44.2346, city: 'Baghdad', name: 'Baghdad Intl' },

  // --- Africa ---
  JNB: { lat: -26.1392, lng: 28.2460, city: 'Johannesburg', name: 'O.R. Tambo Intl' },
  CPT: { lat: -33.9715, lng: 18.6021, city: 'Cape Town', name: 'Cape Town Intl' },
  CAI: { lat: 30.1219, lng: 31.4056, city: 'Cairo', name: 'Cairo Intl' },
  ADD: { lat: 8.9779, lng: 38.7993, city: 'Addis Ababa', name: 'Bole Intl' },
  NBO: { lat: -1.3192, lng: 36.9278, city: 'Nairobi', name: 'Jomo Kenyatta Intl' },
  LOS: { lat: 6.5774, lng: 3.3212, city: 'Lagos', name: 'Murtala Muhammed Intl' },
  CMN: { lat: 33.3675, lng: -7.5899, city: 'Casablanca', name: 'Mohammed V Intl' },
  ALG: { lat: 36.6910, lng: 3.2154, city: 'Algiers', name: 'Houari Boumediene' },
  TUN: { lat: 36.8510, lng: 10.2272, city: 'Tunis', name: 'Tunis-Carthage' },
  DAR: { lat: -6.8781, lng: 39.2026, city: 'Dar es Salaam', name: 'Julius Nyerere Intl' },
  ACC: { lat: 5.6052, lng: -0.1668, city: 'Accra', name: 'Kotoka Intl' },
  DKR: { lat: 14.7397, lng: -17.4902, city: 'Dakar', name: 'Blaise Diagne Intl' },
  MRU: { lat: -20.4302, lng: 57.6836, city: 'Mauritius', name: 'Sir Seewoosagur Ramgoolam Intl' },
  DSS: { lat: 14.6700, lng: -17.0700, city: 'Dakar', name: 'Blaise Diagne Intl' },
  HRG: { lat: 27.1783, lng: 33.7994, city: 'Hurghada', name: 'Hurghada Intl' },
  SSH: { lat: 27.9773, lng: 34.3953, city: 'Sharm El Sheikh', name: 'Sharm El Sheikh Intl' },

  // --- South Asia ---
  DEL: { lat: 28.5562, lng: 77.1000, city: 'New Delhi', name: 'Indira Gandhi Intl' },
  BOM: { lat: 19.0896, lng: 72.8656, city: 'Mumbai', name: 'Chhatrapati Shivaji Maharaj Intl' },
  BLR: { lat: 13.1986, lng: 77.7066, city: 'Bangalore', name: 'Kempegowda Intl' },
  MAA: { lat: 12.9941, lng: 80.1709, city: 'Chennai', name: 'Chennai Intl' },
  CCU: { lat: 22.6547, lng: 88.4467, city: 'Kolkata', name: 'Netaji Subhas Chandra Bose Intl' },
  HYD: { lat: 17.2403, lng: 78.4294, city: 'Hyderabad', name: 'Rajiv Gandhi Intl' },
  COK: { lat: 10.1520, lng: 76.4019, city: 'Kochi', name: 'Cochin Intl' },
  CMB: { lat: 7.1808, lng: 79.8841, city: 'Colombo', name: 'Bandaranaike Intl' },
  DAC: { lat: 23.8433, lng: 90.3978, city: 'Dhaka', name: 'Hazrat Shahjalal Intl' },
  KTM: { lat: 27.6966, lng: 85.3591, city: 'Kathmandu', name: 'Tribhuvan Intl' },
  ISB: { lat: 33.5491, lng: 72.8289, city: 'Islamabad', name: 'Islamabad Intl' },
  KHI: { lat: 24.9065, lng: 67.1609, city: 'Karachi', name: 'Jinnah Intl' },
  LHE: { lat: 31.5216, lng: 74.4036, city: 'Lahore', name: 'Allama Iqbal Intl' },
  MLE: { lat: 4.1918, lng: 73.5291, city: 'Male', name: 'Velana Intl' },

  // --- Southeast Asia ---
  SIN: { lat: 1.3644, lng: 103.9915, city: 'Singapore', name: 'Changi' },
  BKK: { lat: 13.6900, lng: 100.7501, city: 'Bangkok', name: 'Suvarnabhumi' },
  DMK: { lat: 13.9126, lng: 100.6068, city: 'Bangkok', name: 'Don Mueang' },
  KUL: { lat: 2.7456, lng: 101.7099, city: 'Kuala Lumpur', name: 'Kuala Lumpur Intl' },
  CGK: { lat: -6.1256, lng: 106.6559, city: 'Jakarta', name: 'Soekarno-Hatta Intl' },
  MNL: { lat: 14.5086, lng: 121.0198, city: 'Manila', name: 'Ninoy Aquino Intl' },
  SGN: { lat: 10.8188, lng: 106.6520, city: 'Ho Chi Minh City', name: 'Tan Son Nhat Intl' },
  HAN: { lat: 21.2212, lng: 105.8072, city: 'Hanoi', name: 'Noi Bai Intl' },
  REP: { lat: 13.4107, lng: 103.8128, city: 'Siem Reap', name: 'Siem Reap Intl' },
  PNH: { lat: 11.5466, lng: 104.8442, city: 'Phnom Penh', name: 'Phnom Penh Intl' },
  RGN: { lat: 16.9073, lng: 96.1332, city: 'Yangon', name: 'Yangon Intl' },
  DPS: { lat: -8.7482, lng: 115.1672, city: 'Bali', name: 'Ngurah Rai Intl' },
  HKT: { lat: 8.1132, lng: 98.3169, city: 'Phuket', name: 'Phuket Intl' },

  // --- East Asia ---
  PEK: { lat: 40.0799, lng: 116.6031, city: 'Beijing', name: 'Beijing Capital Intl' },
  PKX: { lat: 39.5098, lng: 116.4105, city: 'Beijing', name: 'Beijing Daxing Intl' },
  PVG: { lat: 31.1443, lng: 121.8083, city: 'Shanghai', name: 'Pudong Intl' },
  SHA: { lat: 31.1979, lng: 121.3363, city: 'Shanghai', name: 'Hongqiao Intl' },
  CAN: { lat: 23.3924, lng: 113.2988, city: 'Guangzhou', name: 'Baiyun Intl' },
  HKG: { lat: 22.3080, lng: 113.9185, city: 'Hong Kong', name: 'Hong Kong Intl' },
  NRT: { lat: 35.7647, lng: 140.3864, city: 'Tokyo', name: 'Narita Intl' },
  HND: { lat: 35.5494, lng: 139.7798, city: 'Tokyo', name: 'Haneda' },
  KIX: { lat: 34.4347, lng: 135.2440, city: 'Osaka', name: 'Kansai Intl' },
  ICN: { lat: 37.4602, lng: 126.4407, city: 'Seoul', name: 'Incheon Intl' },
  GMP: { lat: 37.5583, lng: 126.7906, city: 'Seoul', name: 'Gimpo Intl' },
  TPE: { lat: 25.0797, lng: 121.2342, city: 'Taipei', name: 'Taiwan Taoyuan Intl' },
  TSA: { lat: 25.0694, lng: 121.5525, city: 'Taipei', name: 'Songshan' },
  CTS: { lat: 42.7752, lng: 141.6924, city: 'Sapporo', name: 'New Chitose' },
  FUK: { lat: 33.5859, lng: 130.4507, city: 'Fukuoka', name: 'Fukuoka' },
  NGO: { lat: 34.8584, lng: 136.8125, city: 'Nagoya', name: 'Chubu Centrair Intl' },
  SZX: { lat: 22.6393, lng: 113.8107, city: 'Shenzhen', name: 'Shenzhen Bao\'an Intl' },
  CTU: { lat: 30.5785, lng: 103.9471, city: 'Chengdu', name: 'Shuangliu Intl' },
  CKG: { lat: 29.7192, lng: 106.6417, city: 'Chongqing', name: 'Jiangbei Intl' },
  XIY: { lat: 34.4471, lng: 108.7516, city: "Xi'an", name: 'Xianyang Intl' },
  KMG: { lat: 24.9924, lng: 102.7433, city: 'Kunming', name: 'Changshui Intl' },
  WUH: { lat: 30.7838, lng: 114.2081, city: 'Wuhan', name: 'Tianhe Intl' },
  HGH: { lat: 30.2295, lng: 120.4344, city: 'Hangzhou', name: 'Xiaoshan Intl' },
  NKG: { lat: 31.7420, lng: 118.8620, city: 'Nanjing', name: 'Lukou Intl' },
  TAO: { lat: 36.2661, lng: 120.3744, city: 'Qingdao', name: 'Jiaodong Intl' },
  MFM: { lat: 22.1496, lng: 113.5920, city: 'Macau', name: 'Macau Intl' },

  // --- Oceania ---
  SYD: { lat: -33.9461, lng: 151.1772, city: 'Sydney', name: 'Kingsford Smith' },
  MEL: { lat: -37.6690, lng: 144.8410, city: 'Melbourne', name: 'Melbourne' },
  BNE: { lat: -27.3842, lng: 153.1175, city: 'Brisbane', name: 'Brisbane' },
  PER: { lat: -31.9403, lng: 115.9670, city: 'Perth', name: 'Perth' },
  AKL: { lat: -37.0082, lng: 174.7850, city: 'Auckland', name: 'Auckland' },
  WLG: { lat: -41.3272, lng: 174.8053, city: 'Wellington', name: 'Wellington Intl' },
  CHC: { lat: -43.4864, lng: 172.5369, city: 'Christchurch', name: 'Christchurch Intl' },
  ADL: { lat: -34.9461, lng: 138.5310, city: 'Adelaide', name: 'Adelaide' },
  OOL: { lat: -28.1644, lng: 153.5047, city: 'Gold Coast', name: 'Gold Coast' },
  CBR: { lat: -35.3069, lng: 149.1951, city: 'Canberra', name: 'Canberra' },
  NAN: { lat: -17.7554, lng: 177.4431, city: 'Nadi', name: 'Nadi Intl' },
  PPT: { lat: -17.5537, lng: -149.6096, city: 'Tahiti', name: 'Faaa Intl' },

  // --- Additional popular destinations ---
  TFS: { lat: 28.0445, lng: -16.5725, city: 'Tenerife', name: 'Tenerife South' },
  LPA: { lat: 27.9319, lng: -15.3866, city: 'Gran Canaria', name: 'Gran Canaria' },
  IBZ: { lat: 38.8729, lng: 1.3731, city: 'Ibiza', name: 'Ibiza' },
  HER: { lat: 35.3397, lng: 25.1803, city: 'Heraklion', name: 'Heraklion Intl' },
  CFU: { lat: 39.6019, lng: 19.9117, city: 'Corfu', name: 'Ioannis Kapodistrias' },
  SKG: { lat: 40.5197, lng: 22.9709, city: 'Thessaloniki', name: 'Thessaloniki Macedonia' },
  SPU: { lat: 43.5389, lng: 16.2980, city: 'Split', name: 'Split' },
  DBV: { lat: 42.5614, lng: 18.2682, city: 'Dubrovnik', name: 'Dubrovnik' },
  FLR: { lat: 43.8100, lng: 11.2051, city: 'Florence', name: 'Florence Peretola' },
  PSA: { lat: 43.6839, lng: 10.3927, city: 'Pisa', name: 'Galileo Galilei' },
  BGY: { lat: 45.6739, lng: 9.7042, city: 'Bergamo', name: 'Orio al Serio' },
  CTA: { lat: 37.4668, lng: 15.0664, city: 'Catania', name: 'Fontanarossa' },
  FAO: { lat: 37.0144, lng: -7.9659, city: 'Faro', name: 'Faro' },
  RAK: { lat: 31.6069, lng: -8.0363, city: 'Marrakech', name: 'Menara' },
};

/** Look up airport info by IATA code — tries FR24 API first, falls back to static data */
async function getAirport(iata) {
  const empty = { lat: null, lng: null, city: null, name: null };
  if (!iata) return empty;
  const code = iata.toUpperCase();

  // Check in-memory cache first
  if (airportCache.has(code)) return airportCache.get(code);

  // Try FR24 API
  const fr24Data = await fetchAirportFromFR24(code);
  if (fr24Data) return fr24Data;

  // Fallback to static data
  const fallback = AIRPORTS_FALLBACK[code];
  if (fallback) {
    airportCache.set(code, fallback);
    return fallback;
  }

  return empty;
}

/**
 * Look up flights by flight number (e.g. "AA1111") using FR24 Flight Summary.
 * Returns all matching flights within the date range.
 * Times are already in proper UTC from FR24.
 */
async function lookupFlight(callsign, date) {
  const clean = callsign.toUpperCase().replace(/\s+/g, '');

  // Build date range: if date provided, use that day; otherwise use today ± 1 day
  let dateFrom, dateTo;
  if (date) {
    dateFrom = `${date}T00:00:00`;
    dateTo = `${date}T23:59:59`;
  } else {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    dateFrom = yesterday.toISOString().replace(/\.\d{3}Z$/, '');
    dateTo = tomorrow.toISOString().replace(/\.\d{3}Z$/, '');
  }

  try {
    const response = await axios.get(`${FR24_BASE}/flight-summary/full`, {
      headers: getHeaders(),
      params: {
        flight_datetime_from: dateFrom,
        flight_datetime_to: dateTo,
        flights: clean,
        limit: 10,
        sort: 'desc',
      },
      timeout: 15000,
    });

    const flights = response.data?.data;
    if (!flights || flights.length === 0) {
      return null;
    }

    // Map FR24 response to our format
    const mapped = await Promise.all(flights.map(async f => {
      const ended = f.flight_ended === 'true' || f.flight_ended === true;
      const origAirport = await getAirport(f.orig_iata);
      const destAirport = await getAirport(f.dest_iata);

      // For live flights without a landed time, estimate arrival using
      // flight_time (scheduled duration in seconds) from takeoff
      let arrivalTime = f.datetime_landed ? ensureZ(f.datetime_landed) : null;
      if (!arrivalTime && !ended && f.datetime_takeoff && f.flight_time) {
        try {
          const takeoffMs = new Date(ensureZ(f.datetime_takeoff)).getTime();
          const durationMs = f.flight_time * 1000;
          const etaMs = takeoffMs + durationMs;
          arrivalTime = new Date(etaMs).toISOString();
          console.log(`[fr24] Estimated arrival for ${f.flight}: ${arrivalTime} (takeoff + ${f.flight_time}s)`);
        } catch (e) {
          // ignore date parsing errors
        }
      }

      return {
        fr24_id: f.fr24_id || null,
        callsign: f.flight || clean,
        carrier: null, // FR24 gives operated_as ICAO code, not name
        carrier_code: f.operated_as || null,
        flight_ended: ended,
        origin: {
          code: f.orig_iata || null,
          icao: f.origin_icao || null,
          airport: origAirport.name,
          city: origAirport.city,
          lat: origAirport.lat,
          lng: origAirport.lng,
          scheduled: f.datetime_takeoff ? ensureZ(f.datetime_takeoff) : null,
          terminal: null,
          gate: null,
        },
        destination: {
          code: f.dest_iata || null,
          icao: f.destination_icao || null,
          airport: destAirport.name,
          city: destAirport.city,
          lat: destAirport.lat,
          lng: destAirport.lng,
          scheduled: arrivalTime,
          terminal: null,
          gate: null,
        },
        aircraft: f.reg || null,
        aircraft_type: f.type || null,
        status: ended ? 'landed' : 'active',
        flight_date: f.datetime_takeoff ? f.datetime_takeoff.split('T')[0] : null,
        flight_time: f.flight_time || null,
        actual_distance_km: f.actual_distance || null,
        circle_distance_km: f.circle_distance || null,
        category: f.category || null,
      };
    }));

    // Deduplicate by route+takeoff time
    const seen = new Set();
    const unique = mapped.filter(f => {
      const key = `${f.origin.code}-${f.destination.code}-${f.origin.scheduled}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return unique;
  } catch (err) {
    if (err.response?.status === 429) {
      throw new Error('Flight lookup rate limit exceeded. Try again later.');
    }
    if (err.response?.status === 402) {
      throw new Error('Insufficient FR24 API credits.');
    }
    throw new Error('Flight lookup failed: ' + (err.response?.data?.message || err.message));
  }
}

// Per-callsign cache for live tracking
const trackCache = new Map();
const CACHE_TTL = 25000; // 25 seconds

/**
 * Get live position of a flight using FR24 Live Flight Positions.
 * Uses bounding box query and filters by callsign/flight number.
 */
async function getFlightPosition(callsign) {
  const clean = callsign.toUpperCase().replace(/\s+/g, '');

  // Check cache
  const cached = trackCache.get(clean);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return cached.data;
  }

  let result = null;

  // Strategy: Query large regions and filter by flight number
  const regions = [
    // North America: "N,S,W,E"
    '55,20,-130,-60',
    // Europe
    '72,35,-15,45',
    // East Asia / Oceania
    '50,-45,90,180',
    // Middle East / South Asia
    '45,5,30,90',
    // South America
    '15,-55,-85,-30',
    // Africa
    '38,-35,-20,55',
  ];

  // Determine most likely region based on airline prefix
  const naAirlines = ['AA', 'DL', 'UA', 'WN', 'B6', 'AS', 'NK', 'F9', 'G4', 'HA', 'AC', 'WS'];
  const euAirlines = ['BA', 'LH', 'AF', 'KL', 'IB', 'FR', 'U2', 'W6', 'VY', 'SK', 'AY', 'TP', 'AZ', 'EI', 'TK', 'LX', 'OS'];
  const asAirlines = ['SQ', 'CX', 'QF', 'NH', 'JL', 'OZ', 'KE', 'CI', 'BR', 'CZ', 'MU', 'CA', 'MH', 'GA', 'PR'];
  const meAirlines = ['EK', 'QR', 'SV', 'WY', 'GF', 'RJ', 'MS', 'AI', '6E', 'ET'];

  const prefix = clean.replace(/\d+/g, '');
  let order;
  if (naAirlines.includes(prefix)) order = [0, 1, 2, 3, 4, 5];
  else if (euAirlines.includes(prefix)) order = [1, 0, 3, 5, 2, 4];
  else if (asAirlines.includes(prefix)) order = [2, 3, 0, 1, 5, 4];
  else if (meAirlines.includes(prefix)) order = [3, 1, 2, 5, 0, 4];
  else order = [0, 1, 2, 3, 4, 5];

  // Try up to 2 regions
  for (let i = 0; i < Math.min(2, order.length); i++) {
    try {
      console.log(`[fr24] Querying region ${order[i]} for ${clean}...`);
      const response = await axios.get(`${FR24_BASE}/live/flight-positions/full`, {
        headers: getHeaders(),
        params: { bounds: regions[order[i]] },
        timeout: 12000,
      });

      const flights = response.data?.data || [];
      console.log(`[fr24] Region ${order[i]}: ${flights.length} aircraft`);

      // Match by flight number or callsign
      const match = flights.find(f => {
        const flt = (f.flight || '').toUpperCase().replace(/\s+/g, '');
        const cs = (f.callsign || '').toUpperCase().replace(/\s+/g, '');
        return flt === clean || cs === clean;
      });

      if (match) {
        console.log(`[fr24] Match: ${match.flight} at ${match.lat},${match.lon} alt=${match.alt}`);
        result = {
          callsign: match.flight || match.callsign,
          lat: match.lat,
          lng: match.lon,
          altitude_m: match.alt ? Math.round(match.alt * 0.3048) : null,
          altitude_ft: match.alt || null,
          velocity_kts: match.gspeed || null,
          heading: match.track || null,
          vertical_rate: match.vspeed || null,
          eta: match.eta || null,
          source: match.source || 'FR24',
          fr24_id: match.fr24_id || null,
          origin_iata: match.orig_iata || null,
          destination_iata: match.dest_iata || null,
          aircraft_type: match.type || null,
          registration: match.reg || null,
        };
        break;
      }
    } catch (err) {
      console.error(`[fr24] Region ${order[i]} error:`, err.message);
      if (err.response?.status === 429 || err.response?.status === 402) break;
      continue;
    }
  }

  // Cache result
  trackCache.set(clean, { data: result, timestamp: Date.now() });

  // Clean old entries
  if (trackCache.size > 100) {
    const cutoff = Date.now() - CACHE_TTL * 10;
    for (const [key, val] of trackCache) {
      if (val.timestamp < cutoff) trackCache.delete(key);
    }
  }

  return result;
}

module.exports = { lookupFlight, getFlightPosition };
