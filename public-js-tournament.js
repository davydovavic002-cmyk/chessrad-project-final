document.addEventListener('DOMContentLoaded', async () => {

    // --- БЛОК 1: АУТЕНТИФИКАЦИЯ ПОЛЬЗОВАТЕЛЯ ---
    let user;
    try {
        const response = await fetch('/api/profile');
        if (!response.ok) { // Небольшое исправление для проверки статуса ответа
            throw new Error('Пользователь не авторизован');
        }
        user = await response.json();
    } catch (error) {
        console.error('Ошибка аутентификации:', error.message);
        window.location.href = '/'; // Перенаправляем на главную/страницу входа
        return;
    }

    // Отображение статуса пользователя и кнопки выхода
    const userStatusDiv = document.getElementById('user-status'); // Убедитесь, что ID в HTML = "user-status"
    if (userStatusDiv) {
        userStatusDiv.innerHTML = `Вы вошли как <strong>${user.username}</strong>. <a href="#" id="logout-btn">Выйти</a>`;

        document.getElementById('logout-btn').addEventListener('click', async (e) => {
            e.preventDefault();
            if (window.socket) {
                window.socket.disconnect();
            }
            await fetch('/api/logout', { method: 'POST' });
            window.location.href = '/';
        });
    }

    // --- БЛОК 2: ПОДКЛЮЧЕНИЕ WEBSOCKET ---
    console.log('Клиент турнира: Попытка подключения к WebSocket...');
// Тестовый вариант
const socket = io({
    transports: ['websocket'] // Пробуем подключиться сразу через WebSocket, минуя polling
    });
    window.socket = socket; // Делаем сокет доступным глобально для удобства

    // --- БЛОК 3: ПОЛУЧЕНИЕ ЭЛЕМЕНТОВ СТРАНИЦЫ ---
    const registerBtn = document.getElementById('registerBtn');
    const tournamentStatusEl = document.getElementById('tournament-status'); // Убедитесь, что ID в HTML = "tournament-status"
    const playerCountEl = document.getElementById('player-count');
    const playerListEl = document.getElementById('player-list');
    const roundNumberEl = document.getElementById('round-number');
    const pairingsTableBody = document.querySelector('#pairings-table tbody');
    const standingsTableBody = document.querySelector('#standings-table tbody');

    // --- БЛОК 4: ОБРАБОТЧИКИ КНОПОК ---
    if (registerBtn) {
        const startBtn = document.createElement('button');
        startBtn.textContent = 'Начать турнир';
        startBtn.id = 'start-tournament-btn';
        startBtn.style.marginLeft = '10px';
        registerBtn.after(startBtn);

        registerBtn.addEventListener('click', () => socket.emit('tournament:register'));
        startBtn.addEventListener('click', () => socket.emit('tournament:start'));
    } else {
        console.error('Элемент с id="registerBtn" не найден. Кнопки не будут работать.');
    }

    // --- БЛОК 5: ОБРАБОТЧИКИ СОБЫТИЙ WEBSOCKET ---

    // Событие успешного подключения
    socket.on('connect', () => {
        console.log(`Успешно подключено к серверу! ID: ${socket.id}. Запрашиваем состояние турнира.`);
        socket.emit('tournament:getState');
    });

    // Ошибка подключения
    socket.on('connect_error', (err) => {
        if (err.message.includes("Authentication error")) {
            console.error('Ошибка аутентификации сокета. Перенаправление на страницу входа.', err.message);
            window.location.href = '/';
        } else {
            console.error('Ошибка подключения к сокету:', err.message);
        }
    });

    // =======================================================================
    // ЕДИНСТВЕННЫЙ ПРАВИЛЬНЫЙ ОБРАБОТЧИК ДЛЯ ПЕРЕНАПРАВЛЕНИЯ НА ИГРУ
    // Все старые ('game:start_redirect' и 'tournamentGameCreated') были удалены.
    // =======================================================================
    socket.on('tournament:gameCreated', (data) => {
        console.log(`[Клиент] ПОЛУЧИЛ команду 'tournament:gameCreated' с данными:`, data);

        if (data && data.gameId) {
            console.log(`ID игры: ${data.gameId}. Перенаправляем...`);

            // ИСПОЛЬЗУЕМ ПРАВИЛЬНЫЙ СИНТАКСИС URL С ОБРАТНЫМИ КАВЫЧКАМИ (`)
            // Убедитесь, что этот URL соответствует вашим роутам на сервере.
            // Если у вас роут /game/:gameId, используйте этот вариант:
            window.location.href = `/game/${data.gameId}`;

            // Если вы используете отдельный HTML-файл, то URL должен быть таким:
            // window.location.href = `/tournament-game.html?gameId=${data.gameId}`;

        } else {
            console.error('Ошибка перенаправления: не получен gameId от сервера.');
        }
    });

    // Обновление общего состояния турнира
    socket.on('tournament:stateUpdate', (state) => {
        console.log('Получено обновление состояния турнира:', state);

        if (!tournamentStatusEl) return;

        tournamentStatusEl.textContent = getTournamentStatusText(state.status);
        roundNumberEl.textContent = state.currentRound || 0;
        playerCountEl.textContent = state.players.length;

        // Обновление списка игроков (более производительный способ)
        playerListEl.innerHTML = state.players.map(player => `<li>${player.username}</li>`).join('');

        // Обновление кнопки регистрации
        if (registerBtn && user) {
            const isRegistered = state.players.some(p => p.id === user.id);
            registerBtn.disabled = isRegistered || state.status !== 'waiting';
            registerBtn.textContent = isRegistered ? 'Вы зарегистрированы' : 'Зарегистрироваться';
        }

        // Обновление таблицы пар
        if (state.pairings && state.pairings.length > 0) {
            pairingsTableBody.innerHTML = state.pairings.map(match => `
                <tr>
                    <td>${match.player1 ? match.player1.username : 'Ожидание'}</td>
                    <td>${match.player2 ? match.player2.username : 'BYE (пропуск)'}</td>
                    <td>${match.result || 'не сыграно'}</td>
                </tr>
            `).join('');
        } else {
            pairingsTableBody.innerHTML = '<tr><td colspan="3">Пары еще не сформированы</td></tr>';
        }

        // Обновление таблицы лидеров
        if (state.standings && state.standings.length > 0) {
            standingsTableBody.innerHTML = state.standings.map((player, index) => `
                <tr>
                    <td>${index + 1}</td>
                    <td>${player.username}</td>
                    <td>${player.score}</td>
                    <td>${player.wins || 0}</td>
                    <td>${player.draws || 0}</td>
                    <td>${player.losses || 0}</td>
                </tr>
            `).join('');
        } else {
            standingsTableBody.innerHTML = '<tr><td colspan="6">Таблица пуста</td></tr>';
        }
    });

    // Обработка ошибок от сервера
    socket.on('tournament:error', (errorData) => {
        const errorMessage = errorData.message || 'Произошла неизвестная ошибка на сервере.';
        alert('Ошибка турнира: ' + errorMessage);
    });

    // --- БЛОК 6: ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
    function getTournamentStatusText(status) {
        const statuses = {
            'waiting': 'Ожидание регистрации',
            'playing': 'Идет игра',
            'finished': 'Завершен'
        };
        return statuses[status] || 'Неизвестный статус';
    }
});
