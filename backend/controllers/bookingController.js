// controllers/bookingController.js
const { Service, Booking, EmailUsage, isTimeSlotAvailable } = require('../models/Booking');
const Client = require('../models/Client');
const BlockedDate = require('../models/BlockedDates');
const { runFullCleanup } = require('../utils/autoCleanup');
const TimeLock = require('../models/TimeLock');
const { 
  sendVerificationEmail, 
  sendBookingConfirmationEmail, 
  sendBookingRejectionEmail,
  sendUserBlockedEmail,
  getBookingEmailUsage,
  getDailyEmailUsage,
  DAILY_EMAIL_LIMIT
} = require('../config/email');
const mongoose = require('mongoose');
const crypto = require('crypto');

// Configurări din variabile de mediu
const NODE_ENV = process.env.NODE_ENV || 'development';
const MAX_BOOKING_DAYS_AHEAD = parseInt(process.env.MAX_BOOKING_DAYS_AHEAD) || 30;
const VERIFICATION_CODE_LENGTH = parseInt(process.env.VERIFICATION_CODE_LENGTH) || 6;
const BOOKING_SESSION_TIMEOUT_MINS = parseInt(process.env.BOOKING_SESSION_TIMEOUT_MINS) || 15;

const { createContextLogger } = require('../utils/logger');
const logger = createContextLogger('BOOKING-CONTROLLER');

/**
 * Cache memory pentru servicii pentru a evita interogări repetate
 */
const serviceCache = {
  services: {},
  lastUpdated: 0,
  ttl: 60000, 
  
  async getService(serviceId) {
    // Refresh cache if expired
    const now = Date.now();
    if (now - this.lastUpdated > this.ttl) {
      await this.refreshCache();
    }
    
    return this.services[serviceId] || null;
  },
  
  async refreshCache() {
    try {
      const services = await Service.find();
      this.services = {};
      
      for (const service of services) {
        this.services[service._id] = service;
      }
      
      this.lastUpdated = Date.now();
    } catch (error) {
      logger.error('Error refreshing service cache:', error);
    }
  }
};

/**
 * In-memory rate limiter pentru protecție împotriva încercărilor excesive
 */
const rateLimit = {
  attempts: {},
  resetTimers: {},
  lastCleanup: 0,
  
  check: function(key, maxAttempts = 5, timeWindowMs = 60000) {
    const now = Date.now();
    
    // Clean up old entries periodically
    if (!this.lastCleanup || now - this.lastCleanup > 3600000) {
      this._cleanup();
      this.lastCleanup = now;
    }
    
    // Initialize if key doesn't exist
    if (!this.attempts[key]) {
      this.attempts[key] = 0;
      this.resetTimers[key] = now + timeWindowMs;
    }
    
    // Reset if time window expired
    if (now > this.resetTimers[key]) {
      this.attempts[key] = 0;
      this.resetTimers[key] = now + timeWindowMs;
    }
    
    // Increment and check
    this.attempts[key]++;
    
    return this.attempts[key] <= maxAttempts;
  },
  
  _cleanup: function() {
    const now = Date.now();
    for (const key in this.resetTimers) {
      if (now > this.resetTimers[key] + 3600000) { // 1 hour
        delete this.attempts[key];
        delete this.resetTimers[key];
      }
    }
  }
};

/**
 * Standardizează răspunsurile de eroare
 */
const errorResponse = (res, status, message, extra = {}) => {
  return res.status(status).json({
    success: false,
    message,
    ...extra
  });
};

/**
 * Generate a secure random verification code
 * @returns {string} 6-digit code
 */
const generateVerificationCode = () => {
  try {
    // Generate a secure random number in the range 100000-999999
    const min = Math.pow(10, VERIFICATION_CODE_LENGTH - 1);
    const max = Math.pow(10, VERIFICATION_CODE_LENGTH) - 1;
    const range = max - min + 1;
    
    return String(min + crypto.randomInt(range));
  } catch (error) {
    // Fallback to Math.random if crypto.randomInt is not available
    logger.warn('Using fallback random code generation');
    const min = 100000;
    const max = 999999;
    return Math.floor(min + Math.random() * (max - min + 1)).toString();
  }
};

/**
 * Get all available services
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
const getServices = async (req, res) => {
  try {
    const services = await Service.find().select('_id name duration price');
    
    if (!services || services.length === 0) {
      return errorResponse(res, 404, 'Nu s-au găsit servicii. Contactați administratorul.');
    }
    
    // Sort services by ID for consistent ordering
    services.sort((a, b) => a._id - b._id);
    
    res.status(200).json({ success: true, services });
  } catch (error) {
    logger.error('Error fetching services:', error);
    return errorResponse(res, 500, 'Eroare la obținerea serviciilor disponibile');
  }
};

const getAvailableTimeSlots = async (req, res) => {
  try {
    const { date, serviceId } = req.body;
    
    logger.info(`[TIME-SLOTS] Cerere pentru ore disponibile: data=${date}, serviceId=${serviceId}`);
    
    // Rulează auto-cleanup înainte de a genera orele
    await runFullCleanup();
    
    // Validation is handled by middleware
    const selectedDate = new Date(date);
    const now = new Date();
    
    // Obține serviciul
    let service = await serviceCache.getService(parseInt(serviceId));
    if (!service) {
      service = await Service.findById(parseInt(serviceId));
    }
    
    if (!service) {
      logger.error(`[TIME-SLOTS] Serviciul ${serviceId} nu a fost găsit`);
      return errorResponse(res, 404, 'Serviciul nu a fost găsit. Vă rugăm să alegeți un serviciu valid.');
    }
    
    logger.info(`[TIME-SLOTS] Serviciu găsit: ${service.name} (${service.duration} min, ${service.price} RON)`);
    
    // Verifică ziua săptămânii
    const dayOfWeek = selectedDate.getDay(); // 0=Duminică, 1=Luni, 6=Sâmbătă
    
    // Duminica este închis
    if (dayOfWeek === 0) {
      logger.info(`[TIME-SLOTS] Duminică - închis`);
      return res.status(200).json({ 
        success: true, 
        timeSlots: [],
        message: 'Nu sunt disponibile programări duminica. Program de lucru: Luni-Sâmbătă.'
      });
    }
    
    // Verifică dacă data este blocată complet de admin
    const dayBlockCheck = await BlockedDate.isDateTimeBlocked(selectedDate);
    if (dayBlockCheck.isBlocked && dayBlockCheck.type === 'fullDay') {
      logger.info(`[TIME-SLOTS] Data ${selectedDate.toISOString().split('T')[0]} este blocată complet: ${dayBlockCheck.reason}`);
      return res.status(200).json({ 
        success: true, 
        timeSlots: [],
        message: `${dayBlockCheck.reason}. Te rugăm să selectezi o altă dată.`
      });
    }
    
    // Determină dacă data selectată este astăzi
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selectedDateOnly = new Date(selectedDate);
    selectedDateOnly.setHours(0, 0, 0, 0);
    const isToday = selectedDateOnly.getTime() === today.getTime();
    
    logger.info(`[TIME-SLOTS] Data selectată: ${selectedDate.toISOString().split('T')[0]}, este astăzi: ${isToday}`);
    if (isToday) {
      logger.info(`[TIME-SLOTS] Ora curentă: ${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`);
    }
    
    // Determină programul de lucru bazat pe ziua săptămânii
    let startHour, endHour, scheduleInfo;
    
    if (dayOfWeek === 6) { 
      // Sâmbătă - program special 10:00-13:00
      startHour = 10;
      endHour = 13;
      scheduleInfo = 'Sâmbătă (10:00-13:00)';
    } else { 
      // Luni-Vineri - program normal 10:00-19:00
      startHour = 10;
      endHour = 19;
      scheduleInfo = 'Luni-Vineri (10:00-19:00)';
    }
    
    logger.info(`[TIME-SLOTS] Program de lucru: ${scheduleInfo}`);
    
    // Generează toate slot-urile posibile (la fiecare 30 minute)
    const allPossibleSlots = [];
    for (let hour = startHour; hour < endHour; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        const timeString = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        
        // Verifică dacă serviciul se încadrează în program
        const slotStartMinutes = hour * 60 + minute;
        const slotEndMinutes = slotStartMinutes + service.duration;
        
        if (slotEndMinutes <= endHour * 60) {
          allPossibleSlots.push({
            time: timeString,
            hour: hour,
            minute: minute,
            startMinutes: slotStartMinutes,
            endMinutes: slotEndMinutes
          });
        }
      }
    }
    
    logger.info(`[TIME-SLOTS] Generate ${allPossibleSlots.length} slot-uri posibile în programul de lucru`);
    
    // Filtrează slot-urile disponibile
    const availableSlots = [];
    
    for (const slot of allPossibleSlots) {
      let isSlotAvailable = true;
      let skipReason = null;
      
      // 1. VERIFICĂ DACĂ SLOT-UL A ÎNCEPUT DEJA (doar pentru astăzi)
      if (isToday) {
        const slotDateTime = new Date(selectedDate);
        slotDateTime.setHours(slot.hour, slot.minute, 0, 0);
        
        if (slotDateTime <= now) {
          isSlotAvailable = false;
          skipReason = 'a început deja';
        }
      }
      
      // 2. VERIFICĂ REZERVĂRI EXISTENTE ȘI BLOCĂRI
      if (isSlotAvailable) {
        const available = await isTimeSlotAvailable(selectedDate, slot.time, service.duration);
        if (!available) {
          isSlotAvailable = false;
          skipReason = 'rezervat sau blocat';
        }
      }
      
      // Adaugă slot-ul dacă este disponibil
      if (isSlotAvailable) {
        availableSlots.push(slot.time);
        logger.info(`[TIME-SLOTS] ✓ ${slot.time} - disponibil`);
      } else {
        logger.info(`[TIME-SLOTS] ✗ ${slot.time} - ${skipReason}`);
      }
    }
    
    logger.info(`[TIME-SLOTS] Rezultat final: ${availableSlots.length} slot-uri disponibile din ${allPossibleSlots.length} posibile`);
    
    // Gestionează cazul când nu există slot-uri disponibile
    if (availableSlots.length === 0) {
      let message = 'Nu există intervale orare disponibile pentru data selectată.';
      
      // Mesaj personalizat pentru astăzi
      if (isToday) {
        const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        message = `Nu mai există intervale orare disponibile pentru astăzi (ora curentă: ${currentTime}). Te rugăm să selectezi o altă dată.`;
      }
      
      // Verifică dacă sunt ore blocate specific de admin
      const blockedInfo = await BlockedDate.getBlockedHours(selectedDate);
      if (blockedInfo.blockedHours && blockedInfo.blockedHours.length > 0) {
        message = `${blockedInfo.reason}. Te rugăm să selectezi o altă dată.`;
      }
      
      logger.info(`[TIME-SLOTS] Nu există slot-uri disponibile: ${message}`);
      
      return res.status(200).json({ 
        success: true, 
        timeSlots: [],
        message: message
      });
    }
    
    // Returnează slot-urile disponibile
    const response = {
      success: true, 
      timeSlots: availableSlots,
      serviceName: service.name,
      serviceDuration: service.duration,
      servicePrice: service.price,
      selectedDate: selectedDate.toISOString().split('T')[0],
      isToday: isToday,
      schedule: scheduleInfo
    };
    
    // Adaugă informații suplimentare pentru debugging (doar în development)
    if (process.env.NODE_ENV === 'development') {
      response.debug = {
        currentTime: now.toTimeString().substring(0, 8),
        totalPossibleSlots: allPossibleSlots.length,
        availableSlotsCount: availableSlots.length,
        dayOfWeek: dayOfWeek
      };
    }
    
    logger.info(`[TIME-SLOTS] Răspuns trimis cu ${availableSlots.length} slot-uri: ${availableSlots.join(', ')}`);
    
    res.status(200).json(response);
    
  } catch (error) {
    logger.error('[TIME-SLOTS] Eroare la obținerea orelor disponibile:', error);
    return errorResponse(res, 500, 'Eroare la obținerea intervalelor orare disponibile');
  }
};


const createBooking = async (req, res) => {
  try {
    const { serviceId, date, time } = req.body;
    
    // Validate service exists
    let service;
    
    // Try to get from cache first
    service = await serviceCache.getService(parseInt(serviceId));
    
    // Fallback to database if not in cache
    if (!service) {
      service = await Service.findById(parseInt(serviceId));
    }
    
    if (!service) {
      return errorResponse(res, 404, 'Serviciul nu a fost găsit. Vă rugăm să alegeți un serviciu valid.');
    }
    
    // Check if the selected time slot is available
    const selectedDate = new Date(date);
    const isAvailable = await isTimeSlotAvailable(selectedDate, time, service.duration);
    
    if (!isAvailable) {
      // Verifică dacă data este blocată pentru un mesaj personalizat
      const blockCheck = await BlockedDate.isDateTimeBlocked(selectedDate, time);
      if (blockCheck.isBlocked) {
        return errorResponse(res, 400, `${blockCheck.reason}. Te rugăm să selectezi altă dată sau oră.`);
      }
      
      return errorResponse(res, 400, `Intervalul orar ${time} a fost rezervat de un alt client în același timp. Te rugăm să selectezi o altă oră.`);
    }
    
    // Încearcă să creezi lock-ul atomic pentru a preveni race conditions
    try {
      const timeLock = new TimeLock({
        date: selectedDate,
        time: time,
        serviceId: parseInt(serviceId),
        lockedBy: req.sessionID 
      });
      
      await timeLock.save(); // Dacă altcineva are deja lock, va da eroare
      
    } catch (lockError) {
      if (lockError.code === 11000) { // Duplicate key error
        return errorResponse(res, 400, `Intervalul orar ${time} a fost rezervat de un alt client în același timp. Te rugăm să selectezi o altă oră.`);
      }
      throw lockError;
    }
    
    // Dacă ajunge aici, lock-ul a fost creat cu succes
    // Store booking information in session to be od later
    if (req.session) {
      req.session.bookingData = {
        serviceId: parseInt(serviceId),
        date: selectedDate,
        time,
        createdAt: new Date() // Add timestamp to track session freshness
      };
      // Set a session timeout (default 15 min)
      req.session.bookingDataExpiry = Date.now() + (BOOKING_SESSION_TIMEOUT_MINS * 60 * 1000);
      req.session.save();
    }
    
    res.status(200).json({ 
      success: true, 
      message: 'Intervalul orar a fost rezervat temporar',
      bookingData: {
        serviceId: service._id,
        service: service.name,
        duration: service.duration,
        price: service.price,
        date: selectedDate.toLocaleDateString('ro-RO'),
        time
      }
    });
  } catch (error) {
    logger.error('Error creating booking:', error);
    return errorResponse(res, 500, 'Eroare la crearea rezervării');
  }
};

/**
 * Resend verification code
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
const resendVerificationCode = async (req, res) => {
  try {
    const { bookingId } = req.body;
    
    // Validation is now handled by middleware
    
    // Rate limiting check to prevent abuse
    const rateLimitKey = `resend_${bookingId}`;
    if (!rateLimit.check(rateLimitKey, 3, 5 * 60 * 1000)) { // 3 attempts per 5 minutes
      return errorResponse(res, 429, 'Prea multe încercări. Vă rugăm să așteptați câteva minute.');
    }
    
    const booking = await Booking.findById(bookingId).populate('client');
    
    if (!booking) {
      return errorResponse(res, 404, 'Rezervarea nu a fost găsită');
    }
    
    // Verifică limita per rezervare
    const bookingUsage = await getBookingEmailUsage(bookingId);
    if (!bookingUsage.success || bookingUsage.remaining <= 0) {
      return errorResponse(res, 429, 'Nu se mai poate retrimite codul. Ai atins limita de email-uri pentru această rezervare.', {
        usageInfo: bookingUsage
      });
    }
    
    // Verifică limita zilnică pentru emailul clientului
    const dailyUsage = await getDailyEmailUsage(booking.email);
    if (!dailyUsage.success || dailyUsage.remaining <= 0) {
      return errorResponse(res, 429, 'Nu se mai poate retrimite codul. Ai atins limita zilnică de email-uri.', {
        usageInfo: dailyUsage
      });
    }
    
    // Generate new verification code
    const verificationCode = generateVerificationCode();
    
    // Trimite email-ul
    const emailResult = await sendVerificationEmail(booking.email, verificationCode, bookingId);
    
    if (!emailResult.success) {
      return errorResponse(res, 500, emailResult.error || 'Nu s-a putut trimite codul de verificare. Vă rugăm să încercați mai târziu.');
    }
    
    // Update booking cu noul cod și actualizează timestamp
    booking.verificationCode = verificationCode;
    booking.lastEmailSentAt = new Date();
    await booking.save();
    
    // Update client email stats
    if (booking.client) {
      await booking.client.incrementEmailCounter();
    }
    
    res.status(200).json({ 
      success: true, 
      message: 'Un nou cod de verificare a fost trimis'
    });
  } catch (error) {
    logger.error('Error resending verification code:', error);
    return errorResponse(res, 500, 'Eroare la retrimiterea codului de verificare');
  }
};



const completeBooking = async (req, res) => {
  try {
    const { clientName, phoneNumber, email, countryCode, serviceId, date, time } = req.body;
    
    // Get booking data from session or request
    let bookingServiceId = serviceId ? parseInt(serviceId) : null;
    let bookingDate = date ? new Date(date) : null;
    let bookingTime = time;
    
    // Check session data if available
    if (req.session && req.session.bookingData) {
      // Check if session data is expired
      const now = Date.now();
      if (req.session.bookingDataExpiry && now > req.session.bookingDataExpiry) {
        return errorResponse(res, 400, 'Sesiunea a expirat. Vă rugăm să începeți procesul de rezervare din nou.');
      }
      
      bookingServiceId = bookingServiceId || req.session.bookingData.serviceId;
      bookingDate = bookingDate || req.session.bookingData.date;
      bookingTime = bookingTime || req.session.bookingData.time;
    }

    // Validate that we have all required data
    if (!bookingServiceId) {
      return errorResponse(res, 400, 'Serviciul este obligatoriu');
    }

    if (!bookingDate) {
      return errorResponse(res, 400, 'Data este obligatorie');
    }

    if (!bookingTime) {
      return errorResponse(res, 400, 'Ora este obligatorie');
    }
    
    if (!email) {
      return errorResponse(res, 400, 'Adresa de email este obligatorie');
    }
    
    // Verifică dacă data e în trecut
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    if (bookingDate < now) {
      return errorResponse(res, 400, 'Nu se pot face rezervări pentru date din trecut');
    }

    // Verifică dacă data este prea departe în viitor
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + MAX_BOOKING_DAYS_AHEAD);
    maxDate.setHours(0, 0, 0, 0);

    if (bookingDate > maxDate) {
      return errorResponse(res, 400, `Nu se pot face rezervări cu mai mult de ${MAX_BOOKING_DAYS_AHEAD} zile în avans`);
    }
    
    // Validate service exists
    let service;
    
    // Try to get from cache first
    service = await serviceCache.getService(bookingServiceId);
    
    // Fallback to database if not in cache
    if (!service) {
      service = await Service.findById(bookingServiceId);
    }
    
    if (!service) {
      return errorResponse(res, 404, 'Serviciul nu a fost găsit');
    }
    
    // Check if the time slot is still available
    // const isAvailable = await isTimeSlotAvailable(bookingDate, bookingTime, service.duration);
    // if (!isAvailable) {
    //   return errorResponse(res, 400, 'Intervalul orar nu mai este disponibil. Vă rugăm să alegeți alt interval.');
    // }
    
    // Rate limiting check to prevent spam
    const rateLimitKey = `book_${email}_${Date.now().toString().slice(0, 10)}`;
    if (!rateLimit.check(rateLimitKey, 5, 30 * 60 * 1000)) { // 5 attempts per 30 minutes
      return errorResponse(res, 429, 'Prea multe încercări. Vă rugăm să așteptați 30 de minute.');
    }
    
    // Formatează numărul de telefon cu codul de țară
    const fullPhoneNumber = countryCode && phoneNumber ? 
      `${countryCode}${phoneNumber.replace(/^0/, '')}` : 
      phoneNumber;
    
    // Find or create client
    let client = await Client.findByEmail(email);
    
    if (client) {
      // Check if client is blocked
      if (client.isBlocked) {
        return errorResponse(res, 403, 'Ne pare rău, acest client este blocat', {
          blockReason: client.blockReason,
          blockDate: client.blockDate
        });
      }
      
      // Update client information if it has changed
      if (client.name !== clientName || client.phoneNumber !== fullPhoneNumber) {
        client.name = clientName;
        client.phoneNumber = fullPhoneNumber;
        client.countryCode = countryCode || '+40';
        await client.save();
      }
    } else {
      // Create new client
      client = new Client({
        name: clientName,
        phoneNumber: fullPhoneNumber,
        email: email,
        countryCode: countryCode || '+40'
      });
      await client.save();
    }
    
    // Verifică limita zilnică de email-uri pentru acest email
    const dailyUsage = await getDailyEmailUsage(email);
    if (!dailyUsage.success || dailyUsage.remaining <= 0) {
      return errorResponse(res, 429, 'Nu se poate trimite codul de verificare. Ai atins limita zilnică de email-uri.');
    }
    
    // Generate verification code
    const verificationCode = generateVerificationCode();
    
    // Create booking in pending state with client reference
    const booking = new Booking({
      client: client._id,
      clientName,
      phoneNumber: fullPhoneNumber,
      email: email,
      countryCode: countryCode || '+40',
      service: bookingServiceId,
      date: bookingDate,
      time: bookingTime,
      verificationCode,
      verified: false,
      status: 'pending',
      emailCount: 0,
      lastEmailSentAt: null
    });
   
    // Save booking to get an ID
    await booking.save();
    
    // Șterge lock-ul pentru că rezervarea a fost finalizată
    try {
      await TimeLock.deleteOne({
        date: bookingDate,
        time: bookingTime,
        serviceId: bookingServiceId,
        lockedBy: req.sessionID
      });
    } catch (lockDeleteError) {
      logger.warn('Could not delete time lock:', lockDeleteError);
      // Nu oprește procesul dacă ștergerea lock-ului eșuează
    }
    
    // Update client's total bookings
    client.totalBookings += 1;
    await client.save();
    
    // Send verification email with booking ID
    const emailResult = await sendVerificationEmail(email, verificationCode, booking._id);
    
    if (!emailResult.success) {
      // If email fails, delete the booking and return error
      await Booking.findByIdAndDelete(booking._id);
      // Revert client's total bookings counter
      client.totalBookings -= 1;
      await client.save();
      
      return errorResponse(res, 500, emailResult.error || 'Nu s-a putut trimite codul de verificare. Vă rugăm să încercați mai târziu.');
    }
    
    // Update client's email counter
    await client.incrementEmailCounter();
    
    // Clear session data and store booking ID
    if (req.session) {
      req.session.bookingData = null;
      req.session.bookingDataExpiry = null;
      req.session.bookingId = booking._id;
      req.session.save();
    }
    
    res.status(200).json({ 
      success: true, 
      message: 'Codul de verificare a fost trimis',
      bookingId: booking._id,
      serviceName: service.name
    });
  } catch (error) {
    logger.error('Error completing booking:', error);
    return errorResponse(res, 500, 'Eroare la completarea rezervării');
  }
};

/**
 * Verify booking with code
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
const verifyBooking = async (req, res) => {
  try {
    const { bookingId, code } = req.body;
    
    // Rate limiting check to prevent brute force
    const rateLimitKey = `verify_${bookingId}`;
    if (!rateLimit.check(rateLimitKey, 5, 15 * 60 * 1000)) { // 5 attempts per 15 minutes
      return errorResponse(res, 429, 'Prea multe încercări. Vă rugăm să așteptați 15 minute.');
    }
    
    // Validation is now handled by middleware
    const booking = await Booking.findById(bookingId).populate('client');
    
    if (!booking) {
      return errorResponse(res, 404, 'Rezervarea nu a fost găsită');
    }
    
    if (booking.verified) {
      return errorResponse(res, 400, 'Rezervarea este deja verificată');
    }
    
    // Secure comparison of verification code (prevent timing attacks)
    // Using constant-time comparison to prevent timing attacks
    try {
      // Format both codes to same length to avoid errors with timingSafeEqual
      const storedCode = booking.verificationCode.padEnd(32, '0');
      const providedCode = code.padEnd(32, '0');
      
      const isCodeValid = crypto.timingSafeEqual(
        Buffer.from(storedCode, 'utf8'),
        Buffer.from(providedCode, 'utf8')
      );
      
      if (!isCodeValid) {
        return errorResponse(res, 400, 'Cod de verificare invalid');
      }
    } catch (error) {
      // Fallback to regular comparison if crypto fails
      logger.error('Error during secure code comparison:', error);
      if (booking.verificationCode !== code) {
        return errorResponse(res, 400, 'Cod de verificare invalid');
      }
    }
    
    // Update booking status
    booking.verified = true;
    await booking.save();
    
    // Clear session
    if (req.session) {
      req.session.bookingId = null;
      req.session.save();
    }
    
    // Get service details for response
    const service = await Service.findById(booking.service);
    
    res.status(200).json({ 
      success: true, 
      message: 'Rezervare verificată cu succes. Așteptați confirmarea frizerului.',
      booking: {
        id: booking._id,
        clientName: booking.clientName,
        serviceName: service ? service.name : 'Unknown Service',
        date: booking.date.toLocaleDateString('ro-RO'),
        time: booking.time
      }
    });
  } catch (error) {
    logger.error('Error verifying booking:', error);
    return errorResponse(res, 500, 'Eroare la verificarea rezervării');
  }
};

/**
 * Admin: Get pending bookings
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
const getPendingBookings = async (req, res) => {
  try {
    const pendingBookings = await Booking.find({ 
      status: 'pending', 
      verified: true 
    }).populate('client').sort({ date: 1, time: 1 }); // Sort by date and time
    
    // Get service details for each booking
    const formattedBookings = [];
    for (const booking of pendingBookings) {
      const service = await Service.findById(booking.service);
      if (service) {
        formattedBookings.push({
          id: booking._id,
          clientId: booking.client ? booking.client._id : null,
          clientName: booking.clientName,
          phoneNumber: booking.phoneNumber,
          email: booking.email, // Added email field
          service: service.name,
          serviceDuration: service.duration,
          servicePrice: service.price,
          date: booking.date.toLocaleDateString('ro-RO'),
          time: booking.time,
          createdAt: booking.createdAt,
          totalClientBookings: booking.client ? booking.client.totalBookings : 1
        });
      }
    }
    
    res.status(200).json({ 
      success: true, 
      bookings: formattedBookings,
      count: formattedBookings.length
    });
  } catch (error) {
    logger.error('Error fetching pending bookings:', error);
    return errorResponse(res, 500, 'Eroare la obținerea rezervărilor în așteptare');
  }
};

/**
 * Admin: Get confirmed bookings for a specific date
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
const getConfirmedBookings = async (req, res) => {
  try {
    const { date } = req.query;
    
    if (!date) {
      return errorResponse(res, 400, 'Data este obligatorie');
    }
    
    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return errorResponse(res, 400, 'Format dată invalid. Folosiți formatul YYYY-MM-DD.');
    }
    
    const selectedDate = new Date(date);
    if (isNaN(selectedDate.getTime())) {
      return errorResponse(res, 400, 'Dată invalidă.');
    }
    
    const nextDay = new Date(selectedDate);
    nextDay.setDate(nextDay.getDate() + 1);
    
    const confirmedBookings = await Booking.find({
      status: 'confirmed',
      date: {
        $gte: selectedDate,
        $lt: nextDay
      }
    }).populate('client').sort({ time: 1 }); // Sort by time
    
    // Get service details for each booking
    const formattedBookings = [];
    let totalPrice = 0;
    
    for (const booking of confirmedBookings) {
      const service = await Service.findById(booking.service);
      if (service) {
        formattedBookings.push({
          id: booking._id,
          clientId: booking.client ? booking.client._id : null,
          clientName: booking.clientName,
          phoneNumber: booking.phoneNumber,
          email: booking.email, // Added email field
          service: service.name,
          servicePrice: service.price,
          serviceDuration: service.duration,
          time: booking.time,
          totalClientBookings: booking.client ? booking.client.totalBookings : 1,
          completedBookings: booking.client ? booking.client.completedBookings : 0
        });
        totalPrice += service.price;
      }
    }
    
    res.status(200).json({ 
      success: true, 
      bookings: formattedBookings,
      totalPrice,
      count: formattedBookings.length,
      date: selectedDate.toLocaleDateString('ro-RO')
    });
  } catch (error) {
    logger.error('Error fetching confirmed bookings:', error);
    return errorResponse(res, 500, 'Eroare la obținerea rezervărilor confirmate');
  }
};

/**
 * Admin: Confirm booking
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
const confirmBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    
    // Validation is now handled by middleware
    
    const booking = await Booking.findById(bookingId).populate('client');
    
    if (!booking) {
      return errorResponse(res, 404, 'Rezervarea nu a fost găsită');
    }
    
    // Get service for email
    const service = await Service.findById(booking.service);
    if (!service) {
      return errorResponse(res, 404, 'Serviciul nu a fost găsit');
    }
    
    // Verifică limitele de email înainte de confirmare
    const bookingUsage = await getBookingEmailUsage(bookingId);
    if (!bookingUsage.success || bookingUsage.remaining <= 0) {
      // Still confirm the booking, but don't send email
      booking.status = 'confirmed';
      await booking.save();
      
      return res.status(200).json({ 
        success: true,
        message: 'Rezervare confirmată, dar nu s-a putut trimite email de confirmare (limită atinsă)',
        emailStatus: 'limited'
      });
    }
    
    const dailyUsage = await getDailyEmailUsage(booking.email);
    if (!dailyUsage.success || dailyUsage.remaining <= 0) {
      // Still confirm the booking, but don't send email
      booking.status = 'confirmed';
      await booking.save();
      
      return res.status(200).json({ 
        success: true,
        message: 'Rezervare confirmată, dar nu s-a putut trimite email de confirmare (limită zilnică atinsă)',
        emailStatus: 'limited'
      });
    }
    
    // Send confirmation email
    const emailResult = await sendBookingConfirmationEmail(booking.email, {
      _id: booking._id,
      clientName: booking.clientName,
      serviceName: service.name,
      date: booking.date,
      time: booking.time
    });
    
    // Update booking status regardless of email success
    booking.status = 'confirmed';
    await booking.save();
    
    // Update client email counter if email was successful
    if (emailResult.success && booking.client) {
      await booking.client.incrementEmailCounter();
    }
    
    if (!emailResult.success) {
     return res.status(200).json({ 
       success: true,
       message: 'Rezervare confirmată, dar nu s-a putut trimite email de confirmare',
       emailStatus: 'failed',
       emailError: emailResult.error
     });
   }
   
   res.status(200).json({ 
     success: true, 
     message: 'Rezervare confirmată și email de confirmare trimis',
     emailStatus: 'sent'
   });
 } catch (error) {
   logger.error('Error confirming booking:', error);
   return errorResponse(res, 500, 'Eroare la confirmarea rezervării');
 }
};

/**
* Admin: Decline booking
* @param {Object} req - Request object
* @param {Object} res - Response object
*/
const declineBooking = async (req, res) => {
 try {
   const { bookingId } = req.params;
   
   // Validation is now handled by middleware
   
   const booking = await Booking.findById(bookingId).populate('client');
   
   if (!booking) {
     return errorResponse(res, 404, 'Rezervarea nu a fost găsită');
   }
   
   // Get service for email
   const service = await Service.findById(booking.service);
   if (!service) {
     return errorResponse(res, 404, 'Serviciul nu a fost găsit');
   }
   
   // Verifică limitele de email înainte de respingere
   const bookingUsage = await getBookingEmailUsage(bookingId);
   if (!bookingUsage.success || bookingUsage.remaining <= 0) {
     // Still decline the booking, but don't send email
     booking.status = 'declined';
     await booking.save();
     
     return res.status(200).json({ 
       success: true,
       message: 'Rezervare respinsă, dar nu s-a putut trimite email de notificare (limită atinsă)',
       emailStatus: 'limited'
     });
   }
   
   const dailyUsage = await getDailyEmailUsage(booking.email);
   if (!dailyUsage.success || dailyUsage.remaining <= 0) {
     // Still decline the booking, but don't send email
     booking.status = 'declined';
     await booking.save();
     
     return res.status(200).json({ 
       success: true,
       message: 'Rezervare respinsă, dar nu s-a putut trimite email de notificare (limită zilnică atinsă)',
       emailStatus: 'limited'
     });
   }
   
   // Send rejection email
   const emailResult = await sendBookingRejectionEmail(booking.email, {
     _id: booking._id,
     serviceName: service.name,
     clientName: booking.clientName,
     date: booking.date,
     time: booking.time
   });
   
   // Update booking status regardless of email success
   booking.status = 'declined';
   await booking.save();
   
   // Update client email counter if email was successful
   if (emailResult.success && booking.client) {
     await booking.client.incrementEmailCounter();
   }
   
   if (!emailResult.success) {
     return res.status(200).json({ 
       success: true,
       message: 'Rezervare respinsă, dar nu s-a putut trimite email de notificare',
       emailStatus: 'failed',
       emailError: emailResult.error
     });
   }
   
   res.status(200).json({ 
     success: true, 
     message: 'Rezervare respinsă și email de notificare trimis',
     emailStatus: 'sent'
   });
 } catch (error) {
   logger.error('Error declining booking:', error);
   return errorResponse(res, 500, 'Eroare la respingerea rezervării');
 }
};

/**
* Admin: Block user
* @param {Object} req - Request object
* @param {Object} res - Response object
*/
const blockUser = async (req, res) => {
 try {
   const { bookingId } = req.params;
   const { reason } = req.body;
   
   // Validation is now handled by middleware
   
   const booking = await Booking.findById(bookingId).populate('client');
   
   if (!booking) {
     return errorResponse(res, 404, 'Rezervarea nu a fost găsită');
   }
   
   // Block client in the client model
   if (booking.client) {
     await booking.client.block(reason || 'No reason provided');
   } else {
     // If for some reason the client reference is missing, try to find/create the client
     let client = await Client.findByEmail(booking.email);
     
     if (!client) {
       client = new Client({
         name: booking.clientName,
         phoneNumber: booking.phoneNumber,
         email: booking.email,
         countryCode: booking.countryCode || '+40'
       });
     }
     
     await client.block(reason || 'No reason provided');
   }
   
   // Verifică limitele de email înainte de a trimite notificarea
   const bookingUsage = await getBookingEmailUsage(bookingId);
   if (!bookingUsage.success || bookingUsage.remaining <= 0) {
     // Doar actualizăm statusul fără a trimite email
     booking.status = 'declined';
     await booking.save();
     
     return res.status(200).json({ 
       success: true, 
       message: 'Utilizator blocat și rezervare respinsă (nu s-a trimis email din cauza limitei)',
       emailStatus: 'limited'
     });
   }
   
   const dailyUsage = await getDailyEmailUsage(booking.email);
   if (!dailyUsage.success || dailyUsage.remaining <= 0) {
     // Doar actualizăm statusul fără a trimite email
     booking.status = 'declined';
     await booking.save();
     
     return res.status(200).json({ 
       success: true, 
       message: 'Utilizator blocat și rezervare respinsă (nu s-a trimis email din cauza limitei zilnice)',
       emailStatus: 'limited'
     });
   }
   
   // Get service for email
   const service = await Service.findById(booking.service);
   if (!service) {
     // Still decline the booking, but don't send email
     booking.status = 'declined';
     await booking.save();
     
     return res.status(200).json({ 
       success: true,
       message: 'Utilizator blocat și rezervare respinsă (serviciul nu a fost găsit)',
       emailStatus: 'failed'
     });
   }
   
   // Trimite email utilizatorului că a fost blocat
   const emailResult = await sendUserBlockedEmail(booking.email, {
     name: booking.clientName,
     phoneNumber: booking.phoneNumber,
     email: booking.email
   }, reason);
   
   // Decline the booking regardless of email status
   booking.status = 'declined';
   await booking.save();
   
   // Update client email counter if email was successful
   if (emailResult.success && booking.client) {
     await booking.client.incrementEmailCounter();
   }
   
   res.status(200).json({ 
     success: true, 
     message: 'Utilizator blocat și rezervare respinsă',
     emailStatus: emailResult.success ? 'sent' : 'failed',
     email: booking.email,
     phoneNumber: booking.phoneNumber,
     clientId: booking.client ? booking.client._id : null
   });
 } catch (error) {
   logger.error('Error blocking user:', error);
   return errorResponse(res, 500, 'Eroare la blocarea utilizatorului');
 }
};

/**
* Admin: Get blocked users list
* @param {Object} req - Request object
* @param {Object} res - Response object
*/
const getBlockedUsers = async (req, res) => {
 try {
   // Get blocked users directly from Client model
   const blockedClients = await Client.find({ isBlocked: true })
     .sort({ blockDate: -1 }) // Most recent first
     .select('_id name phoneNumber email blockReason blockDate totalBookings completedBookings');
     
   res.status(200).json({
     success: true,
     users: blockedClients,
     count: blockedClients.length
   });
 } catch (error) {
   logger.error('Error fetching blocked users:', error);
   return errorResponse(res, 500, 'Eroare la obținerea utilizatorilor blocați');
 }
};

/**
* Admin: Unblock user
* @param {Object} req - Request object
* @param {Object} res - Response object
*/
const unblockUser = async (req, res) => {
 try {
   const { clientId } = req.params;
   
   if (!clientId) {
     return errorResponse(res, 400, 'ID-ul clientului este obligatoriu');
   }
   
   // Find client by ID
   const client = await Client.findById(clientId);
   
   if (!client) {
     return errorResponse(res, 404, 'Clientul nu a fost găsit');
   }
   
   if (!client.isBlocked) {
     return errorResponse(res, 400, 'Clientul nu este blocat');
   }
   
   // Unblock client
   await client.unblock();
   
   res.status(200).json({
     success: true,
     message: 'Clientul a fost deblocat cu succes',
     client: {
       id: client._id,
       name: client.name,
       phoneNumber: client.phoneNumber,
       email: client.email
     }
   });
 } catch (error) {
   logger.error('Error unblocking user:', error);
   return errorResponse(res, 500, 'Eroare la deblocarea utilizatorului');
 }
};

/**
* Admin: Get client details and booking history
* @param {Object} req - Request object
* @param {Object} res - Response object
*/
const getClientDetails = async (req, res) => {
 try {
   const { clientId } = req.params;
   
   if (!clientId) {
     return errorResponse(res, 400, 'ID-ul clientului este obligatoriu');
   }
   
   // Find client by ID
   const client = await Client.findById(clientId);
   
   if (!client) {
     return errorResponse(res, 404, 'Clientul nu a fost găsit');
   }
   
   // Get client's booking history
   const bookings = await Booking.find({ client: clientId })
     .sort({ date: -1, time: -1 }) // Most recent first
     .populate('service');
   
   // Format bookings
   const formattedBookings = bookings.map(booking => {
     const service = booking.service;
     return {
       id: booking._id,
       date: booking.date.toLocaleDateString('ro-RO'),
       time: booking.time,
       service: service ? service.name : 'Unknown Service',
       status: booking.status,
       price: service ? service.price : 0,
       createdAt: booking.createdAt
     };
   });
   
   // Calculate statistics
   const completedBookings = bookings.filter(b => b.status === 'completed').length;
   const cancelledBookings = bookings.filter(b => b.status === 'declined' || b.status === 'cancelled').length;
   const totalSpent = bookings
     .filter(b => b.status === 'completed')
     .reduce((sum, b) => sum + (b.service ? b.service.price : 0), 0);
   
   res.status(200).json({
     success: true,
     client: {
       id: client._id,
       name: client.name,
       phoneNumber: client.phoneNumber,
       email: client.email,
       countryCode: client.countryCode || '+40',
       isBlocked: client.isBlocked,
       blockReason: client.blockReason,
       blockDate: client.blockDate,
       createdAt: client.createdAt,
       totalBookings: client.totalBookings,
       completedBookings: client.completedBookings,
       emailsSent: client.emailsSent || 0
     },
     statistics: {
       completedBookings,
       cancelledBookings,
       totalSpent,
       averageServicePrice: completedBookings > 0 ? (totalSpent / completedBookings).toFixed(2) : 0
     },
     bookings: formattedBookings
   });
 } catch (error) {
   logger.error('Error getting client details:', error);
   return errorResponse(res, 500, 'Eroare la obținerea detaliilor clientului');
 }
};

/**
* Admin: Get Email usage statistics
* @param {Object} req - Request object
* @param {Object} res - Response object
*/
const getEmailUsageStats = async (req, res) => {
 try {
   // Get today's date (start of day)
   const today = new Date();
   today.setHours(0, 0, 0, 0);
   
   // Get daily usage for all emails
   const dailyUsage = await EmailUsage.find({
     date: {
       $gte: today,
       $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
     }
   }).sort({ count: -1 }); // Highest usage first
   
   // Calculate total emails sent today
   const totalEmailsToday = dailyUsage.reduce((total, record) => total + record.count, 0);
   
   // Get top clients by email usage
   const topClientsByEmail = await Client.find()
     .sort({ emailsSent: -1 })
     .limit(10)
     .select('name email emailsSent lastEmailSentAt');
   
   // Get email usage by day (last 7 days)
   const sevenDaysAgo = new Date();
   sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
   sevenDaysAgo.setHours(0, 0, 0, 0);
   
   const dailyTotals = await EmailUsage.aggregate([
     {
       $match: {
         date: { $gte: sevenDaysAgo }
       }
     },
     {
       $group: {
         _id: {
           $dateToString: { format: '%Y-%m-%d', date: '$date' }
         },
         totalEmails: { $sum: '$count' }
       }
     },
     { $sort: { _id: 1 } }
   ]);
   
   res.status(200).json({
     success: true,
     stats: {
       today: {
         totalEmails: totalEmailsToday,
         usageByEmail: dailyUsage.map(record => ({
           email: record.email,
           count: record.count,
           remainingToday: DAILY_EMAIL_LIMIT - record.count
         }))
       },
       topClients: topClientsByEmail,
       dailyTotals: dailyTotals
     }
   });
 } catch (error) {
   logger.error('Error getting email usage stats:', error);
   return errorResponse(res, 500, 'Eroare la obținerea statisticilor email');
 }
};

/**
* Mark booking as completed
* @param {Object} req - Request object
* @param {Object} res - Response object
*/
const completeBookingService = async (req, res) => {
 try {
   const { bookingId } = req.params;
   
   if (!mongoose.Types.ObjectId.isValid(bookingId)) {
     return errorResponse(res, 400, 'ID rezervare invalid');
   }
   
   const booking = await Booking.findById(bookingId).populate('client');
   
   if (!booking) {
     return errorResponse(res, 404, 'Rezervarea nu a fost găsită');
   }
   
   if (booking.status !== 'confirmed') {
     return errorResponse(res, 400, `Nu se poate marca ca finalizată o rezervare cu statusul: ${booking.status}`);
   }
   
   // Update booking status
   booking.status = 'completed';
   booking.completedAt = new Date();
   await booking.save();
   
   // Update client stats
   if (booking.client) {
     booking.client.completedBookings += 1;
     booking.client.lastVisit = new Date();
     await booking.client.save();
   }
   
   // Get service details
   const service = await Service.findById(booking.service);
   
   res.status(200).json({
     success: true,
     message: 'Rezervare marcată ca finalizată',
     booking: {
       id: booking._id,
       clientName: booking.clientName,
       email: booking.email,
       phoneNumber: booking.phoneNumber,
       date: booking.date.toLocaleDateString('ro-RO'),
       time: booking.time,
       status: booking.status,
       service: service ? service.name : 'Unknown Service',
       price: service ? service.price : 0
     }
   });
 } catch (error) {
   logger.error('Error completing booking service:', error);
   return errorResponse(res, 500, 'Eroare la marcarea rezervării ca finalizată');
 }
};

/**
* Get all clients (with optional filters)
* @param {Object} req - Request object
* @param {Object} res - Response object
*/
const getAllClients = async (req, res) => {
 try {
   // Parse query parameters for filtering
   const { search, sort = 'lastVisit', order = 'desc', limit = 50, page = 1 } = req.query;
   
   // Build query
   let query = {};
   
   // Add search filter if provided
   if (search) {
     const searchRegex = new RegExp(search, 'i');
     query = {
       $or: [
         { name: searchRegex },
         { phoneNumber: searchRegex },
         { email: searchRegex } // Added search by email
       ]
     };
   }
   
   // Calculate pagination
   const skip = (parseInt(page) - 1) * parseInt(limit);
   
   // Build sort configuration
   const sortConfig = {};
   sortConfig[sort] = order === 'desc' ? -1 : 1;
   
   // Execute query with pagination and sorting
   const clients = await Client.find(query)
     .sort(sortConfig)
     .skip(skip)
     .limit(parseInt(limit))
     .select('_id name phoneNumber email isBlocked totalBookings completedBookings lastVisit createdAt');
   
   // Get total count for pagination
   const totalCount = await Client.countDocuments(query);
   
   res.status(200).json({
     success: true,
     clients,
     pagination: {
       total: totalCount,
       page: parseInt(page),
       limit: parseInt(limit),
       pages: Math.ceil(totalCount / parseInt(limit))
     }
   });
 } catch (error) {
   logger.error('Error getting clients:', error);
   return errorResponse(res, 500, 'Eroare la obținerea listei de clienți');
 }
};



const suspendBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    
    const booking = await Booking.findById(bookingId);
    
    if (!booking) {
      return errorResponse(res, 404, 'Rezervarea nu a fost găsită');
    }
    
    // Verifică dacă rezervarea nu este deja confirmată
    if (booking.status === 'confirmed') {
      return errorResponse(res, 400, 'Nu se poate suspenda o rezervare confirmată');
    }
    
    // Șterge lock-ul asociat dacă există
    try {
      await TimeLock.deleteOne({
        date: booking.date,
        time: booking.time,
        serviceId: booking.service,
        lockedBy: req.sessionID
      });
    } catch (lockDeleteError) {
      logger.warn('Could not delete time lock during suspension:', lockDeleteError);
    }
    
    // Marchează rezervarea ca suspendată/anulată
    booking.status = 'cancelled';
    await booking.save();
    
    logger.info(`Rezervare suspendată: ${bookingId}`);
    
    res.status(200).json({ 
      success: true, 
      message: 'Rezervarea a fost suspendată cu succes. Intervalul orar este din nou disponibil.' 
    });
  } catch (error) {
    logger.error('Error suspending booking:', error);
    return errorResponse(res, 500, 'Eroare la suspendarea rezervării');
  }
};

const runManualCleanup = async (req, res) => {
  try {
    const results = await runFullCleanup();
    
    res.status(200).json({
      success: true,
      message: 'Curățarea automată a fost executată cu succes',
      results: {
        totalCleaned: results.totalCleaned,
        totalErrors: results.totalErrors,
        details: {
          expired: results.expired,
          unconfirmed: results.unconfirmed,
          declined: results.declined
        },
        timestamp: results.timestamp
      }
    });
    
  } catch (error) {
    logger.error('Error running manual cleanup:', error);
    return errorResponse(res, 500, 'Eroare la rularea curățării automate');
  }
};

// Export all functions
module.exports = {
  getServices,
  getAvailableTimeSlots, // Actualizat
  createBooking, // Actualizat
  completeBooking,
  verifyBooking,
  resendVerificationCode,
  getPendingBookings,
  getConfirmedBookings,
  confirmBooking,
  declineBooking,
  blockUser,
  getBlockedUsers,
  unblockUser,
  getClientDetails,
  getEmailUsageStats, 
  completeBookingService,
  getAllClients,
  suspendBooking,
  runManualCleanup // Nou
};