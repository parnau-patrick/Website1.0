// backend/controllers/blockedDatesController.js
const BlockedDate = require('../models/BlockedDates');
const { Booking } = require('../models/Booking'); // Adăugăm importul pentru Booking
const mongoose = require('mongoose');

// Sistem de logging îmbunătățit
const NODE_ENV = process.env.NODE_ENV;
const { createContextLogger } = require('../utils/logger');
const logger = createContextLogger('BLOCKED-DATES');

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
 * Verifică dacă există rezervări confirmate pentru o dată/ore specifice
 */
const checkExistingBookings = async (date, isFullDay, hours = []) => {
  try {
    // Pregătește intervalul de căutare pentru ziua specificată
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    
    // Caută rezervări confirmate pentru această dată
    const existingBookings = await Booking.find({
      date: {
        $gte: startOfDay,
        $lte: endOfDay
      },
      status: { $in: ['confirmed', 'pending'] } // Verifică și rezervările pending verificate
    }).populate('service');
    
    if (existingBookings.length === 0) {
      return { hasConflict: false, conflictingBookings: [] };
    }
    
    // Dacă se încearcă blocarea întregii zile
    if (isFullDay) {
      return {
        hasConflict: true,
        conflictingBookings: existingBookings.map(booking => ({
          id: booking._id,
          clientName: booking.clientName,
          time: booking.time,
          service: booking.service ? booking.service.name : 'Unknown Service',
          status: booking.status
        })),
        message: `Nu se poate bloca întreaga zi. Există ${existingBookings.length} rezervări pentru această dată.`
      };
    }
    
    // Verifică conflicte pentru ore specifice
    const conflictingBookings = [];
    
    for (const booking of existingBookings) {
      const service = booking.service;
      if (!service) continue;
      
      // Calculează intervalul orar al rezervării existente
      const [bookingHour, bookingMinute] = booking.time.split(':').map(Number);
      const bookingStartMinutes = bookingHour * 60 + bookingMinute;
      const bookingEndMinutes = bookingStartMinutes + service.duration;
      
      // Verifică dacă vreo oră blocată se suprapune cu rezervarea
      for (const hour of hours) {
        const [blockHour, blockMinute] = hour.split(':').map(Number);
        const blockStartMinutes = blockHour * 60 + blockMinute;
        const blockEndMinutes = blockStartMinutes + 30; // Presupunem slot-uri de 30 min
        
        // Verifică suprapunere
        if (
          (blockStartMinutes >= bookingStartMinutes && blockStartMinutes < bookingEndMinutes) ||
          (blockEndMinutes > bookingStartMinutes && blockEndMinutes <= bookingEndMinutes) ||
          (blockStartMinutes <= bookingStartMinutes && blockEndMinutes >= bookingEndMinutes)
        ) {
          conflictingBookings.push({
            id: booking._id,
            clientName: booking.clientName,
            time: booking.time,
            service: service.name,
            status: booking.status,
            conflictingHour: hour
          });
        }
      }
    }
    
    if (conflictingBookings.length > 0) {
      return {
        hasConflict: true,
        conflictingBookings,
        message: `Nu se pot bloca orele selectate. Există rezervări care se suprapun.`
      };
    }
    
    return { hasConflict: false, conflictingBookings: [] };
    
  } catch (error) {
    logger.error('Error checking existing bookings:', error);
    return {
      hasConflict: true,
      conflictingBookings: [],
      message: 'Eroare la verificarea rezervărilor existente'
    };
  }
};

/**
 * Blochează o dată întreagă sau ore specifice
 */
const blockDate = async (req, res) => {
  try {
    const { date, isFullDay, hours } = req.body;
    
    // Validare input
    if (!date) {
      return errorResponse(res, 400, 'Data este obligatorie');
    }
    
    if (!isFullDay && (!hours || !Array.isArray(hours) || hours.length === 0)) {
      return errorResponse(res, 400, 'Trebuie să specifici orele de blocat dacă nu blochezi toată ziua');
    }
    
    // Validare format dată
    const selectedDate = new Date(date);
    if (isNaN(selectedDate.getTime())) {
      return errorResponse(res, 400, 'Format dată invalid');
    }
    
    // Verifică dacă data nu este în trecut
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    selectedDate.setHours(0, 0, 0, 0);
    
    if (selectedDate < today) {
      return errorResponse(res, 400, 'Nu se pot bloca date din trecut');
    }
    
    // Validare ore pentru securitate
    if (!isFullDay && hours) {
      const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
      for (const hour of hours) {
        if (!timeRegex.test(hour)) {
          return errorResponse(res, 400, `Format oră invalid: ${hour}`);
        }
      }
      
      // Limitare număr ore pentru a preveni atacurile
      if (hours.length > 20) {
        return errorResponse(res, 400, 'Prea multe ore selectate');
      }
    }
    
    // VERIFICARE NOUĂ: Controlează dacă există rezervări pentru data/orele specificate
    const bookingCheck = await checkExistingBookings(selectedDate, isFullDay, hours || []);
    
    if (bookingCheck.hasConflict) {
      // Returnează detalii despre rezervările care intră în conflict
      return res.status(409).json({
        success: false,
        message: bookingCheck.message,
        conflictingBookings: bookingCheck.conflictingBookings,
        suggestAction: 'Anulează sau mută rezervările existente înainte de a bloca această dată/ore.'
      });
    }
    
    // Generează mesajul automat cu numele zilei
    const dayName = BlockedDate.formatDateInRomanian(selectedDate);
    const automaticReason = isFullDay 
      ? `Suntem închiși în ${dayName}` 
      : `Anumite ore sunt indisponibile în ${dayName}`;
    
    // Verifică dacă există deja o blocare pentru această dată
    const startOfDay = new Date(selectedDate);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(selectedDate);
    endOfDay.setHours(23, 59, 59, 999);
    
    let existingBlock = await BlockedDate.findOne({
      date: {
        $gte: startOfDay,
        $lte: endOfDay
      }
    });
    
    if (existingBlock) {
      // Actualizează blocarea existentă
      existingBlock.isFullDayBlocked = isFullDay;
      existingBlock.blockedHours = isFullDay ? [] : [...new Set(hours)]; // Remove duplicates
      existingBlock.reason = automaticReason;
      existingBlock.createdBy = req.user.id;
      await existingBlock.save();
    } else {
      // Creează o nouă blocare
      existingBlock = new BlockedDate({
        date: selectedDate,
        isFullDayBlocked: isFullDay,
        blockedHours: isFullDay ? [] : [...new Set(hours)], // Remove duplicates
        reason: automaticReason,
        createdBy: req.user.id
      });
      await existingBlock.save();
    }
    
    res.status(200).json({
      success: true,
      message: isFullDay 
        ? `Data ${dayName} a fost blocată complet` 
        : `Orele selectate din ${dayName} au fost blocate`,
      blockedDate: {
        id: existingBlock._id,
        date: existingBlock.date,
        isFullDayBlocked: existingBlock.isFullDayBlocked,
        blockedHours: existingBlock.blockedHours,
        reason: existingBlock.reason
      }
    });
    
  } catch (error) {
    logger.error('Error blocking date:', error);
    return errorResponse(res, 500, 'Eroare la blocarea datei');
  }
};

/**
 * Obține toate datele blocate
 */
const getBlockedDates = async (req, res) => {
  try {
    const blockedDates = await BlockedDate.find()
      .populate('createdBy', 'username')
      .sort({ date: 1 });
    
    const formattedDates = blockedDates.map(blocked => ({
      id: blocked._id,
      date: blocked.date,
      dateFormatted: BlockedDate.formatDateInRomanian(blocked.date),
      isFullDayBlocked: blocked.isFullDayBlocked,
      blockedHours: blocked.blockedHours,
      reason: blocked.reason,
      createdBy: blocked.createdBy ? blocked.createdBy.username : 'Unknown',
      createdAt: blocked.createdAt
    }));
    
    res.status(200).json({
      success: true,
      blockedDates: formattedDates
    });
    
  } catch (error) {
    logger.error('Error getting blocked dates:', error);
    return errorResponse(res, 500, 'Eroare la obținerea datelor blocate');
  }
};

/**
 * Șterge o dată blocată
 */
const unblockDate = async (req, res) => {
  try {
    const { blockedDateId } = req.params;
    
    // Validare ID
    if (!mongoose.Types.ObjectId.isValid(blockedDateId)) {
      return errorResponse(res, 400, 'ID invalid pentru data blocată');
    }
    
    const blockedDate = await BlockedDate.findById(blockedDateId);
    
    if (!blockedDate) {
      return errorResponse(res, 404, 'Data blocată nu a fost găsită');
    }
    
    const dateFormatted = BlockedDate.formatDateInRomanian(blockedDate.date);
    
    await BlockedDate.findByIdAndDelete(blockedDateId);
    
    res.status(200).json({
      success: true,
      message: `Blocarea pentru ${dateFormatted} a fost eliminată`
    });
    
  } catch (error) {
    logger.error('Error unblocking date:', error);
    return errorResponse(res, 500, 'Eroare la eliminarea blocării');
  }
};

/**
 * Verifică dacă o dată specifică este blocată
 */
const checkDateBlocked = async (req, res) => {
  try {
    const { date, time } = req.query;
    
    if (!date) {
      return errorResponse(res, 400, 'Data este obligatorie');
    }
    
    const selectedDate = new Date(date);
    if (isNaN(selectedDate.getTime())) {
      return errorResponse(res, 400, 'Format dată invalid');
    }
    
    // Validare timp dacă este specificat
    if (time) {
      const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
      if (!timeRegex.test(time)) {
        return errorResponse(res, 400, 'Format timp invalid');
      }
    }
    
    const blockInfo = await BlockedDate.isDateTimeBlocked(selectedDate, time);
    
    res.status(200).json({
      success: true,
      isBlocked: blockInfo.isBlocked,
      reason: blockInfo.reason,
      type: blockInfo.type || null
    });
    
  } catch (error) {
    logger.error('Error checking blocked date:', error);
    return errorResponse(res, 500, 'Eroare la verificarea datei');
  }
};

/**
 * Obține orele blocate pentru o dată specifică
 */
const getBlockedHoursForDate = async (req, res) => {
  try {
    const { date } = req.params;
    
    if (!date) {
      return errorResponse(res, 400, 'Data este obligatorie');
    }
    
    const selectedDate = new Date(date);
    if (isNaN(selectedDate.getTime())) {
      return errorResponse(res, 400, 'Format dată invalid');
    }
    
    const blockedInfo = await BlockedDate.getBlockedHours(selectedDate);
    
    res.status(200).json({
      success: true,
      date: selectedDate,
      dateFormatted: BlockedDate.formatDateInRomanian(selectedDate),
      isFullDayBlocked: blockedInfo.isFullDayBlocked,
      blockedHours: blockedInfo.blockedHours,
      reason: blockedInfo.reason
    });
    
  } catch (error) {
    logger.error('Error getting blocked hours for date:', error);
    return errorResponse(res, 500, 'Eroare la obținerea orelor blocate');
  }
};

module.exports = {
  blockDate,
  getBlockedDates,
  unblockDate,
  checkDateBlocked,
  getBlockedHoursForDate
};