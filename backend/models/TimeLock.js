// backend/models/TimeLock.js
const mongoose = require('mongoose');

// Sistem de logging îmbunătățit
const NODE_ENV = process.env.NODE_ENV;
const { createContextLogger } = require('../utils/logger');
const logger = createContextLogger('TIME-LOCK');

const timeLockSchema = new mongoose.Schema({
  date: { 
    type: Date, 
    required: true 
  },
  time: { 
    type: String, 
    required: true,
    match: /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/
  },
  serviceId: { 
    type: Number, 
    required: true 
  },
  lockedBy: { 
    type: String, 
    required: true 
  }, // Session ID
  lockedAt: { 
    type: Date, 
    default: Date.now
  }
});

// Index unic pentru a preveni lock-urile duplicate
timeLockSchema.index({ 
  date: 1, 
  time: 1, 
  serviceId: 1 
}, { 
  unique: true 
});

// Index pentru expirare automată - DOAR AICI, NU ÎN SCHEMA
timeLockSchema.index({ 
  lockedAt: 1 
}, { 
  expireAfterSeconds: 900 // 15 minute
});

// Metodă statică pentru curățarea lock-urilor expirate manual
timeLockSchema.statics.cleanupExpiredLocks = async function() {
  try {
    const fifteenMinutesAgo = new Date();
    fifteenMinutesAgo.setMinutes(fifteenMinutesAgo.getMinutes() - 15);
    
    const result = await this.deleteMany({
      lockedAt: { $lt: fifteenMinutesAgo }
    });
    
    logger.info(`Cleaned up ${result.deletedCount} expired time locks`);
    return result.deletedCount;
  } catch (error) {
    logger.error('Error cleaning up expired locks:', error);
    return 0;
  }
};

const TimeLock = mongoose.model('TimeLock', timeLockSchema);

module.exports = TimeLock;