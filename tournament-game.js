$(document).ready(async function() {

    // --- 1. ПРОВЕРКА АУТЕНТИФИКАЦИИ ---
    try {
        const response = await fetch('/api/profile');
        if (!response.ok) {
            throw new Error('Пользователь не авторизован');
        }
    } catch (error) {
        alert('Доступ запрещен. Пожалуйста, войдите в систему.');
        window.location.href = '/';
        return;
    }

    console.log('ЗАПУЩЕН СКРИПТ tournament-game.js (синхронизированная версия)');

    // --- 2. ПОЛУЧЕНИЕ ID ИГРЫ ИЗ URL ---
    const pathParts = window.location.pathname.split('/');
    const gameId = pathParts[pathParts.length - 1];

    if (!gameId) {
        alert('Ошибка: не удалось определить ID игры.');
        window.location.href = '/lobby.html';
        return;
    }
    console.log('ID текущей игры:', gameId);

    // --- 3. ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ И ЭЛЕМЕНТЫ UI ---
    let board = null;
    const game = new Chess();
    let myColor = 'white';
    let tournamentId = null;

    const $status = $('#status');
    const $fen = $('#fen');
    const $pgn = $('#pgn');
    const $turnInfo = $('#turn-info');
    const $gameControls = $('#game-controls');
    const $resignBtn = $('#resign-btn');
    const $returnBtn = $('#return-to-tournament-btn');

    // --- 5. ЛОГИКА ШАХМАТНОЙ ДОСКИ (ПЕРЕМЕЩЕНА ВВЕРХ ДЛЯ ИСПРАВЛЕНИЯ ОШИБКИ) ---

    function onDragStart(source, piece) {
        // Проверяем, что игра не окончена, сейчас ход нужного цвета, и фигура принадлежит игроку
        if (game.game_over() || game.turn() !== myColor.charAt(0) || piece.search(new RegExp(`^${myColor.charAt(0)}`)) === -1) {
            return false;
        }
        return true;
    }

// ЗАМЕНИТЕ ВСЮ ФУНКЦИЮ onDrop НА ЭТОТ КОД:
function onDrop(source, target) {
    // --- ДИАГНОСТИКА: ШАГ 1 ---
    // (ИСПРАВЛЕНО: добавлены кавычки-обратные апострофы ``)
    console.log(`--- onDrop СРАБОТАЛ ---`);
    console.log(`Ход с ${source} на ${target}`);
    console.log(`Мой цвет (myColor): '${myColor}'`);
    console.log(`Чей ход по мнению game.js (game.turn()): '${game.turn()}'`);

    const move = game.move({ from: source, to: target, promotion: 'q' });

    // --- ДИАГНОСТИКА: ШАГ 2 ---
    console.log('Результат game.move():', move);

    if (move === null) {
        console.error('ОШИБКА: Ход нелегальный, game.move() вернул null. Отправка на сервер отменена.');
        return 'snapback';
    }

    // Если мы дошли сюда, ход легальный.
    console.log('УСПЕХ: Ход легальный. Отправляю данные на сервер...');
    console.log('Отправляемые данные:', { gameId: gameId, move: { from: source, to: target, promotion: 'q' } });

    // (ИСПРАВЛЕНО: Старая строка удалена, осталась только правильная)
    socket.emit('tournament:game:move', { gameId: gameId, move: { from: source, to: target, promotion: 'q' } });
}
    function onSnapEnd() {
        board.position(game.fen());
    }

    // --- 4. ПОДКЛЮЧЕНИЕ К SOCKET.IO И ОБРАБОТЧИКИ СОБЫТИЙ ---
    const socket = io();

    socket.on('connect', () => {
        console.log('Успешно подключено. Socket ID:', socket.id);
        socket.emit('tournament:game:join', { gameId });
    });

    socket.on('disconnect', () => {
        updateStatus('Соединение с сервером потеряно. Обновите страницу.');
    });

    socket.on('game:state', (data) => {
        console.log('Получено состояние игры (game:state):', data);
        myColor = data.color;
        tournamentId = data.tournamentId;
        game.load(data.fen);
        if (!board) {
            const config = {
                draggable: true,
                position: data.fen,
                orientation: myColor === 'w' ? 'white' : 'black',
                pieceTheme: '/img/chesspieces/wikipedia/{piece}.png',
                onDragStart: onDragStart, // Теперь эта функция точно определена
                onDrop: onDrop,           // И эта тоже
                onSnapEnd: onSnapEnd      // И эта!
            };
            board = Chessboard('myBoard', config);
        } else {
            board.position(data.fen);
        }
        updateGameDisplay();
        $gameControls.css('display', 'flex');
    });

    socket.on('game:move', (move) => {
        console.log('Получен ход от соперника:', move);
        game.move(move);
        board.position(game.fen());
        updateGameDisplay();
    });


// В вашем клиентском JS-файле (который управляет страницей ИГРЫ)

socket.on('game:over', (data) => {
    console.log('Игра окончена:', data);

    // 1. Формируем понятное сообщение для пользователя
    const finalMessage = `Игра окончена! ${data.reason || ''}. Ваш результат: ${data.yourStatus || ''}`;

    // 2. Отображаем это сообщение (у вас это делает updateStatus)
    updateStatus(finalMessage);

    // 3. Отключаем игровые кнопки
    $resignBtn.prop('disabled', true);
    // Возможно, стоит отключить и возможность делать ходы на доске
    // chess.setFEN(chess.fen()); // Простой способ заблокировать доску

    // 4. --- КЛЮЧЕВОЕ ИЗМЕНЕНИЕ ---
    // Через 3 секунды автоматически возвращаем пользователя на страницу турнира.
    // Это дает ему время прочитать, что произошло.
    console.log('Возвращаемся на страницу турнира через 3 секунды...');
    setTimeout(() => {
        // Укажите правильный URL вашей страницы турнира!
        window.location.href = '/tournament';
    }, 3000); // 3000 миллисекунд = 3 секунды
});

    socket.on('error', (data) => {
        console.error('Ошибка от сервера:', data.message);
        alert(`Ошибка: ${data.message}`);
        if (tournamentId) {
            window.location.href = `/tournament/${tournamentId}`;
        } else {
            window.location.href = '/lobby.html';
        }
    });

    // --- 6. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ И КНОПКИ ---

    function updateGameDisplay() {
        const moveColor = game.turn() === 'b' ? 'Черных' : 'Белых';
        let statusText = '';
        if (game.in_checkmate()) {
            statusText = `Игра окончена, мат. ${moveColor} проиграли.`;
        } else if (game.in_draw()) {
            statusText = 'Игра окончена, ничья.';
        } else {
            statusText = `Ход ${moveColor}`;
            if (game.in_check()) {
                statusText += `, ${moveColor} под шахом.`;
            }
        }
        $status.html(statusText);
        $fen.text(game.fen());
        $pgn.html(game.pgn());
        const myTurn = game.turn() === myColor.charAt(0);
        $turnInfo.text(myTurn ? 'Ваш ход' : 'Ход соперника');
        $turnInfo.toggleClass('my-turn', myTurn);
    }

    function updateStatus(message) {
        $status.html(message);
    }


// ЗАМЕНИТЕ ОБРАБОТЧИК КНОПКИ НА ЭТОТ КОД:
$resignBtn.on('click', function() {
    if (confirm('Вы уверены, что хотите сдаться?')) {
        // (ИСПРАВЛЕНО: отправляем gameId, как и договаривались)
        socket.emit('tournament:game:resign', { gameId: gameId });
    }
});

    $returnBtn.on('click', function() {
        if (tournamentId) {
            window.location.href = `/tournament/${tournamentId}`;
        } else {
            alert('Не удалось определить турнир. Возврат в лобби.');
            window.location.href = '/lobby.html';
        }
    });

});
