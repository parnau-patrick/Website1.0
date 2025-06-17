// server.js - Production-Ready Version
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const { connect } = require('./models/Booking');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');

// Import routes and middleware
const bookingRoutes = require('./routes/reservationRoutes');
const { createDefaultAdmin, authenticateJWT } = require('./middleware/authMiddleware');
const { User, Service } = require('./models/Booking');
const { runFullCleanup } = require('./utils/autoCleanup');

// Environment variables validation
const JWT_SECRET = process.env.JWT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET;
const MONGO_URL = process.env.MONGO_URL;
const NODE_ENV = process.env.NODE_ENV || 'production';
const PORT = process.env.PORT || 5000;

let cleanupInterval;
const startAutoCleanup = () => {
  // Rulează prima dată la pornirea serverului
  runFullCleanup().catch(error => {
    logger.error('Initial auto-cleanup failed:', error);
  });
  
  cleanupInterval = setInterval(() => {
    runFullCleanup().catch(error => {
      logger.error('Scheduled auto-cleanup failed:', error);
    });
  }, 10 * 60 * 1000); // 10 min
  
  logger.info('Auto-cleanup job started - runs every 6 hours');
};

// Enhanced logging system - PRODUCTION READY
const { createContextLogger } = require('./utils/logger');
const logger = createContextLogger('SERVER');

// Critical environment variables validation for production
if (NODE_ENV === 'production') {
  const mandatoryEnvVars = [
    'JWT_SECRET',
    'SESSION_SECRET', 
    'MONGO_URL',
    'EMAIL_HOST',
    'EMAIL_PORT',
    'EMAIL_USER',
    'EMAIL_PASS'
  ];
  
  const missingVars = mandatoryEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    logger.error(`CRITICAL ERROR: Missing environment variables: ${missingVars.join(', ')}`);
    process.exit(1);
  }
  
  // Check for default/weak secrets
  const DEFAULT_JWT_SECRET = 'parola_foarte_sigura_pentru_jwt_token';
  const DEFAULT_SESSION_SECRET = 'parola_foarte_sigura_pentru_sesiune';
  
  if (JWT_SECRET === DEFAULT_JWT_SECRET || JWT_SECRET.length < 32) {
    logger.error('CRITICAL ERROR: JWT_SECRET is not properly configured for production!');
    process.exit(1);
  }
  
  if (SESSION_SECRET === DEFAULT_SESSION_SECRET || SESSION_SECRET.length < 32) {
    logger.error('CRITICAL ERROR: SESSION_SECRET is not properly configured for production!');
    process.exit(1);
  }
}

// Initialize express app
const app = express();

// Trust proxy in production (for load balancers, reverse proxies)
if (NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Connect to MongoDB with production-ready error handling
connect()
  .then(() => {
    createDefaultAdmin();
    startAutoCleanup(); // Pornește auto-cleanup
    logger.info('Successfully connected to MongoDB');
  })
  .catch(err => {
    logger.error('Failed to connect to MongoDB:', error);
    process.exit(1);
  });

// HTTPS redirect middleware for production
if (NODE_ENV === 'production' && process.env.FORCE_HTTPS === 'true') {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.header('host')}${req.url}`);
    }
    next();
  });
}

// Compression middleware for better performance
app.use(compression({
  level: NODE_ENV === 'production' ? 6 : 1,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  }
}));



app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://ajax.googleapis.com",
        "https://d3e54v103j8qbb.cloudfront.net",
        "https://maps.googleapis.com",         
        "https://maps.gstatic.com"            
      ],
      
      scriptSrcAttr: ["'none'"],
      
      styleSrc: [
        "'self'", 
        "'unsafe-inline'", 
        "https://fonts.googleapis.com",
        "https://maps.googleapis.com"          
      ],
      
      fontSrc: [
        "'self'", 
        "https://fonts.gstatic.com", 
        "data:"
      ],
      
      imgSrc: [
        "'self'", 
        "data:", 
        "https://maps.googleapis.com",         
        "https://maps.gstatic.com",           
        "https://*.googleusercontent.com"     
      ],
      
      frameSrc: [
        "https://www.google.com",           
        "https://maps.google.com"             
      ],
      
      connectSrc: [
        "'self'",
        "https://maps.googleapis.com"         
      ],
      
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      
      upgradeInsecureRequests: NODE_ENV === 'production' ? [] : null
    }
  },
  hsts: NODE_ENV === 'production' ? {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  } : false
}));

// CORS configuration for production
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',')
  : NODE_ENV === 'production' 
    ? [`https://${process.env.DOMAIN || 'dariushreniuc.com'}`]
    : ['http://localhost:3000', 'http://localhost:5000', 'http://127.0.0.1:5000'];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin) || NODE_ENV === 'development') {
      callback(null, true);
    } else {
      logger.warn(`CORS blocked request from origin: ${origin}`);
      callback(new Error('Not allowed by CORS policy'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Production-optimized rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: NODE_ENV === 'production' ? 100 : 1000, // Stricter in production
  message: {
    success: false,
    message: 'Too many requests. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for static files in development
    return NODE_ENV === 'development' && req.url.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg)$/);
  }
});

const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: NODE_ENV === 'production' ? 5 : 50, // Very strict for auth
  message: {
    success: false,
    message: 'Too many authentication attempts. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: NODE_ENV === 'production' ? 20 : 100, // API rate limit
  message: {
    success: false,
    message: 'API rate limit exceeded. Please slow down.'
  }
});

// Apply rate limiters
app.use('/api/', generalLimiter);
app.use('/api/login', authLimiter);
app.use('/api/bookings', apiLimiter);

// Body parser with size limits
app.use(express.json({ 
  limit: '10kb',
  strict: true
}));
app.use(express.urlencoded({ 
  extended: true, 
  limit: '10kb'
}));

// Enhanced input sanitization
app.use((req, res, next) => {
  const sanitize = (obj) => {
    if (obj && typeof obj === 'object') {
      for (const key in obj) {
        if (typeof obj[key] === 'string') {
          // Remove potential NoSQL injection and XSS patterns
          obj[key] = obj[key]
            .replace(/[\$\{\}]/g, '')
            .replace(/javascript:/gi, '')
            .replace(/<script/gi, '&lt;script')
            .replace(/on\w+\s*=/gi, '')
            .trim();
        } else if (typeof obj[key] === 'object') {
          sanitize(obj[key]);
        }
      }
    }
  };
  
  if (req.body) sanitize(req.body);
  if (req.query) sanitize(req.query);
  if (req.params) sanitize(req.params);
  
  next();
});

// Parameter pollution protection
app.use((req, res, next) => {
  // Prevent duplicate parameters except for whitelisted ones
  const whitelist = ['date', 'service', 'status'];
  
  for (const key in req.query) {
    if (Array.isArray(req.query[key]) && !whitelist.includes(key)) {
      req.query[key] = req.query[key][0]; // Take only the first value
    }
  }
  next();
});

// Production-optimized cache control
app.use((req, res, next) => {
  if (NODE_ENV === 'production') {
    // JavaScript and CSS files - Long cache with versioning
    if (req.url.match(/\.(js|css)$/)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // 1 year
      res.setHeader('ETag', 'strong');
    } 
    // Images and fonts - Medium cache
    else if (req.url.match(/\.(png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$/)) {
      res.setHeader('Cache-Control', 'public, max-age=2592000'); // 30 days
    } 
    // HTML files - Short cache with revalidation
    else if (req.url.match(/\.html$/) || req.url === '/') {
      res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate'); // 5 minutes
    }
    // API endpoints - No cache for dynamic content
    else if (req.url.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  } else {
    // Development - No caching
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

// Static files with production optimization
app.use(express.static(path.join(__dirname, '..'), {
  maxAge: NODE_ENV === 'production' ? '1y' : 0,
  etag: true,
  lastModified: true,
  immutable: NODE_ENV === 'production',
  index: ['index.html', 'programare.html']
}));

// Session configuration with production settings
const SESSION_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

app.use(session({
  secret: SESSION_SECRET,
  name: 'sessionId', // Don't use default name
  resave: false,
  saveUninitialized: false,
  rolling: true, // Reset expiry on activity
  store: MongoStore.create({
    mongoUrl: MONGO_URL,
    ttl: SESSION_EXPIRY / 1000,
    touchAfter: 24 * 3600, // Update once per day unless changed
    crypto: {
      secret: SESSION_SECRET
    }
  }),
  cookie: {
    maxAge: SESSION_EXPIRY,
    secure: NODE_ENV === 'production' && process.env.FORCE_HTTPS === 'true',
    httpOnly: true,
    sameSite: NODE_ENV === 'production' ? 'strict' : 'lax'
  }
}));

// Enhanced login endpoint with security measures
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Input validation
    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Username and password are required' 
      });
    }
    
    // Enhanced input validation
    if (typeof username !== 'string' || typeof password !== 'string' || 
        username.length < 3 || username.length > 50 || 
        password.length < 8 || password.length > 100) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid input parameters' 
      });
    }
    
    const user = await User.findOne({ username });
    
    // Timing attack protection
    if (!user) {
      await bcrypt.compare('dummy_password', '$2a$12$dummy.hash.to.prevent.timing.attacks.here');
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }
    
    // Account lockout mechanism
    if (user.loginAttempts >= 5 && user.lockUntil && user.lockUntil > Date.now()) {
      const lockTimeRemaining = Math.ceil((user.lockUntil - Date.now()) / 60000);
      return res.status(423).json({ 
        success: false, 
        message: `Account locked. Try again in ${lockTimeRemaining} minutes.`
      });
    }
    
    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
      // Increment failed attempts with exponential backoff
      const lockDuration = Math.min(15 * Math.pow(2, user.loginAttempts), 60); // Max 60 minutes
      await User.updateOne(
        { _id: user._id }, 
        { 
          $inc: { loginAttempts: 1 },
          $set: { 
            lockUntil: user.loginAttempts >= 4 ? 
              Date.now() + (lockDuration * 60 * 1000) : undefined
          }
        }
      );
      
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }
    
    // Successful login - reset attempts
    await User.updateOne(
      { _id: user._id },
      { 
        $set: { loginAttempts: 0, lockUntil: null, lastLogin: new Date() }
      }
    );
    
    // Generate JWT with enhanced security
    const token = jwt.sign(
      { 
        id: user._id, 
        username: user.username, 
        role: user.role,
        iat: Math.floor(Date.now() / 1000)
      },
      JWT_SECRET,
      { 
        expiresIn: '24h',
        issuer: 'barbershop-app',
        audience: 'barbershop-users'
      }
    );
    
    // Set secure cookie in production
    if (NODE_ENV === 'production') {
      res.cookie('authToken', token, {
        maxAge: SESSION_EXPIRY,
        httpOnly: true,
        secure: process.env.FORCE_HTTPS === 'true',
        sameSite: 'strict'
      });
    }
    
    res.status(200).json({ 
      success: true, 
      token,
      user: {
        username: user.username,
        role: user.role
      }
    });
    
    logger.info(`Successful login: ${username} from IP: ${req.ip}`);
    
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Dashboard authentication endpoint
app.get('/api/dashboard', authenticateJWT, (req, res) => {
  res.status(200).json({ 
    success: true, 
    message: 'Welcome to dashboard',
    user: {
      username: req.user.username,
      role: req.user.role
    }
  });
});

app.get('/api/admin/cleanup-status', authenticateJWT, async (req, res) => {
  if (req.user.role !== 'admin') {
    logger.warn(`Unauthorized cleanup status access attempt by: ${req.user.username} from IP: ${req.ip}`);
    return res.status(403).json({ 
      success: false, 
      message: 'Admin access required' 
    });
  }
  
  try {
    res.status(200).json({
      success: true,
      autoCleanupActive: !!cleanupInterval,
      nextCleanupIn: cleanupInterval ? '6 hours (estimated)' : 'Not scheduled',
      lastStartup: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error getting cleanup status:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// API Routes
app.use('/api', bookingRoutes);

// Debug routes with proper security
if (NODE_ENV === 'development') {
  app.get('/api/debug-services', async (req, res) => {
    try {
      const services = await Service.find();
      res.status(200).json({ 
        count: services.length, 
        services 
      });
    } catch (error) {
      logger.error('Error fetching services:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Server error',
        error: error.message 
      });
    }
  });
} else {
  // Production debug route (admin only)
  app.get('/api/debug-services', authenticateJWT, async (req, res) => {
    if (req.user.role !== 'admin') {
      logger.warn(`Unauthorized admin access attempt by: ${req.user.username} from IP: ${req.ip}`);
      return res.status(403).json({ 
        success: false, 
        message: 'Admin access required' 
      });
    }
    
    try {
      const services = await Service.find();
      res.status(200).json({ 
        count: services.length, 
        services 
      });
    } catch (error) {
      logger.error('Error fetching services:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Server error'
      });
    }
  });
}

// Health check endpoint for monitoring
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: NODE_ENV
  });
});

// Additional security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  if (NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  
  next();
});

// 404 handler with logging
app.use((req, res) => {
  logger.info(`404 - Route not found: ${req.method} ${req.originalUrl} from IP: ${req.ip}`);
  res.status(404).json({ 
    success: false, 
    message: 'Route not found' 
  });
});


app.use((err, req, res, next) => {
  // Log error with context
  logger.error('Global error handler:', err, {
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  
  
  const message = NODE_ENV === 'production' 
    ? 'Internal server error' 
    : err.message;
    
  res.status(err.statusCode || 500).json({ 
    success: false, 
    message,
    ...(NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Graceful shutdown handling
// Graceful shutdown handling
const gracefulShutdown = (signal) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  
  // Oprește auto-cleanup job-ul
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    logger.info('Auto-cleanup job stopped');
  }
  
  server.close(async () => {
    logger.info('HTTP server closed');
    
    // FIX: Folosește await în loc de callback
    try {
      await require('mongoose').connection.close();
      logger.info('MongoDB connection closed');
      process.exit(0);
    } catch (error) {
      logger.error('Error closing MongoDB connection:', error);
      process.exit(1);
    }
  });
  
  // Force close after 10 seconds
  setTimeout(() => {
    logger.error('Forceful shutdown');
    process.exit(1);
  }, 10000);
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  logger.error('Unhandled Rejection:', err);
  // Don't exit on unhandled promise rejections in production
  if (NODE_ENV !== 'production') {
    process.exit(1);
  }
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info(` Server running in ${NODE_ENV} mode on port ${PORT}`);
  
  if (NODE_ENV === 'production') {
    logger.info(` Production server accessible at https://dariushreniuc.com`);
  } else {
    logger.info(` Development server accessible at http://localhost:${PORT}`);
  }
  
  logger.info(` Health check available at http://localhost:${PORT}/health`);
});


if (NODE_ENV === 'production') {
  server.timeout = 30000; 
  server.keepAliveTimeout = 65000; 
  server.headersTimeout = 66000; 
}

module.exports = app;