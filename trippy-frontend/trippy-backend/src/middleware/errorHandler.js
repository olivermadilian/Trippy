function errorHandler(err, req, res, _next) {
  console.error('Unhandled error:', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
}

module.exports = errorHandler;
