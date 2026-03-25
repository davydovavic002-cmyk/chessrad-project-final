let board = null;
let game = new Chess();
let currentPuzzle = null;
let solvedCount = 0;
const TOTAL_PUZZLES = 10;
let timeLeft = 60;
let timerId = null;
let lozzaWorker = null;

let failedPuzzles = [];
let isReviewMode = false;

$(document).ready(function() {
    initBoard();
    loadSessionInfo();
    initEngine();
    // При клике на поле описания тоже можно вызвать подсказку
    $('#description').css('cursor', 'pointer').on('click', getHint);
});

function initEngine() {
    try {
        lozzaWorker = new Worker('/js/stockfish/lozza.js');
        lozzaWorker.onmessage = function(e) {
            if (e.data.includes('bestmove')) {
                const bestMove = e.data.split(' ')[1];
                // Выводим текст подсказки в нижнее поле
                $('#description').html(`💡 <b>Подсказка:</b> лучший ход — <b>${bestMove}</b>`);
                showHintOnBoard(bestMove);
            }
        };
        lozzaWorker.postMessage('uci');
    } catch (e) { console.warn("Engine offline"); }
}

function initBoard() {
    board = Chessboard('board', {
        draggable: true,
        dropOffBoard: 'snapback',
        onDragStart: onDragStart,
        onDrop: onDrop,
        onMouseoutSquare: null,
        onMouseoverSquare: null,
        position: 'start',
        orientation: 'white',
        pieceTheme: '/img/chesspieces/wikipedia/{piece}.png'
    });
}

function startTimer() {
    if (timerId) clearInterval(timerId);
    timeLeft = 60;
    updateTimerDisplay();
    timerId = setInterval(() => {
        timeLeft--;
        updateTimerDisplay();
        if (timeLeft <= 0) handleFailure("Время вышло!");
    }, 1000);
}

function updateTimerDisplay() {
    const min = Math.floor(timeLeft / 60).toString().padStart(2, '0');
    const sec = (timeLeft % 60).toString().padStart(2, '0');
    $('#timer').text(`${min}:${sec}`);
}

async function loadSessionInfo() {
    try {
        const res = await fetch('/api/user/puzzle-status');
        const data = await res.json();
        solvedCount = data.solvedToday || 0;
        updateProgress();
        $('#streak-info').text(`🔥 Серия: ${data.streak} дн.`);
        $('#action-btn').on('click', startDailySession);
    } catch (e) { console.error(e); }
}

async function startDailySession() {
    $('#action-btn').fadeOut();
    await loadNextPuzzle();
}

async function loadNextPuzzle() {
    if (!isReviewMode && solvedCount >= TOTAL_PUZZLES) {
        if (failedPuzzles.length > 0) return startReviewMode();
        return victory();
    }

    if (isReviewMode && failedPuzzles.length === 0) return victory();

    try {
        // Добавляем timestamp, чтобы браузер не кэшировал старую задачу
        const res = await fetch(`/api/puzzle/next?t=${Date.now()}`);
        if (!res.ok) return (failedPuzzles.length > 0) ? startReviewMode() : victory();

        currentPuzzle = await res.json();
        setupBoard();
        startTimer();
    } catch (e) { console.error(e); }
}

function setupBoard() {
    game.load(currentPuzzle.fen);
    board.orientation(game.turn() === 'w' ? 'white' : 'black');
    board.position(currentPuzzle.fen);

    // Сбрасываем текст описания на стандартный при новой задаче
    $('#description').html(currentPuzzle.description || "Найдите лучший ход за " + (game.turn() === 'w' ? "белых" : "черных"));
    $('#board .square-55d63').css({'box-shadow': 'none', 'background': ''});

    const txt = isReviewMode ? `Отработка: ${failedPuzzles.length}` : `Задача ${solvedCount + 1} из ${TOTAL_PUZZLES}`;
    $('#status').text(txt).css('color', '#333');
}

function handleFailure(reason) {
    clearInterval(timerId);
    failedPuzzles.push(currentPuzzle);

    Swal.fire({
        title: reason,
        text: 'Эта задача появится в конце тренировки',
        icon: 'error',
        timer: 1000,
        showConfirmButton: false
    });

    setTimeout(() => {
        if (!isReviewMode) {
            solvedCount++; // Двигаем счетчик вперед, даже если ошибка
            updateProgress();
        }
        loadNextPuzzle(); // ГАРАНТИРОВАННО запрашиваем следующую
    }, 1000);
}

function onDrop(source, target) {
    const move = game.move({ from: source, to: target, promotion: 'q' });
    if (move === null) return 'snapback';

    const isCorrect = (move.san === currentPuzzle.solution || (source + target) === currentPuzzle.solution);

    if (isCorrect) {
        clearInterval(timerId);
        $(`#board .square-${target}`).css('background', 'rgba(46, 204, 113, 0.6)');

        if (!isReviewMode) {
            solvedCount++;
            updateProgress();
            fetch('/api/puzzle/solve', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ puzzleId: currentPuzzle.id })
            });
        }
        setTimeout(isReviewMode ? nextReviewPuzzle : loadNextPuzzle, 600);
    } else {
        game.undo();
        handleFailure("Неверный ход!");
        return 'snapback';
    }
}

// Режим работы над ошибками
function startReviewMode() {
    isReviewMode = true;
    Swal.fire({
        title: 'Работа над ошибками',
        text: 'Реши те задачи, где возникли сложности',
        icon: 'warning'
    }).then(() => { nextReviewPuzzle(); });
}

function nextReviewPuzzle() {
    if (failedPuzzles.length === 0) return victory();
    currentPuzzle = failedPuzzles.shift();
    setupBoard();
    startTimer();
}

function updateProgress() {
    const p = Math.min((solvedCount / TOTAL_PUZZLES) * 100, 100);
    $('#progress-fill').stop().animate({ width: p + '%' }, 400);
}

function victory() {
    clearInterval(timerId);
    fetch('/api/puzzle/complete-daily', { method: 'POST' }).then(() => {
        if (window.confetti) confetti({ particleCount: 150, spread: 70 });
        Swal.fire({ title: 'Браво!', text: 'Все задачи решены. Стрик сохранен!', icon: 'success' })
            .then(() => { window.location.href = '/lobby'; });
    });
}

function getHint() {
    if (!lozzaWorker) return;
    lozzaWorker.postMessage(`position fen ${game.fen()}`);
    lozzaWorker.postMessage('go movetime 1000');
}

function showHintOnBoard(move) {
    const from = move.substring(0, 2), to = move.substring(2, 4);
    $(`#board .square-${from}`).css('background', 'rgba(52, 152, 219, 0.4)');
    $(`#board .square-${to}`).css('background', 'rgba(46, 204, 113, 0.4)');
}

function onDragStart(source, piece) {
    if (game.game_over()) return false;
    const turn = game.turn();
    if ((turn === 'w' && piece.search(/^b/) !== -1) || (turn === 'b' && piece.search(/^w/) !== -1)) return false;
}
