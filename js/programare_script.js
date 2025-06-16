// js/programare_script.js

// Sistem de logging îmbunătățit pentru frontend
const isProd = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
const logger = {
    info: () => {},
    warn: () => {},
    error: () => {}
};

// Elemente DOM
const step1 = document.getElementById('step1');
const step2 = document.getElementById('step2');
const step3 = document.getElementById('step3');
const step4 = document.getElementById('step4');
const oreDisponibile = document.getElementById('oreDisponibile');
const verificationPopup = document.getElementById('verificationPopup');
const sundayMessage = document.getElementById('sundayMessage');

// Butoane
const btnStep1 = document.getElementById('btnStep1');
const btnStep2 = document.getElementById('btnStep2');
const btnStep3 = document.getElementById('btnStep3');
const btnVerify = document.getElementById('btnVerify');
const btnBackToStep1 = document.getElementById('btnBackToStep1');
const btnBackToStep2 = document.getElementById('btnBackToStep2');
const retrimiteCod = document.getElementById('retrimiteCod');
const closeVerificationPopup = document.getElementById('closeVerificationPopup');

// Inputs
const selectServiciu = document.getElementById('serviciu');
const dataProgramare = document.getElementById('dataProgramare');
const numeCompletInput = document.getElementById('numeComplet');
const telefonInput = document.getElementById('telefon');
const emailInput = document.getElementById('email');
const countryCodeSelect = document.getElementById('countryCode');
const codVerificareInput = document.getElementById('codVerificare');

// Variabile globale pentru stocare date
let selectedServiceId = null;
let selectedServiceName = null;
let selectedDate = null;
let selectedTime = null;
let numeComplet = null;
let telefon = null;
let email = null;
let countryCode = null;
let bookingId = null;

// Variabile pentru timer
let countdownInterval;
let secondsLeft = 0;
let canResend = true;

// API URL - detectează automat URL-ul în funcție de mediu
const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:5000/api'
    : window.location.protocol + '//' + window.location.hostname + '/api';

// Funcție pentru crearea și afișarea notificărilor moderne
function showNotification(message, type = 'error') {
    // Eliminează notificările existente
    const existingNotifications = document.querySelectorAll('.notification');
    existingNotifications.forEach(notification => {
        notification.remove();
    });

    // Creează notificarea
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    
    // Selectează iconul în funcție de tip
    let icon;
    switch(type) {
        case 'success':
            icon = '✓';
            break;
        case 'info':
            icon = 'ℹ';
            break;
        case 'warning':
            icon = '⚠';
            break;
        case 'error':
        default:
            icon = '⚠';
            break;
    }

    notification.innerHTML = `
    <div class="icon">${sanitizeInput(icon)}</div>
    <div class="content">${sanitizeInput(message)}</div>
    <button class="close-btn">×</button>
`;

    // Adaugă notificarea la pagină
    document.body.appendChild(notification);

    // Afișează notificarea cu animație
    setTimeout(() => {
        notification.classList.add('show');
    }, 100);

    // Elimină notificarea după 7 secunde pentru mesajele mai lungi
    const timeout = message.length > 100 ? 7000 : 5000;
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, 300);
    }, timeout);
}

// Funcție pentru sanitizarea input-urilor pentru a preveni XSS
function sanitizeInput(input) {
    // Verificări de securitate stricte
    if (input === null || input === undefined) {
        return '';
    }
    
    // Forțează conversie la string pentru a preveni atacurile prin obiecte
    let str;
    try {
        str = String(input);
    } catch (error) {
        logger.error('Error converting input to string:', error);
        return '';
    }
    
    // Limitează lungimea pentru a preveni atacurile DoS
    if (str.length > 10000) {
        logger.warn('Input too long, truncating for security');
        str = str.substring(0, 10000);
    }
    
    // Detectează și blochează payload-uri XSS comune
    const xssPatterns = [
        /<script[^>]*>.*?<\/script>/gi,
        /<iframe[^>]*>.*?<\/iframe>/gi,
        /<object[^>]*>.*?<\/object>/gi,
        /<embed[^>]*>.*?<\/embed>/gi,
        /<link[^>]*>/gi,
        /<meta[^>]*>/gi,
        /javascript:/gi,
        /vbscript:/gi,
        /on\w+\s*=/gi,
        /expression\s*\(/gi,
        /data:text\/html/gi,
        /data:application\/x-javascript/gi,
        /<svg[^>]*>.*?<\/svg>/gi
    ];
    
    // Verifică pentru payload-uri malițioase
    for (const pattern of xssPatterns) {
        if (pattern.test(str)) {
            logger.warn('XSS attempt detected and blocked:', str.substring(0, 100));
            return ''; // Returnează string gol pentru input malițios
        }
    }
    
    // Elimină caractere de control și Unicode suspicioase
    str = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    
    // Elimină secvențe de encoding HTML/URL care pot fi folosite pentru bypass
    str = str.replace(/&#x?[0-9a-fA-F]+;/g, '');
    str = str.replace(/%[0-9a-fA-F]{2}/g, '');
    
    // Sanitizează folosind metoda ta existentă (îmbunătățită)
    const div = document.createElement('div');
    div.textContent = str;
    let sanitized = div.innerHTML;
    
    // Verificare finală: dacă rezultatul conține încă HTML suspicioase, întoarce gol
    if (/<[^>]+>/.test(sanitized)) {
        // Nu ar trebui să se întâmple niciodată cu textContent, dar extra siguranță
        logger.warn('HTML detected after sanitization, blocking');
        return '';
    }
    
    return sanitized;
}

// Funcție pentru validarea input-urilor
function validateInput(type, value) {
    if (!value) return false;
    
    switch(type) {
        case 'nume':
            // Nume între 3 și 50 caractere, doar litere, spații și cratime
            return /^[A-Za-zĂăÂâÎîȘșȚț\s-]{3,50}$/.test(value) && !/\s\s/.test(value);
        case 'telefon':
            // Format număr de telefon (mai permisiv pentru numere internaționale)
            return /^[0-9]{4,15}$/.test(value.replace(/\s+|-/g, ''));
        case 'email':
            // Validare email
            return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value);
        case 'cod':
            // Exact 6 cifre
            return /^\d{6}$/.test(value);
        default:
            return true;
    }
}


// Funcție pentru suspendarea rezervării
async function suspendReservation() {
    if (!bookingId) {
        logger.warn('Nu există bookingId pentru suspendare');
        return;
    }

    try {
        logger.info('Suspendăm rezervarea:', bookingId);
        
        // Trimite cerere către server pentru a suspenda rezervarea
        const response = await fetch(`${API_URL}/bookings/${bookingId}/suspend`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            }
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            // Rezervarea a fost suspendată cu succes
            bookingId = null;
            resetForm();
            showNotification('Rezervarea a fost suspendată. Intervalul orar este din nou disponibil.', 'info');
        } else {
            // Eroare la suspendare
            logger.error('Eroare la suspendarea rezervării:', data.message);
            bookingId = null;
            resetForm();
            showNotification('Rezervarea a fost anulată local.', 'info');
        }
        
    } catch (error) {
        logger.error('Eroare la suspendarea rezervării:', error);
        // În caz de eroare de rețea, resetează totuși local
        bookingId = null;
        resetForm();
        showNotification('Rezervarea a fost anulată local.', 'info');
    }
}

// Funcție pentru resetarea formularului
function resetForm() {
    // Resetează toate variabilele globale
    selectedServiceId = null;
    selectedServiceName = null;
    selectedDate = null;
    selectedTime = null;
    numeComplet = null;
    telefon = null;
    email = null;
    countryCode = null;
    bookingId = null;
    
    // Resetează inputurile
    selectServiciu.value = '';
    dataProgramare.value = '';
    numeCompletInput.value = '';
    telefonInput.value = '';
    emailInput.value = '';
    codVerificareInput.value = '';
    countryCodeSelect.selectedIndex = 0;
    
    // Curăță orele disponibile
    oreDisponibile.innerHTML = '';
    
    // Oprește timer-ul dacă rulează
    clearInterval(countdownInterval);
    
    // Ascunde mesajul de duminică dacă este afișat
    sundayMessage.style.display = 'none';
    
    // Reactiveză butonul step1 dacă era dezactivat
    btnStep1.disabled = false;
    btnStep1.style.opacity = '1';
}

// Event listener pentru butonul X de închidere a popup-ului
closeVerificationPopup.addEventListener('click', function() {
    // Închide popup-ul
    verificationPopup.style.display = 'none';
    
    // Suspendă rezervarea
    suspendReservation();
    
    // Revine la pasul 1
    step3.classList.remove('active');
    step1.classList.add('active');
});

// Event listener pentru închiderea popup-ului cu ESC
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape' && verificationPopup.style.display === 'flex') {
        // Închide popup-ul
        verificationPopup.style.display = 'none';
        
        // Suspendă rezervarea
        suspendReservation();
        
        // Revine la pasul 1
        step3.classList.remove('active');
        step1.classList.add('active');
    }
});

// Funcție pentru a calcula data minimă permisă
function calculateMinDate() {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinutes = now.getMinutes();
    const currentTime = currentHour * 60 + currentMinutes;
    
    const PROGRAM_LUCRU = {
        weekdays: {
            start: 10 * 60,
            end: 19 * 60
        },
        saturday: {
            start: 10 * 60,
            end: 13 * 60
        }
    };
    
    const dayOfWeek = now.getDay();
    let canSelectToday = false;
    
    if (dayOfWeek === 0) {
        canSelectToday = false;
    } else if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        canSelectToday = currentTime < PROGRAM_LUCRU.weekdays.end;
    } else if (dayOfWeek === 6) {
        canSelectToday = currentTime < PROGRAM_LUCRU.saturday.end;
    }
    
    let minDate = new Date(now);
    if (!canSelectToday) {
        minDate.setDate(now.getDate() + 1);
    }
    
    return minDate.toISOString().split('T')[0];
}

const minDate = calculateMinDate();
dataProgramare.setAttribute('min', minDate);

// Verificare dacă data selectată este duminică
dataProgramare.addEventListener('change', async function() {
    const selectedDate = new Date(this.value);
    const dayOfWeek = selectedDate.getDay(); 
    
    if (dayOfWeek === 0) { // Duminică
        sundayMessage.style.display = 'block';
        btnStep1.disabled = true;
        btnStep1.style.opacity = '0.5';
        return;
    }
    
    // Verifică dacă data este blocată
    try {
        const response = await fetch(`${API_URL}/check-blocked-date?date=${this.value}`, {
            method: 'GET',
            headers: {
                'X-Requested-With': 'XMLHttpRequest'
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.success && data.isBlocked) {
                // Afișează mesajul personalizat pentru data blocată
                sundayMessage.innerHTML = `
                        <h3>Zi Indisponibilă</h3>
                        <p>${sanitizeInput(data.reason)}</p>
                        <p>Te rugăm să selectezi o altă dată pentru programarea ta.</p>
                        <p>Program de lucru: Luni-Vineri (10:00-19:00), Sâmbătă (10:00-13:00)</p>
                    `;
                sundayMessage.style.display = 'block';
                btnStep1.disabled = true;
                btnStep1.style.opacity = '0.5';
                return;
            }
        }
    } catch (error) {
        logger.error('Eroare la verificarea datei blocate:', error);
        // Continuă normal dacă verificarea eșuează
    }
    
    // Data este OK - ascunde orice mesaje și permite continuarea
    sundayMessage.style.display = 'none';
    btnStep1.disabled = false;
    btnStep1.style.opacity = '1';
});



dataProgramare.addEventListener('input', function() {
    const selectedDate = new Date(this.value);
    const currentDate = new Date();
    
    // Resetează timpul pentru comparație corectă
    currentDate.setHours(0, 0, 0, 0);
    selectedDate.setHours(0, 0, 0, 0);
    
    if (selectedDate < currentDate) {
        showNotification('Nu poți selecta o dată din trecut!', 'error');
        this.value = ''; 
        sundayMessage.style.display = 'none';
        btnStep1.disabled = false;
        btnStep1.style.opacity = '1';
        return;
    }
});

// Event listeners pentru butoane înapoi
btnBackToStep1.addEventListener('click', async function() {
    // Refresh orele disponibile când se revine de la pasul 2
    if (selectedServiceId && selectedDate) {
        logger.info('Reîncărcăm orele disponibile după revenirea la pasul 1...');
        await incarcaOreDisponibile();
    }
    
    step2.classList.remove('active');
    step1.classList.add('active');
});

btnBackToStep2.addEventListener('click', function() {
    step3.classList.remove('active');
    step2.classList.add('active');
});

// Funcție pentru a actualiza countdown-ul
function updateCountdown() {
    const countdownElement = document.getElementById('countdown');
    
    if (secondsLeft <= 0) {
        clearInterval(countdownInterval);
        countdownElement.style.display = 'none';
        document.getElementById('retrimiteCod').style.display = 'inline-block';
        canResend = true;
        return;
    }
    
    countdownElement.textContent = `Poți retrimite codul în ${secondsLeft} secunde.`;
    secondsLeft--;
}

// Funcție pentru a începe countdown-ul
function startCountdown(seconds) {
    secondsLeft = seconds;
    clearInterval(countdownInterval);
    document.getElementById('countdown').style.display = 'block';
    document.getElementById('retrimiteCod').style.display = 'none';
    canResend = false;
    updateCountdown();
    countdownInterval = setInterval(updateCountdown, 1000);
}

// Încarcă orele disponibile de la server
async function incarcaOreDisponibile() {
    try {
        logger.info(`Încărcăm orele disponibile pentru: serviceId=${selectedServiceId}, date=${selectedDate}`);
        oreDisponibile.innerHTML = '<p style="color: white; text-align: center;">Se încarcă orele disponibile...</p>';
        
        const response = await fetch(`${API_URL}/available-time-slots`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify({
                serviceId: parseInt(selectedServiceId),
                date: selectedDate
            })
        });
        
        logger.info('Status răspuns de la server:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            logger.error(`Eroare server (${response.status}):`, errorText);
            throw new Error(`Server responded with ${response.status}: ${errorText}`);
        }
        
        const data = await response.json();
        logger.info('Răspuns de la server:', data);
        
       if (data.success && data.timeSlots && data.timeSlots.length > 0) {
            // Șterge orele existente
            oreDisponibile.innerHTML = '';
            
            
            data.timeSlots.forEach(slot => {
                const safeSlot = sanitizeInput(slot);
                const label = document.createElement('label');
                label.innerHTML = `
                    <input type="radio" name="ora" value="${safeSlot}">
                    <span>${safeSlot}</span>
                `;
                oreDisponibile.appendChild(label);
            });
        logger.info(`S-au încărcat ${data.timeSlots.length} ore disponibile`);
        } else {
            // Afișează mesajul personalizat de la server
            const message = data.message || 'Nu există ore disponibile pentru data selectată.';
            
            // Verifică dacă este un mesaj de zi blocată
            if (message.includes('Suntem închiși în') || message.includes('indisponibile în')) {
               oreDisponibile.innerHTML = `
                    <div style="background-color: #1a1a1a; border-left: 4px solid #ff9800; padding: 15px; border-radius: 4px; text-align: center; color: white;">
                        <h3 style="color: #ff9800; margin-bottom: 10px; font-size: 16px;"> Zi Indisponibilă</h3>
                        <p style="margin-bottom: 10px; line-height: 1.5;">${sanitizeInput(message)}</p>
                        <p style="margin: 0; color: #ccc; font-size: 14px;">Program de lucru: Luni-Vineri (10:00-19:00), Sâmbătă (10:00-13:00)</p>
                    </div>
                `;
            } else {
                oreDisponibile.innerHTML = `<p style="color: white; text-align: center;">${sanitizeInput(message)}</p>`;
            }
            
            logger.info('Nu există ore disponibile pentru data selectată');
        }
    } catch (error) {
        logger.error('Eroare la încărcarea orelor disponibile:', error);
        oreDisponibile.innerHTML = `
            <div style="background-color: #1a1a1a; border-left: 4px solid #f44336; padding: 15px; border-radius: 4px; text-align: center; color: white;">
                <h3 style="color: #f44336; margin-bottom: 10px; font-size: 16px;"> Eroare de Conectare</h3>
                <p style="margin-bottom: 10px; line-height: 1.5;">A apărut o eroare la încărcarea orelor disponibile.</p>
                <p style="margin: 0; color: #ccc; font-size: 14px;">Te rugăm să încerci din nou sau să reîmprospătezi pagina.</p>
            </div>
        `;
    }
}

async function verifyTimeSlotStillAvailable(selectedTime) {
    if (!selectedDate || !selectedServiceId || !selectedTime) {
        return false;
    }
    
    try {
        logger.info(`🔍 Verificăm dacă ora ${selectedTime} mai este disponibilă...`);
        
        const response = await fetch(`${API_URL}/available-time-slots`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify({
                serviceId: parseInt(selectedServiceId),
                date: selectedDate
            })
        });
        
        if (!response.ok) {
            logger.error('Eroare la verificarea orei:', response.status);
            return false;
        }
        
        const data = await response.json();
        
        // Verifică dacă ora selectată mai este în lista de ore disponibile
        const isStillAvailable = data.success && data.timeSlots && data.timeSlots.includes(selectedTime);
        
        if (isStillAvailable) {
            logger.info(` Ora ${selectedTime} este încă disponibilă`);
        } else {
            logger.warn(` Ora ${selectedTime} nu mai este disponibilă`);
        }
        
        return isStillAvailable;
        
    } catch (error) {
        logger.error('Eroare la verificarea orei:', error);
        return false;
    }
}

// Pasul 1 -> Pasul 2
btnStep1.addEventListener('click', async function () {
    if (!selectServiciu.value || !dataProgramare.value) {
        showNotification('Te rugăm să selectezi un serviciu și o dată!', 'error');
        return;
    }
    
    // Verifică dacă data selectată este duminică
    const selectedDateObj = new Date(dataProgramare.value);
    const dayOfWeek = selectedDateObj.getDay(); // 0 = Duminică
    
    if (dayOfWeek === 0) {
        sundayMessage.style.display = 'block';
        return; // Nu permite continuarea dacă este duminică
    }

    // Stocare date selecție
    selectedServiceId = selectServiciu.value;
    selectedServiceName = selectServiciu.options[selectServiciu.selectedIndex].text;
    selectedDate = dataProgramare.value;

    logger.info('Serviciu selectat:', selectedServiceId, selectedServiceName);
    logger.info('Dată selectată:', selectedDate);

    try {
        // Încarcă orele disponibile
        await incarcaOreDisponibile();
        
        // Tranziție la pasul 2
        step1.classList.remove('active');
        step2.classList.add('active');
    } catch (error) {
        logger.error('Eroare la pasul 1:', error);
        showNotification('A apărut o eroare. Te rugăm să încerci din nou.', 'error');
    }
});

// Pasul 2 -> Pasul 3
btnStep2.addEventListener('click', async function () {
    const oreInputs = document.querySelectorAll('#oreDisponibile input[name="ora"]');
    let oraSelectata = null;
    
    oreInputs.forEach((radio) => {
        if (radio.checked) {
            oraSelectata = radio.value;
        }
    });

    if (!oraSelectata) {
        showNotification('Te rugăm să selectezi o oră!', 'error');
        return;
    }

    // VERIFICARE NOUĂ: Confirmă că ora mai este disponibilă
    try {
        // Afișează loading pentru verificare
        const loadingNotification = showNotification('Verificăm disponibilitatea orei selectate...', 'info');
        
        const isStillAvailable = await verifyTimeSlotStillAvailable(oraSelectata);
        
        if (!isStillAvailable) {
            showNotification(`Ora ${oraSelectata} nu mai este disponibilă. Orele au fost actualizate.`, 'warning');
            
            // Reîncarcă orele disponibile
            logger.info('🔄 Reîncărcăm orele disponibile...');
            await incarcaOreDisponibile();
            return;
        }
        
        // Ora este încă disponibilă, continuă normal
        selectedTime = oraSelectata;
        logger.info('Oră selectată și verificată:', selectedTime);

        try {
            logger.info('Trimitem cerere pentru rezervare inițială...');
            // Înregistrăm rezervarea inițială
            const response = await fetch(`${API_URL}/bookings`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify({
                    serviceId: parseInt(selectedServiceId),
                    date: selectedDate,
                    time: selectedTime
                })
            });

            const data = await response.json();
            logger.info('Răspuns rezervare inițială:', data);
            
            if (data.success) {
                // TOTUL OK - Merge la pasul 3
                step2.classList.remove('active');
                step3.classList.add('active');
                showNotification('Ora rezervată cu succes! Completează datele pentru confirmare.', 'success');
            } else {
                // EROARE - Ora nu mai e disponibilă (admin a blocat SAU alt client a rezervat)
                
                let errorMessage = data.message || 'Ora selectată nu mai este disponibilă';
                let errorType = 'error';
                
                if (data.message) {
                    if (data.message.includes('blocat') || data.message.includes('închis') || data.message.includes('indisponibil')) {
                        errorMessage = `${data.message} Te rugăm să selectezi altă oră.`;
                        errorType = 'warning';
                        logger.info('🔒 Admin a blocat ora - refreshez...');
                    } else if (data.message.includes('nu mai este disponibil') || data.message.includes('rezervat de alt client')) {
                        errorMessage = `${data.message}`;
                        errorType = 'info';
                        logger.info('👥 Alt client a rezervat ora - refreshez...');
                    } else {
                        logger.info('❓ Eroare necunoscută - refreshez...');
                    }
                }
                
                showNotification(errorMessage, errorType);
                
                // REFRESHEAZĂ orele în toate cazurile de eroare
                logger.info('🔄 Refreshez orele din cauza conflictului...');
                await incarcaOreDisponibile();
            }
        } catch (error) {
            logger.error('Eroare la pasul 2:', error);
            
            let networkErrorMessage = 'A apărut o eroare la rezervarea orei.';
            if (error.message.includes('fetch')) {
                networkErrorMessage = 'Probleme de conexiune. Verifică internetul și încearcă din nou.';
            } else if (error.message.includes('timeout')) {
                networkErrorMessage = 'Cererea a expirat. Te rugăm să încerci din nou.';
            }
            
            showNotification(networkErrorMessage, 'error');
            
            // REFRESHEAZĂ orele și în caz de eroare de rețea
            logger.info('🔄 Refreshez orele din cauza erorii de rețea...');
            await incarcaOreDisponibile();
        }
        
    } catch (verificationError) {
        logger.error('Eroare la verificarea orei:', verificationError);
        showNotification('Nu s-a putut verifica disponibilitatea orei. Te rugăm să încerci din nou.', 'error');
    }
});

// Pasul 3 -> Verificare prin Email
btnStep3.addEventListener('click', async function () {
    numeComplet = numeCompletInput.value.trim();
    telefon = telefonInput.value.trim();
    email = emailInput.value.trim();
    countryCode = countryCodeSelect.value;

    if (!numeComplet || !telefon || !email) {
        showNotification('Te rugăm să introduci numele, telefonul și emailul!', 'error');
        return;
    }

    // Validare nume
    if (!validateInput('nume', numeComplet)) {
        showNotification('Numele trebuie să conțină doar litere, spații și cratime, între 3 și 50 caractere!', 'error');
        return;
    }
    
    // Validare email
    if (!validateInput('email', email)) {
        showNotification('Te rugăm să introduci o adresă de email validă', 'error');
        return;
    }
    
    // Validare telefon - se face pe valoarea fără prefixul țării
    if (!validateInput('telefon', telefon)) {
        showNotification('Vă rugăm să introduceți un număr de telefon valid', 'error');
        return;
    }

    try {
        logger.info('Trimitem cerere pentru completarea rezervării...');
        // Completăm rezervarea cu datele clientului și trimitem email de verificare
        const response = await fetch(`${API_URL}/bookings/complete`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest' // Protecție CSRF suplimentară
            },
            body: JSON.stringify({
                clientName: numeComplet,
                phoneNumber: telefon,
                email: email, // Adăugăm emailul în request
                countryCode: countryCode, // Adăugăm codul de țară
                serviceId: parseInt(selectedServiceId),
                date: selectedDate,
                time: selectedTime
            })
        });

        const data = await response.json();
        logger.info('Răspuns completare rezervare:', data);
        
        if (data.success) {
            bookingId = data.bookingId;
            logger.info('ID Rezervare:', bookingId);
            
            // Resetează countdown-ul și starea butonului de retrimitere
            document.getElementById('retrimiteCod').style.display = 'inline-block';
            document.getElementById('countdown').style.display = 'none';
            clearInterval(countdownInterval);
            canResend = true;
            
            // Resetează inputul pentru cod de verificare
            codVerificareInput.value = '';
            
            // Afișare pop-up verificare email
            verificationPopup.style.display = 'flex';
            
            // Informează utilizatorul despre codul trimis
            showNotification('Un cod de verificare a fost trimis la adresa ta de email.', 'success');
        } else {
            showNotification(data.message || 'A apărut o eroare la trimiterea codului de verificare.', 'error');
        }
    } catch (error) {
        logger.error('Eroare la pasul 3:', error);
        showNotification('A apărut o eroare la trimiterea codului de verificare. Te rugăm să încerci din nou.', 'error');
    }
});

// Verifică codul de email
btnVerify.addEventListener('click', async function () {
    const codVerificare = codVerificareInput.value.trim();

    if (!codVerificare) {
        showNotification('Te rugăm să introduci codul de verificare!', 'error');
        return;
    }
    
    // Validare cod de verificare
    if (!validateInput('cod', codVerificare)) {
        showNotification('Codul de verificare trebuie să conțină exact 6 cifre!', 'error');
        return;
    }

    try {
        logger.info('Trimitem cerere pentru verificarea codului...');
        // Verificăm codul cu backend-ul
       const response = await fetch(`${API_URL}/bookings/verify`, {
           method: 'POST',
           headers: {
               'Content-Type': 'application/json',
               'X-Requested-With': 'XMLHttpRequest' // Protecție CSRF suplimentară
           },
           body: JSON.stringify({
               bookingId: bookingId,
               code: codVerificare
           })
       });

       const data = await response.json();
       logger.info('Răspuns verificare cod:', data);
       
       if (data.success) {
           // Tranziție la ultima pagină
           verificationPopup.style.display = 'none';
           step3.classList.remove('active');
           step4.classList.add('active');
           
           // Datele rezervării complete
           const bookingData = {
               serviciu: selectedServiceName,
               data: selectedDate,
               ora: selectedTime,
               numeComplet: numeComplet,
               telefon: countryCode + telefon,
               email: email
           };
           
           logger.info('Rezervare confirmată:', bookingData);
       } else {
           showNotification(data.message || 'Codul de verificare este incorect!', 'error');
       }
   } catch (error) {
       logger.error('Eroare la verificarea codului:', error);
       showNotification('A apărut o eroare la verificarea codului. Te rugăm să încerci din nou.', 'error');
   }
});

// Retrimite cod
retrimiteCod.addEventListener('click', async function (event) {
   event.preventDefault();
   
   if (!bookingId || !canResend) {
       return;
   }

   try {
       logger.info('Trimitem cerere pentru retrimitere cod...');
       // Solicităm serverului să retrimită codul
       const response = await fetch(`${API_URL}/bookings/resend-code`, {
           method: 'POST',
           headers: {
               'Content-Type': 'application/json',
               'X-Requested-With': 'XMLHttpRequest' // Protecție CSRF suplimentară
           },
           body: JSON.stringify({
               bookingId: bookingId
           })
       });

       const data = await response.json();
       logger.info('Răspuns retrimitere cod:', data);
       
       if (data.success) {
           showNotification('Un nou cod de verificare a fost trimis la adresa ta de email.', 'success');
           
           // Începe countdownul de 60 de secunde
           startCountdown(60);
       } else {
           if (data.message && data.message.includes('limita de email-uri pentru această rezervare')) {
               document.getElementById('retrimiteCod').style.display = 'none';
               document.getElementById('countdown').textContent = 'Ai atins limita de 5 email-uri pentru această rezervare.';
               document.getElementById('countdown').style.display = 'block';
               canResend = false;
           } else if (data.message && data.message.includes('limita zilnică de email-uri')) {
               document.getElementById('retrimiteCod').style.display = 'none';
               document.getElementById('countdown').textContent = 'Ai atins limita zilnică de 20 email-uri.';
               document.getElementById('countdown').style.display = 'block';
               canResend = false;
           } else {
               showNotification('Nu s-a putut retrimite codul de verificare.', 'error');
           }
       }
   } catch (error) {
       logger.error('Eroare la retrimiterea codului:', error);
       showNotification('A apărut o eroare la retrimiterea codului. Te rugăm să încerci din nou.', 'error');
   }
});

// Protecție împotriva CSRF
document.addEventListener('DOMContentLoaded', function() {
   // Verificăm dacă pagina este încărcată în iframe (protecție clickjacking)
   if (window.self !== window.top) {
       window.top.location = window.self.location;
   }
   
   // Pre-completare câmpuri din localStorage dacă există
   const savedName = localStorage.getItem('numeComplet');
   const savedEmail = localStorage.getItem('email');
   const savedPhone = localStorage.getItem('telefon');
   const savedCountryCode = localStorage.getItem('countryCode');
   
   if (savedName) numeCompletInput.value = savedName;
   if (savedEmail) emailInput.value = savedEmail;
   if (savedPhone) telefonInput.value = savedPhone;
   if (savedCountryCode) {
       // Găsește și selectează option-ul corespunzător
       const options = countryCodeSelect.options;
       for (let i = 0; i < options.length; i++) {
           if (options[i].value === savedCountryCode) {
               countryCodeSelect.selectedIndex = i;
               break;
           }
       }
   }
   
   // La pas 3 - salvează datele clientului pentru utilizări viitoare
   btnStep3.addEventListener('click', function() {
       if (numeCompletInput.value && emailInput.value && telefonInput.value) {
           localStorage.setItem('numeComplet', numeCompletInput.value);
           localStorage.setItem('email', emailInput.value);
           localStorage.setItem('telefon', telefonInput.value);
           localStorage.setItem('countryCode', countryCodeSelect.value);
       }
   });
});