const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const { lookup } = require('../controllers/flights.controller');
const { trackFlight } = require('../controllers/tracking.controller');

const router = Router();

// Rate limit flight lookups to protect API key
const flightLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: { error: 'Too many flight lookups. Try again in a minute.' }
});

// Rate limit live tracking (FR24 API)
const trackLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  message: { error: 'Too many tracking requests. Try again in a minute.' }
});

router.get('/lookup', requireAuth, flightLimiter, lookup);
router.get('/track/:callsign', requireAuth, trackLimiter, trackFlight);

module.exports = router;
