// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const { User } = require('../models/Booking'); // Update this path if you separate your models

// Sistem de logging îmbunătățit
const NODE_ENV = process.env.NODE_ENV;
const { createContextLogger } = require('../utils/logger');
const logger = createContextLogger('AUTH');

// Get JWT secret from environment variables
const JWT_SECRET = process.env.JWT_SECRET || (NODE_ENV === 'development' ? 'dev_jwt_secret' : null);

// Ensure JWT_SECRET is set in production
if (NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  logger.error('ERROR: JWT_SECRET environment variable not set in production');
  process.exit(1);
}

/**
 * Middleware to authenticate JWT tokens
 */
const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  
  const token = authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Check if token is about to expire and refresh if needed
    const tokenExp = new Date(decoded.exp * 1000);
    const now = new Date();
    const timeUntilExpiry = (tokenExp - now) / (1000 * 60); // minutes
    
    req.user = {
      id: decoded.id,
      role: decoded.role,
      username: decoded.username
    };
    
    // Optional: Refresh token if it's close to expiring (e.g., less than 15 minutes)
    if (timeUntilExpiry < 15) {
      const newToken = jwt.sign(
        { id: decoded.id, role: decoded.role, username: decoded.username },
        JWT_SECRET,
        { expiresIn: '24h' }
      );
      res.setHeader('X-New-Token', newToken);
    }
    
    next();
  } catch (error) {
    logger.error('JWT verification error:', error.name);
    return res.status(403).json({ success: false, message: 'Authentication failed' });
  }
};

/**
 * Middleware for role-based access control
 * @param {Array} roles - Array of allowed roles
 */
const authorizeRole = (roles = []) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }
    
    next();
  };
};

/**
 * Create a default admin user if none exists and INIT_ADMIN env var is set
 */
const createDefaultAdmin = async () => {
  // Only run in development or if explicitly enabled
  if (NODE_ENV === 'production' && process.env.INIT_ADMIN !== 'true') {
    return;
  }
  
  try {
    const adminCount = await User.countDocuments({ role: 'admin' });
    
    if (adminCount === 0) {
      const bcrypt = require('bcryptjs');
      
      // Get admin credentials from environment variables or use defaults only in development
      const adminUsername = process.env.ADMIN_USERNAME;
      let adminPassword = process.env.ADMIN_PASSWORD;
      
      if (!adminPassword) {
        if (NODE_ENV === 'production') {
          logger.error('ERROR: ADMIN_PASSWORD not set for initial admin creation');
          return;
        } else {
          // Only use default password in development
          adminPassword = 'admin123';
          logger.warn('WARNING: Using default admin password in development');
        }
      }
      
      const hashedPassword = await bcrypt.hash(adminPassword, 12); // Increased rounds for better security
      
      await User.create({
        username: adminUsername,
        password: hashedPassword,
        role: 'admin'
      });
      
      logger.info('Default admin user created');
    }
  } catch (error) {
    logger.error('Error creating default admin:', error);
  }
};

/**
 * Generate a JWT token for a user
 * @param {Object} user - User object
 * @returns {String} JWT token
 */
const generateToken = (user) => {
  return jwt.sign(
    { 
      id: user._id, 
      role: user.role,
      username: user.username
    },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRY || '24h' }
  );
};

module.exports = {
  authenticateJWT,
  authorizeRole,
  createDefaultAdmin,
  generateToken
};