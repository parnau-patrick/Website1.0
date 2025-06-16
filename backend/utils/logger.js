// utils/logger.js - Configurare centralizată Winston Logger
const winston = require('winston');
const path = require('path');

// Configurări de mediu
const NODE_ENV = process.env.NODE_ENV || 'development';
const LOG_LEVEL = process.env.LOG_LEVEL || (NODE_ENV === 'production' ? 'info' : 'debug');

// Asigură-te că directorul logs există
const fs = require('fs');
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Format custom pentru log-uri
const customFormat = winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
  // Dacă avem stack trace (pentru erori), îl includem
  const errorStack = stack ? `\nStack: ${stack}` : '';
  
  // Dacă avem metadata suplimentară, o includem
  const metaString = Object.keys(meta).length > 0 ? `\nMeta: ${JSON.stringify(meta, null, 2)}` : '';
  
  return `${timestamp} [${level.toUpperCase()}]: ${message}${errorStack}${metaString}`;
});

// Format JSON pentru producție
const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Format human-readable pentru dezvoltare
const devFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.colorize({ all: true }),
  customFormat
);

// Configurare transports
const transports = [];

// Console transport - doar în dezvoltare sau dacă este explicit cerut
if (NODE_ENV === 'development' || process.env.LOG_TO_CONSOLE === 'true') {
  transports.push(
    new winston.transports.Console({
      level: LOG_LEVEL,
      format: devFormat
    })
  );
}

// File transport pentru toate log-urile
transports.push(
  new winston.transports.File({
    filename: path.join(logsDir, 'app-combined.log'),
    level: LOG_LEVEL,
    format: NODE_ENV === 'production' ? jsonFormat : devFormat,
    maxsize: 10 * 1024 * 1024, 
    maxFiles: 5,
    tailable: true
  })
);

// File transport doar pentru erori
transports.push(
  new winston.transports.File({
    filename: path.join(logsDir, 'app-error.log'),
    level: 'error',
    format: NODE_ENV === 'production' ? jsonFormat : devFormat,
    maxsize: 10 * 1024 * 1024, 
    maxFiles: 5,
    tailable: true
  })
);

// File transport pentru auto-cleanup (pentru debugging)
if (NODE_ENV === 'development') {
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'auto-cleanup.log'),
      level: 'info',
      format: devFormat,
      maxsize: 5 * 1024 * 1024, 
      maxFiles: 3,
      tailable: true
    })
  );
}

// Creează logger-ul principal
const logger = winston.createLogger({
  level: LOG_LEVEL,
  levels: winston.config.npm.levels,
  format: NODE_ENV === 'production' ? jsonFormat : devFormat,
  transports: transports,
  
  // Configurare pentru uncaught exceptions și unhandled rejections
 exceptionHandlers: [
  new winston.transports.File({
    filename: path.join(logsDir, 'exceptions.log'),
    format: jsonFormat,
    maxsize: 5 * 1024 * 1024, 
    maxFiles: 5,             
    tailable: true
  })
],
  
  rejectionHandlers: [
  new winston.transports.File({
    filename: path.join(logsDir, 'rejections.log'),
    format: jsonFormat,
    maxsize: 5 * 1024 * 1024,  
    maxFiles: 3,              
    tailable: true
  })
],
  
  // Nu ieși din proces la uncaught exception în producție
  exitOnError: NODE_ENV !== 'production'
});

// Logger specializat pentru auto-cleanup
const cleanupLogger = winston.createLogger({
  level: 'info',
  format: devFormat,
  transports: [
    new winston.transports.File({
      filename: path.join(logsDir, 'auto-cleanup.log'),
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 3,
      tailable: true
    })
  ]
});

// Logger specializat pentru email-uri
const emailLogger = winston.createLogger({
  level: 'info',
  format: devFormat,
  transports: [
    new winston.transports.File({
      filename: path.join(logsDir, 'emails.log'),
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 3,
      tailable: true
    })
  ]
});

// Logger specializat pentru booking-uri
const bookingLogger = winston.createLogger({
  level: 'info',
  format: devFormat,
  transports: [
    new winston.transports.File({
      filename: path.join(logsDir, 'bookings.log'),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      tailable: true
    })
  ]
});

// Logger specializat pentru autentificare
const authLogger = winston.createLogger({
  level: 'info',
  format: devFormat,
  transports: [
    new winston.transports.File({
      filename: path.join(logsDir, 'auth.log'),
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 3,
      tailable: true
    })
  ]
});

// Funcții helper pentru logging contextualizat
const createContextLogger = (context) => {
  return {
    info: (message, meta = {}) => logger.info(`[${context}] ${message}`, meta),
    warn: (message, meta = {}) => logger.warn(`[${context}] ${message}`, meta),
    error: (message, error = null, meta = {}) => {
      const errorMeta = error instanceof Error ? { error: error.message, stack: error.stack, ...meta } : meta;
      logger.error(`[${context}] ${message}`, errorMeta);
    },
    debug: (message, meta = {}) => logger.debug(`[${context}] ${message}`, meta)
  };
};

// Funcție pentru logarea cu performanță
const logWithPerformance = (operation, fn) => {
  return async (...args) => {
    const start = Date.now();
    try {
      const result = await fn(...args);
      const duration = Date.now() - start;
      logger.info(`[PERFORMANCE] ${operation} completed in ${duration}ms`);
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      logger.error(`[PERFORMANCE] ${operation} failed after ${duration}ms`, { error: error.message });
      throw error;
    }
  };
};

// Export logger principal și specializați
module.exports = {
  // Logger principal
  logger,
  
  // Loggeri specializați
  cleanupLogger,
  emailLogger,
  bookingLogger,
  authLogger,
  
  // Funcții helper
  createContextLogger,
  logWithPerformance,
  
  // Metode rapide
  info: logger.info.bind(logger),
  warn: logger.warn.bind(logger),
  error: logger.error.bind(logger),
  debug: logger.debug.bind(logger)
};