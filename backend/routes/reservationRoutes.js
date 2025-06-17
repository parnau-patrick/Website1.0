// routes/reservationRoutes.js
const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const validationMiddleware = require('../middleware/validationMiddleware');
const { authenticateJWT, authorizeRole } = require('../middleware/authMiddleware');
const blockedDatesController = require('../controllers/blockedDatesController');

// Middleware de sanitizare globală pentru toate rutele
router.use(validationMiddleware.sanitizeInputs);

router.get('/services', bookingController.getServices);

router.post(
  '/admin/blocked-dates',
  authenticateJWT,
  authorizeRole(['admin']),
  validationMiddleware.sanitizeInputs,
  blockedDatesController.blockDate
);

// Obține toate datele blocate
router.get(
  '/admin/blocked-dates',
  authenticateJWT,
  authorizeRole(['admin', 'barber']),
  blockedDatesController.getBlockedDates
);

// Șterge o dată blocată (doar admin)
router.delete(
  '/admin/blocked-dates/:blockedDateId',
  authenticateJWT,
  authorizeRole(['admin']),
  validationMiddleware.sanitizeInputs,
  blockedDatesController.unblockDate
);

// Verifică dacă o dată/oră este blocată (endpoint public pentru frontend)
router.get(
  '/check-blocked-date',
  validationMiddleware.sanitizeInputs,
  blockedDatesController.checkDateBlocked
);

// Obține orele blocate pentru o dată specifică
router.get(
  '/blocked-hours/:date',
  validationMiddleware.sanitizeInputs,
  blockedDatesController.getBlockedHoursForDate
);

// Rulează manual curățarea automată (doar admin)
router.post(
  '/admin/cleanup',
  authenticateJWT,
  authorizeRole(['admin']),
  bookingController.runManualCleanup
);

router.post(
  '/admin/blocked-dates',
  authenticateJWT,
  authorizeRole(['admin']),
  validationMiddleware.sanitizeInputs,
  validationMiddleware.validateBlockedDateData,
  blockedDatesController.blockDate
);

router.delete(
  '/admin/blocked-dates/:blockedDateId',
  authenticateJWT,
  authorizeRole(['admin']),
  validationMiddleware.sanitizeInputs,
  validationMiddleware.validateBlockedDateId,
  blockedDatesController.unblockDate
);

router.post(
  '/available-time-slots',
  validationMiddleware.validateTimeSlotRequest,
  bookingController.getAvailableTimeSlots
);

router.post(
  '/bookings',
  validationMiddleware.validateBookingData,
  bookingController.createBooking
);

router.post(
  '/bookings/complete',
  validationMiddleware.validateClientInfo,
  validationMiddleware.checkBlockedUser,
  bookingController.completeBooking
);

router.post(
  '/bookings/verify',
  validationMiddleware.validateVerification,
  bookingController.verifyBooking
);

router.post(
  '/bookings/resend-code',
  validationMiddleware.validateBookingId,
  bookingController.resendVerificationCode
);


router.get(
  '/admin/bookings/pending',
  authenticateJWT,
  authorizeRole(['admin', 'barber']),
  bookingController.getPendingBookings
);

router.get(
  '/admin/bookings/confirmed',
  authenticateJWT,
  authorizeRole(['admin', 'barber']),
  bookingController.getConfirmedBookings
);

router.put(
  '/admin/bookings/:bookingId/confirm',
  authenticateJWT,
  authorizeRole(['admin', 'barber']),
  validationMiddleware.validateBookingId,
  bookingController.confirmBooking
);

router.put(
  '/admin/bookings/:bookingId/decline',
  authenticateJWT,
  authorizeRole(['admin', 'barber']),
  validationMiddleware.validateBookingId,
  bookingController.declineBooking
);

// Rute restrânse doar pentru admin
router.post(
  '/admin/users/block/:bookingId',
  authenticateJWT,
  authorizeRole(['admin']), // Doar admin poate bloca utilizatori
  validationMiddleware.validateBookingId,
  bookingController.blockUser
);

// Rute noi pentru gestionarea clienților
router.get(
  '/admin/clients',
  authenticateJWT,
  authorizeRole(['admin', 'barber']),
  bookingController.getAllClients
);

router.get(
  '/admin/clients/:clientId',
  authenticateJWT,
  authorizeRole(['admin', 'barber']),
  validationMiddleware.validateClientId,
  bookingController.getClientDetails
);

router.put(
  '/admin/clients/:clientId/unblock',
  authenticateJWT,
  authorizeRole(['admin']), // Doar admin poate debloca utilizatori
  validationMiddleware.validateClientId,
  bookingController.unblockUser
);

router.put(
  '/bookings/:bookingId/suspend',
  validationMiddleware.validateBookingId,
  bookingController.suspendBooking
);

router.put(
  '/admin/bookings/:bookingId/complete',
  authenticateJWT,
  authorizeRole(['admin', 'barber']),
  validationMiddleware.validateBookingId,
  bookingController.completeBookingService
);

// Rute pentru statistici - Actualizate pentru email în loc de SMS
router.get(
  '/admin/statistics/email',
  authenticateJWT,
  authorizeRole(['admin']), // Doar admin poate vedea statistici
  bookingController.getEmailUsageStats // Actualizat din getSMSUsageStats
);

router.get(
  '/admin/users/blocked',
  authenticateJWT,
  authorizeRole(['admin']), 
  bookingController.getBlockedUsers
);

// Tratare erori pentru rute
router.use((err, req, res, next) => {
  console.error('Route error:', err);
  res.status(500).json({ 
    success: false, 
    message: process.env.NODE_ENV === 'production' 
      ? 'A apărut o eroare pe server' 
      : err.message 
  });
});

module.exports = router;