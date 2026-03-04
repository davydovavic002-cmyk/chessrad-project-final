import { Chess } from 'chess.js';
import { randomUUID } from 'crypto';

export class TournamentGame {
    constructor(options) {
        this.io = options.io;
        this.gameId = randomUUID();
        this.chess = new Chess();
        this.playerWhite = options.playerWhite;
        this.playerBlack = options.playerBlack;
        this.tournament = options.tournament;

        // Настройки времени
        const initialTime = options.timeLimit || 300000; // 5 минут по умолчанию
        this.timeLeft = {
            w: initialTime,
            b: initialTime
        };
        this.lastMoveTime = Date.now();
        this.isGameOver = false;

        // Запуск таймера
        this.startTimer();

        console.log(`[Game ${this.gameId}] 5+0: ${this.playerWhite.username} vs ${this.playerBlack.username}`);
    }

    startTimer() {
        this.timer = setInterval(() => {
            if (this.isGameOver) {
                clearInterval(this.timer);
                return;
            }

            const turn = this.chess.turn(); // 'w' или 'b'
            const now = Date.now();
            const delta = now - this.lastMoveTime;

            this.timeLeft[turn] -= delta;
            this.lastMoveTime = now;

            // Проверка на проигрыш по времени
            if (this.timeLeft[turn] <= 0) {
                this.timeLeft[turn] = 0;
                this._handleTimeout(turn);
            } else {
                // Отправляем тиканье часов игрокам
                this.io.to(this.gameId).emit('game:timer', {
                    white: Math.max(0, Math.floor(this.timeLeft.w / 1000)),
                    black: Math.max(0, Math.floor(this.timeLeft.b / 1000)),
                    turn: turn
                });
            }
        }, 1000);
    }

    makeMove(move, userId) {
        try {
            if (this.isGameOver) return { success: false, error: 'Игра окончена' };

            const color = this.getPlayerColor(userId);
            if (!color) return { success: false, error: 'Вы не участник этой игры' };
            if (this.chess.turn() !== color) return { success: false, error: 'Сейчас не ваш ход' };

            // Фиксируем время на момент хода
            const now = Date.now();
            this.timeLeft[color] -= (now - this.lastMoveTime);
            this.lastMoveTime = now;

            const result = this.chess.move(move);
            if (!result) return { success: false, error: 'Недопустимый ход' };

            // Отправляем ход и обновленное время
            this.io.to(this.gameId).emit('game:move', {
                ...move,
                timeLeft: this.timeLeft
            });

            if (this.chess.game_over()) {
                this._handleGameOver();
            }

            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    _handleTimeout(colorAtMove) {
        if (this.isGameOver) return;

        const reason = 'Время истекло';
        const winner = (colorAtMove === 'w') ? this.playerBlack : this.playerWhite;
        const loser = (colorAtMove === 'w') ? this.playerWhite : this.playerBlack;

        this._finalize(winner, loser, false, reason);
    }

    resign(userId) {
        if (this.isGameOver) return { success: false };
        const loser = (userId === this.playerWhite.id) ? this.playerWhite : this.playerBlack;
        const winner = (userId === this.playerWhite.id) ? this.playerBlack : this.playerWhite;

        this._finalize(winner, loser, false, 'Сдача');
        return { success: true };
    }

    _handleGameOver() {
        let winner = null, loser = null, draw = false, reason = 'Конец игры';

        if (this.chess.in_checkmate()) {
            reason = 'Мат';
            winner = this.chess.turn() === 'w' ? this.playerBlack : this.playerWhite;
            loser = this.chess.turn() === 'w' ? this.playerWhite : this.playerBlack;
        } else {
            reason = 'Ничья';
            draw = true;
            winner = this.playerWhite;
            loser = this.playerBlack;
        }

        this._finalize(winner, loser, draw, reason);
    }

    _finalize(winner, loser, draw, reason) {
        if (this.isGameOver) return;
        this.isGameOver = true;
        clearInterval(this.timer);

        if (this.tournament) {
            this.tournament.handleMatchCompletion({
                gameId: this.gameId,
                winner,
                loser,
                draw
            });
        }

        this.io.to(this.gameId).emit('tournament:game:over', {
            reason,
            winner: draw ? null : winner.username,
            draw,
            finalTimes: this.timeLeft
        });
    }

    getPlayerColor(userId) {
        if (this.playerWhite.id === userId) return 'w';
        if (this.playerBlack.id === userId) return 'b';
        return null;
    }
}
