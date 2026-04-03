const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const { operators, lookup, track } = require('../controllers/trains.controller');

const router = Router();

const trainLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  message: { error: 'Too many train lookups. Try again in a minute.' }
});

const trackLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  message: { error: 'Too many tracking requests. Try again in a minute.' }
});

// Operators list is public (no auth needed for a static list)
router.get('/operators', operators);

router.get('/lookup', requireAuth, trainLimiter, lookup);
router.get('/track/:operator/:number', requireAuth, trackLimiter, track);

module.exports = router;
