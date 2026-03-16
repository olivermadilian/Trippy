const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const { autocomplete, details, staticmap, tripmap } = require('../controllers/places.controller');

const router = Router();

// Rate limit to protect API key — 30 autocomplete requests per minute per user
const placesLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many place lookups. Try again in a minute.' }
});

// Rate limit for map image requests — more generous since they're cached
const mapLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many map requests. Try again in a minute.' }
});

router.get('/autocomplete', requireAuth, placesLimiter, autocomplete);
router.get('/details', requireAuth, placesLimiter, details);
router.get('/staticmap', requireAuth, mapLimiter, staticmap);
router.get('/tripmap', requireAuth, mapLimiter, tripmap);

module.exports = router;
