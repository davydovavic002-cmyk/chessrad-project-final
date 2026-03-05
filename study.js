document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomCode = urlParams.get('room');
    if (!roomCode) { window.location.href = '/lobby.html'; return; }

    let user, board = null, game = new Chess(), isTeacher = false, currentMode = 'play';
    const canvas = document.getElementById('drawing-canvas');
    const ctx = canvas.getContext('2d');
    let shapes = [];

    try {
        const res = await fetch('/api/profile');
        user = await res.json();
        document.getElementById('user-status').innerHTML = `Вы: <strong>${user.username}</strong>`;
    } catch (e) { window.location.href = '/'; return; }

    const socket = io({ transports: ['websocket'] });

    function updateStatusMsg() {
        const statusMsg = document.getElementById('status-msg');
        const historyBlock = document.getElementById('moves-history-block');

        if (currentMode === 'play') {
            const turn = game.turn() === 'w' ? 'БЕЛЫХ' : 'ЧЕРНЫХ';
            statusMsg.innerHTML = `<span style="color: #2ecc71;">● ХОД ${turn}</span>`;
            const history = game.pgn();
            historyBlock.innerHTML = history ? `<strong>Ходы:</strong><br>${history}` : '<em>Список ходов пуст</em>';
            historyBlock.scrollTop = historyBlock.scrollHeight;
        } else {
            statusMsg.innerHTML = '';
        }
    }

    const boardConfig = {
        draggable: true,
        onDragStart: (source, piece) => {
            if (isTeacher || currentMode === 'edit') return true;
            if (game.game_over()) return false;
            return !((game.turn() === 'w' && piece.search(/^b/) !== -1) || (game.turn() === 'b' && piece.search(/^w/) !== -1));
        },
        onSnapEnd: () => { if (currentMode === 'play') board.position(game.fen()); },
        dropOffBoard: 'snapback',
        sparePieces: false,
        position: 'start',
        onDrop: (source, target, piece, newPos) => {
            clearShapes();
            if (currentMode === 'play') {
                const move = game.move({ from: source, to: target, promotion: 'q' });
                if (move === null) return 'snapback';
                updateStatusMsg();
                socket.emit('study:move', { roomCode, fen: game.fen(), type: 'play' });
            } else {
                setTimeout(() => {
                    socket.emit('study:move', { roomCode, fen: Chessboard.objToFen(newPos), type: 'edit' });
                }, 50);
            }
        },
        pieceTheme: '/img/chesspieces/wikipedia/{piece}.png'
    };

    board = Chessboard('myBoard', boardConfig);

    function setMode(mode) {
        currentMode = mode;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.getElementById(`mode-${mode}`).classList.add('active');

        const historyBlock = document.getElementById('moves-history-block');
        const teacherControls = document.getElementById('teacher-controls-block');

        clearShapes(); // Очищаем графику при смене режима

        if (mode === 'edit') {
            historyBlock.style.display = 'none';
            teacherControls.style.display = 'flex';
            board.destroy();
            boardConfig.sparePieces = true;
            boardConfig.dropOffBoard = 'trash';
            board = Chessboard('myBoard', boardConfig);
            board.clear();
            game.clear();
        } else {
            historyBlock.style.display = 'block';
            teacherControls.style.display = 'none';
            board.destroy();
            boardConfig.sparePieces = false;
            boardConfig.dropOffBoard = 'snapback';
            board = Chessboard('myBoard', boardConfig);

            // Если игра была пуста после режима разбора, ставим начальную позицию
            if (!game.fen() || game.fen() === 'empty' || game.history().length === 0) {
                game.reset();
                board.start();
            } else {
                board.position(game.fen());
            }
        }
        updateStatusMsg();
        resizeCanvas();
        socket.emit('study:modeChange', { roomCode, mode });
    }

    socket.emit('study:join', { roomCode });
    socket.on('study:roomData', (data) => {
        document.getElementById('room-id-display').textContent = data.roomCode;
        isTeacher = (data.teacher_id === user.id || user.role === 'admin');
        if (isTeacher) document.getElementById('teacher-tools').style.display = 'block';
        if (data.fen && data.fen !== 'start') { game.load(data.fen); board.position(data.fen); }
        updateStatusMsg();
    });

    socket.on('study:syncMove', (data) => {
        if (data.fen === 'empty') { board.clear(); game.clear(); }
        else { board.position(data.fen); if (data.type === 'play') game.load(data.fen); }
        updateStatusMsg();
    });

    document.getElementById('mode-play').onclick = () => isTeacher && setMode('play');
    document.getElementById('mode-edit').onclick = () => isTeacher && setMode('edit');
    document.getElementById('clear-btn').onclick = () => { board.clear(); game.clear(); socket.emit('study:move', { roomCode, fen: 'empty', type: 'edit' }); };
    document.getElementById('reset-btn').onclick = () => { board.start(); game.reset(); socket.emit('study:move', { roomCode, fen: 'start', type: 'edit' }); };
    document.getElementById('flip-btn').onclick = () => { board.flip(); setTimeout(resizeCanvas, 100); };

    document.getElementById('import-btn').onclick = () => {
        const val = document.getElementById('pgn-input').value.trim();
        if (game.load(val) || game.load_pgn(val)) {
            board.position(game.fen());
            socket.emit('study:move', { roomCode, fen: game.fen(), type: 'edit' });
        } else { alert("Ошибка PGN/FEN"); }
    };

    function resizeCanvas() {
        const b = document.getElementById('myBoard');
        if(b && canvas) { canvas.width = b.offsetWidth; canvas.height = b.offsetHeight; }
    }
    function clearShapes() { shapes = []; ctx.clearRect(0, 0, canvas.width, canvas.height); }
    window.addEventListener('resize', resizeCanvas);
    setTimeout(resizeCanvas, 500);
});
