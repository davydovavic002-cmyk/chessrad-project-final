import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

let db;

const LEVEL_THRESHOLDS = [
    { name: 'Большой мастер', min: 7500 },
    { name: 'Мастер', min: 4500 },
    { name: 'Опытный', min: 2500 },
    { name: 'Любитель', min: 1500 },
    { name: 'Новичок', min: 0 }
];

function getLevelByRating(rating) {
    const level = LEVEL_THRESHOLDS.find(l => rating >= l.min);
    return level ? level.name : 'Новичок';
}

async function getDbConnection() {
    if (!db) {
        const dbDir = './db';
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        db = await open({
            filename: path.join(dbDir, 'chess-app.db'),
            driver: sqlite3.Database
        });
    }
    return db;
}

export const initDb = async () => {
    const db = await getDbConnection();

    // Таблица пользователей
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'student',
            wins INTEGER NOT NULL DEFAULT 0,
            losses INTEGER NOT NULL DEFAULT 0,
            draws INTEGER NOT NULL DEFAULT 0,
            level TEXT NOT NULL DEFAULT 'Новичок',
            rating INTEGER NOT NULL DEFAULT 500,
            win_streak INTEGER NOT NULL DEFAULT 0,
            trophies TEXT DEFAULT '[]'
        );
    `);

    // История игр
    await db.exec(`
        CREATE TABLE IF NOT EXISTS games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            player1_id INTEGER,
            player2_id INTEGER,
            winner_id INTEGER,
            result TEXT,
            game_type TEXT DEFAULT 'Обычный',
            date TEXT,
            FOREIGN KEY(player1_id) REFERENCES users(id),
            FOREIGN KEY(player2_id) REFERENCES users(id)
        );
    `);

    // Учебные комнаты
    await db.exec(`
        CREATE TABLE IF NOT EXISTS study_rooms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_code TEXT UNIQUE NOT NULL,
            teacher_id INTEGER NOT NULL,
            student_id INTEGER,
            fen TEXT DEFAULT 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(teacher_id) REFERENCES users(id),
            FOREIGN KEY(student_id) REFERENCES users(id)
        );
    `);

    // Таблица библиотеки позиций
    await db.exec(`
        CREATE TABLE IF NOT EXISTS position_library (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            teacher_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            category TEXT DEFAULT 'Общее',
            fen TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(teacher_id) REFERENCES users(id)
        );
    `);

    const tableInfo = await db.all("PRAGMA table_info(users)");

    const hasAvatar = tableInfo.some(column => column.name === 'avatar_url');
    if (!hasAvatar) {
        await db.exec('ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT ""');
    }

    const hasMustChange = tableInfo.some(column => column.name === 'must_change_password');
    if (!hasMustChange) {
        await db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0');
    }

    console.log('[DB] База данных инициализирована.');
};

export const addUser = async (username, password, role = 'student') => {
    const db = await getDbConnection();
    const password_hash = await bcrypt.hash(password, 10);
    const result = await db.run(
        'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
        [username, password_hash, role]
    );
    return result.lastID;
};

export const findUserByUsername = async (username) => {
    const db = await getDbConnection();
    return db.get('SELECT * FROM users WHERE username = ?', username);
};

export const findUserById = async (id) => {
    const db = await getDbConnection();
    const user = await db.get(`
        SELECT id, username, role, wins, losses, draws, level, rating,
               win_streak, trophies, must_change_password, avatar_url
        FROM users WHERE id = ?
    `, id);

    if (!user) return null;

    const history = await db.all(`
        SELECT
            CASE WHEN g.player1_id = ? THEN u2.username ELSE u1.username END as opponent,
            g.result,
            g.game_type as type
        FROM games g
        LEFT JOIN users u1 ON g.player1_id = u1.id
        LEFT JOIN users u2 ON g.player2_id = u2.id
        WHERE g.player1_id = ? OR g.player2_id = ?
        ORDER BY g.id DESC LIMIT 5
    `, [id, id, id]);

    return { ...user, history: history || [] };
};

export const saveGameResult = async (p1_id, p2_id, winner_id, type = 'Обычный') => {
    const db = await getDbConnection();
    const date = new Date().toLocaleDateString('ru-RU');
    let res1 = (winner_id === p1_id) ? 'Победа' : (winner_id === null ? 'Ничья' : 'Поражение');

    await db.run(
        'INSERT INTO games (player1_id, player2_id, winner_id, result, game_type, date) VALUES (?, ?, ?, ?, ?, ?)',
        [p1_id, p2_id, winner_id, res1, type, date]
    );
};

export const updateUserStats = async (winnerId, loserId, isDraw = false) => {
    const db = await getDbConnection();
    try {
        if (isDraw) {
            await db.run('UPDATE users SET draws = draws + 1, rating = rating + 5, win_streak = 0 WHERE id = ? OR id = ?', [winnerId, loserId]);
            await saveGameResult(winnerId, loserId, null);
        } else {
            const winner = await db.get('SELECT win_streak FROM users WHERE id = ?', [winnerId]);
            const newStreak = (winner ? winner.win_streak : 0) + 1;
            const points = newStreak >= 3 ? 25 : 15;

            await db.run('UPDATE users SET wins = wins + 1, rating = rating + ?, win_streak = ? WHERE id = ?', [points, newStreak, winnerId]);
            await db.run('UPDATE users SET losses = losses + 1, rating = MAX(0, rating - 10), win_streak = 0 WHERE id = ?', [loserId]);

            await saveGameResult(winnerId, loserId, winnerId);
        }

        const players = await db.all('SELECT id, rating FROM users WHERE id IN (?, ?)', [winnerId, loserId]);
        for (const player of players) {
            const newLevelName = getLevelByRating(player.rating);
            await db.run('UPDATE users SET level = ? WHERE id = ?', [newLevelName, player.id]);
        }
        return true;
    } catch (error) {
        console.error('[DB] Ошибка обновления статистики:', error);
        return false;
    }
};

// --- ФУНКЦИИ АДМИН-ПАНЕЛИ ---

export async function getAllUsers(sortBy = 'new') {
    const db = await getDbConnection();
    let orderBy = 'id DESC';
    if (sortBy === 'old') orderBy = 'id ASC';
    if (sortBy === 'rating') orderBy = 'rating DESC';
    if (sortBy === 'alphabet') orderBy = 'username COLLATE NOCASE ASC';

    return db.all(`SELECT id, username, role, rating, win_streak FROM users ORDER BY ${orderBy}`);
}

export async function updateUserRole(userId, newRole) {
    const db = await getDbConnection();
    return db.run('UPDATE users SET role = ? WHERE id = ?', [newRole, userId]);
}

export async function deleteUser(userId) {
    const db = await getDbConnection();
    return db.run('DELETE FROM users WHERE id = ?', [userId]);
}

export async function resetUserPassword(userId, tempPassword) {
    const internalDb = await getDbConnection();
    const hash = await bcrypt.hash(tempPassword, 10);
    return internalDb.run(
        'UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?',
        [hash, userId]
    );
}

// --- ФУНКЦИИ ПРОФИЛЯ ---

export async function updateOwnPassword(userId, newPassword) {
    const db = await getDbConnection();
    const hash = await bcrypt.hash(newPassword, 10);
    return db.run(
        'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?',
        [hash, userId]
    );
}

// --- ФУНКЦИИ ДЛЯ ОБУЧЕНИЯ ---

export const createStudyRoom = async (teacherId, roomCode) => {
    const db = await getDbConnection();
    await db.run('INSERT INTO study_rooms (teacher_id, room_code) VALUES (?, ?)', [teacherId, roomCode]);
    return { teacherId, roomCode };
};

export const findStudyRoomByCode = async (code) => {
    const db = await getDbConnection();
    return await db.get(`
        SELECT r.*, u.username as teacher_name
        FROM study_rooms r
        JOIN users u ON r.teacher_id = u.id
        WHERE r.room_code = ?
    `, [code]);
};

export const joinStudentToRoom = async (roomCode, studentId) => {
    const db = await getDbConnection();
    await db.run('UPDATE study_rooms SET student_id = ? WHERE room_code = ?', [studentId, roomCode]);
};

export const updateStudyRoomFen = async (roomCode, fen) => {
    const db = await getDbConnection();
    await db.run('UPDATE study_rooms SET fen = ? WHERE room_code = ?', [fen, roomCode]);
};

export const countTeacherRooms = async (teacherId) => {
    const db = await getDbConnection();
    const result = await db.get('SELECT COUNT(*) as count FROM study_rooms WHERE teacher_id = ?', [teacherId]);
    return result.count;
};

export const deleteStudyRoom = async (roomCode, teacherId) => {
    const db = await getDbConnection();
    return await db.run('DELETE FROM study_rooms WHERE room_code = ? AND teacher_id = ?', [roomCode, teacherId]);
};

export const getTeacherRooms = async (teacherId) => {
    const db = await getDbConnection();
    return await db.all('SELECT * FROM study_rooms WHERE teacher_id = ? ORDER BY created_at DESC', [teacherId]);
};

export const addTrophyToUser = async (userId, trophy) => {
    const db = await getDbConnection();
    try {
        const user = await db.get('SELECT trophies FROM users WHERE id = ?', [userId]);
        let trophies = [];
        try {
            trophies = (user && user.trophies) ? JSON.parse(user.trophies) : [];
        } catch (e) { trophies = []; }

        trophies.unshift({ ...trophy, date: new Date().toLocaleDateString('ru-RU') });
        await db.run('UPDATE users SET trophies = ? WHERE id = ?', [JSON.stringify(trophies), userId]);
        return true;
    } catch (e) { return false; }
};

// --- ФУНКЦИИ БИБЛИОТЕКИ ПОЗИЦИЙ (ОБЩИЕ ДЛЯ ВСЕХ УЧИТЕЛЕЙ) ---

export const addPosition = async (teacherId, title, category, fen) => {
    const db = await getDbConnection();
    const finalCategory = category || 'Общее';
    return await db.run(
        'INSERT INTO position_library (teacher_id, title, category, fen) VALUES (?, ?, ?, ?)',
        [teacherId, title, finalCategory, fen]
    );
};

export const updatePosition = async (posId, teacherId, { title, category, fen }) => {
    const db = await getDbConnection();
    const finalCategory = category || 'Общее';
    // Убрана проверка teacher_id, чтобы любой учитель мог обновить
    return await db.run(
        'UPDATE position_library SET title = ?, category = ?, fen = ? WHERE id = ?',
        [title, finalCategory, fen, posId]
    );
};

export const getTeacherPositions = async () => {
    const db = await getDbConnection();
    // Возвращает все позиции для всех учителей
    return await db.all(`
        SELECT
            pl.id,
            pl.teacher_id,
            u.username as author_name,
            pl.title,
            COALESCE(pl.category, 'Общее') as category,
            pl.fen,
            pl.created_at
        FROM position_library pl
        JOIN users u ON pl.teacher_id = u.id
        ORDER BY category, title
    `);
};

export const deletePosition = async (posId) => {
    const db = await getDbConnection();
    // Убрана проверка teacher_id, чтобы любой учитель мог удалить
    return await db.run('DELETE FROM position_library WHERE id = ?', [posId]);
};
