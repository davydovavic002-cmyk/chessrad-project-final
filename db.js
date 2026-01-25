// database.js - ВЕРСИЯ ДЛЯ ES MODULES

// --- ШАГ 1: Заменяем все 'require' на 'import' ---
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import bcrypt from 'bcryptjs';
import fs from 'fs';

// Эта часть остается без изменений
let db;

async function getDbConnection() {
    if (!db) {
        if (!fs.existsSync('./db')) {
            fs.mkdirSync('./db');
        }

        db = await open({
            filename: './db/chess-app.db',
            driver: sqlite3.Database
        });
    }
    return db;
}

// --- ШАГ 2: Добавляем 'export' перед каждой функцией, которую нужно использовать в других файлах ---

export const initDb = async () => {
    const db = await getDbConnection();
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            wins INTEGER NOT NULL DEFAULT 0,
            losses INTEGER NOT NULL DEFAULT 0,
            draws INTEGER NOT NULL DEFAULT 0,
            level TEXT NOT NULL DEFAULT 'Новичок',
            rating INTEGER NOT NULL DEFAULT 1200
        );
    `);
    console.log('[DB] База данных успешно инициализирована.');
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

export const findUserById = async (id) => {
    const db = await getDbConnection();
    return db.get('SELECT id, username, wins, losses, draws, level, rating FROM users WHERE id = ?', id);
};

export const comparePasswords = async (password, hash) => {
    if (!password || !hash) return false;
    return bcrypt.compare(password, hash);
};

export const updateUserLevel = async (userId, newLevel) => {
    console.log(`[DB] Попытка обновить уровень. UserID: ${userId}, Новый уровень: ${newLevel}`);
    const db = await getDbConnection();
    try {
        const result = await db.run('UPDATE users SET level = ? WHERE id = ?', [newLevel, userId]);
        if (result.changes > 0) {
            console.log(`[DB] Уровень для UserID: ${userId} успешно обновлен.`);
            return { success: true };
        } else {
            console.log(`[DB] Пользователь с UserID: ${userId} не найден для обновления.`);
            return { success: false, message: 'User not found' };
        }
    } catch (err) {
        console.error('[DB] Ошибка при выполнении SQL-запроса на обновление уровня:', err);
        throw err;
    }
};

export const updateUserStats = async (winnerId, loserId, isDraw = false) => {
    const db = await getDbConnection();
    try {
        if (isDraw) {
            await db.run('UPDATE users SET draws = draws + 1 WHERE id = ? OR id = ?', [winnerId, loserId]);
            console.log(`[DB] Записана ничья для игроков ${winnerId} и ${loserId}`);
        } else {
            await db.run('UPDATE users SET wins = wins + 1, rating = rating + 10 WHERE id = ?', [winnerId]);
            await db.run('UPDATE users SET losses = losses + 1, rating = rating - 10 WHERE id = ?', [loserId]);
            console.log(`[DB] Записана победа для ${winnerId} и поражение для ${loserId}`);
        }
        return true;
    } catch (error) {
        console.error('Ошибка при обновлении статистики игроков:', error);
        return false;
    }
};

// --- ШАГ 3: Полностью удаляем 'module.exports' ---
// Старая строка `module.exports = { ... }` больше не нужна.
