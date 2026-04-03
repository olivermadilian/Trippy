require('dotenv').config();

const express = require('express');
const corsConfig = require('./src/config/cors');
const errorHandler = require('./src/middleware/errorHandler');

const authRoutes = require('./src/routes/auth.routes');
const tripRoutes = require('./src/routes/trips.routes');
const legRoutes = require('./src/routes/legs.routes');
const squawkRoutes = require('./src/routes/squawk.routes');
const flightRoutes = require('./src/routes/flights.routes');
const trainRoutes = require('./src/routes/trains.routes');
const referenceRoutes = require('./src/routes/reference.routes');
const placesRoutes = require('./src/routes/places.routes');

const app = express();

// Middleware
app.use(corsConfig);
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/trips', tripRoutes);
app.use('/api/trips', legRoutes);  // Legs are nested: /api/trips/:tripId/legs
app.use('/api/squawk', squawkRoutes);
app.use('/api/flights', flightRoutes);
app.use('/api/trains', trainRoutes);
app.use('/api/reference', referenceRoutes);
app.use('/api/places', placesRoutes);

// Error handling
app.use(errorHandler);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Trippy backend running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});
