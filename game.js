$(document).ready(async function() { // Добавляем async, так как используем await

    // --- ИЗМЕНЕНИЕ 1: НОВАЯ, НАДЕЖНАЯ ПРОВЕРКА АУТЕНТИФИКАЦИИ ---
    try {
        // Делаем запрос к защищенному эндпоинту. Браузер сам прикрепит httpOnly cookie.
        const response = await fetch('/api/profile');
        if (!response.ok) {
            // Если ответ не "ok" (например, статус 401), значит пользователь не авторизован.
            throw new Error('Пользователь не авторизован');
        }
        // Если запрос прошел успешно, значит кука валидна, и мы можем продолжать.
        console.log('Пользователь успешно аутентифицирован через cookie.');
    } catch (error) {
        console.error('Ошибка аутентификации:', error.message);
        alert('Доступ запрещен. Пожалуйста, войдите в систему.');
        window.location.href = '/'; // Перенаправляем на главную
        return; // Прерываем выполнение скрипта
    }

    console.log('ЗАПУЩЕН СКРИПТ GAME.JS (Версия для httpOnly Cookies)');

    // --- Глобальные переменные (без изменений) ---
    let board = null;
    const game = new Chess();
    let myColor = 'white';
    let gameRoomId = null;

    // --- Переменные для элементов UI (без изменений) ---
    const $status = $('#status');
    const $fen = $('#fen');
    const $pgn = $('#pgn');
    const $turnInfo = $('#turn-info');
    const $gameControls = $('#game-controls');
    const $findGameBtn = $('#find-game-btn');
    const $resignBtn = $('#resign-btn');
    const $rematchBtn = $('#rematch-btn');

    // --- ИЗМЕНЕНИЕ 2: УПРОЩЕННОЕ ПОДКЛЮЧЕНИЕ К SOCKET.IO ---
    // Объект auth больше не нужен, браузер отправит cookie автоматически
    const socket = io();

    // --- Базовые обработчики сокета (с минимальным изменением) ---
    socket.on('connect_error', (err) => {
        console.error('Ошибка аутентификации сокета:', err.message);
        // ИЗМЕНЕНИЕ 3: Убираем строку ниже, так как localStorage больше не используется
        // localStorage.removeItem('jwtToken');
        alert(`Ошибка аутентификации: ${err.message}. Вы будете перенаправлены на страницу входа.`);
        window.location.href = '/';
    });

    // Для отладки: логируем все события
    socket.onAny((eventName, ...args) => {
        console.log(`Socket.IO Событие: ${eventName}`, args);
    });

    socket.on('connect', () => {
        console.log(`Успешно подключено! Socket ID: ${socket.id}`);
        updateStatus('Подключено. Нажмите "Найти игру"');
        $findGameBtn.prop('disabled', false).show();
    });

    socket.on('disconnect', () => {
        console.error('Отключено от сервера.');
        updateStatus('Потеряно соединение. Пожалуйста, обновите страницу.');
        $findGameBtn.prop('disabled', true);
        $resignBtn.prop('disabled', true);
        $rematchBtn.prop('disabled', true);
    });

    // ... (здесь начинается остальная часть вашего файла game.js)


    // --- Логика шахматной доски (Chessboard.js) ---

    function onDragStart(source, piece) {
        // ИСПРАВЛЕНО: isGameOver() -> game_over()
        if (game.game_over()) return false;

        // Ходить можно, ТОЛЬКО если сейчас ваш ход.
        if (game.turn() !== myColor.charAt(0)) return false;

        // Запрещаем двигать фигуры не своего цвета
        if (piece.charAt(0) !== myColor.charAt(0)) return false;

        return true;
    }

    function onDrop(source, target) {
        // Создаем объект хода
        let moveObject = {
            from: source,
            to: target,
            promotion: 'q' // Предварительно ставим превращение в ферзя
        };

        // Пытаемся сделать ход локально для проверки
        const localMoveResult = game.move(moveObject);

        // Если ход невалиден, chessboard.js вернет фигуру на место
        if (localMoveResult === null) return 'snapback';

        // Если ход валиден, отправляем его на сервер
        console.log('Отправляем ход на сервер:', { move: localMoveResult, roomId: gameRoomId });
        socket.emit('move', { move: localMoveResult, roomId: gameRoomId });
    }

    function onSnapEnd() {
        if (board) {
            board.position(game.fen());
        }
    }

    // --- Функции обновления UI ---

    function updateStatus(htmlMessage) {
        $status.html(htmlMessage);
    }

    function updateGameDisplay() {
        console.log('[CLIENT] Внутри updateGameDisplay()');
        if (!board) {
            console.error('[CLIENT] ОШИБКА: Объект доски `board` равен null');
            return;
        }

        board.position(game.fen());
        $fen.text(game.fen());
        $pgn.html(game.pgn());

        // ИСПРАВЛЕНО: isGameOver() -> game_over()
        if (game.game_over()) {
            $turnInfo.text('Игра окончена').removeClass('my-turn');
            return;
        }

        const isMyTurn = game.turn() === myColor.charAt(0);
        let text = isMyTurn ? 'Ваш ход' : 'Ход соперника';

        // ИСПРАВЛЕНО: inCheck() -> in_check()
        if (game.in_check()) {
            text += ' (Шах!)';
        }

        $turnInfo.text(text).toggleClass('my-turn', isMyTurn);
    }

    // --- Обработка игровых событий от сервера ---

    socket.on('status', (data) => {
        updateStatus(data.message);
    });

    socket.on('gameStart', (data) => {
        myColor = data.color;
        gameRoomId = data.roomId;
        const opponentUsername = data.opponent.username || 'Соперник';

        const boardConfig = {
            draggable: true,
            position: 'start',
            orientation: myColor === 'w' ? 'white' : 'black',
            onDragStart: onDragStart,
            onDrop: onDrop,
            onSnapEnd: onSnapEnd
        };

        if (!board) {
            board = Chessboard('myBoard', boardConfig);
        } else {
            board.orientation(myColor === 'w' ? 'white' : 'black');
            board.position('start');
        }

        game.reset();

        $findGameBtn.hide();
        $gameControls.show();
        $rematchBtn.hide();
        $resignBtn.show().prop('disabled', false);

        const colorText = myColor === 'w' ? 'белыми' : 'черными';
        updateStatus(`Игра против <b>${opponentUsername}</b>. Вы играете ${colorText}.`);
        updateGameDisplay();
    });

    socket.on('gameStateUpdate', (data) => {
        console.log('%c[CLIENT] ПОЛУЧЕНО событие gameStateUpdate!', 'color: green; font-weight: bold;');
        console.log('[CLIENT] Полученные данные:', data);

        if (data && data.fen) {
            console.log(`[CLIENT] Загружаю FEN: ${data.fen}`);
            game.load(data.fen);
            console.log('[CLIENT] Вызываю updateGameDisplay() для перерисовки.');
            updateGameDisplay();
        } else {
            console.error('[CLIENT] Получены некорректные данные в gameStateUpdate:', data);
        }
    });

    socket.on('invalidMove', () => {
        updateStatus('Недопустимый ход!');
        updateGameDisplay();
    });

socket.on('gameOver', (data) => {
    if (data.fen) game.load(data.fen);

    let statusMessage = 'Игра окончена.';
    const winnerUsername = data.winner ? `<b>${data.winner}</b>` : 'не определен';

    switch (data.type) {
        case 'checkmate':
            statusMessage = `Мат! Победил(а) ${winnerUsername}.`;
            break;
        case 'resign':
            statusMessage = `Соперник сдался. Победил(а) ${winnerUsername}.`;
            break;
        // ДОБАВЛЕН НОВЫЙ СЛУЧАЙ
        case 'abandonment':
            statusMessage = `Соперник отключился. Победил(а) ${winnerUsername}.`;
            break;
        case 'draw':
            statusMessage = 'Ничья.';
            break;
        case 'stalemate':
            statusMessage = 'Ничья (пат).';
            break;
        default:
            statusMessage = `Ничья (${data.reason || 'неизвестная причина'}).`;
    }

    updateStatus(statusMessage);
    $resignBtn.prop('disabled', true);
    $rematchBtn.show().text('Реванш').prop('disabled', false).removeClass('glowing-button');
    updateGameDisplay();
});

    socket.on('rematchOffered', () => {
        updateStatus('Соперник предлагает реванш!');
        $rematchBtn.text('Принять реванш').prop('disabled', false).addClass('glowing-button');
    });

    socket.on('rematchCancelled', () => {
        updateStatus('Предложение о реванше отменено.');
        $rematchBtn.text('Реванш').prop('disabled', true).removeClass('glowing-button');
    });

    // --- Обработчики кнопок ---

    $findGameBtn.on('click', function() {
        $(this).prop('disabled', true).text('Поиск игры...');
        socket.emit('findGame');
    });

    $resignBtn.on('click', function() {
        if (confirm('Вы уверены, что хотите сдаться?')) {
            socket.emit('surrender', { roomId: gameRoomId });
        }
    });

    $rematchBtn.on('click', function() {
        const buttonText = $(this).text();

        if (buttonText.includes('Принять')) {
            socket.emit('rematchAccepted', { roomId: gameRoomId });
            $(this).prop('disabled', true).text('Создание игры...');
        } else {
            socket.emit('rematch', { roomId: gameRoomId });
            $(this).prop('disabled', true).text('Ожидание ответа...');
        }
    });

});
