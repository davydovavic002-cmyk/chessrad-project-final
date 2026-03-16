document.addEventListener('DOMContentLoaded', async () => {

    // --- 1. АУТЕНТИФИКАЦИЯ ---
    let user;
    try {
        const response = await fetch('/api/profile');
        if (!response.ok) throw new Error('Пользователь не авторизован');
        user = await response.json();
    } catch (error) {
        console.error('Ошибка аутентификации:', error.message);
        window.location.href = '/';
        return;
    }

    const userStatusDiv = document.getElementById('user-status');
    if (userStatusDiv) {
        userStatusDiv.innerHTML = `Вы вошли как <strong>${user.username}</strong> | <a href="#" id="logoutBtn">Выйти</a>`;
        document.getElementById('logoutBtn').addEventListener('click', async (e) => {
            e.preventDefault();
            await fetch('/api/logout', { method: 'POST' });
            window.location.href = '/';
        });
    }

    // --- 2. ПОДКЛЮЧЕНИЕ WEBSOCKET ---
    const socket = io({
        withCredentials: true,
        transports: ['polling', 'websocket']
    });

    // --- 3. ПОЛУЧЕНИЕ ЭЛЕМЕНТОВ ---
    const registerBtn = document.getElementById('registerBtn');
    const tournamentStatusEl = document.getElementById('tournamentstatus');
    const playerCountEl = document.getElementById('playercount');
    const playerListEl = document.getElementById('playerlist');
    const roundNumberEl = document.getElementById('roundnumber');
    const pairingsTableBody = document.querySelector('#pairingstable tbody');
    const standingsTableBody = document.querySelector('#standingstable tbody');

    // Кнопка "Покинуть турнир"
    const leaveBtn = document.createElement('button');
    leaveBtn.textContent = 'Покинуть турнир';
    leaveBtn.className = 'btn-danger';
    leaveBtn.style.display = 'none';
    if (registerBtn) registerBtn.after(leaveBtn);

    // Кнопка "Запустить турнир"
    const startBtn = document.createElement('button');
    startBtn.textContent = 'Запустить турнир';
    startBtn.className = 'btn-secondary';
    startBtn.style.display = 'none';
    if (leaveBtn) leaveBtn.after(startBtn);

    // --- 4. ОБРАБОТЧИКИ КНОПОК ---
    registerBtn.addEventListener('click', () => {
        socket.emit('tournament:register');
    });

    leaveBtn.addEventListener('click', async () => {
        const result = await Swal.fire({
            title: 'Вы уверены?',
            text: "Вы хотите покинуть турнир?",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#e74c3c',
            cancelButtonColor: '#95a5a6',
            confirmButtonText: 'Да, покинуть',
            cancelButtonText: 'Отмена'
        });

        if (result.isConfirmed) {
            socket.emit('tournament:leave');
        }
    });

    startBtn.addEventListener('click', async () => {
        const result = await Swal.fire({
            title: 'Начать турнир?',
            text: "Регистрация будет закрыта, и начнутся первые игры.",
            icon: 'question',
            showCancelButton: true,
            confirmButtonColor: '#2ecc71',
            cancelButtonColor: '#95a5a6',
            confirmButtonText: 'Запустить!',
            cancelButtonText: 'Еще подождем'
        });

        if (result.isConfirmed) {
            socket.emit('tournament:start');
        }
    });

    // --- 5. ЛОГИКА ОБНОВЛЕНИЯ ИНТЕРФЕЙСА ---

    socket.on('connect', () => {
        socket.emit('tournament:getState', 'main-tournament-1');
    });

    socket.on('tournament:stateUpdate', (state) => {
        if (!state) return;

        tournamentStatusEl.textContent = getStatusText(state.status);
        roundNumberEl.textContent = state.currentRound || 0;

        const players = state.players || [];
        playerCountEl.textContent = `(${players.length})`;
        playerListEl.innerHTML = players.map(p => `<li>${p.username}</li>`).join('');

        const isRegistered = players.some(p => String(p.id) === String(user.id));

        if (state.status === 'waiting') {
            // ПРОВЕРКА РОЛИ АДМИНА
            if (user && user.role === 'admin') {
                startBtn.style.display = 'inline-block';
            } else {
                startBtn.style.display = 'none';
            }

            if (isRegistered) {
                registerBtn.style.display = 'none';
                leaveBtn.style.display = 'inline-block';
            } else {
                registerBtn.style.display = 'inline-block';
                registerBtn.disabled = false;
                registerBtn.textContent = 'Зарегистрироваться';
                leaveBtn.style.display = 'none';
            }
        } else {
            registerBtn.style.display = 'none';
            leaveBtn.style.display = 'none';
            startBtn.style.display = 'none';
        }

        updatePairingsTable(state);
        updateStandingsTable(state);
    });

    socket.on('tournament:gameCreated', (data) => {
        if (data.gameId) window.location.href = `/game/${data.gameId}`;
    });

    socket.on('tournament:error', (data) => {
        Swal.fire({
            icon: 'error',
            title: 'Ошибка турнира',
            text: data.message,
            confirmButtonColor: '#e74c3c'
        });
    });

    // --- 6. ФУНКЦИИ ВЫВОДА ---

    function updatePairingsTable(state) {
        if (!state.rounds || state.rounds.length === 0 || state.currentRound === 0) {
            pairingsTableBody.innerHTML = '<tr><td colspan="3" class="empty-msg">Пары еще не сформированы</td></tr>';
            return;
        }

        const currentRoundData = state.rounds[state.currentRound - 1];
        if (!currentRoundData) return;

        pairingsTableBody.innerHTML = currentRoundData.games.map(match => {
            const p1 = state.players.find(p => p.id === match.players[0])?.username || 'Неизвестно';
            const p2 = match.players[1]
                       ? (state.players.find(p => p.id === match.players[1])?.username || 'Неизвестно')
                       : '<span class="bye">ПРОПУСК (Bye)</span>';

            let resultDisplay = match.result || '<i>В процессе...</i>';

            if (!match.result && match.gameId && (match.players[0] === user.id || match.players[1] === user.id)) {
                resultDisplay = `<a href="/game/${match.gameId}" class="join-link">ВОЙТИ В ИГРУ</a>`;
            }

            return `<tr><td>${p1}</td><td>${p2}</td><td>${resultDisplay}</td></tr>`;
        }).join('');
    }

    function updateStandingsTable(state) {
        const players = state.players || [];
        if (players.length === 0) {
            standingsTableBody.innerHTML = '<tr><td colspan="6" class="empty-msg">Нет участников</td></tr>';
            return;
        }

        const stats = {};
        players.forEach(p => {
            stats[p.id] = { wins: 0, draws: 0, losses: 0 };
        });

        if (state.rounds) {
            state.rounds.forEach(round => {
                round.games.forEach(game => {
                    if (!game.result) return;
                    const [p1Id, p2Id] = game.players;
                    if (game.result === '1-0') {
                        if (stats[p1Id]) stats[p1Id].wins++;
                        if (p2Id && stats[p2Id]) stats[p2Id].losses++;
                    } else if (game.result === '0-1') {
                        if (stats[p1Id]) stats[p1Id].losses++;
                        if (p2Id && stats[p2Id]) stats[p2Id].wins++;
                    } else if (game.result === '1/2-1/2') {
                        if (stats[p1Id]) stats[p1Id].draws++;
                        if (p2Id && stats[p2Id]) stats[p2Id].draws++;
                    }
                });
            });
        }

        const sorted = [...players].sort((a, b) => b.score - a.score);

        standingsTableBody.innerHTML = sorted.map((p, index) => {
            const s = stats[p.id] || { wins: 0, draws: 0, losses: 0 };
            return `
                <tr>
                    <td class="col-rank">${index + 1}</td>
                    <td class="col-player">${p.username}</td>
                    <td class="col-stat"><strong>${p.score}</strong></td>
                    <td class="col-stat">${s.wins}</td>
                    <td class="col-stat">${s.draws}</td>
                    <td class="col-stat">${s.losses}</td>
                </tr>
            `;
        }).join('');
    }

    function getStatusText(status) {
        const map = {
            'waiting': 'Ожидание регистрации',
            'running': 'Турнир идет',
            'finished': 'Турнир завершен'
        };
        return map[status] || 'Неизвестно';
    }
});
