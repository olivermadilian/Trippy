const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { addLeg, updateLeg, deleteLeg, reorderLegs } = require('../controllers/legs.controller');

const router = Router();

router.post('/:tripId/legs', requireAuth, addLeg);
router.put('/:tripId/legs/reorder', requireAuth, reorderLegs);
router.put('/:tripId/legs/:legId', requireAuth, updateLeg);
router.delete('/:tripId/legs/:legId', requireAuth, deleteLeg);

module.exports = router;
