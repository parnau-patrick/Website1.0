// models/Booking.js - Versiune actualizată pentru sistemul de email
const mongoose = require('mongoose');
const BlockedDate = require('./BlockedDates');
const TimeLock = require('./TimeLock');
require('dotenv').config();


// Environment variables - fără credențiale hardcodate
const NODE_ENV = process.env.NODE_ENV || 'production';
const MONGO_URL = process.env.MONGO_URL || (NODE_ENV === 'production' 
  ? null // În producție, trebuie să fie configurat în variabilele de mediu
  : 'mongodb://localhost:27017/barbershop'); // Local development fallback

// Sistem de logging îmbunătățit
const { createContextLogger } = require('../utils/logger');
const logger = createContextLogger('BOOKING-MODEL');

// Verifică dacă MONGO_URL este setat în producție
if (NODE_ENV === 'production' && !process.env.MONGO_URL) {
  logger.error('ERROR: MONGO_URL environment variable is required in production!');
  process.exit(1);
}

// Services Schema
const serviceSchema = new mongoose.Schema({
  _id: {
    type: Number,
    required: true
  },
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    maxlength: 50
  },
  duration: {
    type: Number,  // Duration in minutes
    required: true,
    min: 5,
    max: 240
  },
  price: {
    type: Number,
    required: true,
    min: 0,
    max: 10000
  }
});

// Booking Schema (actualizat pentru a include referința la Client și câmpul email)
const bookingSchema = new mongoose.Schema({
  // Referință către Client
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client'
  },
  // Păstrăm aceste câmpuri pentru compatibilitate descendentă
  clientName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  phoneNumber: {
    type: String,
    required: true,
    trim: true,
    maxlength: 30 // Mărit pentru a permite numere internaționale
  },
  // Adăugăm câmpul email
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    maxlength: 100,
    match: [/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, 'Introduceți un email valid']
  },
  service: {
    type: Number,
    ref: 'Service',
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  time: {
    type: String,
    required: true,
    match: /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'declined', 'completed', 'cancelled'],
    default: 'pending'
  },
  verificationCode: {
    type: String,
    maxlength: 10
  },
  verified: {
    type: Boolean,
    default: false
  },
  // Modificat din smsCount în emailCount
  emailCount: {
    type: Number,
    default: 0,
    min: 0,
    max: 20
  },
  // Modificat din lastSmsSentAt în lastEmailSentAt
  lastEmailSentAt: {
    type: Date
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  // Câmpuri noi pentru îmbunătățirea sistemului
  completedAt: {
    type: Date
  },
  notes: {
    type: String,
    trim: true,
    maxlength: 500
  },
  // Câmp pentru a stoca codul țării/prefixul
  countryCode: {
    type: String,
    trim: true,
    maxlength: 5,
    default: '+40' // Implicit România
  }
});

// Adăugăm indecși pentru îmbunătățirea performanței
bookingSchema.index({ client: 1 });
bookingSchema.index({ phoneNumber: 1 });
bookingSchema.index({ email: 1 }); // Nou index pentru email
bookingSchema.index({ date: 1, status: 1 });
bookingSchema.index({ status: 1, verified: 1 });
bookingSchema.index({ createdAt: 1 });

// Blocked Users Schema 
const blockedUserSchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    maxlength: 30
  },
  // Adăugăm câmpul email pentru blocaje
  email: {
    type: String,
    trim: true,
    lowercase: true,
    maxlength: 100,
    match: [/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, 'Introduceți un email valid']
  },
  reason: {
    type: String,
    trim: true,
    maxlength: 200
  },
  blockedAt: {
    type: Date,
    default: Date.now
  }
});

// Modificat din SMSUsage în EmailUsage
const emailUsageSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    maxlength: 100
  },
  date: {
    type: Date,
    required: true
  },
  count: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  }
});

// UPDATED: findOrCreateDailyUsage method cu validare îmbunătățită pentru email
emailUsageSchema.statics.findOrCreateDailyUsage = async function(email) {
  // Validare email
  if (!email || typeof email !== 'string' || email.length > 100) {
    throw new Error('Invalid email');
  }
  
  const cleanEmail = email.trim().toLowerCase().substring(0, 100);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  try {
    let usage = await this.findOne({
      email: cleanEmail,
      date: {
        $gte: today,
        $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
      }
    });
    
    if (!usage) {
      usage = new this({
        email: cleanEmail,
        date: today,
        count: 0
      });
      await usage.save();
    }
    
    return usage;
  } catch (error) {
    logger.error('Error in findOrCreateDailyUsage:', error);
    throw error;
  }
};

// Admin User Schema
const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 30,
    match: /^[a-zA-Z0-9_]+$/
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['admin', 'barber'],
    default: 'barber'
  },
  lastLogin: {
    type: Date
  },
  loginAttempts: {
    type: Number,
    default: 0,
    min: 0,
    max: 10
  },
  active: {
    type: Boolean,
    default: true
  }
});


// Helper function: verifică disponibilitatea intervalului orar
const isTimeSlotAvailable = async (date, time, duration) => {
  try {
    // Validare input
    if (!date || !time || isNaN(duration)) {
      logger.error('Invalid parameters for isTimeSlotAvailable');
      return false;
    }
    
    // Limitare durata pentru securitate
    if (duration <= 0 || duration > 240) {
      logger.error('Invalid duration value');
      return false;
    }
    
    // Validare format timp
    if (!/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time)) {
      logger.error('Invalid time format');
      return false;
    }
    
    const startTime = new Date(`${date.toDateString()} ${time}`);
    if (isNaN(startTime.getTime())) {
      logger.error('Invalid date/time format');
      return false;
    }
    
    const endTime = new Date(startTime.getTime() + duration * 60000);
    
    // Verifică dacă este duminică (0 = Duminică)
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0) {
      return false; // Duminica este închis
    }
    
    // Verifică programul de lucru - ACTUALIZAT pentru sâmbătă 10-13
    const hour = parseInt(time.split(':')[0]);
    const minute = parseInt(time.split(':')[1]);
    const timeInMinutes = hour * 60 + minute;
    const endTimeInMinutes = timeInMinutes + duration;
    
    if (dayOfWeek === 6) { // Sâmbătă - program special 10:00-13:00
      const saturdayStart = 10 * 60; // 10:00
      const saturdayEnd = 13 * 60;   // 13:00
      
      if (timeInMinutes < saturdayStart || endTimeInMinutes > saturdayEnd) {
        return false;
      }
    } else { // Luni-Vineri - program normal 10:00-19:00
      const weekdayStart = 10 * 60; // 10:00
      const weekdayEnd = 19 * 60;   // 19:00
      
      if (timeInMinutes < weekdayStart || endTimeInMinutes > weekdayEnd) {
        return false;
      }
    }
    
    // Găsește intervalul de serviciu pentru a verifica toate orele ocupate
    const services = await Service.find();
    const serviceIds = services.map(s => s._id);
    
    // Verifică lock-urile pentru toate serviciile (orice serviciu poate bloca o oră)
    const activeLocks = await TimeLock.find({
      date: {
        $gte: new Date(date.toDateString()),
        $lt: new Date(new Date(date.toDateString()).getTime() + 24 * 60 * 60 * 1000)
      },
      serviceId: { $in: serviceIds }
    }).limit(50);
    
    // Verifică dacă ora curentă este locked
    for (const lock of activeLocks) {
      // Găsește serviciul pentru lock pentru a determina durata
      const lockService = services.find(s => s._id === lock.serviceId);
      if (!lockService) continue;
      
      const lockStartTime = new Date(`${lock.date.toDateString()} ${lock.time}`);
      const lockEndTime = new Date(lockStartTime.getTime() + lockService.duration * 60000);
      
      // Verifică dacă există suprapunere
      if (
        (startTime >= lockStartTime && startTime < lockEndTime) || 
        (endTime > lockStartTime && endTime <= lockEndTime) ||
        (startTime <= lockStartTime && endTime >= lockEndTime)
      ) {
        logger.info(`Time slot ${time} is locked by session ${lock.lockedBy}`);
        return false;
      }
    }
    
    // Limitare rezultate pentru performanță
    const overlappingBookings = await Booking.find({
      date: {
        $gte: new Date(date.toDateString()),
        $lt: new Date(new Date(date.toDateString()).getTime() + 24 * 60 * 60 * 1000)
      },
      status: { $in: ['pending', 'confirmed'] }
    }).populate('service').limit(50);

    // Check for overlaps cu rezervările existente
    for (const booking of overlappingBookings) {
      const service = await Service.findById(booking.service);
      if (!service) continue;
      
      const bookingStartTime = new Date(`${booking.date.toDateString()} ${booking.time}`);
      const bookingEndTime = new Date(bookingStartTime.getTime() + service.duration * 60000);
      
      // Check if there's an overlap
      if (
        (startTime >= bookingStartTime && startTime < bookingEndTime) || 
        (endTime > bookingStartTime && endTime <= bookingEndTime) ||
        (startTime <= bookingStartTime && endTime >= bookingEndTime)
      ) {
        return false;
      }
    }
    
    // Verifică din nou dacă data/ora a fost blocată între timp (previne race conditions)
    const finalBlockCheck = await BlockedDate.isDateTimeBlocked(date, time);
    if (finalBlockCheck.isBlocked) {
      logger.info(`Time slot ${time} on ${date.toDateString()} was blocked during reservation process`);
      return false;
    }

    // Verifică din nou dacă toată ziua a fost blocată
    const finalDayBlockCheck = await BlockedDate.isDateTimeBlocked(date);
    if (finalDayBlockCheck.isBlocked && finalDayBlockCheck.type === 'fullDay') {
      logger.info(`Full day ${date.toDateString()} was blocked during reservation process`);
      return false;
    }
    
    return true;
  } catch (error) {
    logger.error('Error checking time slot availability:', error);
    return false; // În caz de eroare, presupunem că slotul nu este disponibil
  }
};

// Create models
const Service = mongoose.model('Service', serviceSchema);
const Booking = mongoose.model('Booking', bookingSchema);
const BlockedUser = mongoose.model('BlockedUser', blockedUserSchema);
const User = mongoose.model('User', userSchema);
// Redenumit din SMSUsage în EmailUsage
const EmailUsage = mongoose.model('EmailUsage', emailUsageSchema);

// Initialize default services if none exist
const initializeServices = async () => {
  try {
    // Limităm inițializarea serviciilor doar în dezvoltare sau când se cere explicit
    if (NODE_ENV === 'production' && process.env.INIT_SERVICES !== 'true') {
      logger.info('Skipping service initialization in production');
      return;
    }
    
    const count = await Service.countDocuments();
    if (count === 0) {
      await Service.create([
        { _id: 1, name: 'Tuns', duration: 30, price: 80 },
        { _id: 2, name: 'Tuns & Barba', duration: 30, price: 100 },
        { _id: 3, name: 'Precision Haircut', duration: 60, price: 150 }
      ]);
      logger.info('Default services created');
    }
  } catch (error) {
    logger.error('Error initializing services:', error);
  }
};

// Improved MongoDB connection with error handling
const connect = async () => {
  try {
    // Log connection info (fără credențiale)
    const sanitizedUrl = MONGO_URL ? MONGO_URL.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@') : 'undefined';
    logger.info(`Connecting to MongoDB in ${NODE_ENV} mode: ${sanitizedUrl}`);
    
    // Configurare opțiuni de conexiune cu focus pe securitate și stabilitate
    const connectionOptions = {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      family: 4,
      maxPoolSize: 10
    };
    
    // Opțiuni extra în producție
    if (NODE_ENV === 'production') {
      connectionOptions.retryWrites = true;
      connectionOptions.retryReads = true;
      connectionOptions.connectTimeoutMS = 30000;
    }
    
    await mongoose.connect(MONGO_URL, connectionOptions);
    logger.info(`Connected to MongoDB in ${NODE_ENV} mode`);
    
    // Inițializează serviciile
    await initializeServices();
    
    return true;
  } catch (error) {
    logger.error('MongoDB connection error:', error);
    
    // În producție, opriți aplicația dacă nu se poate conecta
    if (NODE_ENV === 'production') {
      logger.error('Failed to connect to MongoDB in production. Exiting.');
      process.exit(1);
    }
    
    return false;
  }
};

// Graceful disconnect
const disconnect = async () => {
  try {
    await mongoose.disconnect();
    logger.info('Disconnected from MongoDB');
    return true;
  } catch (error) {
    logger.error('Error disconnecting from MongoDB:', error);
    return false;
  }
};

// Funcție nouă pentru generarea orelor disponibile cu programul actualizat
const generateAvailableTimeSlots = async (date, duration) => {
  try {
    const dayOfWeek = date.getDay();
    
    // Verifică dacă este duminică
    if (dayOfWeek === 0) {
      return [];
    }
    
    // Verifică dacă toată ziua este blocată
    const dayBlockCheck = await BlockedDate.isDateTimeBlocked(date);
    if (dayBlockCheck.isBlocked && dayBlockCheck.type === 'fullDay') {
      return [];
    }
    
    let startHour, endHour;
    
    if (dayOfWeek === 6) { // Sâmbătă - program special 10:00-13:00
      startHour = 10;
      endHour = 13;
    } else { // Luni-Vineri - program normal 10:00-19:00
      startHour = 10;
      endHour = 19;
    }
    
    const timeSlots = [];
    
    // Generate slots every 30 minutes
    for (let hour = startHour; hour < endHour; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        // Format time string with leading zeros
        const startTime = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        
        // Skip slots that would extend beyond closing time
        const startTimeInMinutes = hour * 60 + minute;
        const endTimeInMinutes = startTimeInMinutes + duration;
        
        if (endTimeInMinutes > endHour * 60) {
          continue;
        }
        
        // Check if the time slot is available
        const available = await isTimeSlotAvailable(date, startTime, duration);
        
        if (available) {
          timeSlots.push(startTime);
        }
      }
    }
    
    return timeSlots;
  } catch (error) {
    logger.error('Error generating available time slots:', error);
    return [];
  }
};



module.exports = {
  Service,
  Booking,
  BlockedUser,
  User,
  EmailUsage,
  initializeServices,
  isTimeSlotAvailable,
  generateAvailableTimeSlots, 
  connect,
  disconnect
};