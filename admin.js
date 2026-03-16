document.addEventListener('DOMContentLoaded', loadUsers);

async function loadUsers() {
    try {
        const sortMode = document.getElementById('sort-mode').value;
        const res = await fetch(`/api/admin/users?sort=${sortMode}`);
        const data = await res.json();

        if (!data.success) {
            await Swal.fire({ icon: 'error', title: 'Доступ запрещен' });
            window.location.href = '/lobby.html';
            return;
        }

        const tbody = document.getElementById('users-list');
        tbody.innerHTML = '';

        data.users.forEach(user => {
            let displayRole = user.role;
            if (displayRole === "0" || displayRole === 0) displayRole = 'student';
            if (displayRole === "1" || displayRole === 1) displayRole = 'admin';

            const displayRating = (typeof user.rating === 'number') ? user.rating : '500';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${user.id}</td>
                <td>${user.username}</td>
                <td><span class="badge-role role-${displayRole}">${displayRole}</span></td>
                <td>${displayRating}</td>
                <td>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <select onchange="updateRole(${user.id}, this.value)">
                            <option value="student" ${displayRole === 'student' ? 'selected' : ''}>Студент</option>
                            <option value="teacher" ${displayRole === 'teacher' ? 'selected' : ''}>Учитель</option>
                            <option value="admin" ${displayRole === 'admin' ? 'selected' : ''}>Админ</option>
                        </select>
                        <button onclick="resetPassword(${user.id}, '${user.username}')" class="btn-action btn-reset">Сброс</button>
                        <button onclick="confirmDelete(${user.id}, '${user.username}')" class="btn-action btn-delete">Удалить</button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        console.error('Ошибка загрузки:', e);
    }
}

async function resetPassword(userId, username) {
    const { value: newPassword } = await Swal.fire({
        title: `Новый пароль для ${username}`,
        input: 'text',
        inputValue: '123456',
        showCancelButton: true,
        confirmButtonColor: '#3498db',
        inputValidator: (value) => {
            if (!value || value.length < 4) return 'Пароль должен быть не менее 4 символов!';
        }
    });

    if (!newPassword) return;

    try {
        const res = await fetch('/api/admin/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, newPassword })
        });
        const data = await res.json();
        if (data.success) {
            Swal.fire({ icon: 'success', title: 'Пароль сброшен', text: `Пользователь ${username} должен сменить его при входе.` });
        } else {
            Swal.fire({ icon: 'error', text: data.message });
        }
    } catch (e) {
        Swal.fire({ icon: 'error', text: 'Ошибка сети' });
    }
}

async function updateRole(userId, newRole) {
    const result = await Swal.fire({
        title: 'Изменить роль?',
        text: `Назначить пользователя на роль ${newRole}?`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#3498db',
        cancelButtonText: 'Отмена'
    });

    if (!result.isConfirmed) {
        loadUsers(); // Перезагружаем, чтобы сбросить значение select обратно
        return;
    }

    try {
        const res = await fetch('/api/admin/update-role', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, newRole })
        });
        const data = await res.json();
        if (data.success) {
            Swal.fire({ icon: 'success', title: 'Обновлено', timer: 1500, showConfirmButton: false });
            loadUsers();
        } else {
            Swal.fire({ icon: 'error', text: data.message });
        }
    } catch (e) {
        Swal.fire({ icon: 'error', text: 'Ошибка при обновлении' });
    }
}

async function confirmDelete(userId, username) {
    const result = await Swal.fire({
        title: 'Удалить пользователя?',
        text: `ВНИМАНИЕ! Действие для ${username} необратимо.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#e74c3c',
        confirmButtonText: 'Да, удалить!',
        cancelButtonText: 'Отмена'
    });

    if (!result.isConfirmed) return;

    try {
        const res = await fetch(`/api/admin/delete-user/${userId}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            Swal.fire({ icon: 'success', title: 'Удален', text: 'Пользователь успешно удален.' });
            loadUsers();
        } else {
            Swal.fire({ icon: 'error', text: data.message });
        }
    } catch (e) {
        Swal.fire({ icon: 'error', text: 'Ошибка сети' });
    }
}
