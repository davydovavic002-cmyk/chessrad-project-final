// ВЕРСИЯ, ПОЛНОСТЬЮ АДАПТИРОВАННАЯ ПОД CHESS.JS v0.10.x

import { Chess } from 'chess.js';
import { randomUUID } from 'crypto';

export class Game {
    constructor(options) {
        this.io = options.io;
        this.gameId = randomUUID();
        // КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ: Используем синтаксис конструктора СТАРОЙ версии
        this.chess = Chess();
        this.isGameOver = false;

        this.players = {
            white: options.playerWhite,
            black: options.playerBlack,
        };

        this.onGameEnd = options.onGameEnd;
        this.gameResultCallback = options.onGameResult;
        this.onRematchAccepted = options.onRematchAccepted;

        this.rematchProposer = null;
        this.cleanupTimeout = null;

        console.log(`[Game ${this.gameId}] Экземпляр игры создан`);
    }

    start() {
        console.log(`[Game ${this.gameId}] Начало игры. Белые: ${this.players.white.user.username}, Черные: ${this.players.black.user.username}`);

        this.players.white.socket.join(this.gameId);
        this.players.black.socket.join(this.gameId);

        this.players.white.socket.emit('gameStart', { color: 'w', roomId: this.gameId, opponent: this.players.black.user, fen: this.chess.fen() });
        this.players.black.socket.emit('gameStart', { color: 'b', roomId: this.gameId, opponent: this.players.white.user, fen: this.chess.fen() });

        this.emitGameState('Игра началась');
    }

    getId() { return this.gameId; }

    getPlayerColor(socketId) {
        if (this.players.white.socket.id === socketId) return 'white';
        if (this.players.black.socket.id === socketId) return 'black';
        return null;
    }

    // Методы адаптированы под старый синтаксис v0.10.x
    emitGameState(message = '') {
        this.io.to(this.gameId).emit('gameStateUpdate', {
            fen: this.chess.fen(),
            turn: this.chess.turn(),
            isCheck: this.chess.in_check(), // С нижним подчеркиванием
            isCheckmate: this.chess.in_checkmate(), // С нижним подчеркиванием
            isDraw: this.chess.in_draw(), // С нижним подчеркиванием
            lastMoveMessage: message,
        });
    }

    makeMove(socketId, move) {
        if (this.isGameOver) return;
        const playerColor = this.getPlayerColor(socketId);
        const currentTurn = this.chess.turn() === 'w' ? 'white' : 'black';

        if (playerColor !== currentTurn) {
            this.players[playerColor].socket.emit('invalidMove', { message: 'Сейчас не ваш ход' });
            return;
        }

        // В старой версии move возвращает null при ошибке
        const result = this.chess.move(move);
        if (result === null) {
            console.error(`[Game ${this.gameId}] Недопустимый ход:`, move);
            this.players[playerColor].socket.emit('invalidMove', { message: 'Недопустимый ход' });
            return;
        }

        this.emitGameState(`Ход: ${result.san}`);
        this.checkGameOver();
    }

    handleSurrender(socketId) {
        if (this.isGameOver) return;
        const resigningColor = this.getPlayerColor(socketId);
        if (!resigningColor) return;

        const winnerColor = resigningColor === 'white' ? 'black' : 'white';
        this.endGame({
            type: 'resign',
            winner: this.players[winnerColor].user.username,
            reason: `${this.players[resigningColor].user.username} сдался.`,
            winnerId: this.players[winnerColor].user.id,
            loserId: this.players[resigningColor].user.id,
            isDraw: false,
        });
    }

    // Методы адаптированы под старый синтаксис v0.10.x
    checkGameOver() {
        if (!this.chess.game_over()) return; // Метод game_over()

        let result = {};
        if (this.chess.in_checkmate()) {
            const winnerColor = this.chess.turn() === 'w' ? 'black' : 'white';
            result = { type: 'checkmate', winner: this.players[winnerColor].user.username, reason: 'Мат!' };
        } else {
            if (this.chess.in_stalemate()) result = { type: 'stalemate', reason: 'Пат' };
            else if (this.chess.in_threefold_repetition()) result = { type: 'draw', reason: 'Ничья (троекратное повторение)' };
            else if (this.chess.insufficient_material()) result = { type: 'draw', reason: 'Ничья (недостаточно материала)' };
            else result = { type: 'draw', reason: 'Ничья по правилу 50 ходов' };
        }
        this.endGame(result);
    }

    endGame(result) {
        if (this.isGameOver) return;
        this.isGameOver = true;

        if (result.type.includes('draw') || result.type.includes('stalemate')) {
            result.isDraw = true;
            // Для ничьей не важно, кто winner/loser, но для статистики назначим
            result.winnerId = this.players.white.user.id;
            result.loserId = this.players.black.user.id;
        } else if (result.type === 'resign') {
            // Уже установлено в handleSurrender
            result.isDraw = false;
        }
        else { // checkmate
            result.isDraw = false;
            const winnerColor = Object.keys(this.players).find(c => this.players[c].user.username === result.winner);
            const loserColor = winnerColor === 'white' ? 'black' : 'white';
            result.winnerId = this.players[winnerColor].user.id;
            result.loserId = this.players[loserColor].user.id;
        }

        this.io.to(this.gameId).emit('gameOver', { ...result, fen: this.chess.fen() });

        if (this.gameResultCallback) {
            this.gameResultCallback(result.winnerId, result.loserId, result.isDraw);
        }

        // Очистка через 20 секунд
        this.cleanupTimeout = setTimeout(() => this.cleanup(), 20000);
    }

    handleRematchRequest(socketId) {
        if (!this.isGameOver) return;
        clearTimeout(this.cleanupTimeout); // Отменяем авто-очистку, раз есть запрос на реванш
        const playerColor = this.getPlayerColor(socketId);
        if (!playerColor) return;

        this.rematchProposer = socketId;
        const opponentColor = playerColor === 'white' ? 'black' : 'white';
        this.players[opponentColor].socket.emit('rematchOffered');
    }

    handleRematchAccept(socketId) {
        if (!this.isGameOver) return;
        const accepterColor = this.getPlayerColor(socketId);
        const opponentSocketId = this.players[accepterColor === 'white' ? 'black' : 'white'].socket.id;

        if (this.rematchProposer === opponentSocketId) {
            // Оба игрока согласны
            this.players.white.socket.leave(this.gameId);
            this.players.black.socket.leave(this.gameId);
            if (this.onRematchAccepted) {
                // Возвращаем игроков в лобби для создания новой игры
                this.onRematchAccepted(this.players.white, this.players.black);
            }
            if (this.onGameEnd) {
                this.onGameEnd(this.gameId); // Завершаем текущую игру
            }
        }
    }

    cleanup() {
        console.log(`[Game ${this.gameId}] Очистка игры.`);
        if (this.onGameEnd) {
            this.onGameEnd(this.gameId);
        }
    }
}
