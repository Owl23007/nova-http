const { createApp } = require('nova-http');

const router = createApp();

router.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage(),
    node: process.version,
  });
});

module.exports = { healthRouter: router };

