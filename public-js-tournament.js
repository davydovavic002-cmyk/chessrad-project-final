document.addEventListener('DOMContentLoaded', async () => {

    // --- БЛОК 1: АУТЕНТИФИКАЦИЯ ПОЛЬЗОВАТЕЛЯ ---
    let user;
    try {
        const response = await fetch('/api/profile');
        if (!response.ok) { // Правильная проверка статуса
            throw new Error('Пользователь не авторизован');
        }
        user = await response.json();
    } catch (error) {
        console.error('Ошибка аутентификации:', error.message);
        window.location.href = '/'; // Перенаправляем на главную
        return;
    }

    // Отображение статуса пользователя
    const userStatusDiv = document.getElementById('userstatus'); // ИСПРАВЛЕН ID
    if (userStatusDiv) {
        userStatusDiv.innerHTML = `Вы вошли как <strong>${user.username}</strong> <a href="#" id="logoutBtn">Выйти</a>`;
        document.getElementById('logoutBtn').addEventListener('click', async (e) => {
            e.preventDefault();
            if (window.socket) window.socket.disconnect();
            await fetch('/api/logout', { method: 'POST' });
            window.location.href = '/';
        });
    }

    // --- БЛОК 2: ПОДКЛЮЧЕНИЕ WEBSOCKET ---
    console.log('Клиент турнира: Попытка подключения к WebSocket...');
    const socket = io({ transports: ['websocket'] });
    window.socket = socket;

    // --- БЛОК 3: ПОЛУЧЕНИЕ ЭЛЕМЕНТОВ СТРАНИЦЫ (С ИСПРАВЛЕННЫМИ ID) ---
    const registerBtn = document.getElementById('registerBtn');
    const tournamentStatusEl = document.getElementById('tournamentstatus');
    const playerCountEl = document.getElementById('playercount');
    const playerListEl = document.getElementById('playerlist');
    const roundNumberEl = document.getElementById('roundnumber');
    const pairingsTableBody = document.querySelector('#pairingstable tbody');
    const standingsTableBody = document.querySelector('#standingstable tbody');

    // --- БЛОК 4: ОБРАБОТЧИКИ КНОПОК ---
    if (registerBtn) {
        const startBtn = document.createElement('button');
        startBtn.textContent = 'Начать турнир';
        startBtn.id = 'startTournamentBtn';
        startBtn.style.marginLeft = '10px';
        registerBtn.after(startBtn);

        registerBtn.addEventListener('click', () => socket.emit('tournament:register'));
        startBtn.addEventListener('click', () => socket.emit('tournament:start'));
    }

    // --- БЛОК 5: ОБРАБОТЧИКИ СОБЫТИЙ WEBSOCKET ---

    // Событие успешного подключения
    socket.on('connect', () => {
        console.log(`Успешно подключено к серверу. ID: ${socket.id}. Запрашиваем состояние турнира.`);
        // ИСПРАВЛЕНО: Отправляем ID турнира, который мы хотим получить
        socket.emit('tournament:getState', 'main-tournament-1');
    });

    // Ошибка подключения
    socket.on('connect_error', (err) => {
        if (err.message.includes('Authentication error')) {
            console.error('Ошибка аутентификации сокета. Перенаправление на страницу входа.', err.message);
            window.location.href = '/';
        } else {
            console.error('Ошибка подключения к сокету:', err.message);
        }
    });

    // Перенаправление на страницу игры
    socket.on('tournament:gameCreated', (data) => {
        console.log('ПОЛУЧЕНА команда tournament:gameCreated с данными:', data);
        if (data && data.gameId) {
            console.log(`ID игры: ${data.gameId}. Перенаправляем...`);
            // ИСПРАВЛЕНО: Используем правильный прямой слэш для URL
            window.location.href = `/game/${data.gameId}`;
        } else {
            console.error('Ошибка перенаправления: не получен gameId от сервера.');
        }
    });

    // ГЛАВНЫЙ ОБРАБОТЧИК: Обновление состояния всего интерфейса
    socket.on('tournament:stateUpdate', (state) => {
        console.log('--- ПОЛУЧЕНО ОБНОВЛЕНИЕ СОСТОЯНИЯ ТУРНИРА ---');
        console.log(state); // Раскрой этот объект в консоли браузера и изучи его!

        try {
            if (!state) {
                console.error('Критическая ошибка: объект state не пришел с сервера!');
                return;
            }
            if (state.error) {
                document.body.innerHTML = `<h1>Ошибка загрузки турнира: ${state.error}</h1>`;
                return;
            }

            tournamentStatusEl.textContent = getTournamentStatusText(state.status || 'unknown');
            roundNumberEl.textContent = state.currentRound || 0;

            const playersArray = Array.isArray(state.players) ? state.players : [];
            playerCountEl.textContent = playersArray.length;
            playerListEl.innerHTML = playersArray.map(player => `<li>${player.username}</li>`).join('');

            if (registerBtn && user) {
                const isRegistered = playersArray.some(p => p.id === user.id);
                registerBtn.disabled = isRegistered || state.status !== 'waiting';
                registerBtn.textContent = isRegistered ? 'Вы зарегистрированы' : 'Зарегистрироваться';
            }

            const pairingsArray = Array.isArray(state.pairings) ? state.pairings : [];
            if (pairingsArray.length > 0) {
                pairingsTableBody.innerHTML = pairingsArray.map(match => `
                    <tr>
                        <td>${match.player1 ? match.player1.username : 'Ожидание'}</td>
                        <td>${match.player2 ? match.player2.username : 'BYE (пропуск)'}</td>
                        <td>${match.result || 'не сыграно'}</td>
                    </tr>`).join('');
            } else {
                pairingsTableBody.innerHTML = '<tr><td colspan="3">Пары еще не сформированы</td></tr>';
            }

            const standingsArray = Array.isArray(state.standings) ? state.standings : [];
            if (standingsArray.length > 0) {
                standingsTableBody.innerHTML = standingsArray.map((player, index) => `
                    <tr>
                        <td>${index + 1}</td>
                        <td>${player.username}</td>
                        <td>${player.score}</td>
                        <td>${player.wins || 0}</td>
                        <td>${player.draws || 0}</td>
                        <td>${player.losses || 0}</td>
                    </tr>`).join('');
            } else {
                standingsTableBody.innerHTML = '<tr><td colspan="6">Таблица пуста</td></tr>';
            }

        } catch (error) {
            console.error('!!! ОШИБКА НА КЛИЕНТЕ ПРИ ОБРАБОТКЕ СОСТОЯНИЯ !!!', error);
            alert('Произошла ошибка при обновлении интерфейса. Подробности в консоли (F12).');
        }
    });

    // Обработка ошибок от сервера
    socket.on('tournament:error', (errorData) => {
        alert('Ошибка турнира: ' + (errorData.message || 'Произошла неизвестная ошибка.'));
    });

    // --- БЛОК 6: ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
    function getTournamentStatusText(status) {
        const statuses = { 'waiting': 'Ожидание регистрации', 'playing': 'Идет игра', 'finished': 'Завершен' };
        return statuses[status] || 'Неизвестный статус';
    }
});
