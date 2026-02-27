
import { Chess } from 'chess.js';
import { randomUUID } from 'crypto';

export class TournamentGame {

    constructor(options) {
        this.io = options.io;
        this.gameId = randomUUID();
        this.chess = new Chess();

        this.playerWhite = options.playerWhite;
        this.playerBlack = options.playerBlack;

        // this.tournamentId = options.tournamentId; // Можно оставить для информации, но важнее ссылка
        this.tournament = options.tournament; // <-- ДОБАВЛЕНО: Ссылка на сам объект Tournament

        if (!this.tournament) {
            console.error(`[TournamentGame ${this.gameId}] Ошибка: Tournament-объект не был передан.`);
        }

        console.log(`[TournamentGame ${this.gameId}] Экземпляр игры создан для турнира ${this.tournament?.id}. Белые: ${this.playerWhite.username}, Черные: ${this.playerBlack.username}`);
    }

    /**
     * Обрабатывает ход, сделанный игроком.
     * @param {object} move - Объект хода от chess.js (например, { from: 'e2', to: 'e4' })
     * @param {string} userId - ID игрока, который делает ход.
     * @returns {object} - Результат операции.
     */
    makeMove(move) {
        try {
            const result = this.chess.move(move);
            if (result === null) {
                throw new Error('Недопустимый ход');
            }
            this.io.to(this.gameId).emit('tournament:game:update', this.chess.fen());

            if (this.chess.game_over()) {
                let reason = 'Игра окончена';
                let winnerPlayer = null; // Будет объектом игрока
                let loserPlayer = null; // Будет объектом игрока
                let draw = false;

                if (this.chess.in_checkmate()) {
                    reason = 'Мат';
                    winnerPlayer = this.chess.turn() === 'w' ? this.playerBlack : this.playerWhite;
                    loserPlayer = this.chess.turn() === 'w' ? this.playerWhite : this.playerBlack;
                } else if (this.chess.in_draw() || this.chess.in_stalemate() || this.chess.in_threefold_repetition() || this.chess.insufficient_material()) {
                    reason = 'Ничья';
                    draw = true;
                    // В случае ничьи, оба игрока "участвовали" в ней
                    winnerPlayer = this.playerWhite; // Для handleMatchCompletion оба будут обработаны
                    loserPlayer = this.playerBlack;
                }

                // <-- ГЛАВНОЕ ИЗМЕНЕНИЕ: Уведомляем Tournament о завершении игры
                if (this.tournament) {
                    this.tournament.handleMatchCompletion({
                        gameId: this.gameId,
                        winner: winnerPlayer,
                        loser: loserPlayer,
                        draw: draw,
                        reason: reason // Можно добавить причину
                    });
                } else {
                    console.error(`[TournamentGame ${this.gameId}] Не удалось сообщить о завершении матча: Tournament-объект отсутствует.`);
                }

                this.io.to(this.gameId).emit('tournament:game:over', {
                    reason: reason,
                    winner: winnerPlayer?.username, // Отправляем username для клиента
                    white: this.playerWhite.username,
                    black: this.playerBlack.username
                });

                return { success: true, gameOver: true, reason, winner: winnerPlayer?.username };
            }

            return { success: true, gameOver: false };

        } catch (error) {
            console.error(`[TournamentGame ${this.gameId}] Ошибка при совершении хода:`, error.message);
            return { success: false, error: error.message };
        }
    }

    resign(resigningUser) {
        if (!resigningUser) {
            return { success: false, message: 'Ошибка: пользователь не определен.' };
        }

        console.log(`[TournamentGame ${this.gameId}] Игрок ${resigningUser.username} сдался.`);

        let winner, loser;

        if (resigningUser.id === this.playerWhite.id) {
            winner = this.playerBlack;
            loser = this.playerWhite;
        } else if (resigningUser.id === this.playerBlack.id) {
            winner = this.playerWhite;
            loser = this.playerBlack;
        } else {
            const errorMessage = `Пользователь ${resigningUser.username} не является участником этой игры.`;
            console.error(`[TournamentGame ${this.gameId}] ${errorMessage}`);
            return { success: false, message: errorMessage };
        }

        const gameOverMessage = `Игра окончена: ${resigningUser.username} сдался. Победитель: ${winner.username}.`;

        // <-- ГЛАВНОЕ ИЗМЕНЕНИЕ: Уведомляем Tournament о сдаче
        if (this.tournament) {
            this.tournament.handleMatchCompletion({
                gameId: this.gameId,
                winner: winner,
                loser: loser,
                draw: false, // При сдаче нет ничьей
                reason: 'resign'
            });
        } else {
            console.error(`[TournamentGame ${this.gameId}] Не удалось сообщить о сдаче: Tournament-объект отсутствует.`);
        }

        this.io.to(this.gameId).emit('tournament:game:over', {
            reason: gameOverMessage,
            winner: winner.username,
            white: this.playerWhite.username,
            black: this.playerBlack.username
        });

        return {
            success: true,
            message: gameOverMessage,
            report: { // Этот report уже не так критичен для Tournament, но может быть полезен для других целей
                gameId: this.gameId,
                tournamentId: this.tournament?.id, // Используем опциональную цепочку
                winner: winner,
                loser: loser,
                reason: 'resign'
            }
        };
    }

    /**
     * Определяет цвет игрока по его ID.
     * @param {string} userId
     * @returns {'w' | 'b' | null}
     */
    getPlayerColor(userId) {
        if (this.playerWhite && this.playerWhite.id === userId) {
            return 'w';
        }
        if (this.playerBlack && this.playerBlack.id === userId) {
            return 'b';
        }
        return null;
    }
}
