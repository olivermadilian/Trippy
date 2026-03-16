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
    res.status(502).json({ error: 'Failed to reach Google Places API' });
  }
}

module.exports = { autocomplete, details };
