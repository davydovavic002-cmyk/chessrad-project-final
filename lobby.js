// lobby.js - Версия для httpOnly Cookies с разделом обучения

document.addEventListener('DOMContentLoaded', async () => {
    // Вместо этого мы сразу пытаемся получить данные профиля.
    // Если у пользователя есть валидная кука, сервер вернет данные.
    try {
        const response = await fetch('/api/profile', {
            method: 'GET'
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


    // --- НОВЫЙ БЛОК: РАЗДЕЛ ОБУЧЕНИЯ ---
    const studyControls = document.getElementById('study-controls');
    if (studyControls) {
        if (user.role === 'admin' || user.role === 'teacher') {
            // Интерфейс для учителя/админа: Карточка создания
            studyControls.innerHTML = `
                <div class="menu-card primary study-card" id="btn-create-study">
                    <div class="card-icon">👨‍🏫</div>
                    <div class="card-text">
                        <h3>Учебный класс</h3>
                        <p>Создать комнату и передать код ученику</p>
                    </div>
                </div>
            `;

            document.getElementById('btn-create-study').onclick = async () => {
                const res = await fetch('/api/study/create', { method: 'POST' });
                const data = await res.json();
                if (data.success) {
                    alert('Комната создана! Код: ' + data.roomCode);
                    window.location.href = `study.html?room=${data.roomCode}`;
                } else {
                    alert('Ошибка: ' + data.message);
                }
            };
        } else {
            // Интерфейс для ученика: Карточка входа с полем ввода
            studyControls.innerHTML = `
                <div class="menu-card study-card" style="cursor: default;">
                    <div class="card-icon">🎓</div>
                    <div class="card-text">
                        <h3>Вход на обучение</h3>
                        <div style="display: flex; gap: 10px; margin-top: 8px;">
                            <input type="text" id="study-code-input" placeholder="Код (напр. CH-A1B2)"
                                style="padding: 8px; border: 1px solid #ddd; border-radius: 6px; flex: 1; font-family: 'Inter';">
                            <button id="btn-join-study"
                                style="padding: 8px 15px; background: var(--blue-primary); color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                                Войти
                            </button>
                        </div>
                    </div>
                </div>
            `;

            document.getElementById('btn-join-study').onclick = async () => {
                const roomCode = document.getElementById('study-code-input').value.trim();
                if (!roomCode) return alert('Введите код!');

                const res = await fetch('/api/study/join', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ roomCode })
                });
                const data = await res.json();
                if (data.success) {
                    window.location.href = `study.html?room=${data.roomCode}`;
                } else {
                    alert(data.message);
                }
            };
        }
    }
    // --- КОНЕЦ БЛОКА ОБУЧЕНИЯ ---

    document.getElementById('logout-btn').addEventListener('click', async () => {
        if (window.socket) {
            window.socket.disconnect();
        }

        // Отправляем запрос на сервер, чтобы он удалил httpOnly куку
        await fetch('/api/logout', { method: 'POST' });

        // После этого перенаправляем на страницу входа
        window.location.href = '/';
    });

    console.log(`Интерфейс лобби успешно настроен для ${user.username}`);

    // Подключение к WebSocket
    connectWebSocket();
}

function connectWebSocket() {
    console.log('Клиент: Попытка подключения к WebSocket...');

    // При установке соединения браузер АВТОМАТИЧЕСКИ прикрепит httpOnly куку.
    window.socket = io("http://147.45.147.30:3000", {
      withCredentials: true
    });

    window.socket.on('connect', () => {
        console.log('Клиент: Успешно подключен к WebSocket серверу! ID:', window.socket.id);
    });

    window.socket.on('connect_error', (err) => {
        console.error('Клиент: Ошибка подключения к WebSocket -', err.message);
        if (err.message.includes("Authentication error")) {
            window.location.href = '/';
        }
    });
}
