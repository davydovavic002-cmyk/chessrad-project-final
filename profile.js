// profile.js - Итоговая версия для httpOnly Cookies

document.addEventListener('DOMContentLoaded', async () => {
    console.log('ЗАПУЩЕН СКРИПТ PROFILE.JS (Версия для httpOnly Cookies)');

    const profileInfoDiv = document.getElementById('profile-info');
    const skillLevelSelect = document.getElementById('skill-level-select');
    const saveSkillBtn = document.getElementById('save-skill-btn');
    const skillSaveStatus = document.getElementById('skill-save-status');
    const logoutLink = document.getElementById('logout-link-profile');

    if (!profileInfoDiv || !skillLevelSelect || !saveSkillBtn || !skillSaveStatus || !logoutLink) {
        console.error('Критическая ошибка: один или несколько ключевых элементов UI не найдены на странице! Проверьте ID в HTML.');
        return;
    }

    // --- ИЗМЕНЕНИЕ 1: НОВАЯ ЛОГИКА ЗАГРУЗКИ ПРОФИЛЯ ---
    try {
        // Запрашиваем профиль. Браузер сам прикрепит httpOnly куку.
        const response = await fetch('/api/profile');

        if (!response.ok) {
            // Если ответ не "ok" (например, 401 Unauthorized), значит пользователь не авторизован.
            throw new Error(`Ошибка авторизации, статус: ${response.status}`);
        }

        const user = await response.json();
        // Отображаем информацию о пользователе
        profileInfoDiv.innerHTML = `
            <p><strong>Имя пользователя:</strong> ${user.username}</p>
            <p><strong>Рейтинг:</strong> ${user.elo || 1200}</p>
            <p><strong>Уровень:</strong> ${user.level || 'Не указан'}</p>
            <p><strong>Побед:</strong> ${user.wins || 0}</p>
            <p><strong>Поражений:</strong> ${user.losses || 0}</p>
            <p><strong>Ничьих:</strong> ${user.draws || 0}</p>
        `;

        if (user.level) {
            skillLevelSelect.value = user.level;
        }

    } catch (error) {
        console.error('Ошибка при загрузке профиля:', error.message);
        // Если что-то пошло не так (куки нет, она невалидна), просто перенаправляем на главную.
        window.location.href = '/';
        return; // Прекращаем выполнение скрипта, т.к. пользователь не авторизован
    }

    // --- ИЗМЕНЕНИЕ 2: УПРОЩЕННОЕ СОХРАНЕНИЕ УРОВНЯ ---
    saveSkillBtn.addEventListener('click', async () => {
        const newSkillLevel = skillLevelSelect.value;
        skillSaveStatus.textContent = 'Сохранение...';
        skillSaveStatus.style.color = 'inherit';

        try {
            const response = await fetch('/api/user/level', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    // Заголовок 'Authorization' больше не нужен, кука отправляется автоматически
                },
                body: JSON.stringify({ level: newSkillLevel }),
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || 'Ошибка сервера');
            }

            skillSaveStatus.style.color = 'green';
            skillSaveStatus.textContent = 'Сохранено!';

            // Перезагружаем страницу, чтобы обновить данные профиля
            window.location.reload();

        } catch (error) {
            skillSaveStatus.style.color = 'red';
            skillSaveStatus.textContent = `Ошибка: ${error.message}`;
        } finally {
            setTimeout(() => { skillSaveStatus.textContent = ''; }, 3000);
        }
    });

    // --- ИЗМЕНЕНИЕ 3: НОВАЯ ЛОГИКА ВЫХОДА ---
    logoutLink.addEventListener('click', async (event) => {
        event.preventDefault();

        // Отправляем запрос на сервер для удаления httpOnly куки
        await fetch('/api/logout', { method: 'POST' });

        // localStorage.removeItem('jwtToken'); // <-- БОЛЬШЕ НЕ НУЖНО

        // Перенаправляем на главную страницу
        window.location.href = '/';
    });
});
