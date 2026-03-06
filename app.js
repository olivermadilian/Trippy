const dialog = document.getElementById('flight-dialog');
const form = document.getElementById('flight-form');
const addBtn = document.getElementById('add-btn');
const cancelBtn = document.getElementById('cancel-btn');
const flightList = document.getElementById('flight-list');
const emptyState = document.getElementById('empty-state');
const stats = document.getElementById('stats');
const totalFlightsEl = document.getElementById('total-flights');
const dialogTitle = document.getElementById('dialog-title');
const operatorLabel = document.getElementById('operator-label');
const tripNumberLabel = document.getElementById('trip-number-label');
const terminalLabel = document.getElementById('terminal-label');
const gateLabel = document.getElementById('gate-label');
const submitBtn = document.getElementById('submit-btn');
const typeBtns = document.querySelectorAll('.type-btn');
const typeToggle = document.querySelector('.type-toggle');
const appMain = document.getElementById('app-main');
const detailPanel = document.getElementById('detail-panel');
const detailBack = document.getElementById('detail-back');
const detailDelete = document.getElementById('detail-delete');
const detailMap = document.getElementById('detail-map');
const detailRoute = document.getElementById('detail-route');
const detailFields = document.getElementById('detail-fields');

let currentType = 'flight';
let editingId = null;
let detailTripId = null;
let leafletMap = null;

const typeConfig = {
  flight: {
    icon: '✈️',
    operatorLabel: 'Airline',
    numberLabel: 'Flight #',
    operatorPlaceholder: 'e.g. Delta',
    numberPlaceholder: 'e.g. DL 402',
    fromPlaceholder: 'e.g. JFK or New York',
    toPlaceholder: 'e.g. LAX or London',
    terminalLabel: 'Terminal',
    terminalPlaceholder: 'e.g. T3',
    gateLabel: 'Gate',
    gatePlaceholder: 'e.g. B22',
  },
  train: {
    icon: '🚆',
    operatorLabel: 'Operator',
    numberLabel: 'Train #',
    operatorPlaceholder: 'e.g. Amtrak',
    numberPlaceholder: 'e.g. 2173',
    fromPlaceholder: 'e.g. Penn Station',
    toPlaceholder: 'e.g. Union Station',
    terminalLabel: 'Car/Coach',
    terminalPlaceholder: 'e.g. Car 5',
    gateLabel: 'Platform',
    gatePlaceholder: 'e.g. 12',
  },
};

function setType(type) {
  currentType = type;
  const cfg = typeConfig[type];
  const label = type === 'flight' ? 'Flight' : 'Train';

  if (editingId) {
    dialogTitle.textContent = `Edit ${label}`;
    submitBtn.textContent = `Save ${label}`;
  } else {
    dialogTitle.textContent = `Add ${label}`;
    submitBtn.textContent = `Add ${label}`;
  }

  operatorLabel.textContent = cfg.operatorLabel;
  tripNumberLabel.textContent = cfg.numberLabel;
  terminalLabel.textContent = cfg.terminalLabel;
  gateLabel.textContent = cfg.gateLabel;

  document.getElementById('operator').placeholder = cfg.operatorPlaceholder;
  document.getElementById('trip-number').placeholder = cfg.numberPlaceholder;
  document.getElementById('from').placeholder = cfg.fromPlaceholder;
  document.getElementById('to').placeholder = cfg.toPlaceholder;
  document.getElementById('terminal').placeholder = cfg.terminalPlaceholder;
  document.getElementById('gate').placeholder = cfg.gatePlaceholder;

  typeBtns.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.type === type);
  });

  closeAllAutocompletes();
}

// ── Autocomplete ──

function searchAirports(query) {
  const q = query.toLowerCase();
  return AIRPORTS.filter(
    (a) =>
      a.code.toLowerCase().startsWith(q) ||
      a.city.toLowerCase().includes(q) ||
      a.name.toLowerCase().includes(q)
  ).slice(0, 8);
}

function searchStations(query) {
  const q = query.toLowerCase();
  return TRAIN_STATIONS.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.city.toLowerCase().includes(q)
  ).slice(0, 8);
}

function formatAirportDisplay(airport) {
  return `${airport.code} – ${airport.city}`;
}

function formatStationDisplay(station) {
  return `${station.name}, ${station.city}`;
}

function renderAirportItem(airport) {
  return `<span class="ac-main"><span class="ac-code">${escapeHtml(airport.code)}</span>${escapeHtml(airport.name)}</span><span class="ac-detail">${escapeHtml(airport.city)}</span>`;
}

function renderStationItem(station) {
  return `<span class="ac-main">${escapeHtml(station.name)}</span><span class="ac-detail">${escapeHtml(station.city)}, ${escapeHtml(station.country)}</span>`;
}

function closeAllAutocompletes() {
  document.querySelectorAll('.autocomplete-list').forEach((el) => {
    el.classList.remove('open');
    el.innerHTML = '';
  });
  highlightedIndex = -1;
}

let highlightedIndex = -1;

function setupAutocomplete(inputId, listId) {
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);

  input.addEventListener('input', () => {
    // Clear stored coordinates when user types manually
    delete input.dataset.lat;
    delete input.dataset.lng;

    const query = input.value.trim();
    if (query.length < 1) {
      list.classList.remove('open');
      list.innerHTML = '';
      return;
    }

    let results, renderItem, formatDisplay;

    if (currentType === 'flight') {
      results = searchAirports(query);
      renderItem = renderAirportItem;
      formatDisplay = formatAirportDisplay;
    } else {
      results = searchStations(query);
      renderItem = renderStationItem;
      formatDisplay = formatStationDisplay;
    }

    if (results.length === 0) {
      list.classList.remove('open');
      list.innerHTML = '';
      return;
    }

    highlightedIndex = -1;

    list.innerHTML = results
      .map(
        (item, i) =>
          `<li class="autocomplete-item" data-index="${i}">${renderItem(item)}</li>`
      )
      .join('');

    list._results = results;
    list._formatDisplay = formatDisplay;
    list.classList.add('open');
  });

  input.addEventListener('keydown', (e) => {
    if (!list.classList.contains('open')) return;

    const items = list.querySelectorAll('.autocomplete-item');
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlightedIndex = Math.min(highlightedIndex + 1, items.length - 1);
      updateHighlight(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlightedIndex = Math.max(highlightedIndex - 1, 0);
      updateHighlight(items);
    } else if (e.key === 'Enter' && highlightedIndex >= 0) {
      e.preventDefault();
      selectItem(input, list, highlightedIndex);
    } else if (e.key === 'Escape') {
      list.classList.remove('open');
      list.innerHTML = '';
    }
  });

  list.addEventListener('click', (e) => {
    const item = e.target.closest('.autocomplete-item');
    if (!item) return;
    const index = parseInt(item.dataset.index, 10);
    selectItem(input, list, index);
  });

  input.addEventListener('blur', () => {
    setTimeout(() => {
      list.classList.remove('open');
      list.innerHTML = '';
    }, 200);
  });
}

function updateHighlight(items) {
  items.forEach((item, i) => {
    item.classList.toggle('highlighted', i === highlightedIndex);
    if (i === highlightedIndex) {
      item.scrollIntoView({ block: 'nearest' });
    }
  });
}

function selectItem(input, list, index) {
  const result = list._results[index];
  const display = list._formatDisplay(result);
  input.value = display;

  // Store coordinates
  if (result.lat != null) {
    input.dataset.lat = result.lat;
    input.dataset.lng = result.lng;
  }

  list.classList.remove('open');
  list.innerHTML = '';
  highlightedIndex = -1;
}

setupAutocomplete('from', 'from-suggestions');
setupAutocomplete('to', 'to-suggestions');

// ── Trips ──

function loadTrips() {
  try {
    return JSON.parse(localStorage.getItem('trippy-flights')) || [];
  } catch {
    return [];
  }
}

function saveTrips(trips) {
  localStorage.setItem('trippy-flights', JSON.stringify(trips));
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':');
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

function renderTrips() {
  const trips = loadTrips();
  trips.sort((a, b) => b.date.localeCompare(a.date));

  flightList.innerHTML = '';

  if (trips.length === 0) {
    emptyState.hidden = false;
    stats.hidden = true;
    return;
  }

  emptyState.hidden = true;
  stats.hidden = false;

  const flightCount = trips.filter((t) => (t.type || 'flight') === 'flight').length;
  const trainCount = trips.filter((t) => t.type === 'train').length;
  const parts = [];
  if (flightCount) parts.push(`${flightCount} flight${flightCount !== 1 ? 's' : ''}`);
  if (trainCount) parts.push(`${trainCount} train${trainCount !== 1 ? 's' : ''}`);
  totalFlightsEl.textContent = parts.join(' · ');

  for (const trip of trips) {
    const type = trip.type || 'flight';
    const cfg = typeConfig[type];
    const li = document.createElement('li');
    li.className = 'flight-card';
    li.dataset.type = type;
    li.dataset.id = trip.id;

    const metaParts = [];
    if (trip.operator || trip.airline) metaParts.push(trip.operator || trip.airline);
    if (trip.tripNumber || trip.flightNumber) metaParts.push(trip.tripNumber || trip.flightNumber);

    li.innerHTML = `
      <div class="trip-icon ${type}">${cfg.icon}</div>
      <div class="flight-route">
        <div class="airports">
          <span>${escapeHtml(trip.from)}</span>
          <span class="arrow">→</span>
          <span>${escapeHtml(trip.to)}</span>
        </div>
        ${metaParts.length > 0 ? `<div class="flight-meta"><span>${escapeHtml(metaParts.join(' · '))}</span></div>` : ''}
      </div>
      <div class="flight-date">${formatDate(trip.date)}</div>
    `;

    flightList.appendChild(li);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Detail Panel ──

function greatCirclePoints(lat1, lng1, lat2, lng2, n) {
  n = n || 50;
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const points = [];

  const p1 = lat1 * toRad, l1 = lng1 * toRad;
  const p2 = lat2 * toRad, l2 = lng2 * toRad;

  const d = 2 * Math.asin(
    Math.sqrt(
      Math.pow(Math.sin((p2 - p1) / 2), 2) +
      Math.cos(p1) * Math.cos(p2) * Math.pow(Math.sin((l2 - l1) / 2), 2)
    )
  );

  if (d < 1e-10) return [[lat1, lng1], [lat2, lng2]];

  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
    const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
    const z = A * Math.sin(p1) + B * Math.sin(p2);
    points.push([
      Math.atan2(z, Math.sqrt(x * x + y * y)) * toDeg,
      Math.atan2(y, x) * toDeg,
    ]);
  }

  return points;
}

function initMap(trip) {
  const hasCoords = trip.fromLat != null && trip.toLat != null;

  if (!hasCoords) {
    detailMap.innerHTML = '';
    detailMap.className = 'detail-map-placeholder';
    const type = trip.type || 'flight';
    detailMap.textContent = typeConfig[type].icon;
    return;
  }

  detailMap.className = 'detail-map';
  detailMap.innerHTML = '';

  leafletMap = L.map(detailMap, {
    zoomControl: false,
    attributionControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    touchZoom: false,
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
  }).addTo(leafletMap);

  const from = [trip.fromLat, trip.fromLng];
  const to = [trip.toLat, trip.toLng];
  const arcColor = (trip.type || 'flight') === 'train' ? '#10b981' : '#3b82f6';

  const arcPoints = greatCirclePoints(from[0], from[1], to[0], to[1], 60);
  L.polyline(arcPoints, { color: arcColor, weight: 2.5, opacity: 0.8, dashArray: '8 6' }).addTo(leafletMap);

  L.circleMarker(from, { radius: 5, color: arcColor, fillColor: '#f8fafc', fillOpacity: 1, weight: 2 }).addTo(leafletMap);
  L.circleMarker(to, { radius: 5, color: arcColor, fillColor: '#f8fafc', fillOpacity: 1, weight: 2 }).addTo(leafletMap);

  const bounds = L.latLngBounds([from, to]);
  leafletMap.fitBounds(bounds, { padding: [40, 40] });
}

function destroyMap() {
  if (leafletMap) {
    leafletMap.remove();
    leafletMap = null;
  }
}

function getFieldDefs(trip) {
  const type = trip.type || 'flight';
  const cfg = typeConfig[type];
  return [
    { key: 'operator', label: cfg.operatorLabel, placeholder: `Add ${cfg.operatorLabel.toLowerCase()}`, inputType: 'text' },
    { key: 'tripNumber', label: cfg.numberLabel, placeholder: `Add ${cfg.numberLabel.toLowerCase()}`, inputType: 'text' },
    { key: 'departureTime', label: 'Departure', placeholder: 'Add time', inputType: 'time', display: formatTime },
    { key: 'arrivalTime', label: 'Arrival', placeholder: 'Add time', inputType: 'time', display: formatTime },
    { key: 'confirmation', label: 'Confirmation #', placeholder: 'Add confirmation', inputType: 'text' },
    { key: 'seat', label: 'Seat', placeholder: 'Add seat', inputType: 'text' },
    { key: 'terminal', label: cfg.terminalLabel, placeholder: `Add ${cfg.terminalLabel.toLowerCase()}`, inputType: 'text' },
    { key: 'gate', label: cfg.gateLabel, placeholder: `Add ${cfg.gateLabel.toLowerCase()}`, inputType: 'text' },
    { key: 'notes', label: 'Notes', placeholder: 'Add notes', inputType: 'textarea', fullWidth: true },
  ];
}

function renderDetailFields(trip) {
  detailFields.innerHTML = '';
  const defs = getFieldDefs(trip);

  for (const def of defs) {
    const raw = trip[def.key] || trip[legacyKey(def.key)] || '';
    const displayVal = def.display ? def.display(raw) : raw;

    const el = document.createElement('div');
    el.className = 'editable-field' + (def.fullWidth ? ' full-width' : '');
    el.dataset.field = def.key;
    el.dataset.inputType = def.inputType;
    el.dataset.placeholder = def.placeholder;

    el.innerHTML = `
      <span class="field-label">${escapeHtml(def.label)}</span>
      <span class="field-value${!raw ? ' empty' : ''}" data-raw="${escapeHtml(raw)}">${escapeHtml(displayVal || def.placeholder)}</span>
    `;

    detailFields.appendChild(el);
  }
}

function legacyKey(key) {
  if (key === 'operator') return 'airline';
  if (key === 'tripNumber') return 'flightNumber';
  return null;
}

function openDetailPanel(tripId) {
  const trips = loadTrips();
  const trip = trips.find((t) => t.id === tripId);
  if (!trip) return;

  detailTripId = tripId;
  appMain.hidden = true;
  detailPanel.hidden = false;

  // Route header
  const type = trip.type || 'flight';
  const arrowColor = type === 'train' ? '#10b981' : '#3b82f6';
  detailRoute.innerHTML = `
    <div class="detail-route-locations">
      <span>${escapeHtml(trip.from)}</span>
      <span class="detail-route-arrow" style="color:${arrowColor}">→</span>
      <span>${escapeHtml(trip.to)}</span>
    </div>
    <div class="detail-route-date">${formatDate(trip.date)}</div>
  `;

  renderDetailFields(trip);
  initMap(trip);
}

function closeDetailPanel() {
  destroyMap();
  detailPanel.hidden = true;
  appMain.hidden = false;
  detailTripId = null;
  renderTrips();
}

// Inline editing via event delegation
detailFields.addEventListener('click', (e) => {
  const field = e.target.closest('.editable-field');
  if (!field || field.querySelector('.field-input')) return;

  const fieldKey = field.dataset.field;
  const inputType = field.dataset.inputType;
  const placeholder = field.dataset.placeholder;
  const valueEl = field.querySelector('.field-value');
  const rawValue = valueEl.dataset.raw || '';

  let input;
  if (inputType === 'textarea') {
    input = document.createElement('textarea');
    input.rows = 3;
  } else {
    input = document.createElement('input');
    input.type = inputType;
  }
  input.className = 'field-input';
  input.value = rawValue;
  if (inputType !== 'time') {
    input.placeholder = placeholder;
  }

  valueEl.replaceWith(input);
  input.focus();

  const save = () => {
    const newValue = input.value.trim();

    // Save to localStorage
    const trips = loadTrips();
    const trip = trips.find((t) => t.id === detailTripId);
    if (trip) {
      trip[fieldKey] = newValue;
      saveTrips(trips);
    }

    // Find the field def for display formatting
    const defs = getFieldDefs(trip || {});
    const def = defs.find((d) => d.key === fieldKey);
    const displayVal = def && def.display ? def.display(newValue) : newValue;

    const newValueEl = document.createElement('span');
    newValueEl.className = 'field-value' + (!newValue ? ' empty' : '');
    newValueEl.dataset.raw = newValue;
    newValueEl.textContent = displayVal || placeholder;

    input.replaceWith(newValueEl);
  };

  let saved = false;
  input.addEventListener('blur', () => {
    if (!saved) { saved = true; save(); }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && inputType !== 'textarea') {
      e.preventDefault();
      saved = true;
      save();
    }
    if (e.key === 'Escape') {
      // Restore original without saving
      const defs = getFieldDefs({});
      const def = defs.find((d) => d.key === fieldKey);
      const raw = valueEl ? (valueEl.dataset || {}).raw || '' : '';
      const displayVal = def && def.display ? def.display(rawValue) : rawValue;

      const restoredEl = document.createElement('span');
      restoredEl.className = 'field-value' + (!rawValue ? ' empty' : '');
      restoredEl.dataset.raw = rawValue;
      restoredEl.textContent = displayVal || placeholder;

      saved = true;
      input.replaceWith(restoredEl);
    }
  });
});

detailBack.addEventListener('click', closeDetailPanel);

detailDelete.addEventListener('click', () => {
  if (!detailTripId) return;
  const trips = loadTrips().filter((t) => t.id !== detailTripId);
  saveTrips(trips);
  closeDetailPanel();
});

// ── Dialog & Form ──

function openAddDialog() {
  editingId = null;
  form.reset();
  clearInputCoords();
  typeToggle.hidden = false;
  setType('flight');
  dialog.showModal();
}

function openEditDialog(tripId) {
  const trips = loadTrips();
  const trip = trips.find((t) => t.id === tripId);
  if (!trip) return;

  editingId = tripId;
  form.reset();
  clearInputCoords();
  typeToggle.hidden = true;

  const type = trip.type || 'flight';
  setType(type);

  document.getElementById('from').value = trip.from || '';
  document.getElementById('to').value = trip.to || '';
  document.getElementById('date').value = trip.date || '';
  document.getElementById('operator').value = trip.operator || trip.airline || '';
  document.getElementById('trip-number').value = trip.tripNumber || trip.flightNumber || '';
  document.getElementById('confirmation').value = trip.confirmation || '';
  document.getElementById('departure-time').value = trip.departureTime || '';
  document.getElementById('arrival-time').value = trip.arrivalTime || '';
  document.getElementById('seat').value = trip.seat || '';
  document.getElementById('terminal').value = trip.terminal || '';
  document.getElementById('gate').value = trip.gate || '';
  document.getElementById('notes').value = trip.notes || '';

  // Restore stored coordinates
  const fromInput = document.getElementById('from');
  const toInput = document.getElementById('to');
  if (trip.fromLat != null) { fromInput.dataset.lat = trip.fromLat; fromInput.dataset.lng = trip.fromLng; }
  if (trip.toLat != null) { toInput.dataset.lat = trip.toLat; toInput.dataset.lng = trip.toLng; }

  dialog.showModal();
}

function clearInputCoords() {
  const fromInput = document.getElementById('from');
  const toInput = document.getElementById('to');
  delete fromInput.dataset.lat;
  delete fromInput.dataset.lng;
  delete toInput.dataset.lat;
  delete toInput.dataset.lng;
}

function readFormData() {
  const fromInput = document.getElementById('from');
  const toInput = document.getElementById('to');

  return {
    type: currentType,
    from: fromInput.value.trim(),
    to: toInput.value.trim(),
    date: document.getElementById('date').value,
    operator: document.getElementById('operator').value.trim(),
    tripNumber: document.getElementById('trip-number').value.trim(),
    confirmation: document.getElementById('confirmation').value.trim(),
    departureTime: document.getElementById('departure-time').value,
    arrivalTime: document.getElementById('arrival-time').value,
    seat: document.getElementById('seat').value.trim(),
    terminal: document.getElementById('terminal').value.trim(),
    gate: document.getElementById('gate').value.trim(),
    notes: document.getElementById('notes').value.trim(),
    fromLat: fromInput.dataset.lat ? parseFloat(fromInput.dataset.lat) : null,
    fromLng: fromInput.dataset.lng ? parseFloat(fromInput.dataset.lng) : null,
    toLat: toInput.dataset.lat ? parseFloat(toInput.dataset.lat) : null,
    toLng: toInput.dataset.lng ? parseFloat(toInput.dataset.lng) : null,
  };
}

typeBtns.forEach((btn) => {
  btn.addEventListener('click', () => setType(btn.dataset.type));
});

addBtn.addEventListener('click', () => openAddDialog());

cancelBtn.addEventListener('click', () => dialog.close());

dialog.addEventListener('click', (e) => {
  if (e.target === dialog) dialog.close();
});

form.addEventListener('submit', (e) => {
  e.preventDefault();

  const data = readFormData();
  const trips = loadTrips();

  if (editingId) {
    const index = trips.findIndex((t) => t.id === editingId);
    if (index !== -1) {
      trips[index] = { ...trips[index], ...data };
    }
  } else {
    data.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    trips.push(data);
  }

  saveTrips(trips);
  renderTrips();
  editingId = null;
  dialog.close();
});

// Click card → open detail panel
flightList.addEventListener('click', (e) => {
  const card = e.target.closest('.flight-card');
  if (!card) return;
  openDetailPanel(card.dataset.id);
});

renderTrips();
