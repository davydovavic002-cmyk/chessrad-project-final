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

    const socket = io({ transports: ['websocket'], withCredentials: true });

    // --- ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ РИСОВАНИЯ ЛИТОГО НАКОНЕЧНИКА ---
    function drawArrowhead(context, fromX, fromY, toX, toY, radius = 15) {
        const angle = Math.atan2(toY - fromY, toX - fromX);

        context.save();
        context.fillStyle = context.strokeStyle; // Используем тот же цвет, что и у линии
        context.beginPath();
        context.translate(toX, toY);
        context.rotate(angle);

        // Рисуем треугольник
        context.moveTo(0, 0);
        context.lineTo(-radius, -radius / 1.5);
        context.lineTo(-radius, radius / 1.5);
        context.closePath();
        context.fill();
        context.restore();
    }

    // --- ФУНКЦИЯ ФИНАЛЬНОГО ЭКРАНА ---
    function showGameOverModal(title, message) {
        if (document.getElementById('game-over-modal')) return;

        const modalHtml = `
            <div id="game-over-modal" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.7); z-index:20000; display:flex; align-items:center; justify-content:center;">
                <div style="background:white; padding:30px; border-radius:15px; text-align:center; box-shadow:0 5px 25px rgba(0,0,0,0.3); max-width:300px;">
                    <h2 style="margin-top:0; color:#2c3e50;">${title}</h2>
                    <p style="font-size:16px; color:#7f8c8d;">${message}</p>
                    <button onclick="this.parentElement.parentElement.remove()" style="background:#3498db; color:white; border:none; padding:10px 20px; border-radius:5px; cursor:pointer; font-weight:bold;">Отлично!</button>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    function checkGameOver() {
        if (game.game_over()) {
            let title = "Игра окончена";
            let message = "";

            if (game.in_checkmate()) {
                const winner = game.turn() === 'w' ? 'Черные' : 'Белые';
                title = "Мат!";
                message = `Победа игрока: ${winner}`;
            } else if (game.in_draw() || game.in_stalemate() || game.in_threefold_repetition()) {
                title = "Ничья";
                message = "Партия завершилась вничью";
            }
            showGameOverModal(title, message);
        }
    }

    // --- ЛОГИКА БИБЛИОТЕКИ ПОЗИЦИЙ ---
    const libModalHtml = `
        <style>
            #lib-content { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; margin-top: 10px; }
            .lib-folder { background: #f8f9fa; border: 1px solid #ddd; border-radius: 8px; padding: 15px 5px; text-align: center; cursor: pointer; transition: 0.2s; }
            .lib-folder:hover { border-color: #3498db; box-shadow: 0 0 10px rgba(52, 152, 219, 0.4); transform: translateY(-2px); }
            .lib-pos-card { background: white; border: 1px solid #eee; border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; transition: 0.2s; cursor: pointer; }
            .lib-pos-card:hover { border-color: #3498db; box-shadow: 0 0 10px rgba(52, 152, 219, 0.4); }
            .lib-preview { width: 100%; aspect-ratio: 1/1; background: #eee; pointer-events: none; }
            .lib-info { padding: 5px; font-size: 12px; text-align: center; font-weight: bold; }
            .lib-back { color: #3498db; cursor: pointer; font-weight: bold; margin-bottom: 10px; display: block; font-size: 14px; }
            #lib-search-input { width: 100%; padding: 10px; margin-bottom: 10px; border: 1px solid #ddd; border-radius: 8px; box-sizing: border-box; }
        </style>
        <div id="lib-modal" style="display:none; position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); z-index:10001; background:white; padding:20px; border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,0.5); width:450px; max-height:80vh; overflow-y:auto; color: #333;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom:1px solid #eee; padding-bottom:10px;">
                <h3 style="margin:0;" id="lib-title">📚 Библиотека</h3>
                <button onclick="document.getElementById('lib-modal').style.display='none'; document.getElementById('lib-overlay').style.display='none';" style="cursor:pointer; border:none; background:none; font-size:20px;">&times;</button>
            </div>
            <input type="text" id="lib-search-input" placeholder="🔍 Найти позицию..." oninput="searchInLibrary(this.value)">
            <div id="lib-nav"></div>
            <div id="lib-content">Загрузка...</div>
        </div>
        <div id="lib-overlay" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:10000;" onclick="document.getElementById('lib-modal').style.display='none'; document.getElementById('lib-overlay').style.display='none';"></div>
    `;
    document.body.insertAdjacentHTML('beforeend', libModalHtml);

    let cachedPositions = [];

    async function openLibrary() {
        document.getElementById('lib-modal').style.display = 'block';
        document.getElementById('lib-overlay').style.display = 'block';
        try {
            const res = await fetch('/api/positions');
            cachedPositions = await res.json();
            document.getElementById('lib-search-input').value = '';
            renderLibFolders();
        } catch (e) { document.getElementById('lib-content').innerHTML = 'Ошибка загрузки'; }
    }

    function renderLibFolders() {
        const content = document.getElementById('lib-content');
        const nav = document.getElementById('lib-nav');
        nav.innerHTML = '';
        if (cachedPositions.length === 0) { content.innerHTML = '<p>Библиотека пуста.</p>'; return; }
        const categories = [...new Set(cachedPositions.map(p => p.category || 'Общее'))];
        content.innerHTML = categories.map(cat => {
            const count = cachedPositions.filter(p => (p.category || 'Общее') === cat).length;
            return `<div class="lib-folder" onclick="renderLibCategory('${cat}')"><div style="font-size:30px;">📂</div><div style="font-weight:bold;">${cat}</div><div style="font-size:10px; color:gray;">${count} поз.</div></div>`;
        }).join('');
    }

    window.searchInLibrary = function(query) {
        const content = document.getElementById('lib-content');
        const nav = document.getElementById('lib-nav');
        query = query.toLowerCase().trim();
        if (!query) { nav.innerHTML = ''; renderLibFolders(); return; }
        nav.innerHTML = `<span class="lib-back" onclick="document.getElementById('lib-search-input').value=''; renderLibFolders()">← Назад</span>`;
        const filtered = cachedPositions.filter(p => p.title.toLowerCase().includes(query));
        content.innerHTML = filtered.map(pos => `<div class="lib-pos-card" onclick="applyLibraryPosition('${pos.fen}')"><img src="https://chessboardimage.com/${pos.fen.split(' ')[0]}.png" class="lib-preview"><div class="lib-info">${pos.title}</div></div>`).join('') || '<p>Ничего не найдено</p>';
    };

    window.renderLibCategory = function(catName) {
        const content = document.getElementById('lib-content');
        const nav = document.getElementById('lib-nav');
        nav.innerHTML = `<span class="lib-back" onclick="renderLibFolders()">← Назад</span>`;
        const filtered = cachedPositions.filter(p => (p.category || 'Общее') === catName);
        content.innerHTML = filtered.map(pos => `<div class="lib-pos-card" onclick="applyLibraryPosition('${pos.fen}')"><img src="https://chessboardimage.com/${pos.fen.split(' ')[0]}.png" class="lib-preview"><div class="lib-info">${pos.title}</div></div>`).join('');
    };

    window.applyLibraryPosition = function(fen) {
        if (currentMode === 'play') game.load(fen);
        else demoFen = fen;
        board.position(fen);
        socket.emit('study:move', { roomCode, fen: fen, type: currentMode });
        updateStatusMsg();
        document.getElementById('lib-modal').style.display = 'none';
        document.getElementById('lib-overlay').style.display = 'none';
    };

    function translateMove(move) {
        const pieceNames = { 'p': 'пешка', 'n': 'конь', 'b': 'слон', 'r': 'ладья', 'q': 'ферзь', 'k': 'король' };
        return `<li>${pieceNames[move.piece] || ''} (${move.from}-${move.to})</li>`;
    }

    function updateStatusMsg() {
        const statusMsg = document.getElementById('status-msg');
        const historyBlock = document.getElementById('moves-history-block');
        if (currentMode === 'play') {
            const turn = game.turn() === 'w' ? 'БЕЛЫХ' : 'ЧЕРНЫХ';
            statusMsg.innerHTML = `<span style="color: #2ecc71;">● ХОД ${turn} (ИГРА)</span>`;
            const moves = game.history({ verbose: true });
            historyBlock.innerHTML = moves.length > 0 ? `<strong>История:</strong><ul>${moves.map(translateMove).join('')}</ul>` : '<em>История пуста</em>';
        } else if (currentMode === 'demo') {
            statusMsg.innerHTML = '<span style="color: #3498db;">● ДЕМОНСТРАЦИЯ</span>';
            historyBlock.innerHTML = '';
        } else { statusMsg.innerHTML = '<span style="color: #f39c12;">● РЕДАКТОР</span>'; }
    }

    const boardConfig = {
        draggable: true,
        onDragStart: (source, piece) => {
            if (game.game_over()) return false;
            if (isTeacher || currentMode === 'demo') return true;
            if (currentMode === 'play' && game.turn() === 'b' && piece.search(/^b/) !== -1) return true;
            return false;
        },
        onSnapEnd: () => { if (currentMode === 'play') board.position(game.fen()); },
        dropOffBoard: 'snapback',
        position: 'start',
        onDrop: (source, target, piece, newPos) => {
            if (currentMode === 'play') {
                const move = game.move({ from: source, to: target, promotion: 'q' });
                if (move === null) return 'snapback';
                socket.emit('study:move', { roomCode, fen: game.fen(), type: 'play' });
                checkGameOver();
            } else {
                demoFen = Chessboard.objToFen(newPos);
                socket.emit('study:move', { roomCode, fen: demoFen, type: currentMode });
            }
            updateStatusMsg();
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
        const libBtn = document.getElementById('lib-btn');

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        board.destroy();

        if (mode === 'edit') {
            historyBlock.style.display = 'none';
            teacherControls.style.display = 'flex';
            if (libBtn) libBtn.style.display = 'inline-block';
            boardConfig.sparePieces = true;
            boardConfig.dropOffBoard = 'trash';
        } else {
            historyBlock.style.display = 'block';
            teacherControls.style.display = (mode === 'demo' && isTeacher) ? 'flex' : 'none';
            if (libBtn) libBtn.style.display = (mode === 'demo') ? 'inline-block' : 'none';
            boardConfig.sparePieces = false;
            boardConfig.dropOffBoard = 'snapback';
        }

        board = Chessboard('myBoard', boardConfig);
        board.position(mode === 'demo' ? demoFen : game.fen());
        if (isTeacher && !fromSocket) socket.emit('study:changeMode', { roomCode, mode });
        board.orientation(isTeacher ? 'white' : 'black');
        updateStatusMsg();
        setTimeout(() => { board.resize(); resizeCanvas(); }, 150);
    }

    socket.emit('study:join', { roomCode });

    socket.on('study:roomData', (data) => {
        isTeacher = (data.teacher_id === user.id || user.role === 'admin' || user.role === 'teacher');
        if (isTeacher) {
            document.getElementById('teacher-tools').style.display = 'block';
            document.getElementById('mode-edit').style.display = 'block';
            if (!document.getElementById('lib-btn')) {
                const btn = document.createElement('button');
                btn.id = 'lib-btn'; btn.className = 'btn';
                btn.style.cssText = 'background: #3498db; color: white; margin-left: 10px; display: none;';
                btn.innerHTML = '📚 Библиотека'; btn.onclick = openLibrary;
                document.getElementById('teacher-controls-block').appendChild(btn);
            }
        }
        board.orientation(isTeacher ? 'white' : 'black');
        document.getElementById('room-id-display').textContent = data.roomCode;
        if (data.fen) { game.load(data.fen); demoFen = data.fen; board.position(data.fen); }
        updateStatusMsg();
    });

    socket.on('study:syncMove', (data) => {
        if (data.type === 'demo' || data.type === 'edit') {
            demoFen = data.fen;
            if (currentMode === 'demo' || currentMode === 'edit') board.position(demoFen);
        } else {
            game.load(data.fen);
            if (currentMode === 'play') {
                board.position(data.fen);
                checkGameOver();
            }
        }
        updateStatusMsg();
    });

    socket.on('study:gameFinished', (data) => {
        const { winnerId, isDraw } = data;
        let title = "Партия завершена";
        let message = isDraw ? "Ничья! Рейтинг обновлен." : (winnerId === user.id ? "Вы победили! Рейтинг увеличен." : "Вы проиграли. Рейтинг обновлен.");
        showGameOverModal(title, message);
    });

    socket.on('study:syncMode', (data) => { if (!isTeacher) setMode(data.mode, true); });
    socket.on('study:syncDraw', (data) => { if (!isTeacher) { shapes = data.shapes; redrawAllShapes(); } });

    document.getElementById('mode-play').onclick = () => setMode('play');
    document.getElementById('mode-demo').onclick = () => setMode('demo');
    document.getElementById('mode-edit').onclick = () => setMode('edit');
    document.getElementById('clear-btn').onclick = () => { board.clear(); socket.emit('study:move', { roomCode, fen: '8/8/8/8/8/8/8/8', type: currentMode }); };
    document.getElementById('reset-btn').onclick = () => {
        game.reset(); board.start(); demoFen = 'start';
        socket.emit('study:move', { roomCode, fen: 'start', type: currentMode });
        if(document.getElementById('game-over-modal')) document.getElementById('game-over-modal').remove();
    };
    document.getElementById('flip-btn').onclick = () => { board.flip(); setTimeout(resizeCanvas, 100); };

    function resizeCanvas() {
        const b = document.getElementById('myBoard');
        if(b && canvas) { canvas.width = b.offsetWidth; canvas.height = b.offsetHeight; redrawAllShapes(); }
    }

    function redrawAllShapes() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        shapes.forEach(s => {
            ctx.lineWidth = 4;
            if (s.type === 'circle') {
                ctx.strokeStyle = 'rgba(46, 204, 113, 0.8)';
                ctx.beginPath(); ctx.arc(s.pos.x, s.pos.y, 20, 0, Math.PI * 2); ctx.stroke();
            } else {
                ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
                ctx.beginPath(); ctx.moveTo(s.start.x, s.start.y); ctx.lineTo(s.end.x, s.end.y); ctx.stroke();
                drawArrowhead(ctx, s.start.x, s.start.y, s.end.x, s.end.y, 18);
            }
        });
    }

    const boardEl = document.getElementById('myBoard');
    boardEl.oncontextmenu = (e) => e.preventDefault();
    boardEl.addEventListener('mousedown', (e) => {
        const rect = canvas.getBoundingClientRect();
        const pos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        if (e.button === 0) {
            shapes = [];
            ctx.clearRect(0,0,canvas.width,canvas.height);
            if(isTeacher) socket.emit('study:draw', {roomCode, shapes:[]});
            return;
        }
        if (e.button === 2 && isTeacher) { isDrawing = true; startSquare = pos; }
    });

    boardEl.addEventListener('mousemove', (e) => {
        if (!isDrawing) return;
        const rect = canvas.getBoundingClientRect();
        const pos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        redrawAllShapes();
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(startSquare.x, startSquare.y); ctx.lineTo(pos.x, pos.y); ctx.stroke();
        drawArrowhead(ctx, startSquare.x, startSquare.y, pos.x, pos.y, 18);
    });

    window.addEventListener('mouseup', (e) => {
        if (isDrawing && e.button === 2) {
            const rect = canvas.getBoundingClientRect();
            const pos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            const dist = Math.hypot(pos.x - startSquare.x, pos.y - startSquare.y);
            if (dist > 15) shapes.push({ type: 'arrow', start: startSquare, end: pos });
            else shapes.push({ type: 'circle', pos: startSquare });
            if (isTeacher) socket.emit('study:draw', { roomCode, shapes });
            isDrawing = false; redrawAllShapes();
        }
    });

    window.addEventListener('resize', () => { if(board) board.resize(); resizeCanvas(); });
    setTimeout(() => { if(board) board.resize(); resizeCanvas(); }, 500);
});
