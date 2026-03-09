const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const { lookup } = require('../controllers/flights.controller');

const router = Router();

// Rate limit flight lookups to protect API key
const flightLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: { error: 'Too many flight lookups. Try again in a minute.' }
});

router.get('/lookup', requireAuth, flightLimiter, lookup);

module.exports = router;
