// Hybrid server that runs both the Telegram bot and a web endpoint
import { exec } from 'child_process';
import path from 'path';
import express from 'express';

const app = express();
const PORT = process.env.PORT || 5000;

console.log('Starting GUN PARK Telegram Bot...');

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'GUN PARK Telegram Bot is running',
    bot: 'Active',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'gun-park-telegram-bot' });
});

// Start web server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Health server running on port ${PORT}`);
});

// Start the Telegram bot
const botPath = path.join(process.cwd(), 'gun-park-bot.js');
const botProcess = exec(`node ${botPath}`, (error, stdout, stderr) => {
  if (error) {
    console.error(`Bot execution error: ${error}`);
    return;
  }
  if (stderr) {
    console.error(`Bot stderr: ${stderr}`);
  }
  console.log(`Bot stdout: ${stdout}`);
});

botProcess.stdout?.on('data', (data) => {
  console.log(`Bot: ${data}`);
});

botProcess.stderr?.on('data', (data) => {
  console.error(`Bot Error: ${data}`);
});

botProcess.on('close', (code) => {
  console.log(`Bot process exited with code ${code}`);
});

// Keep the process alive
process.on('SIGINT', () => {
  console.log('Shutting down bot...');
  botProcess.kill();
  process.exit();
});

process.on('SIGTERM', () => {
  console.log('Shutting down bot...');
  botProcess.kill();
  process.exit();
});