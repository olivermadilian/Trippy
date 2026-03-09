const { Router } = require('express');
const { searchAirports, getAirport, searchStations } = require('../controllers/reference.controller');

const router = Router();

router.get('/airports', searchAirports);
router.get('/airports/:code', getAirport);
router.get('/stations', searchStations);

module.exports = router;
