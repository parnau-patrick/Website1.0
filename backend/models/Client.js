// models/Client.js - Versiune actualizată pentru a include email și funcții asociate
const mongoose = require('mongoose');

// Sistem de logging îmbunătățit
const NODE_ENV = process.env.NODE_ENV;
const { createContextLogger } = require('../utils/logger');
const logger = createContextLogger('CLIENT-MODEL');

/**
 * Client Schema - Stochează informații unice despre clienți (actualizat pentru email)
 */
const clientSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Numele clientului este obligatoriu'],
    trim: true,
    minlength: [2, 'Numele trebuie să conțină cel puțin 2 caractere'],
    maxlength: [50, 'Numele nu poate depăși 50 de caractere']
  },
  phoneNumber: {
    type: String,
    required: [true, 'Numărul de telefon este obligatoriu'],
    trim: true,
    maxlength: [30, 'Numărul de telefon nu poate depăși 30 caractere'] // Mărit pentru a accepta formate internaționale
  },
  // Adăugat câmpul email
  email: {
    type: String,
    required: [true, 'Adresa de email este obligatorie'],
    unique: true, // REMOVED: The duplicate index declaration below
    trim: true,
    lowercase: true,
    maxlength: [100, 'Email-ul nu poate depăși 100 caractere'],
    match: [/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, 'Adresă de email invalidă']
  },
  // Adăugăm codul de țară pentru telefon
  countryCode: {
    type: String,
    trim: true,
    maxlength: [5, 'Codul de țară nu poate depăși 5 caractere'],
    default: '+40' // Implicit România
  },
  isBlocked: {
    type: Boolean,
    default: false
  },
  blockReason: {
    type: String,
    default: null,
    trim: true,
    maxlength: [200, 'Motivul blocării nu poate depăși 200 de caractere']
  },
  blockDate: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastVisit: {
    type: Date,
    default: null
  },
  totalBookings: {
    type: Number,
    default: 0,
    min: 0,
    max: 1000
  },
  completedBookings: {
    type: Number,
    default: 0,
    min: 0,
    max: 1000
  },
  // Contor email-uri trimise (înlocuiește smsSent)
  emailsSent: {
    type: Number,
    default: 0,
    min: 0,
    max: 1000
  },
  // Redenumit din lastSmsSentAt în lastEmailSentAt
  lastEmailSentAt: {
    type: Date,
    default: null
  },
  notes: {
    type: String,
    trim: true,
    maxlength: [500, 'Notele nu pot depăși 500 de caractere']
  },
  lastModified: {
    type: Date,
    default: Date.now
  }
});

// Middleware pentru a actualiza lastModified la fiecare salvare
clientSchema.pre('save', function(next) {
  this.lastModified = new Date();
  next();
});

// FIXED: Crearea unor indecși pentru performanță - REMOVED duplicate email index
clientSchema.index({ phoneNumber: 1 });
// REMOVED: clientSchema.index({ email: 1 }, { unique: true }); // This was duplicate!
clientSchema.index({ isBlocked: 1 });
clientSchema.index({ lastVisit: -1 });
clientSchema.index({ createdAt: 1 });
clientSchema.index({ lastModified: -1 });

/**
 * Găsește client după număr de telefon
 * @param {string} phoneNumber - Număr de telefon de căutat
 */
clientSchema.statics.findByPhoneNumber = async function(phoneNumber) {
  if (!phoneNumber) return null;
  
  try {
    // Validare input pentru securitate
    if (typeof phoneNumber !== 'string' || phoneNumber.length > 30) {
      logger.error('Invalid phone number format in findByPhoneNumber');
      return null;
    }
    
    // Standardizează formatul numărului de telefon eliminând spații, cratime, etc.
    const cleanNumber = phoneNumber.replace(/\s+|-|\(|\)|\+/g, '').substring(0, 30);
    
    // Încearcă diferite formate posibile - acum acceptă și formate internaționale
    const client = await this.findOne({ 
      phoneNumber: { $regex: cleanNumber.replace(/^0/, '') } 
    }).maxTimeMS(2000);
    
    return client;
  } catch (error) {
    logger.error('Error in findByPhoneNumber:', error);
    return null;
  }
};

/**
 * Găsește client după adresa de email
 * @param {string} email - Adresa de email de căutat
 */
clientSchema.statics.findByEmail = async function(email) {
  if (!email) return null;
  
  try {
    // Validare input pentru securitate
    if (typeof email !== 'string' || email.length > 100) {
      logger.error('Invalid email format in findByEmail');
      return null;
    }
    
    // Standardizează formatul email-ului
    const cleanEmail = email.trim().toLowerCase().substring(0, 100);
    
    // Caută clientul după email
    const client = await this.findOne({ 
      email: cleanEmail 
    }).maxTimeMS(2000);
    
    return client;
  } catch (error) {
    logger.error('Error in findByEmail:', error);
    return null;
  }
};

/**
 * Blochează client
 * @param {string} reason - Motivul blocării
 */
clientSchema.methods.block = async function(reason) {
  try {
    // Validare pentru securitate
    if (reason && (typeof reason !== 'string' || reason.length > 200)) {
      reason = reason ? reason.substring(0, 200) : 'No reason provided';
    }
    
    this.isBlocked = true;
    this.blockReason = reason || 'No reason provided';
    this.blockDate = new Date();
    return await this.save();
  } catch (error) {
    logger.error('Error blocking client:', error);
    throw error;
  }
};

/**
 * Deblochează client
 */
clientSchema.methods.unblock = async function() {
  try {
    this.isBlocked = false;
    this.blockReason = null;
    this.blockDate = null;
    return await this.save();
  } catch (error) {
    logger.error('Error unblocking client:', error);
    throw error;
  }
};

/**
 * Actualizează statisticile clientului după finalizarea unei rezervări
 */
clientSchema.methods.completeBooking = async function() {
  try {
    // Validări suplimentare pentru a preveni overflow
    if (this.totalBookings >= 1000 || this.completedBookings >= 1000) {
      logger.warn('Maximum booking count reached for client', this._id);
      return this;
    }
    
    this.totalBookings += 1;
    this.completedBookings += 1;
    this.lastVisit = new Date();
    return await this.save();
  } catch (error) {
    logger.error('Error completing booking for client:', error);
    throw error;
  }
};

/**
 * Incrementează contorul de email-uri al clientului (înlocuiește incrementSmsCounter)
 */
clientSchema.methods.incrementEmailCounter = async function() {
  try {
    // Validare suplimentară pentru a preveni overflow
    if (this.emailsSent >= 1000) {
      logger.warn('Maximum email count reached for client', this._id);
      return this;
    }
    
    this.emailsSent += 1;
    this.lastEmailSentAt = new Date();
    return await this.save();
  } catch (error) {
    logger.error('Error incrementing email counter for client:', error);
    throw error;
  }
};

const Client = mongoose.model('Client', clientSchema);

module.exports = Client;