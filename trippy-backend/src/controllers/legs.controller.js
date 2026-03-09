const { createUserClient } = require('../config/supabase');

const VALID_TYPES = ['flight', 'hotel', 'train', 'bus'];
const VALID_STATUSES = ['scheduled', 'confirmed', 'in_air', 'in_transit', 'completed', 'cancelled'];

async function addLeg(req, res) {
  const supabase = createUserClient(req.accessToken);
  const { tripId } = req.params;
  const leg = req.body;

  if (!leg.type || !VALID_TYPES.includes(leg.type)) {
    return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
  }

  // Get the current max sort_order for this trip
  const { data: existing } = await supabase
    .from('legs')
    .select('sort_order')
    .eq('trip_id', tripId)
    .order('sort_order', { ascending: false })
    .limit(1);

  const nextOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;

  const { data, error } = await supabase
    .from('legs')
    .insert({
      trip_id: tripId,
      sort_order: leg.sort_order ?? nextOrder,
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
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
}

async function updateLeg(req, res) {
  const supabase = createUserClient(req.accessToken);
  const { legId } = req.params;
  const updates = {};

  // Only include provided fields
  const fields = [
    'type', 'status', 'sort_order',
    'origin_code', 'origin_city', 'origin_lat', 'origin_lng',
    'destination_code', 'destination_city', 'destination_lat', 'destination_lng',
    'depart_time', 'arrive_time', 'actual_depart', 'actual_arrive',
    'carrier', 'vehicle_number', 'metadata', 'notes'
  ];

  for (const field of fields) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }

  // Support nested origin/destination objects from frontend
  if (req.body.origin) {
    if (req.body.origin.code !== undefined) updates.origin_code = req.body.origin.code;
    if (req.body.origin.city !== undefined) updates.origin_city = req.body.origin.city;
    if (req.body.origin.lat !== undefined) updates.origin_lat = req.body.origin.lat;
    if (req.body.origin.lng !== undefined) updates.origin_lng = req.body.origin.lng;
  }
  if (req.body.destination) {
    if (req.body.destination.code !== undefined) updates.destination_code = req.body.destination.code;
    if (req.body.destination.city !== undefined) updates.destination_city = req.body.destination.city;
    if (req.body.destination.lat !== undefined) updates.destination_lat = req.body.destination.lat;
    if (req.body.destination.lng !== undefined) updates.destination_lng = req.body.destination.lng;
  }

  if (updates.type && !VALID_TYPES.includes(updates.type)) {
    return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
  }
  if (updates.status && !VALID_STATUSES.includes(updates.status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('legs')
    .update(updates)
    .eq('id', legId)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Leg not found' });
  res.json(data);
}

async function deleteLeg(req, res) {
  const supabase = createUserClient(req.accessToken);
  const { error } = await supabase
    .from('legs')
    .delete()
    .eq('id', req.params.legId);

  if (error) return res.status(500).json({ error: error.message });
  res.status(204).send();
}

async function reorderLegs(req, res) {
  const supabase = createUserClient(req.accessToken);
  const { tripId } = req.params;
  const { leg_ids } = req.body;

  if (!Array.isArray(leg_ids)) {
    return res.status(400).json({ error: 'leg_ids must be an array of leg IDs in desired order' });
  }

  // Update each leg's sort_order
  const updates = leg_ids.map((id, i) =>
    supabase
      .from('legs')
      .update({ sort_order: i, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('trip_id', tripId)
  );

  const results = await Promise.all(updates);
  const failed = results.find(r => r.error);
  if (failed) return res.status(500).json({ error: failed.error.message });

  // Return updated legs
  const { data, error } = await supabase
    .from('legs')
    .select('*')
    .eq('trip_id', tripId)
    .order('sort_order');

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}

module.exports = { addLeg, updateLeg, deleteLeg, reorderLegs };
