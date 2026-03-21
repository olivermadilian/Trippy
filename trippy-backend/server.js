require('dotenv').config();

// Validate required environment variables before starting
const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const express = require('express');
const helmet = require('helmet');
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
app.use(helmet());
app.use(corsConfig);
app.use(express.json({ limit: '50kb' }));

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
