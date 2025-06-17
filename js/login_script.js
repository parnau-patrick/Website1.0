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
        
        document.addEventListener('DOMContentLoaded', () => {
            // Check if user is already logged in
            const token = localStorage.getItem('token');
            if (token) {
                // Verifică dacă token-ul a expirat
                const tokenTimestamp = localStorage.getItem('tokenTimestamp');
                const currentTime = new Date().getTime();
                
                // Dacă tokenul este mai vechi de 24 de ore, consideră-l expirat
                if (tokenTimestamp && (currentTime - tokenTimestamp > 24 * 60 * 60 * 1000)) {
                    localStorage.removeItem('token');
                    localStorage.removeItem('tokenTimestamp');
                } else {
                    window.location.href = 'admin-dashboard.html';
                }
            }
            
            const loginForm = document.getElementById('loginForm');
            const errorMessage = document.getElementById('errorMessage');
            const loginButton = document.getElementById('loginButton');
            const loadingIndicator = document.getElementById('loadingIndicator');
            
            loginForm.addEventListener('submit', async (event) => {
                event.preventDefault();
                
                // Dezactivează butonul și arată indicatorul de loading
                loginButton.disabled = true;
                loadingIndicator.style.display = 'inline-block';
                
                const username = document.getElementById('username').value.trim();
                const password = document.getElementById('password').value;
                
                if (!username || !password) {
                    showError('Completați toate câmpurile!');
                    resetButton();
                    return;
                }
                
                try {
                    // Send login request
                    const response = await fetch(`${API_URL}/login`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ username, password })
                    });
                    
                    let data;
                    try {
                        data = await response.json();
                    } catch (e) {
                        throw new Error('Răspuns invalid de la server');
                    }
                    
                    if (!response.ok) {
                        throw new Error(data.message || 'Autentificare eșuată!');
                    }
                    
                    if (data.success && data.token) {
                        // Store token with timestamp and redirect to dashboard
                        localStorage.setItem('token', data.token);
                        localStorage.setItem('tokenTimestamp', new Date().getTime());
                        window.location.href = 'admin-dashboard.html';
                    } else {
                        showError('Autentificare eșuată!');
                        resetButton();
                    }
                } catch (error) {
                    logger.error('Login error:', error);
                    showError(error.message || 'Eroare de autentificare!');
                    resetButton();
                }
            });
            
            function showError(message) {
                errorMessage.textContent = message;
                errorMessage.style.display = 'block';
                
                // Hide error after 4 seconds
                setTimeout(() => {
                    errorMessage.style.display = 'none';
                }, 4000);
            }
            
            function resetButton() {
                loginButton.disabled = false;
                loadingIndicator.style.display = 'none';
            }
            
            // Prevenire atacuri XSS prin sanitizarea inputurilor
            function sanitizeInput(input) {
                const div = document.createElement('div');
                div.textContent = input;
                return div.innerHTML;
            }
        });
        
       
        if (window.self !== window.top) {
            window.top.location = window.self.location;
        }