// ---------------------------------
// 1. ИМПОРТЫ И НАСТРОЙКА
// ---------------------------------
import 'dotenv/config';
import express from 'express';
import http from 'http';
import https from 'https';
import fs from 'fs';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import cookie from 'cookie';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import { Chess } from 'chess.js'; // Добавили импорт для проверки ходов на сервере

import {
    initDb,
    addUser,
    findUserByUsername,
    findUserById,
    updateUserStats,
    createStudyRoom,
    findStudyRoomByCode,
    joinStudentToRoom,
    updateStudyRoomFen,
    getTeacherRooms,
    deleteStudyRoom
} from './db.js';
import { Game } from './gamelogic.js';
import { Tournament } from './tournament.js';

const app = express();

let sslOptions;
try {
    sslOptions = {
        key: fs.readFileSync('/etc/letsencrypt/live/chessrad.app/privkey.pem'),
        cert: fs.readFileSync('/etc/letsencrypt/live/chessrad.app/fullchain.pem')
    };
} catch (err) {
    console.error('❌ Ошибка чтения SSL сертификатов:', err.message);
    process.exit(1);
}

const httpsServer = https.createServer(sslOptions, app);

const corsOptions = {
    origin: (origin, callback) => {
        if (!origin || origin.includes('chessrad.app')) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
};

app.use(cors(corsOptions));

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Слишком много попыток. Попробуйте позже." }
});

const io = new Server(httpsServer, {
    cors: corsOptions
});

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-if-env-missing';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------
// 2. ГЛОБАЛЬНОЕ СОСТОЯНИЕ СЕРВЕРА
// ---------------------------------
const activeGames = new Map();
const onlineUsers = new Map();
const matchmakingQueue = [];

let mainTournament;

function createAndAssignTournament() {
    mainTournament = new Tournament({
        io: io,
        games: activeGames,
        id: 'main-tournament-1',
        name: 'Главный еженедельный турнир',
    });
}

createAndAssignTournament();

app.get('/reset-tournament', (req, res) => {
    createAndAssignTournament();
    io.emit('tournament:stateUpdate', mainTournament.getState());
    res.redirect('/tournament.html');
});

// ---------------------------------
// 3. MIDDLEWARE
// ---------------------------------
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------
// 4. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ---------------------------------
const authenticateToken = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ message: 'Доступ запрещен' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: 'Недействительный токен' });
        req.user = user;
        next();
    });
};

const requireAdmin = async (req, res, next) => {
    try {
        const user = await findUserById(req.user.id);
        if (user && user.role === 'admin') {
            next();
        } else {
            res.status(403).json({ message: 'Требуются права администратора' });
        }
    } catch (e) {
        res.status(500).json({ message: 'Ошибка проверки прав' });
    }
};

async function comparePasswords(password, hash) {
    try { return await bcrypt.compare(password, hash); }
    catch (error) { return false; }
}

async function handleGameResultUpdate(winnerId, loserId, isDraw) {
    try {
        await updateUserStats(winnerId, loserId, isDraw);
    } catch (error) {
        console.error('[Stats] Ошибка обновления статистики:', error);
    }
}

function createAndStartGame(player1Socket, player2Socket) {
    if (!player1Socket.user || !player2Socket.user) {
        console.error('❌ Ошибка: Попытка создать игру для неавторизованных сокетов');
        return;
    }

    const isPlayer1White = Math.random() < 0.5;
    const white = isPlayer1White ? player1Socket : player2Socket;
    const black = isPlayer1White ? player2Socket : player1Socket;

    const game = new Game({
        io: io,
        playerWhite: { socket: white, user: white.user },
        playerBlack: { socket: black, user: black.user },
        onGameResult: handleGameResultUpdate,
        onGameEnd: (gameId) => activeGames.delete(gameId)
    });

    activeGames.set(game.getId(), game);
    game.start();
}

// ---------------------------------
// 5. API РОУТЫ
// ---------------------------------

app.post('/api/register', authLimiter, async (req, res) => {
    let { username, password, role } = req.body;
    if (username) username = username.replace(/<\/?[^>]+(>|$)/g, "").trim();

    if (!username || !password || password.length < 4) {
        return res.status(400).json({ message: 'Ошибка валидации' });
    }

    try {
        const existingUser = await findUserByUsername(username);
        if (existingUser) return res.status(409).json({ message: 'Пользователь существует' });

        const userRole = (role === 'teacher') ? 'teacher' : 'student';
        await addUser(username, password, userRole);

        res.status(201).json({ message: 'Успех' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

app.post('/api/login', authLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await findUserByUsername(username);

        if (!user || !(await comparePasswords(password, user.password_hash))) {
            return res.status(401).json({ success: false, message: 'Неверные данные' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '1d' }
        );

        res.cookie('token', token, {
            httpOnly: true,
            maxAge: 86400000,
            sameSite: 'Lax',
            secure: true,
            path: '/'
        });

        res.status(200).json({ success: true });
    } catch (e) {
        console.error('Login error:', e);
        res.status(500).json({ success: false });
    }
});

app.get('/api/profile', authenticateToken, async (req, res) => {
    try {
        const user = await findUserById(req.user.id);
        if (!user) return res.status(404).json({ message: 'Пользователь не найден' });
        const { password_hash, ...profileData } = user;
        res.json(profileData);
    } catch (e) {
        res.status(500).json({ message: 'Ошибка сервера при загрузке профиля' });
    }
});

app.post('/api/profile/change-password', authenticateToken, async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        const userId = req.user.id;

        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({ message: 'Пароль слишком короткий' });
        }

        const user = await findUserById(userId);

        const match = await bcrypt.compare(oldPassword, user.password_hash);
        if (!match) {
            return res.status(401).json({ message: 'Текущий пароль неверный' });
        }

        const { updateOwnPassword } = await import('./db.js');
        await updateOwnPassword(userId, newPassword);

        res.json({ success: true, message: 'Пароль успешно обновлен' });
    } catch (e) {
        console.error('Ошибка смены пароля:', e);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

app.get('/game/:gameId', authenticateToken, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'tournament-game.html'));
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true });
});

app.get('/lobby', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'lobby.html'));
});

// --- АДМИН-ПАНЕЛЬ ---

app.get('/admin', authenticateToken, requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const sortMode = req.query.sort || 'new';
        const { getAllUsers } = await import('./db.js');
        const users = await getAllUsers(sortMode);
        res.json({ success: true, users });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

app.post('/api/admin/update-role', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { userId, newRole } = req.body;
        const { updateUserRole } = await import('./db.js');
        await updateUserRole(userId, newRole);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

app.delete('/api/admin/delete-user/:userId', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { deleteUser } = await import('./db.js');
        await deleteUser(req.params.userId);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

app.post('/api/admin/reset-password', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { userId, newPassword } = req.body;
        if (!newPassword || newPassword.length < 4) {
            return res.status(400).json({ success: false, message: 'Пароль короткий' });
        }
        const { resetUserPassword } = await import('./db.js');
        await resetUserPassword(userId, newPassword);
        res.json({ success: true, message: 'Пароль сброшен' });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

// --- ОБУЧЕНИЕ ---

app.post('/api/study/create', authenticateToken, async (req, res) => {
    try {
        const user = await findUserById(req.user.id);
        if (user.role !== 'teacher' && user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Нужна роль учителя' });
        }
        const { countTeacherRooms } = await import('./db.js');
        const roomCount = await countTeacherRooms(user.id);
        if (roomCount >= 5) {
            return res.status(429).json({ success: false, message: 'Лимит комнат' });
        }
        const roomCode = 'CH-' + Math.random().toString(36).substring(2, 7).toUpperCase();
        await createStudyRoom(user.id, roomCode);
        res.json({ success: true, roomCode });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

app.post('/api/study/join', authenticateToken, async (req, res) => {
    try {
        const { roomCode } = req.body;
        const room = await findStudyRoomByCode(roomCode);
        if (!room) return res.status(404).json({ success: false });
        if (room.teacher_id !== req.user.id) {
            await joinStudentToRoom(roomCode, req.user.id);
        }
        res.json({ success: true, roomCode });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

app.get('/api/study/my-rooms', authenticateToken, async (req, res) => {
    try {
        const rooms = await getTeacherRooms(req.user.id);
        res.json({ success: true, rooms: rooms || [] });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

app.delete('/api/study/:roomCode', authenticateToken, async (req, res) => {
    try {
        const result = await deleteStudyRoom(req.params.roomCode, req.user.id);
        if (result && result.changes > 0) {
            res.json({ success: true });
        } else {
            res.status(403).json({ success: false });
        }
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

app.get('/api/positions', authenticateToken, async (req, res) => {
    try {
        const { getTeacherPositions } = await import('./db.js');
        const positions = await getTeacherPositions();
        res.json(positions);
    } catch (e) {
        res.status(500).json({ message: 'Ошибка при получении библиотеки' });
    }
});

app.post('/api/positions', authenticateToken, async (req, res) => {
    try {
        const { title, category, fen } = req.body;
        if (!title || !fen) return res.status(400).json({ message: 'Данные обязательны' });
        const { addPosition } = await import('./db.js');
        await addPosition(req.user.id, title, category, fen);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ message: 'Ошибка при добавлении' });
    }
});

app.delete('/api/positions/:id', authenticateToken, async (req, res) => {
    try {
        const { deletePosition } = await import('./db.js');
        await deletePosition(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ message: 'Ошибка при удалении' });
    }
});

app.put('/api/positions/:id', authenticateToken, async (req, res) => {
    try {
        const positionId = req.params.id;
        const { title, category, fen } = req.body;
        const { updatePosition } = await import('./db.js');
        const result = await updatePosition(positionId, null, { title, category, fen });

        if (result && result.changes > 0) {
            res.json({ success: true });
        } else {
            res.status(404).json({ success: false, message: 'Позиция не найдена' });
        }
    } catch (e) {
        res.status(500).json({ message: 'Ошибка при обновлении' });
    }
});

// ---------------------------------
// 6. ЛОГИКА SOCKET.IO
// ---------------------------------
io.use((socket, next) => {
    const cookieString = socket.handshake.headers.cookie;
    if (!cookieString) return next(new Error('No cookies'));
    const cookies = cookie.parse(cookieString);
    if (!cookies.token) return next(new Error('No token'));

    jwt.verify(cookies.token, JWT_SECRET, (err, payload) => {
        if (err) return next(new Error('Auth error'));
        socket.user = payload;
        next();
    });
});

io.on('connection', (socket) => {
    if (!socket.user || !socket.user.id) {
        console.warn('⚠️ Подключение сокета без данных пользователя прервано');
        return socket.disconnect();
    }

    onlineUsers.set(socket.user.id, { id: socket.user.id, username: socket.user.username, socket: socket });

    socket.on('study:join', async ({ roomCode }) => {
        const room = await findStudyRoomByCode(roomCode);
        if (room) {
            socket.join(roomCode);
            socket.emit('study:roomData', room);
        }
    });

    socket.on('study:move', async ({ roomCode, fen, type }) => {
        const room = await findStudyRoomByCode(roomCode);
        if (!room) return;

        const isTeacher = (room.teacher_id === socket.user?.id || socket.user?.role === 'admin');
        if ((type === 'demo' || type === 'edit') && !isTeacher) return;

        await updateStudyRoomFen(roomCode, fen);
        socket.to(roomCode).emit('study:syncMove', { fen, type });

        // АВТОСОХРАНЕНИЕ РЕЗУЛЬТАТА ДЛЯ РЕЖИМА "PLAY"
        if (type === 'play') {
            const game = new Chess(fen);
            if (game.game_over()) {
                if (room.teacher_id && room.student_id) {
                    let winnerId = null;
                    let loserId = null;
                    let isDraw = false;

                    if (game.in_checkmate()) {
                        if (game.turn() === 'w') {
                            winnerId = room.student_id;
                            loserId = room.teacher_id;
                        } else {
                            winnerId = room.teacher_id;
                            loserId = room.student_id;
                        }
                    } else {
                        isDraw = true;
                        winnerId = room.teacher_id;
                        loserId = room.student_id;
                    }

                    await updateUserStats(winnerId, loserId, isDraw);

                    // НОВОЕ: Отправка уведомления всем участникам комнаты
                    io.to(roomCode).emit('study:gameFinished', {
                        winnerId,
                        isDraw
                    });

                    console.log(`[Study] Game result saved and broadcasted for room ${roomCode}`);
                }
            }
        }
    });

    socket.on('study:changeMode', async ({ roomCode, mode }) => {
        const room = await findStudyRoomByCode(roomCode);
        if (room && (room.teacher_id === socket.user?.id || socket.user?.role === 'admin')) {
            socket.to(roomCode).emit('study:syncMode', { mode });
        }
    });

    socket.on('study:draw', async ({ roomCode, shapes }) => {
        const room = await findStudyRoomByCode(roomCode);
        if (room && (room.teacher_id === socket.user?.id || socket.user?.role === 'admin')) {
            socket.to(roomCode).emit('study:syncDraw', { shapes });
        }
    });

    socket.on('findGame', () => {
        const currentUserId = socket.user?.id;
        if (!currentUserId) return;

        const idx = matchmakingQueue.findIndex(s => s.user?.id === currentUserId);
        if (idx !== -1) matchmakingQueue.splice(idx, 1);
        matchmakingQueue.push(socket);
        if (matchmakingQueue.length >= 2) {
            createAndStartGame(matchmakingQueue.shift(), matchmakingQueue.shift());
        }
    });

    socket.on('tournament:getState', (tournamentId) => {
        if (mainTournament && mainTournament.id === tournamentId) {
            socket.emit('tournament:stateUpdate', mainTournament.getState());
        }
    });

    socket.on('tournament:register', () => {
        if (!mainTournament || !socket.user) return;
        const result = mainTournament.register(socket.user, socket);
        if (result.success) io.emit('tournament:stateUpdate', mainTournament.getState());
    });

    socket.on('tournament:leave', () => {
        if (mainTournament) {
            mainTournament.removePlayer(socket);
            io.emit('tournament:stateUpdate', mainTournament.getState());
        }
    });

    socket.on('tournament:start', () => {
        if (mainTournament) mainTournament.start();
    });

    socket.on('tournament:game:join', ({ gameId }) => {
        const game = activeGames.get(gameId);
        if (!game || !socket.user) return;
        socket.join(gameId);
        socket.emit('game:state', {
            fen: game.chess.fen(),
            color: game.getPlayerColor(socket.user.id),
            playerWhite: game.playerWhite.user?.username || '?',
            playerBlack: game.playerBlack.user?.username || '?'
        });
    });

    socket.on('tournament:game:move', ({ gameId, move }) => {
        const game = activeGames.get(gameId);
        if (game && socket.user) game.makeMove(move, socket.user.id);
    });

    socket.on('tournament:game:resign', ({ gameId }) => {
        const game = activeGames.get(gameId);
        if (game && socket.user) game.resign(socket.user.id);
    });

    socket.on('disconnect', () => {
        if (socket.user?.id) {
            onlineUsers.delete(socket.user.id);
        }
    });
});
// ---------------------------------
// 7. ЗАПУСК
// ---------------------------------
const startServer = async () => {
    try {
        await initDb();
        httpsServer.listen(443, () => {
            console.log(`🚀 HTTPS Сервер: https://chessrad.app`);
        });
        http.createServer((req, res) => {
            res.writeHead(301, { "Location": "https://" + req.headers['host'] + req.url });
            res.end();
        }).listen(80);
    } catch (err) {
        console.error(err);
    }
};

startServer();
