// backend/utils/autoCleanup.js
const { Booking , Service } = require('../models/Booking');
const Client = require('../models/Client');
const { sendBookingRejectionEmail } = require('../config/email');
const BlockedDate = require('../models/BlockedDates');
const { createContextLogger } = require('./logger');
const logger = createContextLogger('AUTO-CLEANUP');


/**
 * Trimite email de respingere automată pentru rezervarea curățată
 * @param {Object} booking - Rezervarea care va fi curățată
 */
const sendAutoDeclineEmail = async (booking) => {
  try {
    // Găsește informațiile despre serviciu
    const service = await Service.findById(booking.service);
    if (!service) {
      logger.warn(`Auto-cleanup: Nu s-a găsit serviciul pentru booking ${booking._id}`);
      return false;
    }

    // Pregătește datele pentru email - exact ca în bookingController
    const bookingData = {
      _id: booking._id,
      clientName: booking.clientName,
      serviceName: service.name,
      date: booking.date,
      time: booking.time
    };

    // Folosește aceeași funcție ca în bookingController.declineBooking
    const emailResult = await sendBookingRejectionEmail(booking.email, bookingData);
    
    if (emailResult.success) {
      logger.info(`Auto-cleanup: Email de respingere trimis pentru ${booking.email} - booking ${booking._id}`);
      
      // Actualizează contorul de email-uri pentru client dacă există
      if (booking.client) {
        await booking.client.incrementEmailCounter();
      }
      
      return true;
    } else {
      logger.warn(`Auto-cleanup: Nu s-a putut trimite email de respingere pentru ${booking.email}: ${emailResult.error}`);
      return false;
    }
    
  } catch (error) {
    logger.error(`Auto-cleanup: Eroare la trimiterea email-ului de respingere pentru booking ${booking._id}:`, error);
    return false;
  }
};

/**
 * Curăță rezervările expirate (pending care au trecut de data și ora programării)
 */
// Înlocuiește DOAR funcția cleanupExpiredBookings în backend/utils/autoCleanup.js

const cleanupExpiredBookings = async () => {
  try {
    const now = new Date();
    logger.info(`Auto-cleanup: Începe curățarea rezervărilor expirate... Ora curentă: ${now.toISOString()}`);
    
    // SIMPLU: Găsește TOATE rezervările pending verificate și verifică-le în JavaScript
    const pendingBookings = await Booking.find({
      status: 'pending',
      verified: true
    }).populate('client').populate('service');
    
    logger.info(`Auto-cleanup: Găsite ${pendingBookings.length} rezervări pending verificate pentru verificare`);
    
    if (pendingBookings.length === 0) {
      logger.info('Auto-cleanup: Nu există rezervări pending verificate');
      return { cleaned: 0, errors: 0, emailsSent: 0 };
    }
    
    const expiredBookings = [];
    
    // Verifică fiecare rezervare manual în JavaScript (mai fiabil decât interogarea MongoDB)
    for (const booking of pendingBookings) {
      try {
        // Creează datetime-ul rezervării
        const bookingDate = new Date(booking.date);
        const [hours, minutes] = booking.time.split(':').map(Number);
        
        // Creează un obiect Date nou pentru datetime-ul rezervării
        const bookingDateTime = new Date(bookingDate);
        bookingDateTime.setHours(hours, minutes, 0, 0);
        
        const isExpired = bookingDateTime < now;
        const minutesDiff = Math.floor((now - bookingDateTime) / (1000 * 60));
        
        logger.info(`Auto-cleanup: Verific booking ${booking._id} - Client: ${booking.clientName}, Data: ${bookingDate.toISOString().split('T')[0]}, Ora: ${booking.time}, BookingDateTime: ${bookingDateTime.toISOString()}, Expirat: ${isExpired}, Minute în urmă: ${minutesDiff}`);
        
        if (isExpired) {
          expiredBookings.push(booking);
          logger.info(`  ✓ Booking ${booking._id} ESTE EXPIRAT (cu ${minutesDiff} minute în urmă)`);
        } else {
          logger.info(`  - Booking ${booking._id} este încă în viitor (peste ${-minutesDiff} minute)`);
        }
        
      } catch (dateError) {
        logger.error(`Auto-cleanup: Eroare la procesarea datei pentru booking ${booking._id}:`, dateError);
      }
    }
    
    logger.info(`Auto-cleanup: Găsite ${expiredBookings.length} rezervări expirate din ${pendingBookings.length} total`);
    
    if (expiredBookings.length === 0) {
      logger.info('Auto-cleanup: Nu există rezervări expirate de curățat');
      return { cleaned: 0, errors: 0, emailsSent: 0 };
    }
    
    let cleanedCount = 0;
    let errorCount = 0;
    let emailsSentCount = 0;
    
    // Procesează fiecare rezervare expirată
    for (const booking of expiredBookings) {
      try {
        logger.info(`Auto-cleanup: Procesez booking expirat ${booking._id} pentru ${booking.clientName}`);
        
        // Trimite email de respingere automată
        const emailSent = await sendAutoDeclineEmail(booking);
        
        if (emailSent) {
          emailsSentCount++;
          logger.info(`  ✓ Email de respingere trimis pentru ${booking.email}`);
        } else {
          logger.warn(`  ✗ Email de respingere a eșuat pentru ${booking.email}`);
        }
        
        // Actualizează statisticile clientului
        if (booking.client) {
          booking.client.totalBookings = Math.max(0, booking.client.totalBookings - 1);
          await booking.client.save();
          logger.info(`  ✓ Statistici client actualizate pentru ${booking.client.name}`);
        }
        
        // Marchează ca respinsă
        booking.status = 'declined';
        booking.notes = `Respinsă automat - programarea a expirat la ${now.toISOString()}`;
        await booking.save();
        
        cleanedCount++;
        
        logger.info(`  ✓ Booking ${booking._id} marcat ca respins cu succes`);
        
      } catch (error) {
        logger.error(`Auto-cleanup: Eroare la procesarea booking-ului ${booking._id}:`, error);
        errorCount++;
      }
    }
    
    logger.info(`Auto-cleanup expired FINALIZAT: ${cleanedCount} rezervări procesate, ${emailsSentCount} email-uri trimise, ${errorCount} erori`);
    
    return { cleaned: cleanedCount, errors: errorCount, emailsSent: emailsSentCount };
    
  } catch (error) {
    logger.error('Auto-cleanup: EROARE GENERALĂ la curățarea rezervărilor expirate:', error);
    return { cleaned: 0, errors: 1, emailsSent: 0 };
  }
};


/**
 * Curăță rezervările neconfirmate mai vechi de 15 minute
 */
const cleanupUnconfirmedBookings = async () => {
  try {
    const fifteenMinutesAgo = new Date();
    fifteenMinutesAgo.setMinutes(fifteenMinutesAgo.getMinutes() - 15);
    
    // Găsește rezervările pending create acum mai mult de 15 min
    const oldUnconfirmedBookings = await Booking.find({
      status: 'pending',
      verified: false,
      createdAt: { $lt: fifteenMinutesAgo }
    }).populate('client');
    
    if (oldUnconfirmedBookings.length === 0) {
      logger.info('Auto-cleanup: Nu există rezervări neconfirmate vechi de curățat');
      return { cleaned: 0, errors: 0 };
    }
    
    let cleanedCount = 0;
    let errorCount = 0;
    
    for (const booking of oldUnconfirmedBookings) {
      try {
        // Actualizează statisticile clientului dacă există
        if (booking.client) {
          booking.client.totalBookings = Math.max(0, booking.client.totalBookings - 1);
          await booking.client.save();
        }
        
        // Șterge rezervarea neconfirmată
        await Booking.findByIdAndDelete(booking._id);
        
        cleanedCount++;
        
        logger.info(`Auto-cleanup: Șters booking neconfirmat ${booking._id} pentru ${booking.clientName} - creat la ${booking.createdAt}`);
        
      } catch (error) {
        logger.error(`Auto-cleanup: Eroare la ștergerea booking-ului neconfirmat ${booking._id}:`, error);
        errorCount++;
      }
    }
    
    logger.info(`Auto-cleanup neconfirmate completat: ${cleanedCount} rezervări curățate, ${errorCount} erori`);
    
    return { cleaned: cleanedCount, errors: errorCount };
    
  } catch (error) {
    logger.error('Auto-cleanup: Eroare generală la curățarea rezervărilor neconfirmate:', error);
    return { cleaned: 0, errors: 1 };
  }
};

/**
 * Curăță rezervările respinse mai vechi de 7 zile
 */
const cleanupDeclinedBookings = async () => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    // Găsește rezervările respinse mai vechi de 7 zile
    const oldDeclinedBookings = await Booking.find({
      status: 'declined',
      createdAt: { $lt: sevenDaysAgo }
    });
    
    if (oldDeclinedBookings.length === 0) {
      logger.info('Auto-cleanup: Nu există rezervări respinse vechi de curățat');
      return { cleaned: 0, errors: 0 };
    }
    
    const deletedCount = await Booking.deleteMany({
      status: 'declined',
      createdAt: { $lt: sevenDaysAgo }
    });
    
    logger.info(`Auto-cleanup declined completat: ${deletedCount.deletedCount} rezervări respinse curățate`);
    
    return { cleaned: deletedCount.deletedCount, errors: 0 };
    
  } catch (error) {
    logger.error('Auto-cleanup: Eroare la curățarea rezervărilor respinse:', error);
    return { cleaned: 0, errors: 1 };
  }
};

const cleanupExpiredBlockedDates = async () => {
 try {

   
   logger.info('Auto-cleanup: Începe curățarea datelor blocate expirate...');
   
   const yesterday = new Date();
   yesterday.setDate(yesterday.getDate() - 1);
   yesterday.setHours(23, 59, 59, 999);
   
   const result = await BlockedDate.deleteMany({
     date: { $lt: yesterday }
   });
   
   if (result.deletedCount > 0) {
     logger.info(`Auto-cleanup: ${result.deletedCount} date blocate expirate curățate`);
   } else {
     logger.info('Auto-cleanup: Nu există date blocate expirate de curățat');
   }
   
   return { 
     cleaned: result.deletedCount || 0, 
     errors: 0
   };
   
 } catch (error) {
   logger.error('Auto-cleanup: Eroare la curățarea datelor blocate:', error);
   return { 
     cleaned: 0, 
     errors: 1 
   };
 }
};

/**
 * Rulează toate operațiunile de curățare
 */
const runFullCleanup = async () => {
 try {
   logger.info('Auto-cleanup: Începe curățarea automată...');

   const results = {
     expired: await cleanupExpiredBookings(),
     unconfirmed: await cleanupUnconfirmedBookings(),
     declined: await cleanupDeclinedBookings(),
     blockedDates: await cleanupExpiredBlockedDates(), 
     totalCleaned: 0,
     totalErrors: 0,
     timestamp: new Date()
   };
   
   results.totalCleaned = results.expired.cleaned + 
                         results.unconfirmed.cleaned + 
                         results.declined.cleaned + 
                         results.blockedDates.cleaned; 
   
   results.totalErrors = results.expired.errors + 
                        results.unconfirmed.errors + 
                        results.declined.errors + 
                        results.blockedDates.errors; 
   
   logger.info(`Auto-cleanup: Curățare completă finalizată - Total curățate: ${results.totalCleaned}, Total erori: ${results.totalErrors}`);
   
   return results;
   
 } catch (error) {
   logger.error('Auto-cleanup: Eroare la rularea curățării complete:', error);
   return {
     expired: { cleaned: 0, errors: 1 },
     unconfirmed: { cleaned: 0, errors: 1 },
     declined: { cleaned: 0, errors: 1 },
     blockedDates: { cleaned: 0, errors: 1 },
     totalCleaned: 0,
     totalErrors: 4, 
     timestamp: new Date(),
     error: error.message
   };
 }
};

module.exports = {
 cleanupExpiredBookings,
 cleanupUnconfirmedBookings,
 cleanupDeclinedBookings,
 cleanupExpiredBlockedDates, 
 runFullCleanup
};