$(document).ready(async function() {
    // --- ПРОВЕРКА АУТЕНТИФИКАЦИИ ---
    let currentUser = null;
    try {
        const response = await fetch('/api/profile');
        if (!response.ok) throw new Error('Пользователь не авторизован');
        currentUser = await response.json();
        console.log('Пользователь успешно аутентифицирован через cookie.');
    } catch (error) {
        console.error('Ошибка аутентификации:', error.message);
        window.location.href = '/';
        return;
    }

    // --- Глобальные переменные ---
    let board = null;
    const game = new Chess();
    let myColor = 'white';
    let gameRoomId = null;
    let myWinStreak = currentUser.win_streak || 0;

    const $status = $('#status');
    const $fen = $('#fen');
    const $pgn = $('#pgn');
    const $turnInfo = $('#turn-info');
    const $findGameBtn = $('#find-game-btn');
    const $resignBtn = $('#resign-btn');
    const $rematchBtn = $('#rematch-btn');
    const $playerStreak = $('#player-streak');
    const $streakCount = $('#streak-count');

    const socket = io();

    socket.on('connect', () => {
        updateStatus('Подключено. Нажмите "Найти игру"');
        $findGameBtn.prop('disabled', false).show();
    });

    // --- Логика шахматной доски ---
    function onDragStart(source, piece) {
        if (game.game_over()) return false;
        if (game.turn() !== myColor.charAt(0)) return false;
        if (piece.charAt(0) !== myColor.charAt(0)) return false;
        return true;
    }

    function onDrop(source, target) {
        let moveObject = { from: source, to: target, promotion: 'q' };
        const move = game.move(moveObject);
        if (move === null) return 'snapback';
        socket.emit('move', { move, roomId: gameRoomId });
        updateGameDisplay();
    }

    function onSnapEnd() { if (board) board.position(game.fen()); }

    // --- Функции обновления UI ---
    function updateStatus(msg) { $status.html(msg); }

    function updateGameDisplay() {
        if (!board) return;
        board.position(game.fen());
        $fen.text(game.fen());
        $pgn.html(game.pgn());

        if (game.game_over()) {
            $turnInfo.text('Игра окончена').removeClass('my-turn');
            return;
        }

        const isMyTurn = game.turn() === myColor.charAt(0);
        $turnInfo.text(isMyTurn ? 'Ваш ход' : 'Ход соперника').toggleClass('my-turn', isMyTurn);
    }

    // --- Обработка событий сервера ---
    socket.on('gameStart', (data) => {
        myColor = data.color;
        gameRoomId = data.roomId;

        if (myWinStreak >= 3) {
            $playerStreak.show();
            $streakCount.text(myWinStreak);
        }

        const boardConfig = {
            draggable: true,
            position: 'start',
            orientation: myColor === 'w' ? 'white' : 'black',
            onDragStart, onDrop, onSnapEnd
        };

        board = board ? board : Chessboard('myBoard', boardConfig);
        if (board) {
            board.orientation(myColor === 'w' ? 'white' : 'black');
            board.position('start');
        }

        game.reset();
        $findGameBtn.hide();
        $resignBtn.show().prop('disabled', false);
        $rematchBtn.hide();
        updateStatus(`Игра против <b>${data.opponent.username}</b>`);
        updateGameDisplay();
    });

    socket.on('gameStateUpdate', (data) => {
        if (data?.fen) {
            game.load(data.fen);
            updateGameDisplay();
        }
    });

    socket.on('gameOver', (data) => {
        if (data.fen) game.load(data.fen);
        let title = 'Игра окончена';
        let icon = 'info';

        if (data.winner === currentUser.username) {
            const points = (myWinStreak >= 2) ? 25 : 15;
            title = 'Победа!';
            icon = 'success';
            Swal.fire({ title, text: points === 25 ? '🔥 Бонус +25 за серию!' : '+15 очков', icon });
        } else if (data.winner) {
            title = 'Поражение';
            icon = 'error';
            Swal.fire({ title, text: 'Вы проиграли.', icon });
        }

        updateStatus(`Окончено: ${data.type}`);
        $resignBtn.prop('disabled', true);
        $rematchBtn.show().text('Реванш').prop('disabled', false);
        updateGameDisplay();
    });

    socket.on('rematchOffered', () => {
        updateStatus('Соперник предлагает реванш!');
        $rematchBtn.text('Принять реванш').addClass('glowing-button');
    });

    // --- Обработчики кнопок ---
    $findGameBtn.on('click', function() {
        $(this).prop('disabled', true).text('Поиск...');
        socket.emit('findGame');
    });

    $resignBtn.on('click', async function() {
        const res = await Swal.fire({ title: 'Сдаться?', showCancelButton: true });
        if (res.isConfirmed) socket.emit('surrender', { roomId: gameRoomId });
    });

    $rematchBtn.on('click', function() {
        const isAccepting = $(this).text().includes('Принять');
        socket.emit(isAccepting ? 'rematchAccepted' : 'rematch', { roomId: gameRoomId });
        $(this).prop('disabled', true).text('Ожидание...');
    });
});
