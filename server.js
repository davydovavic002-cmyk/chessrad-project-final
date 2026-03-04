// ---------------------------------
// 1. ИМПОРТЫ И НАСТРОЙКА
// ---------------------------------
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import cookie from 'cookie';

import { initDb, addUser, findUserByUsername, findUserById, updateUserStats } from './db.js';
import { Game } from './gamelogic.js';
import { Tournament } from './tournament.js';

const app = express();
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
    cors: {
        origin: "http://147.45.147.30",
        methods: ["GET", "POST"],
        credentials: true
    }
});

const port = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-very-secret-key';

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
    console.log('[Server] Экземпляр турнира готов.');
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

async function comparePasswords(password, hash) {
    try { return await bcrypt.compare(password, hash); }
    catch (error) { return false; }
}

async function handleGameResultUpdate(winnerId, loserId, isDraw) {
    try {
        await updateUserStats(winnerId, loserId, isDraw);
        console.log(`[Stats] Статистика обновлена для ${winnerId} и ${loserId}`);
    } catch (error) {
        console.error('[Stats] Ошибка обновления статистики:', error);
    }
}

function createAndStartGame(player1Socket, player2Socket) {
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
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password || password.length < 4) return res.status(400).json({ message: 'Ошибка валидации' });
    try {
        const existingUser = await findUserByUsername(username);
        if (existingUser) return res.status(409).json({ message: 'Пользователь существует' });
        await addUser(username, password);
        res.status(201).json({ message: 'Успех' });
    } catch (e) { res.status(500).json({ message: 'Ошибка сервера' }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await findUserByUsername(username);
        if (!user || !(await comparePasswords(password, user.password_hash))) {
            return res.status(401).json({ success: false, message: 'Неверные данные' });
        }

        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '1d' });
        res.cookie('token', token, { httpOnly: true, maxAge: 86400000, sameSite: 'strict' });
        res.status(200).json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.get('/api/profile', authenticateToken, async (req, res) => {
    try {
        const user = await findUserById(req.user.id);
        if (!user) return res.status(404).json({ message: 'Пользователь не найден' });

        // Отправляем всё (wins, losses, trophies, history), кроме пароля
        const { password_hash, ...profileData } = user;
        res.json(profileData);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Ошибка сервера при загрузке профиля' });
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

// ---------------------------------
// 6. ЛОГИКА SOCKET.IO
// ---------------------------------
io.use((socket, next) => {
    const cookieString = socket.handshake.headers.cookie;
    if (!cookieString) return next(new Error('No cookies'));
    const cookies = cookie.parse(cookieString);
    jwt.verify(cookies.token, JWT_SECRET, (err, payload) => {
        if (err) return next(new Error('Auth error'));
        socket.user = payload;
        next();
    });
});

io.on('connection', (socket) => {
    onlineUsers.set(socket.user.id, { id: socket.user.id, username: socket.user.username, socket: socket });

    // Поиск игры 1x1
    socket.on('findGame', () => {
        const idx = matchmakingQueue.findIndex(s => s.user.id === socket.user.id);
        if (idx !== -1) matchmakingQueue.splice(idx, 1);
        matchmakingQueue.push(socket);
        if (matchmakingQueue.length >= 2) {
            createAndStartGame(matchmakingQueue.shift(), matchmakingQueue.shift());
        }
    });

    // Состояние турнира
    socket.on('tournament:getState', (tournamentId) => {
        if (mainTournament && mainTournament.id === tournamentId) {
            socket.emit('tournament:stateUpdate', mainTournament.getState());
        }
    });

    socket.on('tournament:register', () => {
        const result = mainTournament.register(socket.user, socket);
        if (!result.success) socket.emit('tournament:error', { message: result.message });
    });

    // НОВАЯ ЛОГИКА: Принудительный выход из турнира
    socket.on('tournament:leave', () => {
        if (mainTournament) {
            mainTournament.removePlayer(socket);
            console.log(`[Tournament] ${socket.user.username} покинул турнир`);
            io.emit('tournament:stateUpdate', mainTournament.getState());
        }
    });

    socket.on('tournament:start', () => {
        const started = mainTournament.start();
        if (!started) socket.emit('tournament:error', { message: 'Не удалось начать' });
    });

    socket.on('tournament:game:join', ({ gameId }) => {
        const game = activeGames.get(gameId);
        if (!game) return socket.emit('error', { message: 'Игра не найдена' });
        socket.join(gameId);
        socket.emit('game:state', {
            fen: game.chess.fen(),
            color: game.getPlayerColor(socket.user.id),
            playerWhite: game.playerWhite.username,
            playerBlack: game.playerBlack.username
        });
    });

    socket.on('tournament:game:move', ({ gameId, move }) => {
        const game = activeGames.get(gameId);
        if (game) {
            const result = game.makeMove(move, socket.user.id);
            if (!result.success) socket.emit('error', { message: result.error });
        }
    });

    socket.on('tournament:game:resign', ({ gameId }) => {
        const game = activeGames.get(gameId);
        if (game) game.resign(socket.user.id);
    });

    socket.on('move', (data) => {
        const game = activeGames.get(data.roomId);
        if (game) game.makeMove(socket.id, data.move);
    });

    socket.on('disconnect', () => {
        console.log(`[Disconnect] Пользователь ${socket.user.username} отключился`);
        onlineUsers.delete(socket.user.id);

        const qIdx = matchmakingQueue.findIndex(s => s.id === socket.id);
        if (qIdx !== -1) {
            matchmakingQueue.splice(qIdx, 1);
            console.log(`[Matchmaking] ${socket.user.username} удален из очереди`);
        }
        // mainTournament.removePlayer(socket) НЕ вызываем здесь, чтобы регистрация не слетала
    });
});

// ---------------------------------
// 7. ЗАПУСК
// ---------------------------------
const startServer = async () => {
    try {
        await initDb();
        httpServer.listen(port, () => {
            console.log(`🚀 Сервер запущен на http://localhost:${port}`);
        });
    } catch (err) {
        console.error('Ошибка при запуске сервера:', err);
    }
};

startServer();
