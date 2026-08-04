const fs = require('fs');
const path = require('path');
const winston = require('winston');

// Ensure the logs directory exists before the file transport opens it.
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

// Shared logger: Console for everything, File for errors only.
// Every module (server, services, routes) should require this instead of
// the winston module itself, whose default logger has no transports and
// emits "[winston] Attempt to write logs with no transports" on every call.
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}] ${message}`)
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: path.join(logsDir, 'error.log'), level: 'error' })
  ]
});

module.exports = logger;
