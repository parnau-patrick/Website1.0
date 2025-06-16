// backend/models/BlockedDates.js - Model complet pentru blocarea datelor/orelor
const mongoose = require('mongoose');

// Sistem de logging îmbunătățit
const NODE_ENV = process.env.NODE_ENV;
const { createContextLogger } = require('../utils/logger');
const logger = createContextLogger('BLOCKED-DATES-MODEL');
// Schema pentru blocarea datelor și orelor
const blockedDateSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: [true, 'Data este obligatorie'],
    validate: {
      validator: function(value) {
        // Verifică că data nu este în trecut
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const selectedDate = new Date(value);
        selectedDate.setHours(0, 0, 0, 0);
        return selectedDate >= today;
      },
      message: 'Nu se pot bloca date din trecut'
    }
  },
  isFullDayBlocked: {
    type: Boolean,
    default: false,
    required: true
  },
  blockedHours: [{
    type: String,
    match: [/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Format oră invalid (HH:MM)'],
    validate: {
      validator: function(hour) {
        // Verifică că ora este în intervalul de program (10:00-19:00)
        const [hours, minutes] = hour.split(':').map(Number);
        const timeInMinutes = hours * 60 + minutes;
        return timeInMinutes >= 600 && timeInMinutes <= 1140; // 10:00-19:00
      },
      message: 'Ora trebuie să fie în intervalul 10:00-19:00'
    }
  }],
  reason: {
    type: String,
    trim: true,
    maxlength: [500, 'Motivul nu poate depăși 500 de caractere'],
    default: function() {
      const dayName = this.constructor.formatDateInRomanian(this.date);
      return this.isFullDayBlocked 
        ? `Suntem închiși în ${dayName}` 
        : `Anumite ore sunt indisponibile în ${dayName}`;
    }
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Utilizatorul creator este obligatoriu']
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Middleware pre-save pentru actualizarea timestampului și validări
blockedDateSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  
  // Validare: dacă nu este toată ziua blocată, trebuie să existe ore
  if (!this.isFullDayBlocked && (!this.blockedHours || this.blockedHours.length === 0)) {
    return next(new Error('Trebuie să specifici ore de blocat dacă nu blochezi toată ziua'));
  }
  
  // Validare: elimină orele duplicate
  if (this.blockedHours && this.blockedHours.length > 0) {
    this.blockedHours = [...new Set(this.blockedHours)];
  }
  
  // Dacă este toată ziua blocată, curăță array-ul de ore
  if (this.isFullDayBlocked) {
    this.blockedHours = [];
  }
  
  // Generează motivul automat dacă nu este specificat
  if (!this.reason) {
    const dayName = this.constructor.formatDateInRomanian(this.date);
    this.reason = this.isFullDayBlocked 
      ? `Suntem închiși în ${dayName}` 
      : `Anumite ore sunt indisponibile în ${dayName}`;
  }
  
  next();
});

// Index-uri pentru căutări rapide și performanță
blockedDateSchema.index({ date: 1, isFullDayBlocked: 1 });
blockedDateSchema.index({ createdBy: 1 });
blockedDateSchema.index({ createdAt: -1 });

// Index unic pentru a preveni duplicatele pe aceeași dată
blockedDateSchema.index({ date: 1 }, { 
  unique: true,
  partialFilterExpression: { date: { $exists: true } }
});

/**
 * Metodă statică pentru verificarea dacă o dată/oră este blocată
 * @param {Date} date - Data de verificat
 * @param {string} time - Ora de verificat (opțional)
 * @returns {Promise<Object>} - Rezultatul verificării
 */
blockedDateSchema.statics.isDateTimeBlocked = async function(date, time = null) {
  try {
    // Validare input
    if (!date || !(date instanceof Date)) {
      logger.error('Date parameter must be a valid Date object');
      return { isBlocked: false, reason: null, type: null };
    }
    
    // Validare timp dacă este specificat
    if (time && !/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time)) {
      logger.error('Invalid time format:', time);
      return { isBlocked: false, reason: null, type: null };
    }
    
    // Pregătește intervalul de căutare pentru ziua specificată
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    
    // Caută blocarea pentru această dată
    const blockedDate = await this.findOne({
      date: {
        $gte: startOfDay,
        $lte: endOfDay
      }
    }).maxTimeMS(5000); // Timeout pentru performanță
    
    if (!blockedDate) {
      return { isBlocked: false, reason: null, type: null };
    }
    
    // Dacă toată ziua este blocată
    if (blockedDate.isFullDayBlocked) {
      return { 
        isBlocked: true, 
        reason: blockedDate.reason,
        type: 'fullDay',
        blockedDate: blockedDate
      };
    }
    
    // Dacă nu este specificată o oră, verifică doar ziua
    if (!time) {
      return { isBlocked: false, reason: null, type: null };
    }
    
    // Verifică dacă ora specifică este blocată
    const isHourBlocked = blockedDate.blockedHours && blockedDate.blockedHours.includes(time);
    return { 
      isBlocked: isHourBlocked, 
      reason: isHourBlocked ? blockedDate.reason : null,
      type: isHourBlocked ? 'specificHours' : null,
      blockedDate: isHourBlocked ? blockedDate : null
    };
    
  } catch (error) {
    logger.error('Error checking blocked date/time:', error);
    return { isBlocked: false, reason: null, type: null };
  }
};

/**
 * Metodă statică pentru obținerea orelor blocate pentru o dată
 * @param {Date} date - Data pentru care să obțină orele blocate
 * @returns {Promise<Object>} - Informațiile despre orele blocate
 */
blockedDateSchema.statics.getBlockedHours = async function(date) {
  try {
    // Validare input
    if (!date || !(date instanceof Date)) {
      logger.error('Date parameter must be a valid Date object');
      return { isFullDayBlocked: false, blockedHours: [], reason: null };
    }
    
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    
    const blockedDate = await this.findOne({
      date: {
        $gte: startOfDay,
        $lte: endOfDay
      }
    }).maxTimeMS(5000);
    
    if (!blockedDate) {
      return { isFullDayBlocked: false, blockedHours: [], reason: null };
    }
    
    return {
      isFullDayBlocked: blockedDate.isFullDayBlocked,
      blockedHours: blockedDate.blockedHours || [],
      reason: blockedDate.reason,
      blockedDate: blockedDate
    };
    
  } catch (error) {
    logger.error('Error getting blocked hours:', error);
    return { isFullDayBlocked: false, blockedHours: [], reason: null };
  }
};

/**
 * Metodă statică pentru formatarea datei în română
 * @param {Date} date - Data de formatat
 * @returns {string} - Data formatată în română
 */
blockedDateSchema.statics.formatDateInRomanian = function(date) {
  try {
    if (!date || !(date instanceof Date)) {
      return 'Dată invalidă';
    }
    
    const days = ['Duminică', 'Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă'];
    const months = [
      'Ianuarie', 'Februarie', 'Martie', 'Aprilie', 'Mai', 'Iunie',
      'Iulie', 'August', 'Septembrie', 'Octombrie', 'Noiembrie', 'Decembrie'
    ];
    
    const dayName = days[date.getDay()];
    const day = date.getDate();
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    
    return `${dayName}, ${day} ${month} ${year}`;
  } catch (error) {
    logger.error('Error formatting date in Romanian:', error);
    return 'Dată invalidă';
  }
};

/**
 * Metodă statică pentru curățarea datelor blocate expirate
 * @returns {Promise<Object>} - Rezultatul operației de curățare
 */
blockedDateSchema.statics.cleanupExpiredBlockedDates = async function() {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(23, 59, 59, 999);
    
    const result = await this.deleteMany({
      date: { $lt: yesterday }
    });
    
    logger.info(`Cleaned up ${result.deletedCount} expired blocked dates`);
    
    return {
      success: true,
      deletedCount: result.deletedCount,
      message: `${result.deletedCount} date blocate expirate au fost curățate`
    };
    
  } catch (error) {
    logger.error('Error cleaning up expired blocked dates:', error);
    return {
      success: false,
      deletedCount: 0,
      message: 'Eroare la curățarea datelor blocate expirate'
    };
  }
};

/**
 * Metodă statică pentru obținerea tuturor datelor blocate active
 * @returns {Promise<Array>} - Lista datelor blocate active
 */
blockedDateSchema.statics.getActiveBlockedDates = async function() {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const activeBlockedDates = await this.find({
      date: { $gte: today }
    })
    .populate('createdBy', 'username role')
    .sort({ date: 1 })
    .maxTimeMS(10000);
    
    return activeBlockedDates;
    
  } catch (error) {
    logger.error('Error getting active blocked dates:', error);
    return [];
  }
};

/**
 * Metodă de instanță pentru actualizarea unei blocări existente
 * @param {boolean} isFullDay - Dacă să blocheze toată ziua
 * @param {Array} hours - Array cu orele de blocat
 * @param {string} userId - ID-ul utilizatorului care face modificarea
 * @returns {Promise<Object>} - Blocarea actualizată
 */
blockedDateSchema.methods.updateBlocking = async function(isFullDay, hours = [], userId) {
  try {
    this.isFullDayBlocked = isFullDay;
    this.blockedHours = isFullDay ? [] : [...new Set(hours)];
    this.createdBy = userId;
    this.updatedAt = new Date();
    
    // Regenerează motivul
    const dayName = this.constructor.formatDateInRomanian(this.date);
    this.reason = isFullDay 
      ? `Suntem închiși în ${dayName}` 
      : `Anumite ore sunt indisponibile în ${dayName}`;
    
    return await this.save();
    
  } catch (error) {
    logger.error('Error updating blocking:', error);
    throw error;
  }
};

/**
 * Metodă virtuală pentru obținerea informațiilor formatate
 */
blockedDateSchema.virtual('formattedInfo').get(function() {
  return {
    id: this._id,
    date: this.date,
    dateFormatted: this.constructor.formatDateInRomanian(this.date),
    isFullDayBlocked: this.isFullDayBlocked,
    blockedHours: this.blockedHours,
    hoursCount: this.blockedHours ? this.blockedHours.length : 0,
    reason: this.reason,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
});

// Asigură-te că virtualele sunt incluse în JSON
blockedDateSchema.set('toJSON', { virtuals: true });
blockedDateSchema.set('toObject', { virtuals: true });

blockedDateSchema.statics.cleanupExpiredBlockedDates = async function() {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(23, 59, 59, 999);
    
    const result = await this.deleteMany({
      date: { $lt: yesterday }
    });
    
    return {
      success: true,
      deletedCount: result.deletedCount
    };
  } catch (error) {
    return {
      success: false,
      deletedCount: 0,
      error: error.message
    };
  }
};

// Creează modelul
const BlockedDate = mongoose.model('BlockedDate', blockedDateSchema);

module.exports = BlockedDate;