document.addEventListener('DOMContentLoaded', async () => {
    console.log('ЗАПУЩЕН СКРИПТ PROFILE.JS (Версия: Полный фарш с историей)');

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
        historyTable: document.getElementById('game-history-list'), // Наша таблица
        logout: document.getElementById('logout-btn')
    };

    try {
        const response = await fetch('/api/profile');
        if (!response.ok) throw new Error(`Ошибка: ${response.status}`);
        const user = await response.json();

        // 1. Статистика
        if (el.wins) el.wins.textContent = user.wins || 0;
        if (el.draws) el.draws.textContent = user.draws || 0;
        if (el.losses) el.losses.textContent = user.losses || 0;
        if (el.username) el.username.textContent = user.username;

        const rating = user.rating || 500;
        if (el.rating) el.rating.textContent = rating;

        // 2. Прогресс-бар
        const currentLevel = levels.find(l => rating >= l.min && rating < l.next);
        if (el.rank) el.rank.textContent = currentLevel.name;

        if (el.progress && el.points) {
            if (currentLevel.next !== Infinity) {
                const range = currentLevel.next - currentLevel.min;
                const pointsInLevel = rating - currentLevel.min;
                const percent = Math.max(5, Math.min(100, (pointsInLevel / range) * 100));
                el.progress.style.width = `${percent}%`;
                const nextLevel = levels[levels.indexOf(currentLevel) + 1].name;
                el.points.textContent = `До уровня "${nextLevel}" осталось ${currentLevel.next - rating} очков`;
            } else {
                el.progress.style.width = '100%';
                el.progress.style.background = 'linear-gradient(90deg, #FFD700, #FFA500)';
                el.points.textContent = 'Вы достигли вершины мастерства!';
            }
        }

        // 3. Трофеи
        if (el.trophyShelf && user.trophies) {
            const trophies = typeof user.trophies === 'string' ? JSON.parse(user.trophies) : user.trophies;
            if (trophies.length > 0) {
                const noMsg = document.getElementById('no-trophies');
                if (noMsg) noMsg.remove();
                trophies.forEach(t => {
                    const medal = document.createElement('div');
                    medal.className = `medal ${t.color || 'yellow'}`;
                    medal.innerHTML = '🏆';
                    medal.title = `${t.tournamentName} - ${t.place} место`;
                    medal.style.cssText = "width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: #ffd700; cursor: help; font-size: 20px;";
                    el.trophyShelf.appendChild(medal);
                });
            }
        }

        // 4. НОВОЕ: Логика Истории Матчей
        if (el.historyTable) {
            // Предположим, бэкенд отдает историю в user.history
            const history = user.history || [];

            if (history.length > 0) {
                el.historyTable.innerHTML = ''; // Очищаем текст "История пуста"

                history.slice(0, 5).forEach(game => { // Берем последние 5 игр
                    const row = document.createElement('tr');

                    // Красим результат: Победа - зеленая, Поражение - красная
                    let resColor = game.result === 'Победа' ? '#2ed573' : (game.result === 'Ничья' ? '#ff9f43' : '#ff4757');

                    row.innerHTML = `
                        <td>${game.opponent || 'Аноним'}</td>
                        <td style="color: ${resColor}; font-weight: bold;">${game.result}</td>
                        <td>${game.type || 'Матч'}</td>
                    `;
                    el.historyTable.appendChild(row);
                });
            }
        }

    } catch (e) {
        console.error("Ошибка:", e);
    }

    // 5. Выход
    if (el.logout) {
        el.logout.onclick = async () => {
            if (confirm("Выйти из аккаунта?")) {
                await fetch('/api/logout', { method: 'POST' });
                window.location.href = '/';
            }
        };
    }
});
