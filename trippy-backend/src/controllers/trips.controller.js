const { createUserClient } = require('../config/supabase');

async function generateSquawkCode(supabase) {
  const today = new Date().toISOString().slice(0, 10);

  for (let attempt = 0; attempt < 20; attempt++) {
    const code = String(Math.floor(Math.random() * 10000)).padStart(4, '0');

    // Check if any active trip already uses this code
    const { data: existing, error } = await supabase
      .from('trips')
      .select('id')
      .eq('squawk_code', code)
      .or(`end_date.is.null,end_date.gte.${today}`)
      .limit(1);

    if (error) throw error;

    if (!existing || existing.length === 0) {
      return code;
    }
  }

  throw new Error('Failed to generate unique squawk code after 20 attempts.');
}

async function listTrips(req, res) {
  const supabase = createUserClient(req.accessToken);
  const { data, error } = await supabase
    .from('trips')
    .select('*, legs(*)')
    .eq('user_id', req.user.id)
    .order('start_date', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  // Sort legs by sort_order within each trip
  const trips = data.map(trip => ({
    ...trip,
    legs: (trip.legs || []).sort((a, b) => a.sort_order - b.sort_order)
  }));

  res.json(trips);
}

async function createTrip(req, res) {
  const supabase = createUserClient(req.accessToken);
  const { title, description, start_date, end_date, is_public, legs } = req.body;

  if (!title) return res.status(400).json({ error: 'Title is required' });

  // Generate a unique 4-digit squawk code
  let squawkCode;
  try {
    squawkCode = await generateSquawkCode(supabase);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to generate squawk code: ' + err.message });
  }

  // Insert trip
  const { data: trip, error: tripError } = await supabase
    .from('trips')
    .insert({
      user_id: req.user.id,
      title,
      description: description || null,
      start_date: start_date || null,
      end_date: end_date || null,
      is_public: is_public || false,
      squawk_code: squawkCode
    })
    .select()
    .single();

  if (tripError) return res.status(500).json({ error: tripError.message });

  // Insert legs if provided
  if (legs && legs.length > 0) {
    const legsWithTripId = legs.map((leg, i) => ({
      trip_id: trip.id,
      sort_order: leg.sort_order ?? i,
      type: leg.type,
      status: leg.status || 'scheduled',
      origin_code: leg.origin?.code || leg.origin_code || null,
      origin_city: leg.origin?.city || leg.origin_city || null,
      origin_lat: leg.origin?.lat || leg.origin_lat || null,
      origin_lng: leg.origin?.lng || leg.origin_lng || null,
      destination_code: leg.destination?.code || leg.destination_code || null,
      destination_city: leg.destination?.city || leg.destination_city || null,
      destination_lat: leg.destination?.lat || leg.destination_lat || null,
      destination_lng: leg.destination?.lng || leg.destination_lng || null,
      depart_time: leg.depart_time || null,
      arrive_time: leg.arrive_time || null,
      carrier: leg.carrier || null,
      vehicle_number: leg.vehicle_number || null,
      metadata: leg.metadata || {},
      notes: leg.notes || null
    }));

    const { error: legsError } = await supabase.from('legs').insert(legsWithTripId);
    if (legsError) return res.status(500).json({ error: legsError.message });
  }

  // Re-fetch with legs
  const { data: fullTrip, error: fetchError } = await supabase
    .from('trips')
    .select('*, legs(*)')
    .eq('id', trip.id)
    .single();

  if (fetchError) return res.status(500).json({ error: fetchError.message });

  fullTrip.legs = (fullTrip.legs || []).sort((a, b) => a.sort_order - b.sort_order);
  res.status(201).json(fullTrip);
}

async function getTrip(req, res) {
  const supabase = createUserClient(req.accessToken);
  const { data, error } = await supabase
    .from('trips')
    .select('*, legs(*)')
    .eq('id', req.params.tripId)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Trip not found' });

  data.legs = (data.legs || []).sort((a, b) => a.sort_order - b.sort_order);

  // Backfill missing coordinates from FR24 airports API
  try {
    const { getAirport } = require('../services/fr24.service');
    for (const leg of data.legs) {
      let updated = false;
      if (leg.origin_code && (!leg.origin_lat || leg.origin_lat === 0)) {
        const apt = await getAirport(leg.origin_code);
        if (apt.lat) { leg.origin_lat = apt.lat; leg.origin_lng = apt.lng; leg.origin_city = apt.city || leg.origin_city; updated = true; }
      }
      if (leg.destination_code && (!leg.destination_lat || leg.destination_lat === 0)) {
        const apt = await getAirport(leg.destination_code);
        if (apt.lat) { leg.destination_lat = apt.lat; leg.destination_lng = apt.lng; leg.destination_city = apt.city || leg.destination_city; updated = true; }
      }
      // Persist fixes to DB (fire and forget)
      if (updated) {
        supabase.from('legs').update({
          origin_lat: leg.origin_lat, origin_lng: leg.origin_lng, origin_city: leg.origin_city,
          destination_lat: leg.destination_lat, destination_lng: leg.destination_lng, destination_city: leg.destination_city,
        }).eq('id', leg.id).then(() => {}).catch(err => console.error(`[backfill] Failed to update leg ${leg.id}:`, err.message));
      }
    }
  } catch (e) {
    // Non-critical — continue serving the trip even if backfill fails
  }

  res.json(data);
}

async function updateTrip(req, res) {
  const supabase = createUserClient(req.accessToken);
  const { title, description, start_date, end_date, is_public } = req.body;

  const updates = { updated_at: new Date().toISOString() };
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (start_date !== undefined) updates.start_date = start_date;
  if (end_date !== undefined) updates.end_date = end_date;
  if (is_public !== undefined) updates.is_public = is_public;

  const { data, error } = await supabase
    .from('trips')
    .update(updates)
    .eq('id', req.params.tripId)
    .eq('user_id', req.user.id)
    .select('*, legs(*)')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Trip not found' });

  data.legs = (data.legs || []).sort((a, b) => a.sort_order - b.sort_order);
  res.json(data);
}

async function deleteTrip(req, res) {
  const supabase = createUserClient(req.accessToken);
  const { error } = await supabase
    .from('trips')
    .delete()
    .eq('id', req.params.tripId)
    .eq('user_id', req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.status(204).send();
}

async function getFollowingTrips(req, res) {
  const supabase = createUserClient(req.accessToken);

  // Get trips the user follows, including the trip owner's profile
  const { data, error } = await supabase
    .from('trip_followers')
    .select(`
      trip_id,
      trips (
        *,
        legs (*),
        profiles:user_id (display_name, avatar_url)
      )
    `)
    .eq('follower_id', req.user.id);

  if (error) return res.status(500).json({ error: error.message });

  const trips = data
    .map(d => {
      if (!d.trips) return null;
      const trip = d.trips;
      trip.legs = (trip.legs || []).sort((a, b) => a.sort_order - b.sort_order);
      // Flatten the traveler info
      trip.traveler = trip.profiles || null;
      delete trip.profiles;
      return trip;
    })
    .filter(Boolean);

  res.json(trips);
}

async function unfollowTrip(req, res) {
  const supabase = createUserClient(req.accessToken);
  const { tripId } = req.params;
  const { error } = await supabase
    .from('trip_followers')
    .delete()
    .eq('trip_id', tripId)
    .eq('follower_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
}

module.exports = { listTrips, createTrip, getTrip, updateTrip, deleteTrip, getFollowingTrips, unfollowTrip };
