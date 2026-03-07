document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomCode = urlParams.get('room');
    if (!roomCode) { window.location.href = '/lobby.html'; return; }

    let user, board = null, game = new Chess(), isTeacher = false, currentMode = 'play';
    let demoFen = 'start';
    const canvas = document.getElementById('drawing-canvas');
    const ctx = canvas.getContext('2d');
    let isDrawing = false, startSquare = null;
    let shapes = [];

    try {
        const res = await fetch('/api/profile');
        user = await res.json();
        document.getElementById('user-status').innerHTML = `Вы: <strong>${user.username}</strong>`;
    } catch (e) { window.location.href = '/'; return; }

    const socket = io("http://147.45.147.30:3000", {
        transports: ['websocket'],
        withCredentials: true
    });

    function updateStatusMsg() {
        const statusMsg = document.getElementById('status-msg');
        const historyBlock = document.getElementById('moves-history-block');
        if (currentMode === 'play') {
            const turn = game.turn() === 'w' ? 'БЕЛЫХ' : 'ЧЕРНЫХ';
            statusMsg.innerHTML = `<span style="color: #2ecc71;">● ХОД ${turn} (ОСНОВНАЯ ИГРА)</span>`;
            const history = game.pgn();
            historyBlock.innerHTML = history ? `<strong>Ходы:</strong><br>${history}` : '<em>Список ходов пуст</em>';
        } else if (currentMode === 'demo') {
            statusMsg.innerHTML = '<span style="color: #3498db;">● РЕЖИМ ДЕМОНСТРАЦИИ</span>';
        } else {
            statusMsg.innerHTML = '<span style="color: #f39c12;">● РЕДАКТОР (Скрыто от ученика)</span>';
        }
    }

    const boardConfig = {
        draggable: true,
        onDragStart: (source, piece) => {
            if (currentMode === 'edit' || currentMode === 'demo') return isTeacher;
            if (game.game_over()) return false;
            if (isTeacher) return true;
            if (game.turn() === 'w') return false;
            if (piece.search(/^w/) !== -1) return false;
            return true;
        },
        onSnapEnd: () => { if (currentMode === 'play') board.position(game.fen()); },
        dropOffBoard: 'snapback',
        sparePieces: false,
        position: 'start',
        onDrop: (source, target, piece, newPos) => {
            if (currentMode === 'play') {
                const move = game.move({ from: source, to: target, promotion: 'q' });
                if (move === null) return 'snapback';
                updateStatusMsg();
                socket.emit('study:move', { roomCode, fen: game.fen(), type: 'play' });
            } else if (currentMode === 'demo' && isTeacher) {
                demoFen = Chessboard.objToFen(newPos);
                socket.emit('study:move', { roomCode, fen: demoFen, type: 'demo' });
            }
        },
        pieceTheme: '/img/chesspieces/wikipedia/{piece}.png'
    };

    board = Chessboard('myBoard', boardConfig);

    function setMode(mode, fromSocket = false) {
        if (!isTeacher && mode === 'edit') return;
        currentMode = mode;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.getElementById(`mode-${mode}`).classList.add('active');
        const historyBlock = document.getElementById('moves-history-block');
        const teacherControls = document.getElementById('teacher-controls-block');

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        board.destroy();
        if (mode === 'edit') {
            historyBlock.style.display = 'none';
            teacherControls.style.display = 'flex';
            boardConfig.sparePieces = true;
            boardConfig.dropOffBoard = 'trash';
            board = Chessboard('myBoard', boardConfig);
            board.clear();
        } else {
            historyBlock.style.display = (mode === 'play' ? 'block' : 'none');
            teacherControls.style.display = 'none';
            boardConfig.sparePieces = false;
            boardConfig.dropOffBoard = 'snapback';
            board = Chessboard('myBoard', boardConfig);
            board.position(mode === 'demo' ? demoFen : game.fen());
        }

        if (isTeacher && !fromSocket) socket.emit('study:changeMode', { roomCode, mode });
        board.orientation(isTeacher ? 'white' : 'black');
        updateStatusMsg();
        setTimeout(() => { board.resize(); resizeCanvas(); }, 150);
    }

    document.getElementById('import-btn').onclick = () => {
        const val = document.getElementById('pgn-input').value.trim();
        if (val) {
            let tempGame = new Chess();
            if (tempGame.load(val) || tempGame.load_pgn(val)) { demoFen = tempGame.fen(); }
            else { alert("Ошибка формата"); return; }
        } else { demoFen = board.fen() + " w - - 0 1"; }
        socket.emit('study:move', { roomCode, fen: demoFen, type: 'demo' });
        setMode('demo');
    };

    socket.emit('study:join', { roomCode });

    socket.on('study:roomData', (data) => {
        isTeacher = (data.teacher_id === user.id || user.role === 'admin' || user.role === 'teacher');
        if (isTeacher) {
            document.getElementById('teacher-tools').style.display = 'block';
            document.getElementById('mode-edit').style.display = 'block';
        }
        board.orientation(isTeacher ? 'white' : 'black');
        document.getElementById('room-id-display').textContent = data.roomCode;
        if (data.fen) { game.load(data.fen); board.position(data.fen); }
        updateStatusMsg();
    });

    socket.on('study:syncMove', (data) => {
        if (data.type === 'demo') {
            demoFen = data.fen;
            if (currentMode === 'demo') board.position(demoFen);
        } else {
            game.load(data.fen);
            if (currentMode === 'play') board.position(data.fen);
        }
        updateStatusMsg();
    });

    socket.on('study:syncMode', (data) => {
        if (!isTeacher) {
            setMode(data.mode, true);
        }
    });

    socket.on('study:syncDraw', (data) => { if (!isTeacher) { shapes = data.shapes; redrawAllShapes(); } });

    document.getElementById('mode-play').onclick = () => setMode('play');
    document.getElementById('mode-demo').onclick = () => setMode('demo');
    document.getElementById('mode-edit').onclick = () => setMode('edit');
    document.getElementById('clear-btn').onclick = () => board.clear();
    document.getElementById('reset-btn').onclick = () => {
        if (currentMode === 'play') {
            game.reset();
            board.start();
            socket.emit('study:move', { roomCode, fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', type: 'play' });
        } else { board.start(); }
    };
    document.getElementById('flip-btn').onclick = () => { board.flip(); setTimeout(resizeCanvas, 100); };

    function resizeCanvas() {
        const b = document.getElementById('myBoard');
        if(b && canvas) {
            canvas.width = b.offsetWidth;
            canvas.height = b.offsetHeight;
            redrawAllShapes();
        }
    }

    function clearShapes() {
        shapes = [];
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (isTeacher) socket.emit('study:draw', { roomCode, shapes: [] });
    }

    function drawShape(s) {
        if (s.type === 'circle') {
            ctx.strokeStyle = 'rgba(46, 204, 113, 0.8)';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(s.pos.x, s.pos.y, 20, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
            ctx.lineWidth = 4;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(s.start.x, s.start.y);
            ctx.lineTo(s.end.x, s.end.y);
            ctx.stroke();
            const headLength = 15;
            const angle = Math.atan2(s.end.y - s.start.y, s.end.x - s.start.x);
            ctx.beginPath();
            ctx.moveTo(s.end.x, s.end.y);
            ctx.lineTo(s.end.x - headLength * Math.cos(angle - Math.PI / 6), s.end.y - headLength * Math.sin(angle - Math.PI / 6));
            ctx.moveTo(s.end.x, s.end.y);
            ctx.lineTo(s.end.x - headLength * Math.cos(angle + Math.PI / 6), s.end.y - headLength * Math.sin(angle + Math.PI / 6));
            ctx.stroke();
        }
    }

    function redrawAllShapes() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        shapes.forEach(drawShape);
    }

    const boardEl = document.getElementById('myBoard');
    boardEl.oncontextmenu = (e) => e.preventDefault();

    boardEl.addEventListener('mousedown', (e) => {
        const rect = canvas.getBoundingClientRect();
        const pos = { x: e.clientX - rect.left, y: e.clientY - rect.top };

        if (e.button === 0) { // Левая кнопка очищает стрелки
            clearShapes();
            return;
        }

        if (e.button === 2 && isTeacher) { // Правая кнопка начинает рисование
            isDrawing = true;
            startSquare = pos;
        }
    });

    boardEl.addEventListener('mousemove', (e) => {
        if (!isDrawing) return;
        const rect = canvas.getBoundingClientRect();
        const pos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        redrawAllShapes();
        drawShape({ type: 'arrow', start: startSquare, end: pos });
    });

    window.addEventListener('mouseup', (e) => {
        if (isDrawing && e.button === 2) {
            const rect = canvas.getBoundingClientRect();
            const pos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            const dist = Math.hypot(pos.x - startSquare.x, pos.y - startSquare.y);
            if (dist > 15) shapes.push({ type: 'arrow', start: startSquare, end: pos });
            else shapes.push({ type: 'circle', pos: startSquare });
            if (isTeacher) socket.emit('study:draw', { roomCode, shapes });
            isDrawing = false;
            redrawAllShapes();
        }
    });

    window.addEventListener('resize', () => { if(board) board.resize(); resizeCanvas(); });
    setTimeout(() => { if(board) board.resize(); resizeCanvas(); }, 500);
});
