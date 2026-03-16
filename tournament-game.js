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
    let pendingMove = null;

    const $status = $('#status');
    const $turnInfo = $('#turn-info');
    const $pgn = $('#pgn');
    const $fen = $('#fen');

    // --- ДОБАВЛЕНИЕ МОДАЛЬНОГО ОКНА ПРЕВРАЩЕНИЯ ---
    if (!$('#promotion-modal').length) {
        $('body').append(`
            <div id="promotion-modal" style="display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #2c3e50; padding: 20px; border-radius: 10px; box-shadow: 0 0 20px rgba(0,0,0,0.8); z-index: 10000; text-align: center; border: 2px solid #3498db;">
                <h3 style="color: white; margin-bottom: 15px; font-family: sans-serif;">Выберите фигуру</h3>
                <div style="display: flex; gap: 15px; justify-content: center;">
                    <button class="promo-choice" data-piece="q" style="width: 60px; height: 60px; font-size: 40px; cursor: pointer; background: #ecf0f1; border-radius: 5px; border: none;">♕</button>
                    <button class="promo-choice" data-piece="r" style="width: 60px; height: 60px; font-size: 40px; cursor: pointer; background: #ecf0f1; border-radius: 5px; border: none;">♖</button>
                    <button class="promo-choice" data-piece="b" style="width: 60px; height: 60px; font-size: 40px; cursor: pointer; background: #ecf0f1; border-radius: 5px; border: none;">♗</button>
                    <button class="promo-choice" data-piece="n" style="width: 60px; height: 60px; font-size: 40px; cursor: pointer; background: #ecf0f1; border-radius: 5px; border: none;">♘</button>
                </div>
            </div>
        `);
    }

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
        const moveData = { from: source, to: target, promotion: 'q' };
        const piece = game.get(source);
        const isPawn = piece && piece.type === 'p';
        const isPromotionRank = (target[1] === '8' || target[1] === '1');

        if (isPawn && isPromotionRank) {
            const tempGame = new Chess(game.fen());
            if (tempGame.move(moveData) === null) return 'snapback';
            pendingMove = moveData;
            $('#promotion-modal').fadeIn(200);
            return 'snapback';
        }

        const move = game.move(moveData);
        if (move === null) return 'snapback';

        socket.emit('tournament:game:move', { gameId, move: moveData });
        updateGameDisplay();
    }

    $(document).on('click', '.promo-choice', function() {
        const pieceType = $(this).data('piece');
        if (pendingMove) {
            pendingMove.promotion = pieceType;
            game.move(pendingMove);
            board.position(game.fen());
            socket.emit('tournament:game:move', { gameId, move: pendingMove });
            pendingMove = null;
            $('#promotion-modal').fadeOut(200);
            updateGameDisplay();
        }
    });

    function onSnapEnd() { board.position(game.fen()); }

    // --- 5. SOCKET.IO ---
    const socket = io({ transports: ['websocket'] });

    socket.on('connect', () => {
        socket.emit('tournament:game:join', { gameId });
    });

    socket.on('game:timer', (data) => {
        if (isGameOver) return;
        const $wt = $('#white-timer'), $bt = $('#black-timer');
        $wt.text(formatTime(data.white)).toggleClass('active-timer', data.turn === 'w');
        $bt.text(formatTime(data.black)).toggleClass('active-timer', data.turn === 'b');
    });

    socket.on('game:state', (data) => {
        myColor = data.color;
        game.load(data.fen);
        const whiteName = data.playerWhite?.username || 'Белые';
        const blackName = data.playerBlack?.username || 'Черные';

        if (myColor === 'w') {
            $('#opponent-info .player-name').text(blackName + ' (Черные)');
            $('#me-info .player-name').text(currentUser.username + ' (Вы)');
        } else {
            $('#opponent-info .player-name').text(whiteName + ' (Белые)');
            $('#me-info .player-name').text(currentUser.username + ' (Вы)');
        }

        if (!board) {
            board = Chessboard('myBoard', {
                draggable: true,
                position: data.fen,
                orientation: myColor === 'w' ? 'white' : 'black',
                pieceTheme: '/img/chesspieces/wikipedia/{piece}.png',
                onDragStart, onDrop, onSnapEnd
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

        Swal.fire({
            title: resultText,
            text: `Причина: ${data.reason}`,
            icon: data.draw ? 'info' : (isWinner ? 'success' : 'error'),
            confirmButtonText: 'К турниру',
            confirmButtonColor: '#3498db'
        }).then(() => {
            window.location.href = '/tournament.html';
        });
    });

    function updateGameDisplay() {
        const myTurn = game.turn() === myColor;
        $turnInfo.text(myTurn ? 'ВАШ ХОД' : 'ХОД СОПЕРНИКА').toggleClass('active-turn', myTurn);
        $status.text(game.in_check() ? 'ШАХ!' : 'Игра продолжается');
        $pgn.text(game.pgn());
        $fen.text(game.fen());
    }

    $('#resign-btn').click(async () => {
        const res = await Swal.fire({
            title: 'Сдаться?',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Да',
            cancelButtonText: 'Нет'
        });
        if (res.isConfirmed) socket.emit('tournament:game:resign', { gameId });
    });

    $('#return-to-tournament-btn').click(() => { window.location.href = '/tournament.html'; });
});
