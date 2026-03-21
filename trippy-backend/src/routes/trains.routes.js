const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const { lookup } = require('../controllers/trains.controller');

const router = Router();

const trainLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 15, // 15 requests per minute
  message: { error: 'Too many train lookups. Try again in a minute.' }
});

// GET /api/trains/lookup?number=ICE123&source=db&date=2024-03-20
router.get('/lookup', requireAuth, trainLimiter, lookup);

module.exports = router;
