// admin-dashboard_script.js - VERSIUNE OPTIMIZATĂ

// Sistem de logging îmbunătățit pentru frontend
const isProd = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
const logger = {
    info: () => {},
    warn: () => {},
    error: () => {}
};

// Detectare mediu și configurare URL API
const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:5000/api'
    : window.location.protocol + '//' + window.location.hostname + '/api';

// Cache DOM pentru performanță optimă
const domCache = {
    // Containere principale
    pendingCards: null,
    confirmedCards: null,
    loadingOverlay: null,
    toast: null,
    
    // Controale
    datePicker: null,
    logoutBtn: null,
    refreshPendingBtn: null,
    refreshConfirmedBtn: null,
    todayBtn: null,
    manualCleanupBtn: null,
    blockDateBtn: null,
    viewBlockedDatesBtn: null,
    
    // Popup-uri
    blockPopup: null,
    blockDatePopup: null,
    viewBlockedDatesPopup: null,
    
    // Butoane popup
    blockPopupClose: null,
    blockCancelBtn: null,
    blockConfirmBtn: null,
    blockDateClose: null,
    blockDateCancel: null,
    blockDateConfirm: null,
    viewBlockedClose: null,
    viewBlockedCancel: null,
    
    // Input-uri
    blockReasonInput: null,
    blockDateInput: null,
    fullDayCheckbox: null,
    hoursSelectionDiv: null,
    hoursContainer: null,
    blockedDatesContent: null,
    
    init() {
        // Containere principale
        this.pendingCards = document.getElementById('pendingReservationsCards');
        this.confirmedCards = document.getElementById('confirmedReservationsCards');
        this.loadingOverlay = document.getElementById('loadingOverlay');
        this.toast = document.getElementById('toast');
        
        // Controale
        this.datePicker = document.getElementById('datePicker');
        this.logoutBtn = document.getElementById('logoutBtn');
        this.refreshPendingBtn = document.getElementById('refreshPendingBtn');
        this.refreshConfirmedBtn = document.getElementById('refreshConfirmedBtn');
        this.todayBtn = document.getElementById('todayBtn');
        this.manualCleanupBtn = document.getElementById('manualCleanupBtn');
        this.blockDateBtn = document.getElementById('blockDateBtn');
        this.viewBlockedDatesBtn = document.getElementById('viewBlockedDatesBtn');
        
        // Popup-uri
        this.blockPopup = document.getElementById('blockPopup');
        this.blockDatePopup = document.getElementById('blockDatePopup');
        this.viewBlockedDatesPopup = document.getElementById('viewBlockedDatesPopup');
        
        // Butoane popup
        this.blockPopupClose = document.getElementById('blockPopupClose');
        this.blockCancelBtn = document.getElementById('blockCancelBtn');
        this.blockConfirmBtn = document.getElementById('blockConfirmBtn');
        this.blockDateClose = document.getElementById('blockDateClose');
        this.blockDateCancel = document.getElementById('blockDateCancel');
        this.blockDateConfirm = document.getElementById('blockDateConfirm');
        this.viewBlockedClose = document.getElementById('viewBlockedClose');
        this.viewBlockedCancel = document.getElementById('viewBlockedCancel');
        
        // Input-uri
        this.blockReasonInput = document.getElementById('blockReasonInput');
        this.blockDateInput = document.getElementById('blockDateInput');
        this.fullDayCheckbox = document.getElementById('fullDayBlock');
        this.hoursSelectionDiv = document.getElementById('hoursSelection');
        this.hoursContainer = document.getElementById('hoursContainer');
        this.blockedDatesContent = document.getElementById('blockedDatesContent');
    }
};

// Variabile globale pentru block functionality
let currentBlockingBookingId = null;
let currentBlockDatePopupMode = 'block';
let blockedDatesCache = [];

// Pool de debouncing pentru operații costisitoare
const debouncePool = new Map();

function debounce(key, func, wait) {
    if (debouncePool.has(key)) {
        clearTimeout(debouncePool.get(key));
    }
    
    const timeout = setTimeout(() => {
        func();
        debouncePool.delete(key);
    }, wait);
    
    debouncePool.set(key, timeout);
}

// Pool de notificări optimizat
const notificationPool = {
    current: null,
    timeout: null,
    
    show(message, isSuccess = true) {
        // Elimină notificarea existentă
        if (this.current) {
            this.current.remove();
            this.current = null;
        }
        
        if (this.timeout) {
            clearTimeout(this.timeout);
            this.timeout = null;
        }

        if (!domCache.toast) return;

        domCache.toast.textContent = message;
        domCache.toast.className = 'toast ' + (isSuccess ? 'success' : 'error');
        domCache.toast.style.display = 'block';
        this.current = domCache.toast;
        
        this.timeout = setTimeout(() => {
            if (domCache.toast) {
                domCache.toast.style.display = 'none';
            }
            this.current = null;
        }, 3000);
    }
};

// Utilitare optimizate
function sanitizeHtml(input) {
    if (input === null || input === undefined) {
        return '';
    }
    
    let str;
    try {
        str = String(input);
    } catch (error) {
        logger.error('Error converting input to string:', error);
        return '';
    }
    
    if (str.length > 10000) {
        logger.warn('Input too long, truncating for security');
        str = str.substring(0, 10000);
    }
    
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
    
    for (const pattern of xssPatterns) {
        if (pattern.test(str)) {
            logger.warn('XSS attempt detected and blocked:', str.substring(0, 100));
            return '';
        }
    }
    
    str = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    str = str.replace(/&#x?[0-9a-fA-F]+;/g, '');
    str = str.replace(/%[0-9a-fA-F]{2}/g, '');
    
    const div = document.createElement('div');
    div.textContent = str;
    let sanitized = div.innerHTML;
    
    if (/<[^>]+>/.test(sanitized)) {
        logger.warn('HTML detected after sanitization, blocking');
        return '';
    }
    
    return sanitized;
}

function showLoading() {
    if (domCache.loadingOverlay) {
        domCache.loadingOverlay.style.display = 'flex';
    }
}

function hideLoading() {
    if (domCache.loadingOverlay) {
        domCache.loadingOverlay.style.display = 'none';
    }
}

function showToast(message, isSuccess = true) {
    notificationPool.show(message, isSuccess);
}

// Block popup functionality optimizată
function showBlockPopup(bookingId) {
    currentBlockingBookingId = bookingId;
    if (domCache.blockReasonInput) {
        domCache.blockReasonInput.value = '';
    }
    if (domCache.blockPopup) {
        domCache.blockPopup.style.display = 'flex';
    }
}

function hideBlockPopup() {
    currentBlockingBookingId = null;
    if (domCache.blockPopup) {
        domCache.blockPopup.style.display = 'none';
    }
}

// FUNCȚIE OPTIMIZATĂ - Create card for booking cu DocumentFragment
function createCard(booking, type = 'pending') {
    // Utilizează DocumentFragment pentru performanță optimă
    const fragment = document.createDocumentFragment();
    const card = document.createElement('div');
    card.className = 'card';

    const statusClass = type === 'pending' ? 'status-pending' : 'status-confirmed';
    const statusText = type === 'pending' ? 'În așteptare' : 'Confirmată';

    let actionsHtml = '';
    if (type === 'pending') {
        actionsHtml = `
            <div class="card-actions">
                <button class="btn btn-confirm" data-id="${sanitizeHtml(booking.id)}">Acceptă</button>
                <button class="btn btn-decline" data-id="${sanitizeHtml(booking.id)}">Refuză</button>
                <button class="btn btn-block" data-id="${sanitizeHtml(booking.id)}">Blochează</button>
            </div>
        `;
    } else {
        actionsHtml = `
            <div class="card-actions">
                <button class="btn btn-decline" data-id="${sanitizeHtml(booking.id)}">Anulează</button>
            </div>
        `;
    }

    // Construiește HTML-ul complet o singură dată
    card.innerHTML = `
        <div class="card-header">
            <div class="card-title">${sanitizeHtml(booking.clientName)}</div>
            <div class="card-status ${statusClass}">${statusText}</div>
        </div>
        
        <div class="card-body">
            <div class="card-field email">
                <div class="card-field-label">Email</div>
                <div class="card-field-value">${sanitizeHtml(booking.email)}</div>
            </div>
            
            <div class="card-field phone">
                <div class="card-field-label">Telefon</div>
                <div class="card-field-value">${sanitizeHtml(booking.phoneNumber)}</div>
            </div>
            
            <div class="card-field service">
                <div class="card-field-label">Serviciu</div>
                <div class="card-field-value">${sanitizeHtml(booking.service)}</div>
            </div>
            
            ${type === 'pending' ? `
                <div class="card-field date">
                    <div class="card-field-label">Data</div>
                    <div class="card-field-value">${sanitizeHtml(booking.date)}</div>
                </div>
                
                <div class="card-field time">
                    <div class="card-field-label">Ora</div>
                    <div class="card-field-value">${sanitizeHtml(booking.time)}</div>
                </div>
            ` : `
                <div class="card-field time">
                    <div class="card-field-label">Ora</div>
                    <div class="card-field-value">${sanitizeHtml(booking.time)}</div>
                </div>
                
                <div class="card-field price">
                    <div class="card-field-label">Preț</div>
                    <div class="card-field-value">${sanitizeHtml(booking.servicePrice)} RON</div>
                </div>
            `}
        </div>
        
        ${actionsHtml}
    `;

    fragment.appendChild(card);
    return fragment;
}

// Enhanced authentication and token management functions
function setupTokenExpiry() {
    const tokenTimestamp = localStorage.getItem('tokenTimestamp');
    const currentTime = new Date().getTime();
    
    if (tokenTimestamp && (currentTime - tokenTimestamp > 24 * 60 * 60 * 1000)) {
        localStorage.removeItem('token');
        localStorage.removeItem('tokenTimestamp');
        window.location.href = 'login.html';
        return false;
    }
    
    if (!tokenTimestamp || (currentTime - tokenTimestamp > 30 * 60 * 1000)) {
        localStorage.setItem('tokenTimestamp', currentTime);
    }
    
    return true;
}

async function fetchWithAuth(url, options = {}) {
    const token = localStorage.getItem('token');
    
    if (!token) {
        window.location.href = 'login.html';
        return null;
    }
    
    if (!setupTokenExpiry()) {
        return null;
    }
    
    const authOptions = {
        ...options,
        headers: {
            ...options.headers,
            Authorization: `Bearer ${token}`
        }
    };
    
    try {
        const response = await fetch(url, authOptions);
        
        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('token');
            localStorage.removeItem('tokenTimestamp');
            window.location.href = 'login.html';
            return null;
        }
        
        return response;
    } catch (error) {
        logger.error('Network error:', error);
        showToast('Eroare de rețea. Verificați conexiunea.', false);
        return null;
    }
}

// FUNCȚII OPTIMIZATE - Load bookings cu batch processing

// OPTIMIZATĂ - Load pending reservations
async function loadPendingBookings() {
    showLoading();
    try {
        const response = await fetchWithAuth(`${API_URL}/admin/bookings/pending`);
        
        if (!response) {
            return;
        }

        if (!response.ok) {
            throw new Error('Failed to fetch pending reservations');
        }

        const data = await response.json();
        
        if (!domCache.pendingCards) {
            return;
        }

        // OPTIMIZARE: Construiește toate card-urile ca DocumentFragment
        const fragment = document.createDocumentFragment();

        if (data.bookings && data.bookings.length > 0) {
            data.bookings.forEach(booking => {
                const cardFragment = createCard(booking, 'pending');
                fragment.appendChild(cardFragment);
            });

            // O singură operație DOM
            domCache.pendingCards.innerHTML = '';
            domCache.pendingCards.appendChild(fragment);

            // Add event listeners for action buttons
            addActionButtonListeners();
        } else {
            // No pending reservations
            const emptyCard = document.createElement('div');
            emptyCard.className = 'card';
            emptyCard.innerHTML = `
                <div class="empty-message">Nu există rezervări în așteptare</div>
            `;
            domCache.pendingCards.innerHTML = '';
            domCache.pendingCards.appendChild(emptyCard);
        }
    } catch (error) {
        logger.error('Error loading pending reservations:', error);
        showToast('Nu s-au putut încărca rezervările în așteptare', false);
    } finally {
        hideLoading();
    }
};


// OPTIMIZATĂ - Load confirmed reservations for a specific date
async function loadConfirmedBookings(date) {
    if (!date) {
        logger.warn('No date provided for loadConfirmedBookings');
        return;
    }

    showLoading();
    try {
        const response = await fetchWithAuth(`${API_URL}/admin/bookings/confirmed?date=${date}`);
        
        if (!response) {
            return;
        }

        if (!response.ok) {
            throw new Error('Failed to fetch confirmed reservations');
        }

        const data = await response.json();
        
        if (!domCache.confirmedCards) {
            return;
        }

        // OPTIMIZARE: Construiește toate card-urile ca DocumentFragment
        const fragment = document.createDocumentFragment();

        if (data.bookings && data.bookings.length > 0) {
            data.bookings.forEach((booking, index) => {
                try {
                    const cardFragment = createCard(booking, 'confirmed');
                    fragment.appendChild(cardFragment);
                } catch (e) {
                    logger.error(`Error processing booking ${index}:`, e);
                }
            });

            // Add total card
            try {
                const totalCard = document.createElement('div');
                totalCard.className = 'card total-card';
                totalCard.innerHTML = `
                    <div class="card-field">
                        <div class="card-field-label">Total Încasări</div>
                        <div class="card-field-value">${data.totalPrice} RON</div>
                    </div>
                `;
                fragment.appendChild(totalCard);
            } catch (e) {
                logger.error('Error adding total card:', e);
            }

            // O singură operație DOM
            domCache.confirmedCards.innerHTML = '';
            domCache.confirmedCards.appendChild(fragment);

            // Add event listeners for cancel buttons
            try {
                addCancelButtonListeners();
            } catch (e) {
                logger.error('Error adding cancel button listeners:', e);
            }
        } else {
            // No confirmed reservations for this date
            try {
                const emptyCard = document.createElement('div');
                emptyCard.className = 'card';
                emptyCard.innerHTML = `
                    <div class="empty-message">Nu există rezervări confirmate pentru această dată</div>
                `;
                fragment.appendChild(emptyCard);

                // Add total card showing 0
                const totalCard = document.createElement('div');
                totalCard.className = 'card total-card';
                totalCard.innerHTML = `
                    <div class="card-field">
                        <div class="card-field-label">Total Încasări</div>
                        <div class="card-field-value">0 RON</div>
                    </div>
                `;
                fragment.appendChild(totalCard);

                // O singură operație DOM
                domCache.confirmedCards.innerHTML = '';
                domCache.confirmedCards.appendChild(fragment);
            } catch (e) {
                logger.error('Error adding empty card:', e);
            }
        }
    } catch (error) {
        logger.error('Error loading confirmed reservations:', error);
        showToast('Nu s-au putut încărca rezervările confirmate', false);
    } finally {
        hideLoading();
    }
}

// Add event listeners for action buttons
function addActionButtonListeners() {
    // Accept buttons - NO CONFIRMATION
    const acceptButtons = document.querySelectorAll('.btn-confirm');
    acceptButtons.forEach(button => {
        button.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const bookingId = button.getAttribute('data-id');
            if (bookingId) {
                await confirmBooking(bookingId);
            }
        });
    });

    // Decline buttons from pending - NO CONFIRMATION  
    const declineButtons = document.querySelectorAll('#pendingReservationsCards .btn-decline');
    declineButtons.forEach(button => {
        button.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const bookingId = button.getAttribute('data-id');
            if (bookingId) {
                await declineBooking(bookingId);
            }
        });
    });

    // Block buttons - CUSTOM POPUP ONLY
    const blockButtons = document.querySelectorAll('.btn-block');
    blockButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const bookingId = button.getAttribute('data-id');
            if (bookingId) {
                showBlockPopup(bookingId);
            }
        });
    });
}

// Add event listeners for cancel buttons
function addCancelButtonListeners() {
    const cancelButtons = document.querySelectorAll('#confirmedReservationsCards .btn-decline');
    cancelButtons.forEach(button => {
        button.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const bookingId = button.getAttribute('data-id');
            if (bookingId) {
                await declineBooking(bookingId);
            }
        });
    });
}

// Confirm booking (ABSOLUTELY NO CONFIRMATION POPUP)
async function confirmBooking(bookingId) {
    if (!bookingId) {
        showToast('Eroare: ID rezervare lipsește', false);
        return;
    }

    showLoading();
    try {
        const response = await fetchWithAuth(`${API_URL}/admin/bookings/${bookingId}/confirm`, {
            method: 'PUT'
        });
        
        if (!response) {
            return;
        }

        if (!response.ok) {
            throw new Error('Failed to confirm booking');
        }

        const result = await response.json();

        // OPTIMIZARE: Încarcă datele în paralel
        await Promise.all([
            loadPendingBookings(),
            domCache.datePicker?.value ? loadConfirmedBookings(domCache.datePicker.value) : Promise.resolve()
        ]);
        
        let message = 'Rezervare confirmată cu succes!';
        if (result.emailStatus === 'sent') {
            message += ' Un email de confirmare a fost trimis clientului.';
        } else if (result.emailStatus === 'limited') {
            message += ' (Notă: Email-ul nu a fost trimis - limită atinsă)';
        } else if (result.emailStatus === 'failed') {
            message += ' (Notă: Email-ul nu a putut fi trimis)';
        }
        
        showToast(message, true);
    } catch (error) {
        logger.error('Error confirming booking:', error);
        showToast('Nu s-a putut confirma rezervarea', false);
    } finally {
        hideLoading();
    }
}

// Decline booking (ABSOLUTELY NO CONFIRMATION POPUP)
async function declineBooking(bookingId) {
    if (!bookingId) {
        showToast('Eroare: ID rezervare lipsește', false);
        return;
    }

    showLoading();
    try {
        const response = await fetchWithAuth(`${API_URL}/admin/bookings/${bookingId}/decline`, {
            method: 'PUT'
        });
        
        if (!response) {
            return;
        }

        if (!response.ok) {
            throw new Error('Failed to decline booking');
        }

        const result = await response.json();

        // OPTIMIZARE: Încarcă datele în paralel
        await Promise.all([
            loadPendingBookings(),
            domCache.datePicker?.value ? loadConfirmedBookings(domCache.datePicker.value) : Promise.resolve()
        ]);
        
        let message = 'Rezervare refuzată cu succes!';
        if (result.emailStatus === 'sent') {
            message += ' Un email de notificare a fost trimis clientului.';
        } else if (result.emailStatus === 'limited') {
            message += ' (Notă: Email-ul nu a fost trimis - limită atinsă)';
        } else if (result.emailStatus === 'failed') {
            message += ' (Notă: Email-ul nu a putut fi trimis)';
        }
        
        showToast(message, true);
    } catch (error) {
        logger.error('Error declining booking:', error);
        showToast('Nu s-a putut refuza rezervarea', false);
    } finally {
        hideLoading();
    }
}

// Block user with reason
async function blockUser(bookingId, reason) {
    showLoading();
    try {
        const response = await fetchWithAuth(`${API_URL}/admin/users/block/${bookingId}`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ reason })
        });
        
        if (!response) {
            return;
        }

        if (!response.ok) {
            throw new Error('Failed to block user');
        }

        // Reload pending reservations
        await loadPendingBookings();
        
        showToast('Utilizator blocat cu succes! Adresa de email și numărul de telefon au fost adăugate în lista de blocate.', true);
    } catch (error) {
        logger.error('Error blocking user:', error);
        showToast('Nu s-a putut bloca utilizatorul', false);
    } finally {
        hideLoading();
    }
}

// OPTIMIZATE - Block date functions

// OPTIMIZATĂ - Generate hour checkboxes
function generateHourCheckboxes() {
    if (!domCache.hoursContainer) return;
    
    // Verifică ce zi este selectată
    const selectedDate = domCache.blockDateInput ? new Date(domCache.blockDateInput.value) : new Date();
    const dayOfWeek = selectedDate.getDay();
    
    // Determină intervalul de ore bazat pe ziua săptămânii
    let startHour, endHour;
    
    if (dayOfWeek === 6) { // Sâmbătă - program special 10:00-13:00
        startHour = 10;
        endHour = 13;
    } else if (dayOfWeek === 0) { // Duminică - închis
        domCache.hoursContainer.innerHTML = '<p style="text-align: center; color: #888;">Suntem închiși duminica</p>';
        return;
    } else { // Luni-Vineri - program normal 10:00-19:00
        startHour = 10;
        endHour = 19;
    }
    
    // OPTIMIZARE: Generează toate orele ca string
    const hoursHTML = [];
    for (let hour = startHour; hour < endHour; hour++) {
        for (let minute = 0; minute < 60; minute += 30) {
            const timeString = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
            hoursHTML.push(`
                <div class="hour-checkbox-wrapper">
                    <label class="hour-checkbox-label">
                        <input type="checkbox" value="${timeString}" class="hour-checkbox">
                        <span>${timeString}</span>
                    </label>
                </div>
            `);
        }
    }
    
    // O singură operație DOM
    domCache.hoursContainer.innerHTML = hoursHTML.join('');
}

function showBlockDatePopup() {
    if (!domCache.blockDatePopup) {
        showToast('Eroare: Popup-ul nu a fost găsit', false);
        return;
    }
    
    // Restaurează conținutul original pentru blocarea datelor
    const popupTitle = document.getElementById('blockDatePopupTitle');
    const popupContent = document.getElementById('blockDatePopupContent');
    
    if (popupTitle) {
        popupTitle.textContent = 'Blochează Dată';
    }
    
    if (popupContent) {
        popupContent.innerHTML = `
            <div class="form-group">
                <label for="blockDateInput">Selectează Data:</label>
                <input type="date" id="blockDateInput" required>
            </div>
            
            <div class="checkbox-group">
                <input type="checkbox" id="fullDayBlock" checked>
                <label for="fullDayBlock">Blochează toată ziua</label>
            </div>
            
            <div class="hours-selection" id="hoursSelection" style="display: none;">
                <label>Selectează orele de blocat:</label>
                <div class="hours-container" id="hoursContainer">
                    <!-- Orele vor fi generate dinamic -->
                </div>
            </div>
        `;
        
        // Re-cache DOM elements
        domCache.blockDateInput = document.getElementById('blockDateInput');
        domCache.fullDayCheckbox = document.getElementById('fullDayBlock');
        domCache.hoursSelectionDiv = document.getElementById('hoursSelection');
        domCache.hoursContainer = document.getElementById('hoursContainer');
    }
    
    // Configurare și inițializare input pentru dată
    if (domCache.blockDateInput) {
        const today = new Date().toISOString().split('T')[0];
        domCache.blockDateInput.setAttribute('min', today);
        domCache.blockDateInput.value = today;
        
        // Event listener pentru regenerarea orelor
        domCache.blockDateInput.addEventListener('change', function() {
            if (domCache.fullDayCheckbox && !domCache.fullDayCheckbox.checked) {
                generateHourCheckboxes();
            }
        });
    }
    
    // Configurare checkbox pentru "Blochează toată ziua"
    if (domCache.fullDayCheckbox && domCache.hoursSelectionDiv) {
        domCache.fullDayCheckbox.checked = true;
        domCache.hoursSelectionDiv.style.display = 'none';
        
        domCache.fullDayCheckbox.addEventListener('change', function() {
            if (this.checked) {
                domCache.hoursSelectionDiv.style.display = 'none';
            } else {
                domCache.hoursSelectionDiv.style.display = 'block';
                generateHourCheckboxes();
            }
        });
    }
    
    // Generează orele pentru data curentă
    generateHourCheckboxes();
    
    // Afișează popup-ul
    domCache.blockDatePopup.style.display = 'flex';
    
    // Focus pe input-ul de dată
    setTimeout(() => {
        if (domCache.blockDateInput) {
            domCache.blockDateInput.focus();
        }
    }, 150);
    
    logger.info('Block date popup opened successfully');
}

function hideBlockDatePopup() {
    if (domCache.blockDatePopup) {
        domCache.blockDatePopup.style.display = 'none';
    }
}

// Funcție pentru confirmarea blocării - OPTIMIZATĂ
async function handleBlockDateConfirm() {
    if (!domCache.blockDateInput || !domCache.fullDayCheckbox) {
        showToast('Eroare în interfață', false);
        return;
    }
    
    const selectedDate = domCache.blockDateInput.value;
    const isFullDay = domCache.fullDayCheckbox.checked;
    const hourCheckboxes = document.querySelectorAll('.hour-checkbox:checked');
    
    // Validare dată selectată
    if (!selectedDate) {
        showToast('Te rugăm să selectezi o dată', false);
        return;
    }
    
    // Verificare că data nu este în trecut
    const selectedDateObj = new Date(selectedDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    selectedDateObj.setHours(0, 0, 0, 0);
    
    if (selectedDateObj < today) {
        showToast('Nu se pot bloca date din trecut', false);
        return;
    }
    
    // Verificare că nu este duminică
    const dayOfWeek = selectedDateObj.getDay();
    if (dayOfWeek === 0) {
        showToast('Nu se poate bloca duminica - suntem deja închiși în această zi!', false);
        return;
    }
    
    // Validare ore selectate (dacă nu e toată ziua)
    if (!isFullDay && hourCheckboxes.length === 0) {
        showToast('Te rugăm să selectezi cel puțin o oră', false);
        return;
    }
    
    if (!isFullDay && hourCheckboxes.length > 20) {
        showToast('Prea multe ore selectate (maxim 20)', false);
        return;
    }
    
    const selectedHours = Array.from(hourCheckboxes).map(cb => cb.value);
    
    // Verificare pentru date duplicate
    const existingBlock = checkIfDateAlreadyBlocked(selectedDate, isFullDay, selectedHours);
    if (existingBlock.isBlocked) {
        showToast(existingBlock.message, false);
        return;
    }
    
    showLoading();
    try {
        const response = await fetchWithAuth(`${API_URL}/admin/blocked-dates`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                date: selectedDate,
                isFullDay: isFullDay,
                hours: isFullDay ? [] : selectedHours
            })
        });
        
        if (!response) return;
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Eroare la blocarea datei');
        }
        
        const result = await response.json();
        
        hideBlockDatePopup();
        showToast(result.message || 'Data a fost blocată cu succes', true);
        
        // Reîncarcă cache-ul pentru date blocate
        await loadBlockedDates();
        
    } catch (error) {
        logger.error('Error blocking date:', error);
        showToast(error.message || 'Nu s-a putut bloca data', false);
    } finally {
        hideLoading();
    }
}

// Funcție pentru încărcarea datelor blocate - OPTIMIZATĂ
async function loadBlockedDates() {
    try {
        const response = await fetchWithAuth(`${API_URL}/admin/blocked-dates`);
        
        if (!response) return;
        
        if (!response.ok) {
            throw new Error('Failed to fetch blocked dates');
        }
        
        const data = await response.json();
        blockedDatesCache = data.blockedDates || [];
        
        return blockedDatesCache;
    } catch (error) {
        logger.error('Error loading blocked dates:', error);
        return [];
    }
}

async function showBlockedDatesView() {
    if (!domCache.viewBlockedDatesPopup || !domCache.blockedDatesContent) {
        showToast('Eroare în interfață', false);
        return;
    }

    showLoading();
    try {
        const blockedDates = await loadBlockedDates();
        
        if (blockedDates.length === 0) {
            domCache.blockedDatesContent.innerHTML = `
                <div class="no-blocked-dates">
                    <p>Nu există date blocate în prezent.</p>
                </div>
            `;
        } else {
            // OPTIMIZARE: Construiește HTML-ul ca string
            const blockedDatesHTML = blockedDates.map(blocked => {
                const hoursText = blocked.isFullDayBlocked 
                    ? 'Toată ziua' 
                    : blocked.blockedHours.join(', ');
                
                return `
                    <div class="blocked-date-item">
                        <div class="blocked-date-info">
                            <h4>${blocked.dateFormatted}</h4>
                            <p><strong>Tip:</strong> ${hoursText}</p>
                            <p><strong>Motiv:</strong> ${blocked.reason}</p>
                            <p><strong>Creat de:</strong> ${blocked.createdBy}</p>
                        </div>
                        <button class="btn btn-decline unblock-date-btn" data-id="${blocked.id}">
                            Deblochează
                        </button>
                    </div>
                `;
            }).join('');
            
            domCache.blockedDatesContent.innerHTML = `<div class="blocked-dates-list">${blockedDatesHTML}</div>`;
            
            // Adaugă event listeners pentru butoanele de deblocare
            const unblockButtons = domCache.blockedDatesContent.querySelectorAll('.unblock-date-btn');
            unblockButtons.forEach(button => {
                button.addEventListener('click', async (e) => {
                    const blockedDateId = e.target.getAttribute('data-id');
                    if (blockedDateId) {
                        await unblockDate(blockedDateId);
                    }
                });
            });
        }
        
        domCache.viewBlockedDatesPopup.style.display = 'flex';
        
    } catch (error) {
        logger.error('Error showing blocked dates view:', error);
        showToast('Nu s-au putut încărca datele blocate', false);
    } finally {
        hideLoading();
    }
}

// Funcție pentru deblocarea unei date
async function unblockDate(blockedDateId) {
    showLoading();
    try {
        const response = await fetchWithAuth(`${API_URL}/admin/blocked-dates/${blockedDateId}`, {
            method: 'DELETE'
        });
        
        if (!response) return;
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Eroare la deblocarea datei');
        }
        
        const result = await response.json();
        showToast(result.message || 'Data a fost deblocată cu succes', true);
        
        // Reîncarcă lista
        await showBlockedDatesView();
        
    } catch (error) {
        logger.error('Error unblocking date:', error);
        showToast(error.message || 'Nu s-a putut debloca data', false);
    } finally {
        hideLoading();
    }
}

// Funcție pentru rularea manuală a curățării
async function runManualCleanup() {
    showLoading();
    try {
        const response = await fetchWithAuth(`${API_URL}/admin/cleanup`, {
            method: 'POST'
        });
        
        if (!response) return;
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Eroare la rularea curățării');
        }
        
        const result = await response.json();
        
        const message = `Curățare completă: ${result.results.totalCleaned} rezervări curățate, ${result.results.totalErrors} erori`;
        showToast(message, true);
        
        // OPTIMIZARE: Reîncarcă datele în paralel
        const promises = [loadPendingBookings()];
        if (domCache.datePicker && domCache.datePicker.value) {
            promises.push(loadConfirmedBookings(domCache.datePicker.value));
        }
        await Promise.all(promises);
        
    } catch (error) {
        logger.error('Error running manual cleanup:', error);
        showToast(error.message || 'Nu s-a putut rula curățarea', false);
    } finally {
        hideLoading();
    }
}

/**
 * Verifică dacă o dată este deja blocată
 */
function checkIfDateAlreadyBlocked(selectedDate, isFullDay, selectedHours = []) {
    try {
        // Verifică în cache-ul local
        const existingBlock = blockedDatesCache.find(blocked => {
            const blockedDate = new Date(blocked.date).toISOString().split('T')[0];
            return blockedDate === selectedDate;
        });
        
        if (!existingBlock) {
            return { isBlocked: false };
        }
        
        // Verifică tipul de blocare
        if (existingBlock.isFullDayBlocked) {
            return {
                isBlocked: true,
                message: `Data ${existingBlock.dateFormatted} este deja blocată complet!`
            };
        }
        
        // Dacă există blocare parțială și vrei să blochezi toată ziua
        if (!existingBlock.isFullDayBlocked && isFullDay) {
            return {
                isBlocked: true,
                message: `Data ${existingBlock.dateFormatted} are deja ore blocate (${existingBlock.blockedHours.join(', ')}). Pentru a bloca toată ziua, mai întâi deblochează orele existente.`
            };
        }
        
        // Verifică dacă orele selectate se suprapun cu cele existente
        if (!isFullDay && existingBlock.blockedHours) {
            const overlappingHours = selectedHours.filter(hour => 
                existingBlock.blockedHours.includes(hour)
            );
            
            if (overlappingHours.length > 0) {
                return {
                    isBlocked: true,
                    message: `Următoarele ore sunt deja blocate în ${existingBlock.dateFormatted}: ${overlappingHours.join(', ')}`
                };
            }
        }
        
        return { isBlocked: false };
        
    } catch (error) {
        logger.error('Error checking if date is already blocked:', error);
        return { isBlocked: false };
    }
}

// Setup all event listeners - OPTIMIZAT
function setupEventListeners() {
    // Optimizare: event listener unic pentru data picker cu debouncing
    if (domCache.datePicker) {
        const debouncedDateChange = debounce('datePicker', () => {
            loadConfirmedBookings(domCache.datePicker.value);
        }, 300);
        
        domCache.datePicker.addEventListener('change', debouncedDateChange);
    }

    if (domCache.logoutBtn) {
        domCache.logoutBtn.addEventListener('click', logout);
    }

    // Optimizare: debouncing pentru refresh buttons
    if (domCache.refreshPendingBtn) {
        domCache.refreshPendingBtn.addEventListener('click', () => {
            debounce('refreshPending', loadPendingBookings, 500);
        });
    }

    if (domCache.refreshConfirmedBtn) {
        domCache.refreshConfirmedBtn.addEventListener('click', () => {
            debounce('refreshConfirmed', () => {
                if (domCache.datePicker) {
                    loadConfirmedBookings(domCache.datePicker.value);
                }
            }, 500);
        });
    }

    if (domCache.todayBtn) {
        domCache.todayBtn.addEventListener('click', () => {
            const today = new Date().toISOString().split('T')[0];
            if (domCache.datePicker) {
                domCache.datePicker.value = today;
                loadConfirmedBookings(today);
            }
        });
    }

    if (domCache.manualCleanupBtn) {
        domCache.manualCleanupBtn.addEventListener('click', () => {
            debounce('manualCleanup', runManualCleanup, 1000);
        });
    }

    // Setup block popup event listeners
    setupBlockPopupListeners();
    setupBlockDateListeners();
}

// Setup block popup event listeners - OPTIMIZAT
function setupBlockPopupListeners() {
    if (domCache.blockPopupClose) {
        domCache.blockPopupClose.addEventListener('click', hideBlockPopup);
    }
    
    if (domCache.blockCancelBtn) {
        domCache.blockCancelBtn.addEventListener('click', hideBlockPopup);
    }
    
    if (domCache.blockPopup) {
        domCache.blockPopup.addEventListener('click', function(e) {
            if (e.target === this) {
                hideBlockPopup();
            }
        });
    }

    if (domCache.blockConfirmBtn) {
        domCache.blockConfirmBtn.addEventListener('click', async function() {
            const reason = domCache.blockReasonInput ? domCache.blockReasonInput.value.trim() : '';
            
            if (!reason) {
                showToast('Te rugăm să introduci un motiv pentru blocare', false);
                return;
            }

            if (!currentBlockingBookingId) {
                showToast('Eroare: ID rezervare lipsește', false);
                return;
            }

            await blockUser(currentBlockingBookingId, reason);
            hideBlockPopup();
        });
    }
}

function setupBlockDateListeners() {
    if (domCache.blockDateBtn) {
        domCache.blockDateBtn.addEventListener('click', showBlockDatePopup);
    }

    if (domCache.viewBlockedDatesBtn) {
        domCache.viewBlockedDatesBtn.addEventListener('click', showBlockedDatesView);
    }

    // Event listeners pentru popup-ul de blocare
    if (domCache.blockDateClose) {
        domCache.blockDateClose.addEventListener('click', () => {
            hideBlockDatePopup();
        });
    }

    if (domCache.blockDateCancel) {
        domCache.blockDateCancel.addEventListener('click', () => {
            hideBlockDatePopup();
        });
    }

    // Event listeners pentru popup-ul de vizualizare
    if (domCache.viewBlockedClose) {
        domCache.viewBlockedClose.addEventListener('click', () => {
            if (domCache.viewBlockedDatesPopup) {
                domCache.viewBlockedDatesPopup.style.display = 'none';
            }
        });
    }

    if (domCache.viewBlockedCancel) {
        domCache.viewBlockedCancel.addEventListener('click', () => {
            if (domCache.viewBlockedDatesPopup) {
                domCache.viewBlockedDatesPopup.style.display = 'none';
            }
        });
    }

    if (domCache.blockDateConfirm) {
        domCache.blockDateConfirm.addEventListener('click', handleBlockDateConfirm);
    }
}

// Logout
function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('tokenTimestamp');
    window.location.href = 'login.html';
}

// Initialize dashboard - OPTIMIZAT
document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = 'login.html';
        return;
    }

    if (!setupTokenExpiry()) {
        return;
    }

    // Inițializează cache-ul DOM
    domCache.init();

    showLoading();
    try {
        // Verify token validity
        const response = await fetchWithAuth(`${API_URL}/dashboard`);
        
        if (!response) {
            return;
        }

        if (!response.ok) {
            throw new Error('Authentication failed');
        }

        // Set current date in date picker
        const today = new Date().toISOString().split('T')[0];
        if (domCache.datePicker) {
            domCache.datePicker.value = today;
        }

        // OPTIMIZARE: Load data în paralel în loc de secvențial
        const [pendingResult, confirmedResult, blockedDatesResult] = await Promise.allSettled([
            loadPendingBookings(),
            loadConfirmedBookings(today),
            loadBlockedDates()
        ]);

        // Verifică dacă au existat erori și le gestionează
        if (pendingResult.status === 'rejected') {
            logger.error('Eroare la încărcarea rezervărilor pending:', pendingResult.reason);
        }
        if (confirmedResult.status === 'rejected') {
            logger.error('Eroare la încărcarea rezervărilor confirmate:', confirmedResult.reason);
        }
        if (blockedDatesResult.status === 'rejected') {
            logger.error('Eroare la încărcarea datelor blocate:', blockedDatesResult.reason);
        }

        // Add event listeners
        setupEventListeners();

    } catch (error) {
        logger.error('Error initializing dashboard:', error);
        localStorage.removeItem('token');
        localStorage.removeItem('tokenTimestamp');
        window.location.href = 'login.html';
    } finally {
        hideLoading();
    }
});