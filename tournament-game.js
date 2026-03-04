$(document).ready(async function() {
    // --- 1. ПРОВЕРКА АУТЕНТИФИКАЦИИ ---
    let currentUser = null;
    try {
        const response = await fetch('/api/profile');
        if (!response.ok) throw new Error('Пользователь не авторизован');
        currentUser = await response.json();
    } catch (error) {
        console.error('Ошибка профиля:', error);
        window.location.href = '/';
        return;
    }

    // --- 2. ПОЛУЧЕНИЕ ID ИГРЫ ---
    const pathParts = window.location.pathname.split('/');
    const gameId = pathParts[pathParts.length - 1];

    // --- 3. ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ---
    let board = null;
    const game = new Chess();
    let myColor = 'w';
    let isGameOver = false;

    const $status = $('#status');
    const $turnInfo = $('#turn-info');
    const $pgn = $('#pgn');
    const $fen = $('#fen');

    // Форматирование секунд в 00:00
    function formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    // --- 4. ЛОГИКА ДОСКИ ---
    function onDragStart(source, piece) {
        if (isGameOver || game.game_over()) return false;
        if ((myColor === 'w' && piece.search(/^b/) !== -1) ||
            (myColor === 'b' && piece.search(/^w/) !== -1) ||
            (game.turn() !== myColor)) {
            return false;
        }
        return true;
    }

    function onDrop(source, target) {
        const moveData = {
            from: source,
            to: target,
            promotion: 'q'
        };

        const move = game.move(moveData);
        if (move === null) return 'snapback';

        // Отправляем на сервер
        socket.emit('tournament:game:move', {
            gameId: gameId,
            move: moveData
        });

        updateGameDisplay();
    }

    function onSnapEnd() {
        board.position(game.fen());
    }

    // --- 5. SOCKET.IO ---
    const socket = io({ transports: ['websocket'] });

    socket.on('connect', () => {
        socket.emit('tournament:game:join', { gameId });
    });

    // Обновление таймеров (используем прямые селекторы, так как HTML динамический)
    socket.on('game:timer', (data) => {
        if (isGameOver) return;

        const wStr = formatTime(data.white);
        const bStr = formatTime(data.black);

        // Находим элементы в DOM каждый раз (безопасно для динамического HTML)
        const $wt = $('#white-timer');
        const $bt = $('#black-timer');

        $wt.text(wStr);
        $bt.text(bStr);

        // Подсветка активного таймера
        $wt.toggleClass('active-timer', data.turn === 'w');
        $bt.toggleClass('active-timer', data.turn === 'b');

        // Критическое время
        $wt.toggleClass('low-time', data.white < 30);
        $bt.toggleClass('low-time', data.black < 30);
    });

    socket.on('game:state', (data) => {
        myColor = data.color;
        game.load(data.fen);

        // Установка имен и начального состояния
        const whiteName = data.playerWhite?.username || 'Белые';
        const blackName = data.playerBlack?.username || 'Черные';

        // Распределяем кто сверху, кто снизу (Противник всегда сверху)
        if (myColor === 'w') {
            $('#opponent-info .player-name').text(blackName + ' (Черные)');
            $('#opponent-timer').attr('id', 'black-timer');
            $('#me-info .player-name').text(currentUser.username + ' (Вы)');
            $('#me-timer').attr('id', 'white-timer');
        } else {
            $('#opponent-info .player-name').text(whiteName + ' (Белые)');
            $('#opponent-timer').attr('id', 'white-timer');
            $('#me-info .player-name').text(currentUser.username + ' (Вы)');
            $('#me-timer').attr('id', 'black-timer');
        }

        if (!board) {
            board = Chessboard('myBoard', {
                draggable: true,
                position: data.fen,
                orientation: myColor === 'w' ? 'white' : 'black',
                pieceTheme: '/img/chesspieces/wikipedia/{piece}.png',
                onDragStart: onDragStart,
                onDrop: onDrop,
                onSnapEnd: onSnapEnd
            });
        } else {
            board.position(data.fen);
        }
        updateGameDisplay();
    });

    socket.on('game:move', (move) => {
        game.move(move);
        board.position(game.fen());
        updateGameDisplay();
    });

    socket.on('tournament:game:over', (data) => {
        isGameOver = true;
        const isWinner = data.winner === currentUser.username;
        const resultText = data.draw ? 'НИЧЬЯ' : (isWinner ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ');

        $status.html(`<b class="${isWinner ? 'win' : 'loss'}">${resultText}</b>: ${data.reason}`);

        setTimeout(() => {
            alert(`Игра окончена: ${resultText}\nПричина: ${data.reason}`);
            window.location.href = '/tournament.html';
        }, 1500);
    });

    // --- 6. UI ---
    function updateGameDisplay() {
        const myTurn = game.turn() === myColor;
        $turnInfo.text(myTurn ? 'ВАШ ХОД' : 'ХОД СОПЕРНИКА');
        $turnInfo.toggleClass('active-turn', myTurn);
        $turnInfo.toggleClass('waiting-turn', !myTurn);

        $status.text(game.in_check() ? 'ШАХ!' : 'Игра продолжается');
        $pgn.text(game.pgn());
        $fen.text(game.fen());
    }

    $('#resign-btn').click(() => {
        if (confirm('Сдаться?')) socket.emit('tournament:game:resign', { gameId });
    });

    $('#return-to-tournament-btn').click(() => {
        window.location.href = '/tournament.html';
    });
});
