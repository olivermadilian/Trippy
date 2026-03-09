const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { generate, claim, listForTrip, revoke } = require('../controllers/squawk.controller');

const router = Router();

router.post('/generate', requireAuth, generate);
router.post('/claim', requireAuth, claim);
router.get('/trip/:tripId', requireAuth, listForTrip);
router.delete('/:codeId', requireAuth, revoke);

module.exports = router;
