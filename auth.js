// auth.js - Версия для httpOnly Cookies

document.addEventListener('DOMContentLoaded', () => {
    const authContainer = document.querySelector('.auth-container');

    // --- ИЗМЕНЕНИЕ 1: Удаляем проверку токена на клиенте ---
    // Эту проверку теперь будет делать сервер. Если пользователь уже залогинен и
    // попытается зайти на главную страницу, сервер сам его перенаправит в лобби.
    // Поэтому клиентский JS просто всегда показывает форму входа.

    if (authContainer) {
        authContainer.style.visibility = 'visible';
    }

    // --- Дальше логика переключения форм, она не меняется ---
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

            // --- ИЗМЕНЕНИЕ 2: Проверяем флаг успеха, а не сам токен ---
            if (!response.ok || !responseData.success) { // Добавляем проверку на responseData.success
                throw new Error(responseData.message || 'Ошибка входа');
            }

            // localStorage.setItem('jwtToken', responseData.token); // <-- ЭТА СТРОКА БОЛЬШЕ НЕ НУЖНА!

            // Просто переходим в лобби, браузер уже сохранил httpOnly куку.
            window.location.href = '/lobby.html';

        } catch (error) {
            displayError(error.message);
        }
    });

    // --- Логика регистрации остается без изменений ---
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideError();
        // ... ваш код регистрации не меняется
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
                body: JSON.stringify({ username: data.username, password: data.password })
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
