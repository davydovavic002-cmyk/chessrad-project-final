// auth.js - Финальная версия под новый дизайн
document.addEventListener('DOMContentLoaded', () => {
    const authContainer = document.getElementById('auth-container');

    if (authContainer) {
        authContainer.style.display = 'block';
    }

    const loginView = document.getElementById('login-view');
    const registerView = document.getElementById('register-view');
    const showRegisterLink = document.getElementById('show-register');
    const showLoginLink = document.getElementById('show-login');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const errorMessageEl = document.getElementById('error-message');

    function displayError(message) {
        errorMessageEl.textContent = message;
        errorMessageEl.classList.remove('hidden');
    }

    function hideError() {
        errorMessageEl.classList.add('hidden');
    }

    showRegisterLink.addEventListener('click', (e) => {
        e.preventDefault();
        loginView.classList.add('hidden');
        registerView.classList.remove('hidden');
        hideError();
    });

    showLoginLink.addEventListener('click', (e) => {
        e.preventDefault();
        registerView.classList.add('hidden');
        loginView.classList.remove('hidden');
        hideError();
    });

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideError();

        const formData = new FormData(loginForm);
        const data = Object.fromEntries(formData.entries());

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            const responseData = await response.json();

            if (!response.ok || !responseData.success) {
                throw new Error(responseData.message || 'Неверный логин или пароль');
            }

            window.location.href = '/lobby.html';

        } catch (error) {
            displayError(error.message);
        }
    });

    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideError();

        const formData = new FormData(registerForm);
        const data = Object.fromEntries(formData.entries());

        if (data.password !== data.confirmPassword) {
            displayError('Пароли не совпадают');
            return;
        }

        try {
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: data.username,
                    password: data.password,
                    role: data.role // Отправляем роль на сервер
                })
            });

            const responseData = await response.json();

            if (!response.ok) {
                throw new Error(responseData.message || 'Ошибка регистрации');
            }

            alert('Регистрация успешна! Теперь вы можете войти.');
            showLoginLink.click();

        } catch (error) {
            displayError(error.message);
        }
    });
});
