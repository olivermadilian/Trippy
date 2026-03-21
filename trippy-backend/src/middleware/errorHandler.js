function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  console.error('Unhandled error:', err.message);
  // Don't leak internal error details to clients in production
  const message = status < 500
    ? err.message
    : process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message;
  res.status(status).json({ error: message || 'Internal server error' });
}

module.exports = errorHandler;
