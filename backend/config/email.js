// config/email.js
require('dotenv').config();
const nodemailer = require('nodemailer');
const { EmailUsage, Booking } = require('../models/Booking');
const Client = require('../models/Client');

// Sistem de logging îmbunătățit
const NODE_ENV = process.env.NODE_ENV;
const { createContextLogger } = require('../utils/logger');
const logger = createContextLogger('EMAIL');

// Obține credențialele de email din variabilele de mediu
const EMAIL_HOST = process.env.EMAIL_HOST || 'smtp.gmail.com';
const EMAIL_PORT = parseInt(process.env.EMAIL_PORT || '587');
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@dariushreniuc.com';
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || 'contact@dariushreniuc.com';

// Validează existența credențialelor
if (!EMAIL_HOST || !EMAIL_PORT || !EMAIL_USER || !EMAIL_PASS) {
  logger.error('EROARE: Lipsesc credențialele de email în variabilele de mediu.');
  if (NODE_ENV === 'production') {
    // În producție, se oprește aplicația dacă lipsesc credențialele
    logger.error('Credențialele de email sunt obligatorii în producție. Se oprește aplicația.');
    process.exit(1);
  }
}

// Limitele maxime pentru email și constante pentru rate limiting
const DAILY_EMAIL_LIMIT = parseInt(process.env.DAILY_EMAIL_LIMIT || '20');
const BOOKING_EMAIL_LIMIT = parseInt(process.env.BOOKING_EMAIL_LIMIT || '5');
const MIN_SECONDS_BETWEEN_EMAILS = parseInt(process.env.MIN_SECONDS_BETWEEN_EMAILS || '60');

// Inițializare transporter Nodemailer
let transporter;
try {
  // Configurare transporter email bazat pe mediu
  if (NODE_ENV === 'production') {
    transporter = nodemailer.createTransport({
      host: EMAIL_HOST,
      port: EMAIL_PORT,
      secure: EMAIL_PORT === 465, // true pentru 465, false pentru alte porturi
      auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS,
      },
      tls: {
        // Nu eșua la certificate invalide
        rejectUnauthorized: false
      }
    });
    logger.info('Transporter email inițializat pentru producție');
  } else {
    // În dezvoltare, afișează email-urile în consolă dacă nu sunt configurate credențialele
    if (!EMAIL_USER || !EMAIL_PASS) {
      transporter = {
        sendMail: async (opts) => {
          logger.info('EMAIL SIMULAT AR FI TRIMIS:', opts);
          return { messageId: 'MOCK_ID_' + Date.now() };
        }
      };
      logger.warn('Se folosește un transporter email simulat pentru dezvoltare');
    } else {
      // Folosește Gmail pentru dezvoltare dacă sunt credențiale
      transporter = nodemailer.createTransport({
        host: EMAIL_HOST,
        port: EMAIL_PORT,
        secure: EMAIL_PORT === 465,
        auth: {
          user: EMAIL_USER,
          pass: EMAIL_PASS,
        }
      });
      logger.info('Transporter email inițializat pentru dezvoltare cu credențiale reale');
    }
  }
} catch (error) {
  logger.error('Eșec la inițializarea transporterului email:', error);
  
  if (NODE_ENV === 'production') {
    logger.error('Inițializarea transporterului email a eșuat în producție. Se oprește aplicația.');
    process.exit(1);
  } else {
    // Creează un transporter simulat doar pentru dezvoltare
    logger.warn('Se folosește un transporter email simulat pentru dezvoltare');
    transporter = {
      sendMail: async (opts) => {
        logger.info('EMAIL SIMULAT AR FI TRIMIS:', opts);
        return { messageId: 'MOCK_ID_' + Date.now() };
      }
    };
  }
}

/**
 * Validează formatul email-ului
 * @param {string} email - Email-ul de validat
 * @returns {boolean} - True dacă este valid, false în caz contrar
 */
const isValidEmail = (email) => {
  if (!email) return false;
  
  // Regex de bază pentru validarea email-ului
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email);
};

/**
 * Verifică dacă un email a atins limita zilnică de email-uri
 * @param {string} email - Email-ul de verificat
 * @returns {Promise<Object>} - Obiect rezultat cu statusul și mesaj
 */
const checkDailyEmailLimit = async (email) => {
  if (!email) {
    return { success: false, message: 'Adresa de email este obligatorie', remaining: 0 };
  }
  
  try {
    // Obține sau creează înregistrarea zilnică de utilizare
    const usage = await EmailUsage.findOrCreateDailyUsage(email);
    
    // Verifică dacă s-a atins limita
    if (usage.count >= DAILY_EMAIL_LIMIT) {
      logger.warn(`Limita zilnică de email-uri atinsă pentru ${email}: ${usage.count}/${DAILY_EMAIL_LIMIT}`);
      return { 
        success: false, 
        message: `Ai atins limita zilnică de ${DAILY_EMAIL_LIMIT} email-uri`, 
        remaining: 0 
      };
    }
    
    return { 
      success: true, 
      message: 'În limita zilnică', 
      remaining: DAILY_EMAIL_LIMIT - usage.count 
    };
  } catch (error) {
    logger.error('Eroare la verificarea limitei zilnice de email-uri:', error);
    // În caz de eroare, blocăm trimiterea pentru a preveni abuzul
    return { success: false, message: 'Eroare la verificarea limitelor de email', remaining: 0 };
  }
};

/**
 * Verifică dacă o rezervare a atins limita de email-uri
 * @param {string} bookingId - ID-ul rezervării
 * @returns {Promise<Object>} - Obiect rezultat cu statusul și mesaj
 */
const checkBookingEmailLimit = async (bookingId) => {
  if (!bookingId) {
    return { success: false, message: 'ID-ul rezervării este obligatoriu', remaining: 0 };
  }
  
  try {
    // Obține înregistrarea rezervării
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      logger.error(`Rezervarea nu a fost găsită: ${bookingId}`);
      return { success: false, message: 'Rezervarea nu a fost găsită', remaining: 0 };
    }
    
    // Inițializează emailCount dacă nu există
    const emailCount = booking.emailCount || 0;
    
    // Verifică dacă s-a atins limita
    if (emailCount >= BOOKING_EMAIL_LIMIT) {
      logger.warn(`Limita de email-uri pentru rezervare atinsă pentru ${bookingId}: ${emailCount}/${BOOKING_EMAIL_LIMIT}`);
      return { 
        success: false, 
        message: `Ai atins limita de ${BOOKING_EMAIL_LIMIT} email-uri pentru această rezervare`, 
        remaining: 0 
      };
    }
    
    return { 
      success: true, 
      message: 'În limita rezervării', 
      remaining: BOOKING_EMAIL_LIMIT - emailCount 
    };
  } catch (error) {
    logger.error('Eroare la verificarea limitei de email-uri pentru rezervare:', error);
    return { success: false, message: 'Eroare la verificarea limitelor de email pentru rezervare', remaining: 0 };
  }
};

/**
 * Verifică dacă a trecut timpul minim între email-uri pentru a preveni spam-ul
 * @param {Date} lastEmailSentAt - Timestamp-ul ultimului email
 * @returns {Object} - Rezultat cu status și secunde rămase
 */
const checkTimeBetweenEmails = (lastEmailSentAt) => {
  if (!lastEmailSentAt) {
    return { canSend: true, secondsRemaining: 0 };
  }
  
  const now = new Date();
  const timeSinceLastEmail = now - lastEmailSentAt; // în milisecunde
  const secondsElapsed = Math.floor(timeSinceLastEmail / 1000);
  
  if (secondsElapsed < MIN_SECONDS_BETWEEN_EMAILS) {
    const secondsRemaining = MIN_SECONDS_BETWEEN_EMAILS - secondsElapsed;
    return { 
      canSend: false, 
      secondsRemaining,
      message: `Te rugăm să aștepți încă ${secondsRemaining} secunde înainte de a solicita un nou email`
    };
  }
  
  return { canSend: true, secondsRemaining: 0 };
};

/**
 * Incrementează contorul de email-uri pentru o adresă de email
 * @param {string} email - Adresa de email
 * @returns {Promise<boolean>} - Status de succes
 */
const incrementDailyEmailCounter = async (email) => {
  if (!email) {
    logger.error('Adresa de email este obligatorie pentru incrementarea contorului de email-uri');
    return false;
  }
  
  try {
    const usage = await EmailUsage.findOrCreateDailyUsage(email);
    usage.count += 1;
    await usage.save();
    
    // Actualizează și contorul clientului dacă există
    const client = await Client.findByEmail(email);
    if (client) {
      await client.incrementEmailCounter();
    }
    
    logger.info(`Contor zilnic de email-uri pentru ${email}: ${usage.count}/${DAILY_EMAIL_LIMIT}`);
    return true;
  } catch (error) {
    logger.error('Eroare la incrementarea contorului zilnic de email-uri:', error);
    return false;
  }
};

/**
 * Incrementează contorul de email-uri pentru o rezervare
 * @param {string} bookingId - ID-ul rezervării
 * @returns {Promise<boolean>} - Status de succes
 */
const incrementBookingEmailCounter = async (bookingId) => {
  if (!bookingId) {
    logger.error('ID-ul rezervării este obligatoriu pentru incrementarea contorului de email-uri');
    return false;
  }
  
  try {
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      logger.error(`Rezervarea nu a fost găsită: ${bookingId}`);
      return false;
    }
    
    // Inițializează emailCount dacă nu există
    if (booking.emailCount === undefined) {
      booking.emailCount = 0;
    }
    
    booking.emailCount += 1;
    booking.lastEmailSentAt = new Date();
    await booking.save();
    
    logger.info(`Contor email-uri pentru rezervarea ${bookingId}: ${booking.emailCount}/${BOOKING_EMAIL_LIMIT}`);
    return true;
  } catch (error) {
    logger.error('Eroare la incrementarea contorului de email-uri pentru rezervare:', error);
    return false;
  }
};

/**
 * Trimite email de verificare
 * @param {string} to - Adresa de email destinatar
 * @param {string} code - Codul de verificare
 * @param {string} bookingId - ID-ul rezervării
 * @returns {Promise<Object>} - Obiect rezultat cu statusul și mesaj
 */
const sendVerificationEmail = async (to, code, bookingId) => {
  // Validare input
  if (!to) {
    return { success: false, error: 'Adresa de email este obligatorie' };
  }
  
  if (!code) {
    return { success: false, error: 'Codul de verificare este obligatoriu' };
  }
  
  // Validează și sanitizează codul - măsură de securitate împotriva injecției de cod
  const codePattern = /^\d{6}$/;
  if (!codePattern.test(code)) {
    return { 
      success: false, 
      error: 'Codul de verificare trebuie să conțină exact 6 cifre' 
    };
  }
  
  try {
    // Validează email-ul
    if (!isValidEmail(to)) {
      return {
        success: false, 
        error: 'Adresă de email invalidă. Te rugăm să verifici și să încerci din nou.'
      };
    }
    
    // Verifică dacă adresa a atins limita zilnică
    const dailyLimitCheck = await checkDailyEmailLimit(to);
    if (!dailyLimitCheck.success) {
      return { 
        success: false, 
        error: dailyLimitCheck.message || 'Ai atins limita zilnică de email-uri'
      };
    }
    
    // Verifică dacă rezervarea a atins limita sa
    if (bookingId) {
      const bookingLimitCheck = await checkBookingEmailLimit(bookingId);
      if (!bookingLimitCheck.success) {
        return { 
          success: false, 
          error: bookingLimitCheck.message || 'Ai atins limita de email-uri pentru această rezervare'
        };
      }
      
      // Verifică timpul între email-uri pentru această rezervare
      const booking = await Booking.findById(bookingId);
      if (booking && booking.lastEmailSentAt) {
        const timeCheck = checkTimeBetweenEmails(booking.lastEmailSentAt);
        if (!timeCheck.canSend) {
          return {
            success: false,
            error: timeCheck.message || `Te rugăm să aștepți încă ${timeCheck.secondsRemaining} secunde`,
            secondsRemaining: timeCheck.secondsRemaining
          };
        }
      }
    }
    
    // Verifică și timpul ultimului email pentru client pentru rate limiting
    const client = await Client.findByEmail(to);
    if (client && client.lastEmailSentAt) {
      const timeCheck = checkTimeBetweenEmails(client.lastEmailSentAt);
      if (!timeCheck.canSend) {
        return {
          success: false,
          error: timeCheck.message || `Te rugăm să aștepți încă ${timeCheck.secondsRemaining} secunde`,
          secondsRemaining: timeCheck.secondsRemaining
        };
      }
    }
    
    // Folosește numele domeniului în producție, nu numele hardcodat al afacerii
    const domain = NODE_ENV === 'production' ? 'dariushreniuc.com' : 'Darius Hreniuc';
    
    // Personalizează mesajul email-ului de verificare
    const emailSubject = `Codul tău de verificare pentru rezervarea la ${domain}`;
    
    // Conținut HTML pentru email
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
        <h2 style="color: #ff1d46; text-align: center;">Verificare Rezervare</h2>
        <p>Salut!</p>
        <p>Codul tău de verificare pentru programarea la ${domain} este:</p>
        <div style="background-color: #f8f8f8; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; margin: 20px 0;">
          ${code}
        </div>
        <p>Te rugăm să introduci acest cod pe pagina de rezervare pentru a confirma programarea.</p>
        <p>Dacă nu ai solicitat acest cod, te rugăm să ignori acest email.</p>
        <p>Mulțumim,<br>Echipa ${domain}</p>
      </div>
    `;
    
    // Versiunea text pentru clienții de email care nu suportă HTML
    const textContent = `
      Verificare Rezervare
      
      Salut!
      
      Codul tău de verificare pentru programarea la ${domain} este: ${code}
      
      Te rugăm să introduci acest cod pe pagina de rezervare pentru a confirma programarea.
      
      Dacă nu ai solicitat acest cod, te rugăm să ignori acest email.
      
      Mulțumim,
      Echipa ${domain}
    `;
    
    
    
    try {
      // În modul development, afișează email-urile în loc să le trimită
      if (NODE_ENV === "development") {
        logger.info('EMAIL SIMULAT PENTRU DEZVOLTARE:', { 
          to, 
          subject: emailSubject,
          text: textContent
        });
        return { success: true, messageId: 'MOCK_' + Date.now() };
      }
      
      // Pregătește opțiunile pentru email
      const mailOptions = {
        from: `"${domain} Rezervări" <${EMAIL_FROM}>`,
        to: to,
        subject: emailSubject,
        text: textContent,
        html: htmlContent
      };
      
      // Trimite email-ul
      const info = await transporter.sendMail(mailOptions);
      
      logger.info(`Email trimis către ${to}, ID: ${info.messageId}`);
      
      // Incrementează contoarele de email-uri la trimiterea cu succes
      await incrementDailyEmailCounter(to);
      if (bookingId) {
        await incrementBookingEmailCounter(bookingId);
      }
      
      return { 
        success: true, 
        messageId: info.messageId 
      };
      
    } catch (emailError) {
      logger.error('Eroare la trimiterea email-ului:', emailError);
      return { 
        success: false, 
        error: 'Nu s-a putut trimite mesajul. Te rugăm să încerci mai târziu.',
        emailError: NODE_ENV === 'production' ? 'Eroare la trimiterea email-ului' : emailError.message
      };
    }
    
  } catch (error) {
    logger.error('Eroare în sendVerificationEmail:', error);
    return { 
      success: false, 
      error: 'A apărut o eroare la trimiterea mesajului. Te rugăm să încerci mai târziu.' 
    };
  }
};

/**
 * Trimite email de confirmare pentru rezervare
 * @param {string} to - Adresa de email destinatar
 * @param {Object} booking - Detaliile rezervării
 * @returns {Promise<Object>} - Obiect rezultat cu statusul și mesaj
 */
const sendBookingConfirmationEmail = async (to, booking) => {
  logger.info('Se trimite email de confirmare a rezervării...');
  
  // Validare input
  if (!to) {
    return { success: false, error: 'Adresa de email este obligatorie' };
  }
  
  if (!booking) {
    return { success: false, error: 'Detaliile rezervării sunt obligatorii' };
  }
  
  // Validează că obiectul rezervării are câmpurile minime necesare
  if (!booking.serviceName || !booking.date || !booking.time) {
    return { success: false, error: 'Informații incomplete despre rezervare' };
  }
  
  try {
    // Validează email-ul
    if (!isValidEmail(to)) {
      return {
        success: false,
        error: 'Adresă de email invalidă. Te rugăm să verifici și să încerci din nou.'
      };
    }
    
    // Verifică dacă adresa a atins limita zilnică
    const dailyLimitCheck = await checkDailyEmailLimit(to);
    if (!dailyLimitCheck.success) {
      return { 
        success: false, 
        error: dailyLimitCheck.message || 'Ai atins limita zilnică de email-uri'
      };
    }
    
    // Verifică dacă rezervarea a atins limita sa
    if (booking._id) {
      const bookingLimitCheck = await checkBookingEmailLimit(booking._id);
      if (!bookingLimitCheck.success) {
        return { 
          success: false, 
          error: bookingLimitCheck.message || 'Ai atins limita de email-uri pentru această rezervare'
        };
      }
      
      // Verifică timpul între email-uri
      const fullBooking = await Booking.findById(booking._id);
      if (fullBooking && fullBooking.lastEmailSentAt) {
        const timeCheck = checkTimeBetweenEmails(fullBooking.lastEmailSentAt);
        if (!timeCheck.canSend) {
          return {
            success: false,
            error: timeCheck.message || `Te rugăm să aștepți încă ${timeCheck.secondsRemaining} secunde`,
            secondsRemaining: timeCheck.secondsRemaining
          };
        }
      }
    }
    
    // Verifică și timpul ultimului email pentru client pentru rate limiting
    const client = await Client.findByEmail(to);
    if (client && client.lastEmailSentAt) {
      const timeCheck = checkTimeBetweenEmails(client.lastEmailSentAt);
      if (!timeCheck.canSend) {
        return {
          success: false,
          error: timeCheck.message || `Te rugăm să aștepți încă ${timeCheck.secondsRemaining} secunde`,
          secondsRemaining: timeCheck.secondsRemaining
        };
      }
    }
    
    // Formatează data pentru email
    let formattedDate = '';
    try {
      formattedDate = booking.date instanceof Date ?
        booking.date.toLocaleDateString('ro-RO') :
        new Date(booking.date).toLocaleDateString('ro-RO');
    } catch (dateError) {
      logger.error('Eroare la formatarea datei:', dateError);
      formattedDate = 'data programării';
    }
    
    
    const sanitizeForEmail = (text) => {
      if (!text) return '';
      return text
        .replace(/[<>"'`]/g, '') 
        .replace(/&(?!amp;|lt;|gt;|quot;|#39;)/g, '&amp;'); 
    };
    
    const clientName = sanitizeForEmail(booking.clientName);
    const serviceName = sanitizeForEmail(booking.serviceName);
    const bookingTime = sanitizeForEmail(booking.time);
    
    // Folosește numele domeniului în producție
    const domain = NODE_ENV === 'production' ? 'dariushreniuc.com' : 'Darius Hreniuc';
    
    // Folosește email de contact configurabil
    const contactEmail = process.env.CONTACT_EMAIL || 'contact@dariushreniuc.com';
    
    // Subiectul email-ului
    const emailSubject = `Confirmare rezervare la ${domain} - ${formattedDate}, ora ${bookingTime}`;
    
    // Conținut HTML pentru email
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
        <h2 style="color: #ff1d46; text-align: center; font-size: 28px; margin-bottom: 25px;">Rezervare Confirmată</h2>
        
        <!-- Salut îmbunătățit -->
        <p style="font-size: 18px; color: #333; margin-bottom: 8px;">
          Bună <strong style="color:rgb(0, 0, 0); font-size: 20px;">${clientName}</strong>,
        </p>
        <p style="font-size: 16px; color: #555; line-height: 1.6; margin-bottom: 25px;">
          Rezervarea ta a fost <strong style="color: #28a745;">confirmată cu succes!</strong> ✨
        </p>
        
        <!-- Detaliile rezervării (același stil) -->
        <div style="background-color: #f8f8f8; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p style="margin: 5px 0;"><strong>Data:</strong> ${formattedDate}</p>
          <p style="margin: 5px 0;"><strong>Ora:</strong> ${bookingTime}</p>
          <p style="margin: 5px 0;"><strong>Serviciu:</strong> ${serviceName}</p>
        </div>
        
        <!-- Locația (același stil) -->
        <div style="background-color: #f0f8ff; padding: 15px; margin: 20px 0; border-radius: 5px; border-left: 4px solid #007bff;">
          <h3 style="color: #007bff; margin: 0 0 10px 0;">📍 Ne găsești aici:</h3>
          <p style="margin: 5px 0;"><strong>Darius Hreniuc - Gold Style</strong></p>
          <p style="margin: 5px 0;">📍 Bulevardul Regele Mihai I 31, Baia Mare, Maramureș</p>
          <p style="margin: 5px 0;">📞 0748344298</p>
        </div>
        
        <!-- Mesaj îmbunătățit -->
        <p style="font-size: 16px; color: #333; font-weight: 600; text-align: center; margin: 25px 0; padding: 15px; background-color: #f0fff0; border-radius: 5px; border-left: 4px solid #28a745;">
          🌟 Te așteptăm la data și ora stabilită!
        </p>
        
        <!-- Anulare rezervare (același stil) -->
        <div style="background-color: #fff3cd; padding: 15px; margin: 20px 0; border-radius: 5px; border-left: 4px solid #ffc107;">
          <h3 style="color: #856404; margin: 0 0 10px 0;">⚠️ Anulare rezervare:</h3>
          <p style="margin: 5px 0; color: #856404;">Pentru anulare, contactează-ne cu cel puțin <strong>24 de ore înainte:</strong></p>
          <p style="margin: 8px 0; color: #856404;">📧 <strong style="color: #007bff;">${contactEmail}</strong></p>
          <p style="margin: 8px 0; color: #856404;">📞 <strong style="color: #007bff;">0748344298</strong></p>
        </div>
        
        <!-- Footer îmbunătățit -->
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
          <p style="font-size: 16px; color: #333; margin-bottom: 8px;">
            <strong>Mulțumim,</strong>
          </p>
          <p style="font-size: 16px; color:rgb(0, 0, 0); font-weight: bold;">
            Echipa <span style="font-size: 18px;">${domain}</span> ✂️
          </p>
        </div>
      </div>
    `;
    
    // Versiunea text pentru clienții de email care nu suportă HTML
    const textContent = `
      REZERVARE CONFIRMATĂ ✅
      
      Bună ${clientName},
      
      Rezervarea ta a fost confirmată cu succes! ✨
      
      DETALII:
      Data: ${formattedDate}
      Ora: ${bookingTime}
      Serviciu: ${serviceName}
      
      📍 LOCAȚIA:
      Darius Hreniuc - Gold Style
      Bulevardul Regele Mihai I 31, Baia Mare, Maramureș
      Telefon: 0748344298
      
      🌟 Te așteptăm la data și ora stabilită!
      
      ⚠️ ANULARE REZERVARE:
      Pentru anulare, contactează-ne cu cel puțin 24 de ore înainte:
      Email: ${contactEmail}
      Telefon: 0748344298
      
      Mulțumim,
      Echipa ${domain} ✂️
    `;
    
  
    
    try {
      // În modul development, afișează email-urile în loc să le trimită
      if (NODE_ENV === "development") {
        logger.info('EMAIL SIMULAT PENTRU DEZVOLTARE:', { 
          to, 
          subject: emailSubject,
          text: textContent
        });
        return { success: true, messageId: 'MOCK_' + Date.now() };
      }
      
      // Pregătește opțiunile pentru email
      const mailOptions = {
        from: `"${domain} Rezervări" <${EMAIL_FROM}>`,
        to: to,
        subject: emailSubject,
        text: textContent,
        html: htmlContent
      };
      
      // Trimite email-ul
      const info = await transporter.sendMail(mailOptions);
      
      logger.info(`Email de confirmare trimis către ${to}, ID: ${info.messageId}`);
      
      // Incrementează contoarele de email-uri la trimiterea cu succes
      await incrementDailyEmailCounter(to);
      if (booking._id) {
        await incrementBookingEmailCounter(booking._id);
      }
      
      return { 
        success: true, 
        messageId: info.messageId 
      };
      
    } catch (emailError) {
      logger.error('Eroare la trimiterea email-ului de confirmare:', emailError);
      return { 
        success: false, 
        error: 'Nu s-a putut trimite mesajul de confirmare. Te rugăm să încerci mai târziu.',
        emailError: NODE_ENV === 'production' ? 'Eroare la trimiterea email-ului' : emailError.message
      };
    }
    
  } catch (error) {
    logger.error('Eroare în sendBookingConfirmationEmail:', error);
    return { 
      success: false, 
      error: 'A apărut o eroare la trimiterea confirmării. Te rugăm să încerci mai târziu.' 
    };
  }
};

/**
 * Trimite email de respingere pentru rezervare
 * @param {string} to - Adresa de email destinatar
 * @param {Object} booking - Detaliile rezervării
 * @returns {Promise<Object>} - Obiect rezultat cu statusul și mesaj
 */
const sendBookingRejectionEmail = async (to, booking) => {
  // Validare input
  if (!to) {
    return { success: false, error: 'Adresa de email este obligatorie' };
  }
  
  if (!booking) {
    return { success: false, error: 'Detaliile rezervării sunt obligatorii' };
  }
  
  try {
    // Validează email-ul
    if (!isValidEmail(to)) {
      return {
        success: false,
        error: 'Adresă de email invalidă. Te rugăm să verifici și să încerci din nou.'
      };
    }
    
    // Verifică limita zilnică de email-uri
    const dailyLimitCheck = await checkDailyEmailLimit(to);
    if (!dailyLimitCheck.success) {
      return { 
        success: false, 
        error: dailyLimitCheck.message || 'Ai atins limita zilnică de email-uri'
      };
    }
    
    
      const sanitizeForEmail = (text) => {
        if (!text) return '';
        return text
          .replace(/[<>"'`]/g, '') 
          .replace(/&(?!amp;|lt;|gt;|quot;|#39;)/g, '&amp;'); 
      };

    // Sanitizează input-urile
    const clientName = sanitizeForEmail(booking.clientName);
    const serviceName = sanitizeForEmail(booking.serviceName);
    const bookingDate = booking.date ? new Date(booking.date).toLocaleDateString('ro-RO') : 'data programată';
    
    // Folosește numele domeniului în producție
    const domain = NODE_ENV === 'production' ? 'dariushreniuc.com' : 'Darius Hreniuc';
    
    // Folosește email de contact configurabil
    const contactEmail = process.env.CONTACT_EMAIL || 'contact@dariushreniuc.com';
    
    // Subiectul email-ului
    const emailSubject = `Rezervare respinsă la ${domain} - ${bookingDate}`;
    
    // Conținut HTML pentru email
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
        
        <h2 style="color: #ff1d46; text-align: center; font-size: 28px; margin-bottom: 25px;">Rezervare Respinsă</h2>
        
        <!-- Salut îmbunătățit -->
        <p style="font-size: 18px; color: #333; margin-bottom: 8px;">
          Bună <strong style="color:rgb(0, 0, 0); font-size: 20px;">${clientName}</strong>, 😔
        </p>
        
        <!-- Mesajul principal îmbunătățit -->
        <p style="font-size: 16px; color: #555; line-height: 1.6; margin-bottom: 25px;">
          <strong style="color:rgb(0, 0, 0);">Ne pare rău</strong>, dar rezervarea ta pentru serviciul 
          <strong style="color:rgb(0, 0, 0);">${serviceName}</strong> din data de 
          <strong style="color: #333;">${bookingDate}</strong> nu a putut fi confirmată.
        </p>
        
        <!-- Cauzele posibile cu design îmbunătățit -->
        <div style="background-color: #fff3cd; padding: 15px; margin: 20px 0; border-radius: 5px; border-left: 4px solid #ffc107;">
          <p style="margin: 0 0 12px 0; color: #856404; font-weight: 600;">
            🤔 Acest lucru se poate datora uneia dintre următoarele cauze:
          </p>
          <ul style="margin: 0; padding-left: 20px; color: #856404; line-height: 1.6;">
            <li style="margin-bottom: 8px;">Programul este deja plin pentru intervalul orar solicitat</li>
            <li style="margin-bottom: 8px;">A apărut o situație neprevăzută</li>
            <li style="margin-bottom: 0;">Serviciul solicitat nu este disponibil la data respectivă</li>
          </ul>
        </div>
        
       
        <div style="background-color: #e3f2fd; padding: 15px; margin: 20px 0; border-radius: 5px; border-left: 4px solid #2196F3;">
          <p style="margin: 0 0 12px 0; color: #1976d2; font-weight: 600;">
            🔄 Ce poți face:
          </p>
          <p style="margin: 0 0 12px 0; color: #1565c0; line-height: 1.6;">
            Te rugăm să <strong>încerci să faci o nouă rezervare</strong> pentru altă dată sau să ne contactezi pentru mai multe informații:
          </p>
          <p style="margin: 8px 0; color: #1565c0;">📧 <strong style="color: #ff1d46;">${contactEmail}</strong></p>
          <p style="margin: 8px 0; color: #1565c0;">📞 <strong style="color: #1565c0;">0748344298</strong></p>
        </div>
        
        
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; text-align: center;">
          <p style="font-size: 16px; color: #333; margin-bottom: 8px;">
            <strong>Mulțumim pentru înțelegere!</strong> 🙏
          </p>
          <p style="font-size: 16px; color:rgb(0, 0, 0); font-weight: bold;">
            Echipa <span style="font-size: 18px;">${domain}</span> ✂️
          </p>
        </div>
        
      </div>
   `;
   
   // Versiunea text pentru clienții de email care nu suportă HTML
   const textContent = `
     REZERVARE RESPINSĂ
      
      Bună ${clientName}, 😔
      
      Ne pare rău, dar rezervarea ta pentru serviciul ${serviceName} din data de ${bookingDate} nu a putut fi confirmată.
      
      🤔 MOTIVELE POSIBILE:
      • Programul este deja plin pentru intervalul orar solicitat
      • A apărut o situație neprevăzută  
      • Serviciul solicitat nu este disponibil la data respectivă
      
      🔄 CE POȚI FACE:
      Te rugăm să încerci să faci o nouă rezervare pentru altă dată sau să ne contactezi pentru mai multe informații:
      
      📧 ${contactEmail}
      📞 0748344298
      
      Mulțumim pentru înțelegere! 🙏
      
      Echipa ${domain} ✂️
   `;
   
   
   try {
     // În modul development, afișează email-urile în loc să le trimită
     if (NODE_ENV === "development") {
       logger.info('EMAIL SIMULAT PENTRU DEZVOLTARE:', { 
         to, 
         subject: emailSubject,
         text: textContent
       });
       return { success: true, messageId: 'MOCK_' + Date.now() };
     }
     
     // Pregătește opțiunile pentru email
     const mailOptions = {
       from: `"${domain} Rezervări" <${EMAIL_FROM}>`,
       to: to,
       subject: emailSubject,
       text: textContent,
       html: htmlContent
     };
     
     // Trimite email-ul
     const info = await transporter.sendMail(mailOptions);
     
     logger.info(`Email de respingere trimis către ${to}, ID: ${info.messageId}`);
     
     // Incrementează contoarele de email-uri la trimiterea cu succes
     await incrementDailyEmailCounter(to);
     if (booking._id) {
       await incrementBookingEmailCounter(booking._id);
     }
     
     return { 
       success: true, 
       messageId: info.messageId 
     };
     
   } catch (emailError) {
     logger.error('Eroare la trimiterea email-ului de respingere:', emailError);
     return { 
       success: false, 
       error: 'Nu s-a putut trimite mesajul de respingere. Te rugăm să încerci mai târziu.',
       emailError: NODE_ENV === 'production' ? 'Eroare la trimiterea email-ului' : emailError.message
     };
   }
   
 } catch (error) {
   logger.error('Eroare în sendBookingRejectionEmail:', error);
   return { 
     success: false, 
     error: 'A apărut o eroare la trimiterea respingerii. Te rugăm să încerci mai târziu.' 
   };
 }
};

/**
* Obține utilizarea email-urilor pentru o rezervare specifică
* @param {string} bookingId - ID-ul rezervării de verificat
* @returns {Promise<Object>} - Detalii despre utilizarea email-urilor pentru rezervare
*/
const getBookingEmailUsage = async (bookingId) => {
 if (!bookingId) {
   return { 
     success: false, 
     error: 'ID-ul rezervării este obligatoriu',
     emailCount: 0,
     limit: BOOKING_EMAIL_LIMIT
   };
 }

 try {
   const booking = await Booking.findById(bookingId);
   
   if (!booking) {
     return { 
       success: false, 
       error: 'Rezervarea nu a fost găsită',
       emailCount: 0,
       limit: BOOKING_EMAIL_LIMIT
     };
   }

   return {
     success: true,
     emailCount: booking.emailCount || 0,
     limit: BOOKING_EMAIL_LIMIT,
     lastEmailSentAt: booking.lastEmailSentAt
   };
 } catch (error) {
   logger.error('Eroare la obținerea utilizării email-urilor pentru rezervare:', error);
   return { 
     success: false, 
     error: 'Eroare la obținerea utilizării email-urilor',
     emailCount: 0,
     limit: BOOKING_EMAIL_LIMIT
   };
 }
};

/**
* Obține utilizarea zilnică de email-uri pentru o adresă de email
* @param {string} email - Adresa de email de verificat
* @returns {Promise<Object>} - Detalii despre utilizarea zilnică de email-uri
*/
const getDailyEmailUsage = async (email) => {
 if (!email) {
   return { 
     success: false, 
     error: 'Adresa de email este obligatorie',
     emailCount: 0,
     limit: DAILY_EMAIL_LIMIT
   };
 }

 try {
   const usage = await EmailUsage.findOrCreateDailyUsage(email);
   return {
     success: true,
     emailCount: usage.count || 0,
     limit: DAILY_EMAIL_LIMIT,
     lastEmailSentAt: usage.lastEmailSentAt
   };
 } catch (error) {
   logger.error('Eroare la obținerea utilizării zilnice de email-uri:', error);
   return { 
     success: false, 
     error: 'Eroare la obținerea utilizării zilnice de email-uri',
     emailCount: 0,
     limit: DAILY_EMAIL_LIMIT
   };
 }
};

/**
* Trimite email de blocare a utilizatorului
* @param {string} to - Adresa de email destinatar
* @param {Object} clientData - Datele clientului
* @param {string} reason - Motivul blocării
* @returns {Promise<Object>} - Obiect rezultat cu statusul și mesaj
*/
const sendUserBlockedEmail = async (to, clientData, reason) => {
 // Validare input
 if (!to) {
   return { success: false, error: 'Adresa de email este obligatorie' };
 }
 
 try {
   // Validează email-ul
   if (!isValidEmail(to)) {
     return {
       success: false,
       error: 'Adresă de email invalidă. Te rugăm să verifici și să încerci din nou.'
     };
   }
   
   // Verifică limita zilnică de email-uri
   const dailyLimitCheck = await checkDailyEmailLimit(to);
   if (!dailyLimitCheck.success) {
     return { 
       success: false, 
       error: dailyLimitCheck.message || 'Ai atins limita zilnică de email-uri'
     };
   }
   
   // Sanitizează input-urile
   const clientName = (clientData.name || '').replace(/[<>&"'`]/g, '');
   const sanitizedReason = (reason || 'Încălcarea regulamentului').replace(/[<>&"'`]/g, '');
   
   // Folosește numele domeniului în producție
   const domain = NODE_ENV === 'production' ? 'dariushreniuc.com' : 'Darius Hreniuc';
   
   // Folosește email de contact configurabil
   const contactEmail = process.env.CONTACT_EMAIL || 'contact@dariushreniuc.com';
   
   // Subiectul email-ului
   const emailSubject = `Contul tău a fost blocat - ${domain}`;
   
   // Conținut HTML pentru email
   const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
      <h2 style="color: #ff1d46; text-align: center; font-size: 28px; margin-bottom: 25px;">Cont Restricționat</h2>
      
      <!-- Salut îmbunătățit -->
      <p style="font-size: 18px; color: #333; margin-bottom: 8px;">
        Bună <strong style="color:rgb(0, 0, 0); font-size: 20px;">${clientName}</strong>, 😔
      </p>
      
      <!-- Mesajul principal îmbunătățit -->
      <p style="font-size: 16px; color: #555; line-height: 1.6; margin-bottom: 25px;">
        Te informăm că <strong style="color:rgb(0, 0, 0);">accesul tău la sistemul de rezervări</strong> de pe 
        <strong style="color:rgb(0, 0, 0);">${domain}</strong> a fost restricționat.
      </p>
      
      <!-- Motivul cu design îmbunătățit -->
      <div style="background-color: #fff3cd; padding: 15px; margin: 20px 0; border-radius: 5px; border-left: 4px solid #ffc107;">
        <p style="margin: 0; color: #856404; font-weight: 600;">
          📋 <strong>Motivul restricționării:</strong>
        </p>
        <p style="margin: 8px 0 0 0; color: #856404; line-height: 1.6;">
          ${sanitizedReason}
        </p>
      </div>
      
      <!-- Informații de contact cu design îmbunătățit -->
      <div style="background-color: #e3f2fd; padding: 15px; margin: 20px 0; border-radius: 5px; border-left: 4px solid #2196F3;">
        <p style="margin: 0 0 12px 0; color: #1976d2; font-weight: 600;">
          💬 <strong>Dorești să discuți această decizie?</strong>
        </p>
        <p style="margin: 0 0 12px 0; color: #1565c0; line-height: 1.6;">
          Dacă consideri că această acțiune a fost efectuată din greșeală sau dorești să discuți situația, te rugăm să ne contactezi:
        </p>
        <p style="margin: 8px 0; color: #1565c0;">📧 <strong style="color: #1565c0;">${contactEmail}</strong></p>
        <p style="margin: 8px 0; color: #1565c0;">📞 <strong style="color: #1565c0;">0748344298</strong></p>
      </div>
      
      <!-- Footer îmbunătățit -->
      <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; text-align: center;">
        <p style="font-size: 16px; color: #333; margin-bottom: 8px;">
          <strong>Mulțumim pentru înțelegere!</strong> 🙏
        </p>
        <p style="font-size: 16px; color:rgb(0, 0, 0); font-weight: bold;">
          Echipa <span style="font-size: 18px;">${domain}</span> ✂️
        </p>
      </div>
    </div>
   `;
   
   // Versiunea text pentru clienții de email care nu suportă HTML
   const textContent = `
        CONT RESTRICȚIONAT
      
      Bună ${clientName}, 😔
      
      Te informăm că accesul tău la sistemul de rezervări de pe ${domain} a fost restricționat.
      
      📋 MOTIVUL RESTRICȚIONĂRII:
      ${sanitizedReason}
      
      💬 DOREȘTI SĂ DISCUȚI ACEASTĂ DECIZIE?
      Dacă consideri că această acțiune a fost efectuată din greșeală sau dorești să discuți situația, te rugăm să ne contactezi:
      
      📧 ${contactEmail}
      📞 0748344298
      
      Mulțumim pentru înțelegere! 🙏
      
      Echipa ${domain} ✂️
   `;
   

   try {
     // În modul development, afișează email-urile în loc să le trimită
     if (NODE_ENV === "development") {
       logger.info('EMAIL SIMULAT PENTRU DEZVOLTARE:', { 
         to, 
         subject: emailSubject,
         text: textContent
       });
       return { success: true, messageId: 'MOCK_' + Date.now() };
     }
     
     // Pregătește opțiunile pentru email
     const mailOptions = {
       from: `"${domain} Rezervări" <${EMAIL_FROM}>`,
       to: to,
       subject: emailSubject,
       text: textContent,
       html: htmlContent
     };
     
     // Trimite email-ul
     const info = await transporter.sendMail(mailOptions);
     
     logger.info(`Email de blocare cont trimis către ${to}, ID: ${info.messageId}`);
     
     // Incrementează contoarele de email-uri la trimiterea cu succes
     await incrementDailyEmailCounter(to);
     
     return { 
       success: true, 
       messageId: info.messageId 
     };
     
   } catch (emailError) {
     logger.error('Eroare la trimiterea email-ului de blocare cont:', emailError);
     return { 
       success: false, 
       error: 'Nu s-a putut trimite mesajul de blocare cont. Te rugăm să încerci mai târziu.',
       emailError: NODE_ENV === 'production' ? 'Eroare la trimiterea email-ului' : emailError.message
     };
   }
   
 } catch (error) {
   logger.error('Eroare în sendUserBlockedEmail:', error);
   return { 
     success: false, 
     error: 'A apărut o eroare la trimiterea notificării de blocare cont. Te rugăm să încerci mai târziu.' 
   };
 }
};

module.exports = {
 sendVerificationEmail,
 sendBookingConfirmationEmail,
 sendBookingRejectionEmail,
 sendUserBlockedEmail,
 getBookingEmailUsage,
 getDailyEmailUsage,
 checkTimeBetweenEmails,
 isValidEmail,
 DAILY_EMAIL_LIMIT,
 BOOKING_EMAIL_LIMIT,
 MIN_SECONDS_BETWEEN_EMAILS
};