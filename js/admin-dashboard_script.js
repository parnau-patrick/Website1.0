  // Global variables for block functionality
let currentBlockingBookingId = null;
let currentBlockDatePopupMode = 'block'; // 'block' sau 'view'
let blockedDatesCache = [];

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

// Utilitare
function sanitizeHtml(input) {
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
    
    // Sanitizează folosind metoda îmbunătățită
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

function showLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.style.display = 'flex';
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.style.display = 'none';
}

function showToast(message, isSuccess = true) {
    const toast = document.getElementById('toast');
    if (toast) {
        toast.textContent = message;
        toast.className = 'toast ' + (isSuccess ? 'success' : 'error');
        toast.style.display = 'block';
        
        setTimeout(() => {
            toast.style.display = 'none';
        }, 3000);
    }
}

// Block popup functionality
function showBlockPopup(bookingId) {
    currentBlockingBookingId = bookingId;
    const reasonInput = document.getElementById('blockReasonInput');
    const popup = document.getElementById('blockPopup');
    
    if (reasonInput) {
        reasonInput.value = '';
    }
    if (popup) {
        popup.style.display = 'flex';
    }
}

function hideBlockPopup() {
    currentBlockingBookingId = null;
    const popup = document.getElementById('blockPopup');
    if (popup) {
        popup.style.display = 'none';
    }
}

// Create card for booking
function createCard(booking, type = 'pending') {
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

    return card;
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

// Initialize dashboard
document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = 'login.html';
        return;
    }

    if (!setupTokenExpiry()) {
        return;
    }

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
        const datePicker = document.getElementById('datePicker');
        if (datePicker) {
            datePicker.value = today;
        }

        // Load data
        await loadPendingBookings();
        await loadConfirmedBookings(today);
        await loadBlockedDates(); // Încarcă cache-ul pentru datele blocate

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

// Setup all event listeners
function setupEventListeners() {
    const datePicker = document.getElementById('datePicker');
    const logoutBtn = document.getElementById('logoutBtn');
    const refreshPendingBtn = document.getElementById('refreshPendingBtn');
    const refreshConfirmedBtn = document.getElementById('refreshConfirmedBtn');
    const todayBtn = document.getElementById('todayBtn');
    const manualCleanupBtn = document.getElementById('manualCleanupBtn');

    if (datePicker) {
        datePicker.addEventListener('change', async () => {
            await loadConfirmedBookings(datePicker.value);
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }

    if (refreshPendingBtn) {
        refreshPendingBtn.addEventListener('click', loadPendingBookings);
    }

    if (refreshConfirmedBtn) {
        refreshConfirmedBtn.addEventListener('click', () => {
            const picker = document.getElementById('datePicker');
            if (picker) {
                loadConfirmedBookings(picker.value);
            }
        });
    }

    if (todayBtn) {
        todayBtn.addEventListener('click', () => {
            const today = new Date().toISOString().split('T')[0];
            const picker = document.getElementById('datePicker');
            if (picker) {
                picker.value = today;
                loadConfirmedBookings(today);
            }
        });
    }

    if (manualCleanupBtn) {
        manualCleanupBtn.addEventListener('click', runManualCleanup);
    }

    // Setup block popup event listeners
    setupBlockPopupListeners();
    setupBlockDateListeners(); // Nou
}


// Setup block popup event listeners
function setupBlockPopupListeners() {
    const blockPopupClose = document.getElementById('blockPopupClose');
    const blockCancelBtn = document.getElementById('blockCancelBtn');
    const blockPopup = document.getElementById('blockPopup');
    const blockConfirmBtn = document.getElementById('blockConfirmBtn');

    if (blockPopupClose) {
        blockPopupClose.addEventListener('click', hideBlockPopup);
    }
    
    if (blockCancelBtn) {
        blockCancelBtn.addEventListener('click', hideBlockPopup);
    }
    
    if (blockPopup) {
        blockPopup.addEventListener('click', function(e) {
            if (e.target === this) {
                hideBlockPopup();
            }
        });
    }

    if (blockConfirmBtn) {
        blockConfirmBtn.addEventListener('click', async function() {
            const reasonInput = document.getElementById('blockReasonInput');
            const reason = reasonInput ? reasonInput.value.trim() : '';
            
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

// Load pending reservations
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
        
        // Get the cards container
        const cardsContainer = document.getElementById('pendingReservationsCards');
        
        if (cardsContainer) {
            cardsContainer.innerHTML = '';
        }

        if (data.bookings && data.bookings.length > 0) {
            data.bookings.forEach(booking => {
                // Create card
                if (cardsContainer) {
                    const card = createCard(booking, 'pending');
                    cardsContainer.appendChild(card);
                }
            });

            // Add event listeners for action buttons
            addActionButtonListeners();
        } else {
            // No pending reservations
            if (cardsContainer) {
                const emptyCard = document.createElement('div');
                emptyCard.className = 'card';
                emptyCard.innerHTML = `
                    <div class="empty-message">Nu există rezervări în așteptare</div>
                `;
                cardsContainer.appendChild(emptyCard);
            }
        }
    } catch (error) {
        logger.error('Error loading pending reservations:', error);
        showToast('Nu s-au putut încărca rezervările în așteptare', false);
    } finally {
        hideLoading();
    }
}

// Load confirmed reservations for a specific date
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
        
        // Get the cards container
        const cardsContainer = document.getElementById('confirmedReservationsCards');
        
        // Clear existing content safely
        if (cardsContainer) {
            try {
                cardsContainer.innerHTML = '';
            } catch (e) {
                logger.error('Error clearing cards container:', e);
            }
        }

        if (data.bookings && data.bookings.length > 0) {
            data.bookings.forEach((booking, index) => {
                try {
                    // Create card
                    if (cardsContainer) {
                        const card = createCard(booking, 'confirmed');
                        if (card) {
                            cardsContainer.appendChild(card);
                        }
                    }
                } catch (e) {
                    logger.error(`Error processing booking ${index}:`, e);
                }
            });

            // Add total card
            if (cardsContainer) {
                try {
                    const totalCard = document.createElement('div');
                    totalCard.className = 'card total-card';
                    totalCard.innerHTML = `
                        <div class="card-field">
                            <div class="card-field-label">Total Încasări</div>
                            <div class="card-field-value">${data.totalPrice} RON</div>
                        </div>
                    `;
                    cardsContainer.appendChild(totalCard);
                } catch (e) {
                    logger.error('Error adding total card:', e);
                }
            }

            // Add event listeners for cancel buttons
            try {
                addCancelButtonListeners();
            } catch (e) {
                logger.error('Error adding cancel button listeners:', e);
            }
        } else {
            // No confirmed reservations for this date
            if (cardsContainer) {
                try {
                    const emptyCard = document.createElement('div');
                    emptyCard.className = 'card';
                    emptyCard.innerHTML = `
                        <div class="empty-message">Nu există rezervări confirmate pentru această dată</div>
                    `;
                    cardsContainer.appendChild(emptyCard);

                    // Add total card showing 0
                    const totalCard = document.createElement('div');
                    totalCard.className = 'card total-card';
                    totalCard.innerHTML = `
                        <div class="card-field">
                            <div class="card-field-label">Total Încasări</div>
                            <div class="card-field-value">0 RON</div>
                        </div>
                    `;
                    cardsContainer.appendChild(totalCard);
                } catch (e) {
                    logger.error('Error adding empty card:', e);
                }
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

        // Reload data
        await loadPendingBookings();
        const datePicker = document.getElementById('datePicker');
        if (datePicker && datePicker.value) {
            await loadConfirmedBookings(datePicker.value);
        }
        
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

        // Reload data
        await loadPendingBookings();
        const datePicker = document.getElementById('datePicker');
        if (datePicker && datePicker.value) {
            await loadConfirmedBookings(datePicker.value);
        }
        
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

function setupBlockDateListeners() {
    const blockDateBtn = document.getElementById('blockDateBtn');
    const blockDatePopup = document.getElementById('blockDatePopup');
    const blockDateClose = document.getElementById('blockDateClose');
    const blockDateCancel = document.getElementById('blockDateCancel');
    const blockDateConfirm = document.getElementById('blockDateConfirm');
    
    // Popup pentru vizualizare
    const viewBlockedDatesBtn = document.getElementById('viewBlockedDatesBtn');
    const viewBlockedDatesPopup = document.getElementById('viewBlockedDatesPopup');
    const viewBlockedClose = document.getElementById('viewBlockedClose');
    const viewBlockedCancel = document.getElementById('viewBlockedCancel');
    
    const fullDayCheckbox = document.getElementById('fullDayBlock');
    const hoursSelectionDiv = document.getElementById('hoursSelection');

    if (blockDateBtn) {
        blockDateBtn.addEventListener('click', showBlockDatePopup);
    }

    if (viewBlockedDatesBtn) {
        viewBlockedDatesBtn.addEventListener('click', showBlockedDatesView);
    }

    // Event listeners pentru popup-ul de blocare
    if (blockDateClose) {
        blockDateClose.addEventListener('click', () => {
            blockDatePopup.style.display = 'none';
        });
    }

    if (blockDateCancel) {
        blockDateCancel.addEventListener('click', () => {
            blockDatePopup.style.display = 'none';
        });
    }

    // Event listeners pentru popup-ul de vizualizare
    if (viewBlockedClose) {
        viewBlockedClose.addEventListener('click', () => {
            viewBlockedDatesPopup.style.display = 'none';
        });
    }

    if (viewBlockedCancel) {
        viewBlockedCancel.addEventListener('click', () => {
            viewBlockedDatesPopup.style.display = 'none';
        });
    }

    // Event listeners pentru funcționalitate
    if (fullDayCheckbox) {
        fullDayCheckbox.addEventListener('change', function() {
            if (hoursSelectionDiv) {
                hoursSelectionDiv.style.display = this.checked ? 'none' : 'block';
            }
        });
    }

    if (blockDateConfirm) {
        blockDateConfirm.addEventListener('click', handleBlockDateConfirm);
    }

    const blockDateInput = document.getElementById('blockDateInput');
    if (blockDateInput) {
        blockDateInput.addEventListener('change', function() {
            // Regenerează orele când se schimbă data
            const fullDayCheckbox = document.getElementById('fullDayBlock');
            if (fullDayCheckbox && !fullDayCheckbox.checked) {
                generateHourCheckboxes();
            }
        });
    }

}

function showBlockDatePopup() {
    const blockDatePopup = document.getElementById('blockDatePopup');
    const popupTitle = document.getElementById('blockDatePopupTitle');
    const popupContent = document.getElementById('blockDatePopupContent');
    
    // Verificare că elementele există
    if (!blockDatePopup) {
        showToast('Eroare: Popup-ul nu a fost găsit', false);
        return;
    }
    
    // Restaurează conținutul original pentru blocarea datelor
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
    }
    
    // Configurare și inițializare input pentru dată
    const blockDateInput = document.getElementById('blockDateInput');
    if (blockDateInput) {
        // Setează data minimă la data curentă
        const today = new Date().toISOString().split('T')[0];
        blockDateInput.setAttribute('min', today);
        blockDateInput.value = today;
        
        // Event listener simplu - doar pentru regenerarea orelor
        blockDateInput.addEventListener('change', function() {
            // Regenerează orele când se schimbă data (pentru programul de sâmbătă vs săptămână)
            const fullDayCheckbox = document.getElementById('fullDayBlock');
            if (fullDayCheckbox && !fullDayCheckbox.checked) {
                generateHourCheckboxes();
            }
        });
    }
    
    // Configurare checkbox pentru "Blochează toată ziua"
    const fullDayCheckbox = document.getElementById('fullDayBlock');
    const hoursSelectionDiv = document.getElementById('hoursSelection');
    
    if (fullDayCheckbox && hoursSelectionDiv) {
        // Setare inițială
        fullDayCheckbox.checked = true;
        hoursSelectionDiv.style.display = 'none';
        
        // Event listener pentru schimbarea tipului de blocare
        fullDayCheckbox.addEventListener('change', function() {
            if (this.checked) {
                // Blochează toată ziua - ascunde selecția orelor
                hoursSelectionDiv.style.display = 'none';
            } else {
                // Blochează ore specifice - afișează selecția orelor
                hoursSelectionDiv.style.display = 'block';
                generateHourCheckboxes();
            }
        });
    }
    
    // Generează orele pentru data curentă (pentru cazul când utilizatorul debifează "toată ziua")
    generateHourCheckboxes();
    
    // Afișează popup-ul
    blockDatePopup.style.display = 'flex';
    
    // Îmbunătățire UX - focus pe input-ul de dată
    setTimeout(() => {
        if (blockDateInput) {
            blockDateInput.focus();
        }
    }, 150);
    
    logger.info('Block date popup opened successfully');
}

function hideBlockDatePopup() {
    const blockDatePopup = document.getElementById('blockDatePopup');
    if (blockDatePopup) {
        blockDatePopup.style.display = 'none';
    }
}

function generateHourCheckboxes() {
    const hoursContainer = document.getElementById('hoursContainer');
    if (!hoursContainer) return;
    
    hoursContainer.innerHTML = '';
    
    // Verifică ce zi este selectată
    const blockDateInput = document.getElementById('blockDateInput');
    const selectedDate = blockDateInput ? new Date(blockDateInput.value) : new Date();
    const dayOfWeek = selectedDate.getDay(); // 0 = Duminică, 6 = Sâmbătă
    
    // Determină intervalul de ore bazat pe ziua săptămânii
    let startHour, endHour;
    
    if (dayOfWeek === 6) { // Sâmbătă - program special 10:00-13:00
        startHour = 10;
        endHour = 13;
    } else if (dayOfWeek === 0) { // Duminică - închis
        // Nu genera ore pentru duminică
        hoursContainer.innerHTML = '<p style="text-align: center; color: #888;">Suntem închiși duminica</p>';
        return;
    } else { // Luni-Vineri - program normal 10:00-19:00
        startHour = 10;
        endHour = 19;
    }
    
    // Generează orele pentru intervalul determinat
    const hours = [];
    for (let hour = startHour; hour < endHour; hour++) {
        for (let minute = 0; minute < 60; minute += 30) {
            const timeString = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
            hours.push(timeString);
        }
    }
    
    
    // Creează checkbox-urile pentru ore
    hours.forEach(hour => {
        const checkboxWrapper = document.createElement('div');
        checkboxWrapper.className = 'hour-checkbox-wrapper';
        
        checkboxWrapper.innerHTML = `
            <label class="hour-checkbox-label">
                <input type="checkbox" value="${hour}" class="hour-checkbox">
                <span>${hour}</span>
            </label>
        `;
        
        hoursContainer.appendChild(checkboxWrapper);
    });
}

// Funcție pentru confirmarea blocării
async function handleBlockDateConfirm() {
    const blockDateInput = document.getElementById('blockDateInput');
    const fullDayCheckbox = document.getElementById('fullDayBlock');
    const hourCheckboxes = document.querySelectorAll('.hour-checkbox:checked');
    
    // Verificare elemente de interfață
    if (!blockDateInput || !fullDayCheckbox) {
        showToast('Eroare în interfață', false);
        return;
    }
    
    const selectedDate = blockDateInput.value;
    const isFullDay = fullDayCheckbox.checked;
    
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
    const dayOfWeek = selectedDateObj.getDay(); // 0 = Duminică
    if (dayOfWeek === 0) {
        showToast('Nu se poate bloca duminica - suntem deja închiși în această zi!', false);
        return;
    }
    
    // Validare ore selectate (dacă nu e toată ziua)
    if (!isFullDay && hourCheckboxes.length === 0) {
        showToast('Te rugăm să selectezi cel puțin o oră', false);
        return;
    }
    
    // Validare numărul de ore (previne atacuri)
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
    
    // Încep procesul de blocare
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
        
        // Succes - închide popup și afișează mesaj
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

// Funcție pentru încărcarea datelor blocate
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
    const viewBlockedDatesPopup = document.getElementById('viewBlockedDatesPopup');
    const blockedDatesContent = document.getElementById('blockedDatesContent');
    
    showLoading();
    try {
        const blockedDates = await loadBlockedDates();
        
        if (!viewBlockedDatesPopup || !blockedDatesContent) {
            showToast('Eroare în interfață', false);
            return;
        }
        
        if (blockedDates.length === 0) {
            blockedDatesContent.innerHTML = `
                <div class="no-blocked-dates">
                    <p>Nu există date blocate în prezent.</p>
                </div>
            `;
        } else {
            let blockedDatesHTML = '<div class="blocked-dates-list">';
            
            blockedDates.forEach(blocked => {
                const hoursText = blocked.isFullDayBlocked 
                    ? 'Toată ziua' 
                    : blocked.blockedHours.join(', ');
                
                blockedDatesHTML += `
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
            });
            
            blockedDatesHTML += '</div>';
            blockedDatesContent.innerHTML = blockedDatesHTML;
            
            // Adaugă event listeners pentru butoanele de deblocare
            const unblockButtons = blockedDatesContent.querySelectorAll('.unblock-date-btn');
            unblockButtons.forEach(button => {
                button.addEventListener('click', async (e) => {
                    const blockedDateId = e.target.getAttribute('data-id');
                    if (blockedDateId) {
                        await unblockDate(blockedDateId);
                    }
                });
            });
        }
        
        viewBlockedDatesPopup.style.display = 'flex';
        
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
        
        // Reîncarcă datele
        await loadPendingBookings();
        const datePicker = document.getElementById('datePicker');
        if (datePicker && datePicker.value) {
            await loadConfirmedBookings(datePicker.value);
        }
        
    } catch (error) {
        logger.error('Error running manual cleanup:', error);
        showToast(error.message || 'Nu s-a putut rula curățarea', false);
    } finally {
        hideLoading();
    }
}

/**
 * Verifică dacă o dată este deja blocată
 * @param {string} selectedDate - Data selectată
 * @param {boolean} isFullDay - Dacă se blochează toată ziua
 * @param {Array} selectedHours - Orele selectate (dacă nu e toată ziua)
 * @returns {Object} - Rezultatul verificării
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
        // În caz de eroare, permite operația să continue
        return { isBlocked: false };
    }
}


// Logout
function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('tokenTimestamp');
    window.location.href = 'login.html';
}