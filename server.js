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
import cookieParser from 'cookie-parser'; // <-- Добавлен импорт
import cookie from 'cookie';             // <-- Добавлен импорт

// Импорт ваших модулей (убедитесь, что пути верны)
import { addUser, findUserByUsername, findUserById, updateUserLevel, updateUserStats } from './db.js';
import { Game } from './gamelogic.js';       // Логика отдельной игры
import { Tournament } from './tournament.js'; // Логика турнира

const app = express();
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "http://147.45.147.30",
    methods: ["GET", "POST"], // <--- ВОТ НЕОБХОДИМАЯ ЗАПЯТАЯ
    credentials: true
  }
});

const port = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-very-secret-key'; // Важно: в реальном проекте используйте .env

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------
// 2. ГЛОБАЛЬНОЕ СОСТОЯНИЕ СЕРВЕРА
// ---------------------------------

const activeGames = new Map();
const onlineUsers = new Map(); // <--- ВОТ ЭТА СТРОКА

const matchmakingQueue = [];

// Оборачиваем создание турнира в функцию, чтобы ее можно было вызывать повторно
function createAndAssignTournament() {
    mainTournament = new Tournament({
        io: io,
        games: activeGames,
        id: 'main-tournament-1',
        name: 'Главный еженедельный турнир',
    });
    console.log('[Server] Создан новый экземпляр турнира.');
}

// Заменяем старое объявление на вызов этой функции при старте сервера
let mainTournament;
createAndAssignTournament();

// Создаем специальный маршрут для сброса состояния
app.get('/reset-tournament', (req, res) => {
    console.log('[Server] !!! ПОЛУЧЕН ЗАПРОС НА ПРИНУДИТЕЛЬНЫЙ СБРОС ТУРНИРА !!!');

    // 1. Создаем новый объект турнира взамен старого
    createAndAssignTournament();

    // 2. (Опционально, но очень полезно) Оповещаем всех клиентов, что турнир сброшен
    io.emit('tournament:stateUpdate', mainTournament.getState());

    // 3. Перенаправляем пользователя обратно на страницу турнира
    res.redirect('/tournament.html');
});
// ---------------------------------
// 3. MIDDLEWARE ДЛЯ EXPRESS
// ---------------------------------
app.use(express.json()); // Для парсинга JSON-тел запросов
app.use(cookieParser()); // Для парсинга кук
app.use(express.static(path.join(__dirname, 'public'))); // Раздача статики

// ---------------------------------
// 4. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ И MIDDLEWARE АУТЕНТИФИКАЦИИ
// ---------------------------------

// Middleware для защиты API роутов
const authenticateToken = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) {
        return res.status(401).json({ message: 'Доступ запрещен, токен не предоставлен' });
    }
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Недействительный токен' });
        }
        req.user = user; // user содержит { id, username }
        next();
    });
};

// Функция для сравнения паролей
async function comparePasswords(password, hash) {
    try {
        return await bcrypt.compare(password, hash);
    } catch (error) {
        console.error('Ошибка при сравнении паролей:', error);
        return false;
    }
}

// Функция обновления статистики по результатам игры
async function handleGameResultUpdate(winnerId, loserId, isDraw) {
    try {
        if (isDraw) {
            await updateUserStats(winnerId, { draws: 1 });
            await updateUserStats(loserId, { draws: 1 });
            console.log(`[Stats] Записана ничья для игроков ${winnerId} и ${loserId}`);
        } else {
            await updateUserStats(winnerId, { wins: 1 });
            await updateUserStats(loserId, { losses: 1 });
            console.log(`[Stats] Победа для ${winnerId}, поражение для ${loserId}`);
        }
    } catch (error) {
        console.error('[Stats] Ошибка при обновлении статистики:', error);
    }
}

// Функция создания и запуска игры 1 на 1
function createAndStartGame(player1Socket, player2Socket) {
    const isPlayer1White = Math.random() < 0.5;
    const whitePlayerSocket = isPlayer1White ? player1Socket : player2Socket;
    const blackPlayerSocket = isPlayer1White ? player2Socket : player1Socket;

    const game = new Game({
        io: io,
        playerWhite: { socket: whitePlayerSocket, user: whitePlayerSocket.user },
        playerBlack: { socket: blackPlayerSocket, user: blackPlayerSocket.user },
        onGameResult: handleGameResultUpdate,
        onGameEnd: (gameId) => {
            activeGames.delete(gameId);
            console.log(`[Server] Игра ${gameId} полностью удалена.`);
        },
        onRematchAccepted: (p1, p2) => {
            console.log(`[Server] Запускаем реванш между ${p1.user.username} и ${p2.user.username}`);
            createAndStartGame(p1.socket, p2.socket);
        }
    });

    activeGames.set(game.getId(), game);
    game.start();
}

// ---------------------------------
// 5. API РОУТЫ (РЕГИСТРАЦИЯ, ВХОД, ПРОФИЛЬ)
// ---------------------------------

app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password || password.length < 4) {
        return res.status(400).json({ message: 'Имя пользователя и пароль (мин 4 символа) обязательны' });
    }
    try {
        const existingUser = await findUserByUsername(username);
        if (existingUser) {
            return res.status(409).json({ message: 'Пользователь с таким именем уже существует' });
        }
        await addUser(username, password);
        res.status(201).json({ message: 'Регистрация прошла успешно' });
    } catch (error) {
        console.error('Ошибка регистрации:', error);
        res.status(500).json({ message: 'Внутренняя ошибка сервера' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await findUserByUsername(username);

        // ИСПРАВЛЕННАЯ ЛОГИКА: Сначала проверяем, есть ли пользователь
        if (!user) {
            console.log(`[Login] Попытка входа для несуществующего пользователя: ${username}`);
            return res.status(401).json({ success: false, message: 'Неверное имя пользователя или пароль' });
        }

        const passwordsMatch = await comparePasswords(password, user.password_hash);

        // ИСПРАВЛЕННАЯ ЛОГИКА: Затем проверяем, совпадает ли пароль
        if (!passwordsMatch) {
            console.log(`[Login] Неудачная попытка входа для пользователя: ${username} (неверный пароль)`);
            return res.status(401).json({ success: false, message: 'Неверное имя пользователя или пароль' });
        }

        console.log(`[Login] Аутентификация успешна для ${user.username}`);
        const payload = { id: user.id, username: user.username };
        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1d' });

        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 24 * 60 * 60 * 1000, // 24 часа
            sameSite: 'strict'
        });

        res.status(200).json({ success: true, message: 'Вход выполнен успешно' });

    } catch (error) {
        console.error('КРИТИЧЕСКАЯ ОШИБКА в /api/login:', error);
        res.status(500).json({ success: false, message: 'Внутренняя ошибка сервера' });
    }
});

app.get('/api/profile', authenticateToken, async (req, res) => {
    try {
        const userProfile = await findUserById(req.user.id);
        if (!userProfile) {
            return res.status(404).json({ message: 'Пользователь не найден' });
        }

        // ИСПРАВЛЕНИЕ: Удаляем хэш пароля перед отправкой на клиент
        const { password_hash, ...profileToSend } = userProfile;

        res.json(profileToSend);
    } catch (error) {
        console.error('Критическая ошибка в /api/profile:', error);
        res.status(500).json({ message: 'Ошибка при получении профиля' });
    }
});

app.post('/api/user/level', authenticateToken, async (req, res) => {
    const { level } = req.body;
    const userId = req.user.id;
    const validLevels = ['Новичок', 'Любитель', 'Профессионал', 'Эксперт', 'Мастер'];

    if (!level || !validLevels.includes(level)) {
        console.error(`Получено недопустимое значение уровня: ${level}`);
        return res.status(400).json({ message: 'Недопустимое значение уровня' });
    }

    try {
        const result = await updateUserLevel(userId, level);
        if (result.success) {
            console.log(`[API] Уровень для пользователя ${userId} успешно обновлен на ${level}`);
            res.status(200).json({ message: 'Уровень успешно обновлен', skillLevel: level });
        } else {
            console.error(`[API] Не удалось обновить уровень для пользователя ${userId}. Причина: ${result.message}`);
            res.status(404).json({ message: result.message || 'Пользователь не найден' });
        }
    } catch (error) {
        console.error('Ошибка при вызове updateUserLevel:', error);
        res.status(500).json({ message: 'Внутренняя ошибка сервера' });
    }
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true, message: 'Выход выполнен успешно' });
});

// Роут для отдачи страницы игры
app.get('/game/:gameId', authenticateToken, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'tournament-game.html'));
});

app.get('/tournament', (req, res) => {
    // Укажи здесь точное имя файла, которое ты нашел на шаге 1
    res.sendFile(path.join(__dirname, 'public', 'tournament.html'));
});

// ---------------------------------
// 6. ЛОГИКА SOCKET.IO
// ---------------------------------

// Middleware для аутентификации Socket.IO
io.use((socket, next) => {
    const cookieString = socket.handshake.headers.cookie;

    if (!cookieString) {
        console.error('[Socket.IO Auth] Ошибка: Запрос на подключение не содержит куки.');
        return next(new Error('Authentication error: No cookies provided'));
    }

    try {
        const cookies = cookie.parse(cookieString);
        const token = cookies.token;

        if (!token) {
            console.error('[Socket.IO Auth] Ошибка: Токен в куках не найден.');
            return next(new Error('Authentication error: Token not found in cookies'));
        }

        jwt.verify(token, JWT_SECRET, (err, payload) => {
            if (err) {
                console.error(`[Socket.IO Auth] Ошибка: Неверный или истекший токен. ${err.message}`);
                return next(new Error('Authentication error: Invalid token'));
            }

            // Всё хорошо, сохраняем данные пользователя в сокет
            socket.user = payload; // payload содержит { id, username }
            console.log(`[Socket.IO Auth] Пользователь ${payload.username} успешно аутентифицирован.`);
            next(); // Разрешаем подключение
        });
    } catch (e) {
        console.error('[Socket.IO Auth] Критическая ошибка при парсинге кук:', e);
        return next(new Error('Authentication error: Could not process cookies'));
    }
});

// Главный обработчик событий Socket.IO
io.on('connection', (socket) => {
    // Эта функция сработает ТОЛЬКО ПОСЛЕ успешного прохождения io.use
    // Поэтому здесь мы можем быть уверены, что socket.user существует
    console.log(`[Socket.IO] Успешно подключился: ${socket.user.username} (ID сокета: ${socket.id})`);

  onlineUsers.set(socket.user.id, {
        id: socket.user.id,
        username: socket.user.username,
        socket: socket
    });
    console.log(`[OnlineUsers] Пользователь ${socket.user.username} добавлен в список онлайн.`);

    socket.on('disconnect', () => {
        // Убираем пользователя из списка онлайн при отключении
        if (socket.user) {
            onlineUsers.delete(socket.user.id);
            console.log(`[OnlineUsers] Пользователь ${socket.user.username} удален из списка онлайн.`);
        }
        console.log(`[Socket.IO] Пользователь отключился: ${socket.id}`);
    });

    // ----- ЛОГИКА МАТЧМЕЙКИНГА 1 НА 1 -----
    socket.on('findGame', () => {
        console.log(`[Socket.IO] ${socket.user.username} ищет игру.`);

        // Предотвращение дублирования в очереди
        const indexInQueue = matchmakingQueue.findIndex(s => s.user.id === socket.user.id);
        if (indexInQueue !== -1) {
            matchmakingQueue.splice(indexInQueue, 1);
        }

        matchmakingQueue.push(socket);

        if (matchmakingQueue.length >= 2) {
            console.log('[Matchmaking] Найдены игроки. Создание игры...');
            const player1Socket = matchmakingQueue.shift();
            const player2Socket = matchmakingQueue.shift();
            createAndStartGame(player1Socket, player2Socket);
        }
    });

    socket.on('cancelFindGame', () => {
        const index = matchmakingQueue.findIndex(s => s.id === socket.id);
        if (index !== -1) {
            matchmakingQueue.splice(index, 1);
            console.log(`[Socket.IO] ${socket.user.username} отменил поиск игры.`);
        }
    });


// server.js


// server.js

// ... внутри io.on('connection', socket => { ... })

socket.on('tournament:getState', (tournamentId) => {
    // В нашем случае у нас один главный турнир
    if (mainTournament && mainTournament.id === tournamentId) {
        console.log(`[Server] Клиент ${socket.user?.username || socket.id} запросил состояние турнира ${tournamentId}`);
        // Отправляем состояние ТОЛЬКО этому одному клиенту, который попросил
        socket.emit('tournament:stateUpdate', mainTournament.getState());
    }
});
// ...

socket.on('tournament:register', () => {
    if (!socket.user || !socket.user.username) {
        return socket.emit('tournament:error', { message: 'Не удалось определить пользователя.' });
    }

    console.log(`[Socket.IO] ${socket.user.username} пытается зарегистрироваться в турнире.`);

    const result = mainTournament.register(socket.user, socket);

    if (!result.success) {
        socket.emit('tournament:error', { message: result.message });
    } else {
        console.log(`[Server] ${socket.user.username} успешно зарегистрирован.`);

        // --- ВОТ ЭТО ИЗМЕНЕНИЕ ---
        // Меняем 'tournament:state' на 'tournament:stateUpdate', чтобы клиент его услышал
        io.emit('tournament:stateUpdate', mainTournament.getState());
    }
});

    socket.on('tournament:leave', () => {
        console.log(`[Socket.IO] Игрок ${socket.user.username} покидает турнир.`);
        try {
            mainTournament.removePlayer(socket);
        } catch (error) {
            console.error(`[Server] Ошибка при выходе игрока ${socket.user.username}: ${error.message}`);
        }
    });

    socket.on('tournament:start', () => {
        console.log(`[Socket.IO] Получена команда на старт турнира от ${socket.user.username}.`);
        try {
            const started = mainTournament.start();
            if (!started) {
                throw new Error('Не удалось начать турнир (уже запущен или недостаточно игроков).');
            }
            console.log('[Socket.IO] Команда на запуск турнира успешно обработана.');
        } catch (error) {
            console.error(`[Server] Ошибка старта турнира: ${error.message}`);
            socket.emit('tournament:error', { message: error.message });
        }
    });

    // ----- ОБЩАЯ ЛОГИКА ДЛЯ ИГР -----
    socket.on('move', (data) => {
        if (!data || !data.roomId || !data.move) {
            console.error(`[Server] Получены неполные данные для хода от ${socket.user.username}`);
            return;
        }
        const game = activeGames.get(data.roomId);

        if (game) {
            game.makeMove(socket.id, data.move);
        } else {
            console.error(`[Server] Ошибка: Попытка сделать ход в игре, которая не найдена: ${data.roomId}`);
            socket.emit('error', 'Игра не найдена. Возможно, она уже завершилась.');
        }
    });

    socket.on('surrender', (data) => {
        const game = activeGames.get(data.roomId);
        if (game) {
            game.handleSurrender(socket.id);
        }
    });

    socket.on('rematch', (data) => {
        const game = activeGames.get(data.roomId);
        if (game) {
            game.handleRematchRequest(socket.id);
        }
    });

    // Этот обработчик был в коде, но не был прислан. Добавляю для полноты.
    socket.on('rematch:accept', (data) => {
        const game = activeGames.get(data.roomId);
        if (game) {
            game.handleRematchAccept(socket.id);
        }
    });

    // ----- ОБРАБОТКА ОТКЛЮЧЕНИЯ -----
    socket.on('disconnect', () => {
        console.log(`[Socket.IO] Пользователь отключился: ${socket.user.username} (ID: ${socket.id})`);

        // Удаление из очереди матчмейкинга
        const queueIndex = matchmakingQueue.findIndex(s => s.id === socket.id);
        if (queueIndex !== -1) {
            matchmakingQueue.splice(queueIndex, 1);
            console.log(`[Queue] Игрок ${socket.user.username} удален из очереди.`);
        }

        // Обработка выхода из активной игры
        for (const [roomId, game] of activeGames.entries()) {
            const playerColor = game.getPlayerColor(socket.id);

            if (playerColor) {
                console.log(`[Game Abort] Игрок ${socket.user.username} покинул игру ${roomId}. Завершение...`);

                const winnerColor = playerColor === 'white' ? 'black' : 'white';
                const winner = game.players[winnerColor].user;
                const loser = game.players[playerColor].user;

                game.endGame({
                    type: 'abandonment',
                    winner: winner.username,
                    winnerId: winner.id,
                    loserId: loser.id,
                    isDraw: false,
                    reason: `${loser.username} отключился.`
                });
                break; // Выходим из цикла, так как игрок может быть только в одной игре
            }
        }

        // Обработка выхода из турнира (если он не в активной игре)
        try {
            mainTournament.removePlayer(socket);
        } catch(error) { /* Ошибки здесь можно игнорировать, т.к. игрока могло и не быть в турнире */ }
    });



   socket.on('tournament:game:join', ({ gameId }) => {
        // Находим игру в общем списке. Теперь она там должна быть благодаря Шагу 1.
        const game = activeGames.get(gameId);

        if (!game) {
            console.error(`[Server] Игрок ${socket.user.username} не смог подключиться к турнирной игре ${gameId}: игра не найдена.`);
            return socket.emit('error', { message: 'Турнирная игра не найдена' });
        }

        // Присоединяем игрока к комнате игры
        socket.join(gameId);
        console.log(`[Server] Игрок ${socket.user.username} подключился к комнате турнирной игры ${gameId}`);

        // Определяем цвет игрока
        const playerColor = game.getPlayerColor(socket.user.id);

        // Отправляем игроку его цвет и состояние доски
        socket.emit('game:state', {
            fen: game.chess.fen(),
            color: playerColor,
    tournamentId: game.tournamentId // <-- ДОБАВЛЕНО
   });
    });



// server.js


// Примерно так может выглядеть ваш обработчик сдачи на сервере

socket.on('tournament:game:resign', ({ gameId }) => {
    const game = activeGames.get(gameId);
    if (!game) return;

    const result = game.resign(socket.user);

    if (result.success) {
        // 1. Обновляем состояние турнира, как и раньше
        mainTournament.handleMatchCompletion(result.report);

        // 2. --- НОВОЕ ---
        // Отправляем событие об окончании игры обоим игрокам
        const winnerSocket = onlineUsers.get(result.report.winner.id)?.socket;
        const loserSocket = onlineUsers.get(result.report.loser.id)?.socket;

        if (winnerSocket) {
            winnerSocket.emit('game:over', {
                reason: 'Соперник сдался',
                yourStatus: 'Победа'
            });
        }
        if (loserSocket) {
            loserSocket.emit('game:over', {
                reason: 'Вы сдались',
                yourStatus: 'Поражение'
            });
        }
    }
});

    // Событие, которое клиент о
    // Событие, которое клиент отправляет при совершении хода в турнирной игре
    socket.on('tournament:game:move', ({ gameId, move }) => {
 console.log('СЕРВЕР: Получено событие "tournament:game:move", данные:', { gameId, move });
        const game = activeGames.get(gameId);
        if (!game) {
            return socket.emit('error', { message: 'Турнирная игра для хода не найдена' });
        }

        // Используем логику из TournamentGame для проверки хода
        const result = game.makeMove(move, socket.user.id);

        if (result.success) {
            // Ход верный. Отправляем его второму игроку.
            socket.to(gameId).emit('game:move', move);

            if (result.gameOver) {
                console.log(`[Server] Турнирная игра ${gameId} окончена: ${result.message}`);
                // Оповещаем обоих игроков о конце игры
                io.to(gameId).emit('game:over', { message: result.message });

                // Сообщаем турниру о результате
                mainTournament.reportGameResult(result.report);

                // (Опционально) Удаляем завершенную игру из активных
                activeGames.delete(gameId);
            }
        } else {
            // Ход неверный. Сообщаем об этом только отправителю.
            socket.emit('error', { message: result.message });
        }
    });


});

// ---------------------------------
// 7. ЗАПУСК СЕРВЕРА
// ---------------------------------
const startServer = async () => {
    httpServer.listen(port, () => {
        console.log(`🚀 Сервер запущен на http://localhost:${port}`);
    });
};

startServer();
