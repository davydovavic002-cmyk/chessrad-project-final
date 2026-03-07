// lobby.js - Версия для httpOnly Cookies с разделом обучения и логами

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const response = await fetch('/api/profile', {
            method: 'GET'
        });

        if (response.ok) {
            const user = await response.json();
            console.log('Профиль получен успешно:', user); // ЛОГ 1
            setupLobbyUI(user);
        } else {
            console.log('Пользователь не авторизован. Перенаправление на страницу входа.');
            window.location.href = '/';
        }
    } catch (error) {
        console.error('Сетевая ошибка при получении профиля:', error);
        window.location.href = '/';
    }
});

function setupLobbyUI(user) {
    const userStatusDiv = document.getElementById('user-status');
    const findGameBtn = document.getElementById('find-game-btn');
    const profileBtn = document.getElementById('profile-btn');
    const tournamentsBtn = document.getElementById('tournaments-btn');
    const lobbyContainer = document.querySelector('.lobby-container');

    if (!userStatusDiv || !profileBtn || !tournamentsBtn || !findGameBtn) {
        console.error('КРИТИЧЕСКАЯ ОШИБКА: Не все элементы интерфейса лобби найдены в HTML!'); // ЛОГ 2
        return;
    }

    if (lobbyContainer) {
        lobbyContainer.style.visibility = 'visible';
    }

    userStatusDiv.innerHTML = `
        <span>Привет, <strong>${user.username}</strong>!</span>
        <button id="logout-btn" style="margin-left: 15px;">Выйти</button>
    `;

    profileBtn.onclick = () => { window.location.href = 'profile.html'; };
    findGameBtn.onclick = () => { window.location.href = 'game.html'; };
    tournamentsBtn.onclick = () => { window.location.href = 'tournament.html'; };

    // --- РАЗДЕЛ ОБУЧЕНИЯ (С КНОПКОЙ ВОЙТИ) ---
    const studyControls = document.getElementById('study-controls');

    if (studyControls) {
        console.log('Контейнер study-controls найден. Роль пользователя:', user.role); // ЛОГ 3

        if (user.role === 'admin' || user.role === 'teacher') {
            console.log('Отрисовка интерфейса УЧИТЕЛЯ'); // ЛОГ 4
            studyControls.innerHTML = `
                <div class="menu-card primary study-card" id="btn-create-study" style="cursor: pointer; padding: 15px;">
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
                    alert(`КОМНАТА СОЗДАНА!\n\nКод для ученика: ${data.roomCode}\n\nНажми ОК, чтобы войти в класс.`);
                    window.location.href = `study.html?room=${data.roomCode}`;
                } else {
                    alert('Ошибка: ' + data.message);
                }
            };
        } else {
            console.log('Отрисовка интерфейса УЧЕНИКА'); // ЛОГ 5
            studyControls.innerHTML = `
                <div class="menu-card study-card" style="cursor: default; padding: 15px; min-height: auto;">
                    <div class="card-icon">🎓</div>
                    <div class="card-text" style="width: 100%;">
                        <h3>Вход на обучение</h3>
                        <div style="display: flex; flex-direction: row; flex-wrap: nowrap; gap: 8px; margin-top: 10px; align-items: center;">
                            <input type="text" id="study-code-input" placeholder="Код комнаты"
                                style="padding: 10px; border: 1px solid #ddd; border-radius: 6px; width: 180px; flex: none; font-family: 'Inter'; color: #333;">
                            <button id="btn-join-study"
                                style="display: block !important; padding: 10px 15px; background: #2ecc71; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; white-space: nowrap; flex-shrink: 0;">
                                Войти
                            </button>
                        </div>
                    </div>
                </div>
            `;

            const inputEl = document.getElementById('study-code-input');
            const joinBtn = document.getElementById('btn-join-study');

            const handleJoin = async () => {
                const roomCode = inputEl.value.trim().toUpperCase();
                if (!roomCode) return alert('Введите код!');
                try {
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
                } catch (err) {
                    alert('Ошибка сети');
                }
            };

            joinBtn.onclick = handleJoin;
            inputEl.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleJoin(); });
            joinBtn.onmouseover = () => joinBtn.style.background = '#27ae60';
            joinBtn.onmouseout = () => joinBtn.style.background = '#2ecc71';
        }
    } else {
        console.error('ОШИБКА: Элемент с id="study-controls" не найден на странице!'); // ЛОГ 6
    }

    document.getElementById('logout-btn').addEventListener('click', async () => {
        if (window.socket) window.socket.disconnect();
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = '/';
    });

    connectWebSocket();
}

function connectWebSocket() {
    window.socket = io("http://147.45.147.30:3000", { withCredentials: true });
    window.socket.on('connect', () => { console.log('WebSocket подключен'); });
    window.socket.on('connect_error', (err) => {
        if (err.message.includes("Authentication error")) window.location.href = '/';
    });
}
