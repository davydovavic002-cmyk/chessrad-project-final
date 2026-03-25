<!DOCTYPE html>
<html lang="ru">
<head>
    <meta http-equiv="Content-Security-Policy" content="font-src 'self' https://fonts.gstatic.com;">
    <meta charset="UTF-8">
    <title>Учебный класс - ChessRad</title>
    <link rel="stylesheet" href="/css/chessboard-1.0.0.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    <link rel="stylesheet" href="/css/study.css">
</head>
<body>

    <header class="lobby-header">
        <div class="logo-area">
            <h1>ChessRad <span class="badge">STUDY</span></h1>
        </div>
        <div id="user-status" class="user-badge-text">Загрузка...</div>
    </header>

    <div class="main-layout">
        <aside class="tabs-sidebar">
            <div id="tabs-list"></div>
            <button class="add-tab-btn" id="add-tab-btn" title="Добавить демо-вкладку" style="display: none;">
                <i class="fas fa-plus"></i>
            </button>
        </aside>

        <div class="board-section">
            <div id="status-msg"></div>
            <div class="board-container">
                <div id="myBoard"></div>
                <canvas id="drawing-canvas"></canvas>
            </div>

            <div class="board-controls" id="teacher-tools" style="display: none;">
                <button class="btn-secondary" id="flip-btn"><i class="fas fa-sync"></i> Разворот</button>
                <button class="btn-secondary" id="reset-btn"><i class="fas fa-undo"></i> Начальная</button>
                <button class="btn-danger-light" id="clear-btn"><i class="fas fa-trash"></i> Очистить</button>
            </div>
        </div>

        <aside class="info-panel">
            <div id="video-chat-container"></div>

            <div class="room-info">
                <h3 style="margin: 0; font-size: 16px;">Комната: <span id="room-id-display">---</span></h3>
            </div>

            <div id="game-info-block" style="display: none; flex-direction: column; flex-grow: 1;">
                <div id="moves-history-block" class="chat-area">
                    <em>История ходов...</em>
                </div>
            </div>

            <div id="demo-controls-block" style="display: none; flex-direction: column; gap: 10px;">
                <button class="btn-primary-sm" id="editor-btn" style="background: #f39c12; color: white; width: 100%;">
                    <i class="fas fa-puzzle-piece"></i> ⚙️ РЕДАКТОР ПОЗИЦИИ
                </button>
                <button class="btn-secondary" id="lib-btn" style="background: #3498db; color: white; width: 100%;">
                    <i class="fas fa-book"></i> 📚 БИБЛИОТЕКА ПОЗИЦИЙ
                </button>
            </div>

            <button class="btn-logout" onclick="window.location.href='/lobby.html'">Покинуть класс</button>
        </aside>
    </div>

    <div id="editor-modal" class="modal-overlay" style="display: none;">
        <div class="editor-modal">
            <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center;">
                <h3>🧩 Редактор позиции</h3>
                <button onclick="document.getElementById('editor-modal').style.display='none'" class="close-btn" style="background:none; border:none; font-size:24px; cursor:pointer;">&times;</button>
            </div>
            <div class="editor-layout">
                <div id="board-editor"></div>
                <div class="editor-tools">
                    <button class="btn-secondary" id="editor-start-btn">Начальная</button>
                    <button class="btn-danger-light" id="editor-clear-btn">Очистить</button>
                    <button class="btn-primary-sm" id="apply-editor-btn">ПРИМЕНИТЬ НА ДОСКУ</button>
                </div>
            </div>
        </div>
    </div>

    <div id="lib-modal" class="modal-overlay" style="display: none;">
        <div class="editor-modal" style="width: 600px; background: white; padding: 20px; border-radius: 15px;">
            <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <h3>📚 Библиотека позиций</h3>
                <button onclick="document.getElementById('lib-modal').style.display='none'" style="background:none; border:none; font-size:24px; cursor:pointer;">&times;</button>
            </div>
            <div id="lib-content" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 15px; max-height: 60vh; overflow-y: auto; padding: 10px;">
                </div>
        </div>
    </div>

    <script src="/js/jquery-3.4.1.min.js"></script>
    <script src="/js/chessboard-1.0.0.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js"></script>
    <script src="/socket.io/socket.io.js"></script>
    <script src="/js/study.js"></script>
</body>
</html>
deploy@5757509-xa87129:~/chessrad2-main$ cat public/js/study.js
// Переносим applyLibPos и renderLibraryFolders в начало, чтобы они были доступны везде
window.applyLibPos = null;
window.renderLibraryFolders = null;

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomCode = urlParams.get('room');
    if (!roomCode) { window.location.href = '/lobby.html'; return; }

    let user, board = null, game = new Chess(), isTeacher = false;
    // Инициализируем с пустой customHistory
    let tabs = [{ id: 'play', type: 'play', fen: 'start', shapes: [], pgn: '', customHistory: [] }];
    let activeTabId = 'play';
    let editorBoard = null;
    let allLibraryPositions = [];

    const canvas = document.getElementById('drawing-canvas');
    const ctx = canvas.getContext('2d');
    let isDrawing = false, startSquarePoint = null, shapes = [];

    // --- АУТЕНТИФИКАЦИЯ ---
    try {
        const res = await fetch('/api/profile');
        if (!res.ok) throw new Error();
        user = await res.json();
        document.getElementById('user-status').innerHTML = `Вы: <strong>${user.username}</strong>`;
    } catch (e) { window.location.href = '/'; return; }

    const socket = io({ transports: ['websocket'], withCredentials: true });

    // --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
    function getCellCenter(pixelX, pixelY) {
        const size = boardEl.offsetWidth / 8;
        const col = Math.floor(pixelX / size);
        const row = Math.floor(pixelY / size);
        const isBlack = board.orientation() === 'black';
        return {
            col: isBlack ? 7 - col : col,
            row: isBlack ? 7 - row : row
        };
    }

    function getCanvasCoords(col, row) {
        const size = boardEl.offsetWidth / 8;
        let finalCol = col;
        let finalRow = row;
        if (board.orientation() === 'black') {
            finalCol = 7 - col;
            finalRow = 7 - row;
        }
        return { x: finalCol * size + size / 2, y: finalRow * size + size / 2 };
    }

    // --- КЛИКАБЕЛЬНАЯ ИСТОРИЯ ХОДОВ (CUSTOM) ---
    window.goToMove = (index) => {
        if (!isTeacher) return;
        const tab = tabs.find(t => t.id === activeTabId);
        if (!tab || !tab.customHistory || !tab.customHistory[index]) return;

        const target = tab.customHistory[index];

        // Загружаем состояние из истории
        game.load(target.fen);
        tab.fen = target.fen;
        tab.pgn = game.pgn();

        board.position(target.fen);
        // Синхронизируем переход по истории с другими участниками
        socket.emit('study:move', {
            roomCode,
            tabId: activeTabId,
            fen: target.fen,
            pgn: tab.pgn,
            customHistory: tab.customHistory
        });
        updateUI();
    };

    // --- УПРАВЛЕНИЕ ВКЛАДКАМИ ---
    document.getElementById('add-tab-btn').onclick = () => {
        if (!isTeacher) return;
        const newId = 'tab_' + Date.now();
        // Создаем вкладку с поддержкой кастомной истории
        const newTab = {
            id: newId,
            type: 'demo',
            fen: '8/8/8/8/8/8/8/8 w - - 0 1',
            shapes: [],
            pgn: '',
            customHistory: []
        };
        tabs.push(newTab);
        socket.emit('study:updateTabs', { roomCode, tabs, activeTabId: newId });
        window.switchTab(newId);
    };

    window.removeTab = (id, event) => {
        if (event) event.stopPropagation();
        if (!isTeacher || id === 'play') return;
        tabs = tabs.filter(t => t.id !== id);
        if (activeTabId === id) activeTabId = 'play';
        socket.emit('study:updateTabs', { roomCode, tabs, activeTabId });
        window.switchTab(activeTabId);
    };

    window.switchTab = (id) => {
        const tab = tabs.find(t => t.id === id);
        if (!tab) return;
        activeTabId = id;

        if (board) board.destroy();
        board = Chessboard('myBoard', {
            ...config,
            sparePieces: false,
            dropOffBoard: (tab.type === 'play' ? 'snapback' : 'trash')
        });

        // Загружаем позицию в логический движок
        const startFen = (tab.fen === 'start') ? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' : tab.fen;
        game.load(startFen);

        if (tab.type === 'play') {
            board.orientation(isTeacher ? 'white' : 'black');
        } else {
            board.orientation('white');
        }

        board.position(tab.fen);
        shapes = tab.shapes || [];
        if (isTeacher) socket.emit('study:switchTab', { roomCode, tabId: id });

        setTimeout(() => {
            resizeCanvas();
            redrawAllShapes();
        }, 50);
        updateUI();
    };

    function renderTabs() {
        document.getElementById('tabs-list').innerHTML = tabs.map(t => `
            <div class="tab-item ${t.id === activeTabId ? 'active' : ''}" onclick="window.switchTab('${t.id}')">
                <i class="fas ${t.type === 'play' ? 'fa-gamepad' : 'fa-chalkboard'}"></i>
                <span>${t.type === 'play' ? 'Игра' : 'Демо'}</span>
                ${isTeacher && t.id !== 'play' ? `<i class="fas fa-times remove-tab-icon" onclick="window.removeTab('${t.id}', event)"></i>` : ''}
            </div>`).join('');
    }

    // --- КНОПКИ УПРАВЛЕНИЯ ---
    document.getElementById('flip-btn').onclick = () => { if(board) board.flip(); redrawAllShapes(); };
    document.getElementById('reset-btn').onclick = () => {
        if (!isTeacher) return;
        window.applyLibPos('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    };
    document.getElementById('clear-btn').onclick = () => {
        if (!isTeacher) return;
        window.applyLibPos('8/8/8/8/8/8/8/8 w - - 0 1');
    };

    // --- БИБЛИОТЕКА ---
    document.getElementById('lib-btn').onclick = async () => {
        const res = await fetch('/api/positions');
        allLibraryPositions = await res.json();
        document.getElementById('lib-modal').style.display = 'flex';
        window.renderLibraryFolders();
    };

    window.renderLibraryFolders = () => {
        const content = document.getElementById('lib-content');
        const categories = [...new Set(allLibraryPositions.map(p => p.category || 'Общее'))];
        content.innerHTML = categories.map(cat => {
            const count = allLibraryPositions.filter(p => (p.category || 'Общее') === cat).length;
            return `<div class="folder-card" onclick="renderLibraryCategory('${cat}')" style="background: #fff; border: 1px solid #e0e0e0; border-radius: 12px; padding: 15px 10px; text-align: center; cursor: pointer;">
                <div style="font-size: 30px; margin-bottom: 5px;">📂</div>
                <strong style="display:block; font-size:14px;">${cat}</strong>
                <div style="font-size: 11px; color: #7f8c8d;">${count} поз.</div>
            </div>`;
        }).join('');
    };

    window.renderLibraryCategory = (categoryName) => {
        const filtered = allLibraryPositions.filter(p => (p.category || 'Общее') === categoryName);
        renderPositionGrid(filtered, `Папка: ${categoryName}`, false);
    };

    function renderPositionGrid(positions, title, isSearch = false) {
        const content = document.getElementById('lib-content');
        content.innerHTML = `<div style="grid-column: 1 / -1; margin-bottom: 10px;"><button onclick="window.renderLibraryFolders()">← Назад</button> <b>${title}</b></div>`;
        positions.forEach(pos => {
            const boardId = `lib-mini-${pos.id}`;
            const div = document.createElement('div');
            div.className = 'lib-pos-card';
            div.innerHTML = `<div id="${boardId}" style="width: 100%; aspect-ratio: 1/1;"></div><div style="padding:5px; font-size:12px; text-align:center;">${pos.title}</div>`;
            div.onclick = () => window.applyLibPos(pos.fen);
            content.appendChild(div);
            setTimeout(() => Chessboard(boardId, { position: pos.fen, showNotation: false, draggable: false, pieceTheme: '/img/chesspieces/wikipedia/{piece}.png' }), 50);
        });
    }

    // --- РЕДАКТОР ---
    document.getElementById('editor-btn').onclick = () => {
        document.getElementById('editor-modal').style.display = 'flex';
        if (!editorBoard) {
            editorBoard = Chessboard('board-editor', {
                draggable: true, dropOffBoard: 'trash', sparePieces: true,
                position: board.fen(), pieceTheme: '/img/chesspieces/wikipedia/{piece}.png'
            });
        } else { editorBoard.position(board.fen()); }
    };

    document.getElementById('editor-start-btn').onclick = () => { if(editorBoard) editorBoard.start(); };
    document.getElementById('editor-clear-btn').onclick = () => { if(editorBoard) editorBoard.clear(); };
    document.getElementById('apply-editor-btn').onclick = () => {
        const fen = editorBoard.fen() + ' w - - 0 1';
        window.applyLibPos(fen);
        document.getElementById('editor-modal').style.display = 'none';
    };

    window.applyLibPos = (fen) => {
        const tab = tabs.find(t => t.id === activeTabId);
        tab.fen = fen;
        tab.pgn = '';
        tab.customHistory = []; // Очищаем историю при установке новой позиции
        game.load(fen);
        board.position(fen);
        socket.emit('study:move', { roomCode, tabId: activeTabId, fen, pgn: '', customHistory: [] });
        document.getElementById('lib-modal').style.display = 'none';
        updateUI();
    };

    function updateUI() {
        const historyBlock = document.getElementById('moves-history-block');
        const gameBlock = document.getElementById('game-info-block');
        const demoBlock = document.getElementById('demo-controls-block');
        const statusMsg = document.getElementById('status-msg');
        const tab = tabs.find(t => t.id === activeTabId);

        gameBlock.style.display = 'flex';
        demoBlock.style.display = (isTeacher && tab.type !== 'play') ? 'flex' : 'none';

        if (tab.type === 'play') {
            const turn = game.turn() === 'w' ? 'Белых' : 'Черных';
            statusMsg.innerHTML = `<span style="color: #2ecc71;">● ХОД ${turn.toUpperCase()}</span>`;
        } else {
            statusMsg.innerHTML = `<span style="color: #3498db;">● РЕЖИМ ДЕМОНСТРАЦИИ</span>`;
        }

        // Рендерим кастомную историю вместо стандартной game.history()
        const history = tab.customHistory || [];
        const moveClass = isTeacher ? 'pgn-move' : 'pgn-move-static';
        historyBlock.innerHTML = history.length > 0
            ? `<div class="pgn-container">${history.map((m, i) => `<span class="${moveClass}" onclick="goToMove(${i})">${i+1}. ${m.san}</span>`).join('')}</div>`
            : '<em>История пуста</em>';

        renderTabs();
    }

    const config = {
        draggable: true,
        pieceTheme: '/img/chesspieces/wikipedia/{piece}.png',
        onDragStart: (source, piece) => {
            if (activeTabId === 'play') {
                if (!isTeacher && piece.search(/^w/) !== -1) return false;
                if (isTeacher && piece.search(/^b/) !== -1) return false;
            }
            return true;
        },
        onDrop: (source, target) => {
            const tab = tabs.find(t => t.id === activeTabId);
            if (!tab.customHistory) tab.customHistory = [];

            // Пытаемся сделать легальный ход
            const move = game.move({ from: source, to: target, promotion: 'q' });
            let moveNotation = "";

            if (move) {
                moveNotation = move.san;
            } else if (tab.type !== 'play') {
                // НЕлегальный ход в ДЕМО режиме
                const piece = game.get(source);
                if (!piece) return 'snapback';

                // Формируем описание хода вручную
                moveNotation = `${piece.type.toUpperCase()}(${source})-${target}`;

                // Вручную обновляем состояние движка (принудительная перестановка)
                game.remove(source);
                game.put(piece, target);

                // Меняем очередь хода вручную, чтобы FEN был валидным для следующего хода
                let fenParts = game.fen().split(' ');
                fenParts[1] = (game.turn() === 'w') ? 'b' : 'w';
                game.load(fenParts.join(' '));
            } else {
                return 'snapback'; // В обычном режиме не пускаем
            }

            // Записываем в нашу историю
            tab.customHistory.push({
                san: moveNotation,
                fen: game.fen()
            });

            tab.fen = game.fen();
            tab.pgn = game.pgn();
        },
        onSnapEnd: () => {
            const tab = tabs.find(t => t.id === activeTabId);
            socket.emit('study:move', {
                roomCode,
                tabId: activeTabId,
                fen: tab.fen,
                pgn: tab.pgn,
                customHistory: tab.customHistory
            });
            updateUI();
        }
    };

    board = Chessboard('myBoard', config);

    // --- СОКЕТЫ ---
    socket.emit('study:join', { roomCode });

    socket.on('study:roomData', (d) => {
        isTeacher = (Number(d.teacher_id) === Number(user.id) || user.role === 'admin' || user.role === 'teacher');
        document.getElementById('teacher-tools').style.display = isTeacher ? 'flex' : 'none';
        document.getElementById('add-tab-btn').style.display = isTeacher ? 'block' : 'none';
        if (d.tabs && d.tabs.length > 0) tabs = d.tabs;
        window.switchTab(d.activeTabId || activeTabId);
    });

    socket.on('study:syncMove', (d) => {
        const t = tabs.find(x => x.id === d.tabId);
        if (t) {
            t.fen = d.fen;
            t.pgn = d.pgn || '';
            t.customHistory = d.customHistory || []; // Синхронизируем кастомную историю
            if (d.tabId === activeTabId) {
                game.load(d.fen);
                board.position(d.fen, false);
                updateUI();
            }
        }
    });

    socket.on('study:syncDraw', (d) => {
        const t = tabs.find(x => x.id === d.tabId);
        if (t) t.shapes = d.shapes || [];
        if (d.tabId === activeTabId) {
            shapes = d.shapes || [];
            redrawAllShapes();
        }
    });

    socket.on('study:syncTabs', (d) => {
        tabs = d.tabs;
        if (!tabs.find(t => t.id === activeTabId)) {
            activeTabId = 'play';
            window.switchTab('play');
        }
        renderTabs();
    });

    socket.on('study:syncSwitchTab', (d) => { if (!isTeacher) window.switchTab(d.tabId); });

    // --- РИСОВАНИЕ ---
    function redrawAllShapes() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        shapes.forEach(s => {
            ctx.lineWidth = 4;
            const start = getCanvasCoords(s.startCol, s.startRow);
            if (s.type === 'circle') {
                ctx.strokeStyle = 'rgba(46, 204, 113, 0.8)';
                ctx.beginPath(); ctx.arc(start.x, start.y, 20, 0, Math.PI * 2); ctx.stroke();
            } else {
                const end = getCanvasCoords(s.endCol, s.endRow);
                ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
                ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke();
                drawArrowhead(ctx, start.x, start.y, end.x, end.y, 18);
            }
        });
    }

    function drawArrowhead(context, fromX, fromY, toX, toY, radius = 15) {
        const angle = Math.atan2(toY - fromY, toX - fromX);
        context.save();
        context.fillStyle = context.strokeStyle;
        context.beginPath();
        context.translate(toX, toY);
        context.rotate(angle);
        context.moveTo(0, 0);
        context.lineTo(-radius, -radius / 1.5);
        context.lineTo(-radius, radius / 1.5);
        context.closePath();
        context.fill();
        context.restore();
    }

    const boardEl = document.getElementById('myBoard');
    boardEl.oncontextmenu = (e) => e.preventDefault();
    boardEl.addEventListener('mousedown', (e) => {
        if (!isTeacher) return;
        const rect = canvas.getBoundingClientRect();
        const gridPos = getCellCenter(e.clientX - rect.left, e.clientY - rect.top);
        if (e.button === 0) {
            shapes = [];
            socket.emit('study:draw', { roomCode, tabId: activeTabId, shapes: [] });
            redrawAllShapes();
        } else if (e.button === 2) {
            isDrawing = true;
            startSquarePoint = gridPos;
        }
    });

    window.addEventListener('mouseup', (e) => {
        if (isDrawing && e.button === 2) {
            const rect = canvas.getBoundingClientRect();
            const gridPos = getCellCenter(e.clientX - rect.left, e.clientY - rect.top);
            if (startSquarePoint.col === gridPos.col && startSquarePoint.row === gridPos.row) {
                shapes.push({ type: 'circle', startCol: startSquarePoint.col, startRow: startSquarePoint.row });
            } else {
                shapes.push({ type: 'arrow', startCol: startSquarePoint.col, startRow: startSquarePoint.row, endCol: gridPos.col, endRow: gridPos.row });
            }
            socket.emit('study:draw', { roomCode, tabId: activeTabId, shapes });
            isDrawing = false;
            redrawAllShapes();
        }
    });

    function resizeCanvas() {
        const b = document.getElementById('myBoard');
        if (b && canvas) { canvas.width = b.offsetWidth; canvas.height = b.offsetHeight; redrawAllShapes(); }
    }
    window.addEventListener('resize', () => { if(board) board.resize(); resizeCanvas(); });
    setTimeout(resizeCanvas, 500);
});
