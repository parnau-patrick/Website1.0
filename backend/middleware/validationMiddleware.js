// middleware/validationMiddleware.js
const { validate } = require('../models/BlockedDates');
const { BlockedUser } = require('../models/Booking');
const Client = require('../models/Client');
const mongoose = require('mongoose');

// Sistem de logging îmbunătățit
const NODE_ENV = process.env.NODE_ENV;
const { createContextLogger } = require('../utils/logger');
const logger = createContextLogger('VALIDATION');

/**
 * Middleware pentru validarea datelor de rezervare
 */
const validateBookingData = (req, res, next) => {
  const { serviceId, date, time } = req.body;
  
  if (!serviceId || !date || !time) {
    return res.status(400).json({
      success: false,
      message: 'ServiceId, date, și time sunt obligatorii'
    });
  }
  
  // Validare format dată
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    return res.status(400).json({
      success: false,
      message: 'Format dată invalid. Folosiți formatul YYYY-MM-DD.'
    });
  }
  
  // Validare format timp
  const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
  if (!timeRegex.test(time)) {
    return res.status(400).json({
      success: false,
      message: 'Format timp invalid. Folosiți formatul HH:MM.'
    });
  }

  const [hours, minutes] = time.split(':').map(Number);
  if (minutes !== 0 && minutes !== 30) {
    return res.status(400).json({
      success: false,
      message: 'Ora trebuie să fie un slot valid (format HH:00 sau HH:30). Exemplu: 13:00, 13:30, 14:00.'
    });
  }
  
  // Validare dată nu este în trecut
  const selectedDate = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  if (selectedDate < today) {
    return res.status(400).json({
      success: false,
      message: 'Nu se pot programa rezervări în trecut.'
    });
  }
  
  // Verifică dacă ziua selectată se încadrează în orarul de lucru (Luni-Sâmbătă)
  const dayOfWeek = selectedDate.getDay(); // 0 = Duminică, 1 = Luni, ...
  if (dayOfWeek === 0) {
    return res.status(400).json({
      success: false,
      message: 'Nu sunt disponibile programări duminica.'
    });
  }
  
  next();
};

/**
 * Middleware pentru validarea cererii de intervale orare disponibile
 */
const validateTimeSlotRequest = (req, res, next) => {
  const { serviceId, date } = req.body;
  
  if (!serviceId || !date) {
    return res.status(400).json({
      success: false,
      message: 'ServiceId și date sunt obligatorii'
    });
  }
  
  // Validare format dată
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    return res.status(400).json({
      success: false,
      message: 'Format dată invalid. Folosiți formatul YYYY-MM-DD.'
    });
  }
  
  // Validare dată nu este în trecut
  const selectedDate = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  if (selectedDate < today) {
    return res.status(400).json({
      success: false,
      message: 'Nu se pot programa rezervări în trecut.'
    });
  }
  
  // Verifică dacă ziua selectată se încadrează în orarul de lucru (Luni-Sâmbătă)
  const dayOfWeek = selectedDate.getDay(); // 0 = Duminică, 1 = Luni, ...
  if (dayOfWeek === 0) {
    return res.status(400).json({
      success: false,
      message: 'Nu sunt disponibile programări duminica.'
    });
  }
  
  next();
};

/**
 * Middleware pentru validarea îmbunătățită a informațiilor despre client
 */
const validateClientInfo = (req, res, next) => {
  const { clientName, phoneNumber, email, countryCode } = req.body;
  
  // Validare nume client
  if (!clientName) {
    return res.status(400).json({
      success: false,
      message: 'Numele clientului este obligatoriu.'
    });
  }
  
  const trimmedName = clientName.trim();
  
  // Verificare lungime minimă și maximă
  if (trimmedName.length < 3) {
    return res.status(400).json({
      success: false,
      message: 'Numele trebuie să conțină cel puțin 3 caractere.'
    });
  }
  
  if (trimmedName.length > 50) {
    return res.status(400).json({
      success: false,
      message: 'Numele nu poate depăși 50 de caractere.'
    });
  }
  
  // Validare nume (doar litere, spații și cratime)
  const nameRegex = /^[A-Za-zĂăÂâÎîȘșȚț\s-]+$/;
  if (!nameRegex.test(trimmedName)) {
    return res.status(400).json({
      success: false,
      message: 'Numele poate conține doar litere, spații și cratime.'
    });
  }
  
  // Verificare spații multiple consecutive
  if (/\s\s/.test(trimmedName)) {
    return res.status(400).json({
      success: false,
      message: 'Numele nu poate conține spații multiple consecutive.'
    });
  }
  
  // Validare email (nou)
  if (!email) {
    return res.status(400).json({
      success: false,
      message: 'Adresa de email este obligatorie.'
    });
  }
  
  // Validare format email
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({
      success: false,
      message: 'Formatul adresei de email este invalid.'
    });
  }
  
  // Validare lungime email
  if (email.length > 100) {
    return res.status(400).json({
      success: false,
      message: 'Adresa de email este prea lungă (maxim 100 caractere).'
    });
  }
  
  // Validare număr de telefon
  if (!phoneNumber) {
    return res.status(400).json({
      success: false,
      message: 'Numărul de telefon este obligatoriu.'
    });
  }
  
  // Curățăm numărul de telefon de spații, paranteze, etc.
  const cleanNumber = phoneNumber.replace(/\s+|-|\(|\)|\+/g, '');
  
  // Limită lungime pentru a preveni atacuri DoS
  if (cleanNumber.length > 30) {
    return res.status(400).json({
      success: false,
      message: 'Numărul de telefon este prea lung.'
    });
  }
  
  // Validare număr de telefon (acum acceptăm formate internaționale)
  // Verificăm doar dacă conține doar cifre, fără limită strictă pe format
  if (!/^[0-9]+$/.test(cleanNumber)) {
    return res.status(400).json({
      success: false,
      message: 'Număr de telefon invalid. Trebuie să conțină doar cifre.'
    });
  }
  
  // Adăugăm valorile sanitizate înapoi în request pentru a fi folosite mai departe
  req.body.clientName = trimmedName;
  req.body.email = email.toLowerCase().trim();
  
  next();
};

/**
 * Middleware pentru verificare client blocat
 */
const checkBlockedUser = async (req, res, next) => {
  try {
    const { phoneNumber, email } = req.body;
    
    // Verifică client după email
    if (email) {
      const clientByEmail = await Client.findByEmail(email);
      if (clientByEmail && clientByEmail.isBlocked) {
        return res.status(403).json({
          success: false,
          message: 'Acest email este blocat și nu poate face rezervări.',
          blockReason: clientByEmail.blockReason,
          blockDate: clientByEmail.blockDate
        });
      }
    }
    
    // Verifică client după număr de telefon
    if (phoneNumber) {
      const client = await Client.findByPhoneNumber(phoneNumber);
      if (client && client.isBlocked) {
        return res.status(403).json({
          success: false,
          message: 'Acest număr de telefon este blocat și nu poate face rezervări.',
          blockReason: client.blockReason,
          blockDate: client.blockDate
        });
      }
      
      // Verifică și în modelul vechi BlockedUser pentru compatibilitate
      const blockedUser = await BlockedUser.findOne({ 
        phoneNumber: { $regex: phoneNumber.replace(/\s+|-|\(|\)|\+/g, '') } 
      });
      
      if (blockedUser) {
        return res.status(403).json({
          success: false,
          message: 'Acest număr de telefon este blocat și nu poate face rezervări.'
        });
      }
    }
    
    next();
  } catch (error) {
    logger.error('Error checking blocked user:', error);
    res.status(500).json({ success: false, message: 'Eroare de server' });
  }
};

/**
 * Middleware pentru validarea codului de verificare
 */
const validateVerification = (req, res, next) => {
  const { bookingId, code } = req.body;
  
  if (!bookingId || !code) {
    return res.status(400).json({
      success: false,
      message: 'ID-ul rezervării și codul de verificare sunt obligatorii.'
    });
  }
  
  // Validare format ID MongoDB
  if (!mongoose.Types.ObjectId.isValid(bookingId)) {
    return res.status(400).json({
      success: false,
      message: 'ID rezervare invalid.'
    });
  }
  
  // Validare format cod (6 cifre)
  const codeRegex = /^\d{6}$/;
  if (!codeRegex.test(code)) {
    return res.status(400).json({
      success: false,
      message: 'Cod de verificare invalid. Codul trebuie să conțină 6 cifre.'
    });
  }
  
  next();
};


/**
 * Middleware pentru a valida ID-uri de rezervări
 */
const validateBookingId = (req, res, next) => {
  const bookingId = req.params.bookingId || req.body.bookingId;
  
  if (!bookingId) {
    return res.status(400).json({
      success: false,
      message: 'ID-ul rezervării este obligatoriu'
    });
  }
  
  if (!mongoose.Types.ObjectId.isValid(bookingId)) {
    return res.status(400).json({
      success: false,
      message: 'ID rezervare invalid'
    });
  }
  
  next();
};

/**
 * Middleware pentru a valida ID-uri de clienți
 */
const validateClientId = (req, res, next) => {
  const { clientId } = req.params;
  
  if (!clientId) {
    return res.status(400).json({
      success: false,
      message: 'ID-ul clientului este obligatoriu'
    });
  }
  
  if (!mongoose.Types.ObjectId.isValid(clientId)) {
    return res.status(400).json({
      success: false,
      message: 'ID client invalid'
    });
  }
  
  next();
};

/**
 * Middleware pentru a sanitiza intrările (protecție XSS)
 */
const sanitizeInputs = (req, res, next) => {
  try {
    // Sanitizează un șir de caractere
    const sanitizeString = (str) => {
      if (!str) return str;
      return str.toString()
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/`/g, '&#96;');
    };
    
    // Sanitizează corpul cererii
    if (req.body) {
      for (const key in req.body) {
        if (typeof req.body[key] === 'string') {
          req.body[key] = sanitizeString(req.body[key]);
        }
      }
    }
    
    // Sanitizează parametrii query
    if (req.query) {
      for (const key in req.query) {
        if (typeof req.query[key] === 'string') {
          req.query[key] = sanitizeString(req.query[key]);
        }
      }
    }
    
    // Sanitizează parametrii din URL
    if (req.params) {
      for (const key in req.params) {
        if (typeof req.params[key] === 'string' && !mongoose.Types.ObjectId.isValid(req.params[key])) {
          // Nu sanitiza ID-uri de tip ObjectId
          req.params[key] = sanitizeString(req.params[key]);
        }
      }
    }
    
    next();
  } catch (error) {
    logger.error('Error in sanitizeInputs middleware:', error);
    next(); // Continuă chiar dacă sanitizarea eșuează
  }
};

const validateBlockedDateData = (req, res, next) => {
  const { date, isFullDay, hours } = req.body;
  
  if (!date) {
    return res.status(400).json({
      success: false,
      message: 'Data este obligatorie'
    });
  }
  
  // Validare format dată
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    return res.status(400).json({
      success: false,
      message: 'Format dată invalid. Folosiți formatul YYYY-MM-DD.'
    });
  }
  
  // Validare dată nu este în trecut
  const selectedDate = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  if (selectedDate < today) {
    return res.status(400).json({
      success: false,
      message: 'Nu se pot bloca date din trecut.'
    });
  }
  
  // Validare pentru blocarea parțială
  if (!isFullDay) {
    if (!hours || !Array.isArray(hours) || hours.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Trebuie să specifici orele de blocat dacă nu blochezi toată ziua'
      });
    }
    
    // Validare format ore
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    for (const hour of hours) {
      if (!timeRegex.test(hour)) {
        return res.status(400).json({
          success: false,
          message: `Format oră invalid: ${hour}`
        });
      }
    }
    
    // Limitare număr ore
    if (hours.length > 20) {
      return res.status(400).json({
        success: false,
        message: 'Prea multe ore selectate (maxim 20)'
      });
    }
  }
  
  next();
};

const validateBlockedDateId = (req, res, next) => {
  const { blockedDateId } = req.params;
  
  if (!blockedDateId) {
    return res.status(400).json({
      success: false,
      message: 'ID-ul datei blocate este obligatoriu'
    });
  }
  
  if (!mongoose.Types.ObjectId.isValid(blockedDateId)) {
    return res.status(400).json({
      success: false,
      message: 'ID dată blocată invalid'
    });
  }
  
  next();
};

module.exports = {
  validateBookingData,
  validateTimeSlotRequest,
  validateClientInfo,
  checkBlockedUser,
  validateVerification,
  validateBookingId,
  validateClientId,
  sanitizeInputs,
  validateBlockedDateData,
  validateBlockedDateId
};      