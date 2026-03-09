const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  listTrips, createTrip, getTrip, updateTrip, deleteTrip, getFollowingTrips
} = require('../controllers/trips.controller');

const router = Router();

router.get('/following', requireAuth, getFollowingTrips);
router.get('/', requireAuth, listTrips);
router.post('/', requireAuth, createTrip);
router.get('/:tripId', requireAuth, getTrip);
router.put('/:tripId', requireAuth, updateTrip);
router.delete('/:tripId', requireAuth, deleteTrip);

module.exports = router;
