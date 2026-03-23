// Google Places API proxy — keeps API key server-side

async function autocomplete(req, res) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return res.status(500).json({ error: 'Google Places API key not configured' });

  const { query, types } = req.query;
  if (!query || query.length < 2) return res.json({ predictions: [] });

  const url = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
  url.searchParams.set('input', query);
  url.searchParams.set('key', key);
  if (types) url.searchParams.set('types', types);

  try {
    const resp = await fetch(url);
    const data = await resp.json();
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      return res.status(502).json({ error: data.error_message || data.status });
    }
    res.json({
      predictions: (data.predictions || []).map(p => ({
        placeId: p.place_id,
        description: p.description,
        mainText: p.structured_formatting?.main_text,
        secondaryText: p.structured_formatting?.secondary_text,
      }))
    });
  } catch (err) {
    console.error('[places] API error:', err.message);
    res.status(502).json({ error: 'Failed to reach Google Places API' });
  }
}

async function details(req, res) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return res.status(500).json({ error: 'Google Places API key not configured' });

  const { placeId } = req.query;
  if (!placeId) return res.status(400).json({ error: 'placeId is required' });

  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  url.searchParams.set('place_id', placeId);
  url.searchParams.set('fields', 'name,formatted_address,geometry,address_components,types');
  url.searchParams.set('key', key);

  try {
    const resp = await fetch(url);
    const data = await resp.json();
    if (data.status !== 'OK') {
      return res.status(502).json({ error: data.error_message || data.status });
    }
    const r = data.result;
    const city = r.address_components?.find(c => c.types.includes('locality'))?.long_name
      || r.address_components?.find(c => c.types.includes('sublocality'))?.long_name
      || r.address_components?.find(c => c.types.includes('administrative_area_level_1'))?.long_name
      || '';
    const country = r.address_components?.find(c => c.types.includes('country'))?.short_name || '';

    res.json({
      name: r.name,
      address: r.formatted_address,
      lat: r.geometry?.location?.lat,
      lng: r.geometry?.location?.lng,
      city,
      country,
      types: r.types || [],
    });
  } catch (err) {
    console.error('[places] API error:', err.message);
    res.status(502).json({ error: 'Failed to reach Google Places API' });
  }
}

// Static map image proxy — keeps API key server-side
async function staticmap(req, res) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return res.status(500).json({ error: 'Google Places API key not configured' });

  const { lat, lng, zoom = 15, size = '400x200', maptype = 'roadmap', markers, path } = req.query;

  const url = new URL('https://maps.googleapis.com/maps/api/staticmap');
  if (lat && lng) url.searchParams.set('center', `${lat},${lng}`);
  url.searchParams.set('zoom', zoom);
  url.searchParams.set('size', size);
  url.searchParams.set('maptype', maptype);
  url.searchParams.set('scale', '2'); // retina
  url.searchParams.set('key', key);

  // Custom styling for a clean look
  const styles = [
    'feature:all|element:labels.text.fill|color:0x444444',
    'feature:water|color:0xc4dae2',
    'feature:landscape|color:0xf0f0f0',
    'feature:road|visibility:simplified',
    'feature:poi|visibility:off',
    'feature:transit|visibility:off',
  ];
  styles.forEach(s => url.searchParams.append('style', s));

  // Single marker or custom markers string
  if (markers) {
    // markers can be passed as a pre-formatted string or multiple values
    const markerList = Array.isArray(markers) ? markers : [markers];
    markerList.forEach(m => url.searchParams.append('markers', m));
  } else if (lat && lng) {
    url.searchParams.append('markers', `color:0x22c55e|${lat},${lng}`);
  }

  // Path for trip route
  if (path) {
    url.searchParams.append('path', path);
  }

  try {
    const resp = await fetch(url.toString());
    if (!resp.ok) return res.status(502).json({ error: 'Failed to fetch map image' });
    const buffer = Buffer.from(await resp.arrayBuffer());
    res.set('Content-Type', resp.headers.get('content-type') || 'image/png');
    res.set('Cache-Control', 'public, max-age=86400'); // cache 24h
    res.send(buffer);
  } catch (err) {
    console.error('[places] Maps API error:', err.message);
    res.status(502).json({ error: 'Failed to reach Google Maps API' });
  }
}

// Trip route static map — takes an array of waypoints and draws the route
async function tripmap(req, res) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return res.status(500).json({ error: 'Google Places API key not configured' });

  const { waypoints, size = '600x300', maptype = 'terrain' } = req.query;
  // waypoints format: "lat1,lng1|lat2,lng2|lat3,lng3"
  if (!waypoints) return res.status(400).json({ error: 'waypoints param required (lat,lng|lat,lng|...)' });

  const points = waypoints.split('|').filter(p => p.includes(','));
  if (points.length < 1) return res.status(400).json({ error: 'Need at least 1 waypoint' });

  const url = new URL('https://maps.googleapis.com/maps/api/staticmap');
  url.searchParams.set('size', size);
  url.searchParams.set('maptype', maptype);
  url.searchParams.set('scale', '2');
  url.searchParams.set('key', key);

  // Style
  const styles = [
    'feature:poi|visibility:off',
    'feature:transit|visibility:off',
    'feature:road|element:labels|visibility:off',
    'feature:road|visibility:simplified',
  ];
  styles.forEach(s => url.searchParams.append('style', s));

  // Draw path connecting all points
  if (points.length > 1) {
    url.searchParams.append('path', `color:0x22c55eCC|weight:3|geodesic:true|${points.join('|')}`);
  }

  // Add markers for each waypoint
  const markerStr = points.map((p, i) => {
    if (i === 0) return `color:0x22c55e|label:A|${p}`;
    if (i === points.length - 1) return `color:0xe84233|label:B|${p}`;
    return `color:0xc9993a|size:small|${p}`;
  });
  markerStr.forEach(m => url.searchParams.append('markers', m));

  try {
    const resp = await fetch(url.toString());
    if (!resp.ok) return res.status(502).json({ error: 'Failed to fetch map image' });
    const buffer = Buffer.from(await resp.arrayBuffer());
    res.set('Content-Type', resp.headers.get('content-type') || 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(buffer);
  } catch (err) {
    console.error('[places] Maps API error:', err.message);
    res.status(502).json({ error: 'Failed to reach Google Maps API' });
  }
}

module.exports = { autocomplete, details, staticmap, tripmap };
