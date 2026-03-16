document.addEventListener('DOMContentLoaded', () => {
    const authContainer = document.getElementById('auth-container');
    if (authContainer) { authContainer.style.display = 'block'; }

    const loginView = document.getElementById('login-view');
    const registerView = document.getElementById('register-view');
    const showRegisterLink = document.getElementById('show-register');
    const showLoginLink = document.getElementById('show-login');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');

    // Переключение между формами
    showRegisterLink.addEventListener('click', (e) => {
        e.preventDefault();
        loginView.classList.add('hidden');
        registerView.classList.remove('hidden');
    });

    showLoginLink.addEventListener('click', (e) => {
        e.preventDefault();
        registerView.classList.add('hidden');
        loginView.classList.remove('hidden');
    });

    // Вход
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(loginForm);
        const data = Object.fromEntries(formData.entries());

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
                credentials: 'include'
            });

            const responseData = await response.json();

            if (!response.ok || !responseData.success) {
                throw new Error(responseData.message || 'Неверный логин или пароль');
            }

            window.location.href = '/lobby.html';
        } catch (error) {
            Swal.fire({ icon: 'error', title: 'Ошибка входа', text: error.message, confirmButtonColor: '#e74c3c' });
        }
    });

    // Регистрация
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(registerForm);
        const data = Object.fromEntries(formData.entries());

        if (data.password !== data.confirmPassword) {
            Swal.fire({ icon: 'warning', title: 'Внимание', text: 'Пароли не совпадают' });
            return;
        }

        try {
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: data.username,
                    password: data.password,
                    role: data.role
                }),
                credentials: 'include'
            });

            const responseData = await response.json();

            if (!response.ok) {
                throw new Error(responseData.message || 'Ошибка регистрации');
            }

            await Swal.fire({
                icon: 'success',
                title: 'Успешно!',
                text: 'Регистрация завершена. Теперь вы можете войти.',
                confirmButtonColor: '#2ecc71'
            });
            showLoginLink.click();
        } catch (error) {
            Swal.fire({ icon: 'error', title: 'Ошибка', text: error.message });
        }
    });
});
