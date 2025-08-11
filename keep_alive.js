/**
 * Keep-Alive Service for 24/7 Bot Operation
 * Prevents the bot from sleeping on free hosting platforms
 */

const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    botStatus: 'active'
  });
});

// Ping endpoint for external monitors
app.get('/ping', (req, res) => {
  res.json({ 
    pong: true, 
    time: Date.now(),
    service: 'GUN PARK Bot Keep-Alive'
  });
});

// Bot status endpoint
app.get('/bot-status', (req, res) => {
  // Check if gun-park-bot.js process is running
  exec('ps aux | grep "gun-park-bot.js" | grep -v grep', (error, stdout, stderr) => {
    const isRunning = stdout.trim().length > 0;
    res.json({
      botRunning: isRunning,
      processInfo: stdout.trim(),
      timestamp: new Date().toISOString()
    });
  });
});

// Memory and performance metrics
app.get('/metrics', (req, res) => {
  const memUsage = process.memoryUsage();
  const loadavg = require('os').loadavg();
  
  res.json({
    memory: {
      rss: `${Math.round(memUsage.rss / 1024 / 1024)} MB`,
      heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)} MB`,
      heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)} MB`,
      external: `${Math.round(memUsage.external / 1024 / 1024)} MB`
    },
    uptime: {
      seconds: Math.floor(process.uptime()),
      formatted: formatUptime(process.uptime())
    },
    loadAverage: loadavg,
    timestamp: new Date().toISOString()
  });
});

// Self-ping to prevent sleeping (runs every 5 minutes)
function selfPing() {
  const urls = [
    `http://localhost:${PORT}/ping`,
    `http://localhost:5000/health`, // Main bot health endpoint
  ];
  
  urls.forEach(url => {
    require('http').get(url, (res) => {
      console.log(`✓ Keep-alive ping successful: ${url} - Status: ${res.statusCode}`);
    }).on('error', (err) => {
      console.log(`⚠ Keep-alive ping failed: ${url} - ${err.message}`);
    });
  });
}

// Format uptime in human readable format
function formatUptime(seconds) {
  const days = Math.floor(seconds / (24 * 60 * 60));
  const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
  const minutes = Math.floor((seconds % (60 * 60)) / 60);
  const secs = Math.floor(seconds % 60);
  
  return `${days}d ${hours}h ${minutes}m ${secs}s`;
}

// Start the keep-alive service
app.listen(PORT, () => {
  console.log(`🚀 Keep-Alive service running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/`);
  console.log(`🏓 Ping endpoint: http://localhost:${PORT}/ping`);
  console.log(`🤖 Bot status: http://localhost:${PORT}/bot-status`);
  console.log(`📈 Metrics: http://localhost:${PORT}/metrics`);
  
  // Start self-pinging every 5 minutes (300,000 ms)
  setInterval(selfPing, 300000);
  
  // Initial ping after 30 seconds
  setTimeout(selfPing, 30000);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Keep-Alive service shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Keep-Alive service terminated');
  process.exit(0);
});

// Export for external usage
module.exports = app;