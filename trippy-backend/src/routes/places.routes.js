const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const { autocomplete, details } = require('../controllers/places.controller');

const router = Router();

// Rate limit to protect API key — 30 autocomplete requests per minute per user
const placesLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many place lookups. Try again in a minute.' }
});

router.get('/autocomplete', requireAuth, placesLimiter, autocomplete);
router.get('/details', requireAuth, placesLimiter, details);

module.exports = router;
