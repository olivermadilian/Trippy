const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const { generate, claim, listForTrip, revoke } = require('../controllers/squawk.controller');

const router = Router();

// Limit claim attempts to prevent brute-forcing the 6-character code space
const claimLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many claim attempts. Try again in 15 minutes.' },
  keyGenerator: (req) => req.user?.id || req.ip,
});

router.post('/generate', requireAuth, generate);
router.post('/claim', requireAuth, claimLimiter, claim);
router.get('/trip/:tripId', requireAuth, listForTrip);
router.delete('/:codeId', requireAuth, revoke);

module.exports = router;
