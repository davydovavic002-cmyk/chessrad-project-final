// lobby.js - Версия для httpOnly Cookies

document.addEventListener('DOMContentLoaded', async () => {
    // ИЗМЕНЕНИЕ 1: УДАЛЯЕМ ВСЕ УПОМИНАНИЯ localStorage
    // const token = localStorage.getItem('jwtToken'); // УДАЛЕНО
    // if (token) { ... } // УДАЛЕНО

    // Вместо этого мы сразу пытаемся получить данные профиля.
    // Если у пользователя есть валидная кука, сервер вернет данные.
    // Если нет, сервер вернет ошибку, и мы обработаем это.
    try {
        const response = await fetch('/api/profile', {
            method: 'GET' // Заголовки Authorization и Content-Type больше не нужны
        });

        if (response.ok) {
            const user = await response.json();
            setupLobbyUI(user);
        } else {
            // Если сервер вернул ошибку (например, 401 Unauthorized), значит куки нет или она неверна.
            console.log('Пользователь не авторизован. Перенаправление на страницу входа.');
            window.location.href = '/'; // Перенаправляем на главную
        }
    } catch (error) {
        console.error('Сетевая ошибка при получении профиля:', error);
        window.location.href = '/'; // На случай если сервер вообще не отвечает
    }
});

function setupLobbyUI(user) {
    const userStatusDiv = document.getElementById('user-status');
    const findGameBtn = document.getElementById('find-game-btn');
    const profileBtn = document.getElementById('profile-btn');
    const tournamentsBtn = document.getElementById('tournaments-btn');
    const lobbyContainer = document.querySelector('.lobby-container');

    if (!userStatusDiv || !profileBtn || !tournamentsBtn || !findGameBtn) {
        console.error('Не все элементы интерфейса лобби найдены!');
        return;
    }

    if (lobbyContainer) {
        lobbyContainer.style.visibility = 'visible';
    }

    userStatusDiv.innerHTML = `
        <span>Привет, <strong>${user.username}</strong>!</span>
        <button id="logout-btn" style="margin-left: 15px;">Выйти</button>
    `;

    profileBtn.disabled = false;
    profileBtn.addEventListener('click', () => { window.location.href = 'profile.html'; });

    findGameBtn.disabled = false;
    findGameBtn.addEventListener('click', () => { window.location.href = 'game.html'; });

    tournamentsBtn.disabled = false;
    tournamentsBtn.addEventListener('click', () => { window.location.href = 'tournament.html'; });

    // ИЗМЕНЕНИЕ 2: НОВАЯ ЛОГИКА ВЫХОДА
    document.getElementById('logout-btn').addEventListener('click', async () => {
        if (window.socket) {
            window.socket.disconnect();
        }

        // Отправляем запрос на сервер, чтобы он удалил httpOnly куку
        await fetch('/api/logout', { method: 'POST' });

        // localStorage.removeItem('jwtToken'); // УДАЛЕНО

        // После этого перенаправляем на страницу входа
        window.location.href = '/';
    });

    console.log(`Интерфейс лобби успешно настроен для ${user.username}`);

    // Подключение к WebSocket остается здесь же
    connectWebSocket();
}

function connectWebSocket() {
    // ИЗМЕНЕНИЕ 3: УПРОЩАЕМ ПОДКЛЮЧЕНИЕ WEBSOCKET
    // const socketToken = localStorage.getItem('jwtToken'); // УДАЛЕНО
    // if (!socketToken) return; // УДАЛЕНО

    console.log('Клиент: Попытка подключения к WebSocket...');

    // При установке соединения браузер АВТОМАТИЧЕСКИ прикрепит httpOnly куку.
    // Поэтому объект auth на клиенте больше не нужен.

    // --- ИСПРАВЛЕННЫЙ БЛОК ---
    // Вызов io() объединен в одну правильную команду с двумя аргументами
    window.socket = io("http://147.45.147.30:3000", {
      withCredentials: true // Этот объект сообщает socket.io, что нужно отправлять куки
    });
    // --- КОНЕЦ ИСПРАВЛЕННОГО БЛОКА ---

    window.socket.on('connect', () => {
        console.log('Клиент: Успешно подключен к WebSocket серверу! ID:', window.socket.id);
    });

    window.socket.on('connect_error', (err) => {
        console.error('Клиент: Ошибка подключения к WebSocket -', err.message);
        // Если сервер отклонил соединение, перенаправляем на вход
        if (err.message.includes("Authentication error")) {
            window.location.href = '/';
        }
    });
}
