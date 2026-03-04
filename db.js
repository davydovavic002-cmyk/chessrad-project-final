import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import bcrypt from 'bcryptjs';
import fs from 'fs';

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
        if (!fs.existsSync('./db')) fs.mkdirSync('./db');
        db = await open({
            filename: './db/chess-app.db',
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
            wins INTEGER NOT NULL DEFAULT 0,
            losses INTEGER NOT NULL DEFAULT 0,
            draws INTEGER NOT NULL DEFAULT 0,
            level TEXT NOT NULL DEFAULT 'Новичок',
            rating INTEGER NOT NULL DEFAULT 500,
            trophies TEXT DEFAULT '[]'
        );
    `);
    // НОВАЯ ТАБЛИЦА: История игр
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
    console.log('[DB] База данных инициализирована (Users + Games History).');
};

export const addUser = async (username, password) => {
    const db = await getDbConnection();
    const password_hash = await bcrypt.hash(password, 10);
    const result = await db.run(
        'INSERT INTO users (username, password_hash) VALUES (?, ?)',
        [username, password_hash]
    );
    return result.lastID;
};

export const findUserByUsername = async (username) => {
    const db = await getDbConnection();
    return db.get('SELECT * FROM users WHERE username = ?', username);
};

// ОБНОВЛЕНО: теперь возвращает пользователя вместе с массивом истории игр
export const findUserById = async (id) => {
    const db = await getDbConnection();
    const user = await db.get('SELECT id, username, wins, losses, draws, level, rating, trophies FROM users WHERE id = ?', id);
    if (!user) return null;

    // Получаем 5 последних игр, где участвовал этот ID
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

// НОВАЯ ФУНКЦИЯ: Запись результата матча в таблицу games
export const saveGameResult = async (p1_id, p2_id, winner_id, type = 'Обычный') => {
    const db = await getDbConnection();
    const date = new Date().toLocaleDateString('ru-RU');

    // Результат для Player 1
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
            await db.run('UPDATE users SET draws = draws + 1, rating = rating + 5 WHERE id = ? OR id = ?', [winnerId, loserId]);
            await saveGameResult(winnerId, loserId, null); // Записываем ничью
        } else {
            await db.run('UPDATE users SET wins = wins + 1, rating = rating + 15 WHERE id = ?', [winnerId]);
            await db.run('UPDATE users SET losses = losses + 1, rating = MAX(0, rating - 10) WHERE id = ?', [loserId]);
            await saveGameResult(winnerId, loserId, winnerId); // Записываем победу
        }
        // Пересчет уровней
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

export const addTrophyToUser = async (userId, trophy) => {
    const db = await getDbConnection();
    try {
        const user = await db.get('SELECT trophies FROM users WHERE id = ?', userId);
        let trophies = user && user.trophies ? JSON.parse(user.trophies) : [];
        trophies.unshift({ ...trophy, date: new Date().toLocaleDateString('ru-RU') });
        await db.run('UPDATE users SET trophies = ? WHERE id = ?', [JSON.stringify(trophies), userId]);
        return true;
    } catch (e) { return false; }
};
