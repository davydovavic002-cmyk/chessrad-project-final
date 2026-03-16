document.addEventListener('DOMContentLoaded', async () => {
    console.log('ЗАПУЩЕН СКРИПТ PROFILE.JS (Версия: SweetAlert2, Награды и Безопасность)');

    const levels = [
        { name: 'Новичок', min: 0, next: 1500 },
        { name: 'Любитель', min: 1500, next: 2500 },
        { name: 'Опытный', min: 2500, next: 4500 },
        { name: 'Мастер', min: 4500, next: 7500 },
        { name: 'Большой мастер', min: 7500, next: Infinity }
    ];

    const el = {
        wins: document.getElementById('wins-count'),
        draws: document.getElementById('draws-count'),
        losses: document.getElementById('losses-count'),
        username: document.getElementById('display-username'),
        rating: document.getElementById('display-rating'),
        rank: document.getElementById('current-rank-text'),
        progress: document.getElementById('progress-fill-bar'),
        points: document.getElementById('points-to-next-text'),
        trophyShelf: document.getElementById('trophy-shelf'),
        historyTable: document.getElementById('game-history-list'),
        logout: document.getElementById('logout-btn'),
        teacherPanel: document.getElementById('teacher-rooms-panel'),
        roomsList: document.getElementById('my-rooms-list'),
        roomsCount: document.getElementById('rooms-count-label')
    };

    // --- 1. ПРОВЕРКА АУТЕНТИФИКАЦИИ И ЗАГРУЗКА ДАННЫХ ---
    try {
        const response = await fetch('/api/profile');
        if (!response.ok) throw new Error(`Ошибка: ${response.status}`);
        const user = await response.json();

        window.userData = user; // Глобально для модалок

        // Статистика
        if (el.wins) el.wins.textContent = Number(user.wins) || 0;
        if (el.draws) el.draws.textContent = Number(user.draws) || 0;
        if (el.losses) el.losses.textContent = Number(user.losses) || 0;
        if (el.username) el.username.textContent = user.username;

        const rating = parseInt(user.rating) || 0;
        if (el.rating) el.rating.textContent = rating;

        // 2. ПРОГРЕСС-БАР
        const currentLevel = levels.find(l => rating >= l.min && rating < l.next) || levels[0];
        if (el.rank) el.rank.textContent = currentLevel.name;

        if (el.progress && el.points) {
            if (currentLevel.next !== Infinity) {
                const range = currentLevel.next - currentLevel.min;
                const pointsInLevel = rating - currentLevel.min;
                const percent = Math.max(5, Math.min(100, (pointsInLevel / range) * 100));
                el.progress.style.width = percent + '%';
                const nextLevelObj = levels[levels.indexOf(currentLevel) + 1];
                el.points.textContent = `До уровня "${nextLevelObj.name}" осталось ${currentLevel.next - rating} очков`;
            } else {
                el.progress.style.width = '100%';
                el.points.textContent = 'Вы достигли вершины мастерства!';
            }
        }

        // 3. ТРОФЕИ (Парсинг JSON)
        if (el.trophyShelf) {
            let trophies = [];
            try {
                trophies = typeof user.trophies === 'string' ? JSON.parse(user.trophies) : (user.trophies || []);
            } catch (e) { console.warn("Ошибка формата трофеев"); }

            if (trophies.length > 0) {
                const noMsg = document.getElementById('no-trophies');
                if (noMsg) noMsg.remove();
                el.trophyShelf.innerHTML = '';

                trophies.forEach(t => {
                    const medal = document.createElement('div');
                    const bgColor = { red: '#ff4757', blue: '#2e86de', green: '#2ed573', yellow: '#ffa502' }[t.color] || '#ffd700';
                    const icon = t.place === 1 ? '🏆' : '🏅';

                    medal.innerHTML = icon;
                    medal.title = `${t.tournamentName || 'Турнир'} - ${t.place} место (${t.date})`;
                    medal.style.cssText = `
                        width: 45px; height: 45px; border-radius: 50%;
                        display: inline-flex; align-items: center; justify-content: center;
                        background: ${bgColor}; cursor: help; font-size: 24px;
                        border: 2px solid rgba(0,0,0,0.2); margin-right: 10px;
                        box-shadow: 0 4px 10px rgba(0,0,0,0.3); transition: transform 0.2s;
                    `;
                    medal.onmouseover = () => medal.style.transform = 'scale(1.1)';
                    medal.onmouseout = () => medal.style.transform = 'scale(1)';
                    el.trophyShelf.appendChild(medal);
                });
            }
        }

        // 4. ИСТОРИЯ
        if (el.historyTable && user.history) {
            el.historyTable.innerHTML = user.history.slice(0, 5).map(game => {
                const resColor = game.result === 'Победа' ? '#2ed573' : (game.result === 'Ничья' ? '#ff9f43' : '#ff4757');
                return `<tr>
                    <td>${game.opponent || 'Аноним'}</td>
                    <td style="color: ${resColor}; font-weight: bold;">${game.result}</td>
                    <td>${game.type || 'Матч'}</td>
                </tr>`;
            }).join('');
        }

        // 5. ПАНЕЛЬ ПРЕПОДАВАТЕЛЯ
        if (user.role === 'teacher' || user.role === 'admin') {
            if (el.teacherPanel) {
                el.teacherPanel.style.display = 'block';
                if (!document.getElementById('lib-btn-link')) {
                    const libBtn = document.createElement('div');
                    libBtn.id = 'lib-btn-link';
                    libBtn.style.marginBottom = '20px';
                    libBtn.innerHTML = `
                        <a href="/library-editor.html" class="btn btn-primary" style="display: block; text-align: center; background: #3498db; text-decoration: none; padding: 12px; border-radius: 8px; font-weight: bold; color: white;">
                            📚 Управление библиотекой позиций
                        </a>`;
                    el.teacherPanel.prepend(libBtn);
                }
            }
            loadMyRooms();
        }

    } catch (e) {
        console.error("Ошибка в профиле:", e);
        window.location.href = '/';
    }

    // --- ФУНКЦИИ УПРАВЛЕНИЯ КОМНАТАМИ ---
    async function loadMyRooms() {
        if (!el.roomsList) return;
        try {
            const res = await fetch('/api/study/my-rooms');
            const data = await res.json();
            const rooms = data.rooms || [];
            if (el.roomsCount) el.roomsCount.textContent = rooms.length;

            el.roomsList.innerHTML = rooms.length === 0
                ? '<p class="subtitle">У вас нет активных комнат</p>'
                : rooms.map(room => `
                <div class="room-item-card" style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; margin-bottom: 8px; border: 1px solid rgba(255,255,255,0.1);">
                    <div><span style="font-weight: 800; color: #3498db; font-size: 1.1em;">${room.room_code}</span></div>
                    <div style="display: flex; gap: 8px;">
                        <a href="/study.html?room=${room.room_code}" class="btn btn-primary" style="padding: 6px 12px; font-size: 12px; text-decoration: none; border-radius: 4px;">Войти</a>
                        <button onclick="deleteRoom('${room.room_code}')" class="btn btn-danger" style="padding: 6px 12px; font-size: 12px; border-radius: 4px; border: none; cursor: pointer;">Удалить</button>
                    </div>
                </div>`).join('');
        } catch (err) {
            console.error(err);
        }
    }

    window.deleteRoom = async (code) => {
        const result = await Swal.fire({
            title: 'Удалить комнату?',
            text: `Код: ${code}. Все данные обучения в этой комнате будут стерты.`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#e74c3c',
            confirmButtonText: 'Удалить',
            cancelButtonText: 'Отмена'
        });

        if (result.isConfirmed) {
            try {
                const res = await fetch(`/api/study/${code}`, { method: 'DELETE' });
                if (res.ok) {
                    Swal.fire('Удалено!', 'Комната успешно удалена.', 'success');
                    loadMyRooms();
                } else {
                    Swal.fire('Ошибка', 'Не удалось удалить комнату', 'error');
                }
            } catch (err) { console.error(err); }
        }
    };

    if (el.logout) {
        el.logout.onclick = async () => {
            const result = await Swal.fire({
                title: 'Выйти из аккаунта?',
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Выйти',
                cancelButtonText: 'Остаться'
            });

            if (result.isConfirmed) {
                await fetch('/api/logout', { method: 'POST' });
                window.location.href = '/';
            }
        };
    }
});
