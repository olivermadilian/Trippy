const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { getMe, updateMe } = require('../controllers/auth.controller');

const router = Router();

router.get('/me', requireAuth, getMe);
router.put('/me', requireAuth, updateMe);

module.exports = router;
