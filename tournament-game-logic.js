
import { Chess } from 'chess.js';
import { randomUUID } from 'crypto';

// Это специальный класс игры, предназначенный ТОЛЬКО для турниров.
export class TournamentGame {

// ИСПРАВЛЕННЫЙ КОД
constructor(options) {
    this.io = options.io;
    this.gameId = randomUUID();
    this.chess = new Chess();

    this.playerWhite = options.playerWhite;
    this.playerBlack = options.playerBlack;

    // Эта строка была добавлена, чтобы сохранить ID турнира
    this.tournamentId = options.tournamentId;

    // В этой строке кавычки '' заменены на обратные ``
    console.log(`[TournamentGame ${this.gameId}] Экземпляр игры создан для турнира ${this.tournamentId}. Белые: ${this.playerWhite.username}, Черные: ${this.playerBlack.username}`);
}
    /**
     * Обрабатывает ход, сделанный игроком.
     * @param {object} move - Объект хода от chess.js (например, { from: 'e2', to: 'e4' })
     * @param {string} userId - ID игрока, который делает ход.
     * @returns {object} - Результат операции.
     */
// tournament-game-logic.js

// ЗАМЕНИТЕ ВЕСЬ ВАШ МЕТОД makeMove НА ЭТОТ
makeMove(move) {
    try {
        const result = this.chess.move(move);
        if (result === null) {
            throw new Error('Недопустимый ход');
        }

        // Отправляем обновленное состояние всем в комнате
        this.io.to(this.gameId).emit('tournament:game:update', this.chess.fen());

        // Проверяем, закончилась ли игра
        // ИСПОЛЬЗУЕМ СТАРЫЙ СИНТАКСИС БИБЛИОТЕКИ
        if (this.chess.game_over()) {
            let reason = 'Игра окончена';
            let winner = null; // null в случае ничьи

            if (this.chess.in_checkmate()) {
                reason = 'Мат';
                winner = this.chess.turn() === 'w' ? this.playerBlack.username : this.playerWhite.username;
            } else if (this.chess.in_draw()) {
                reason = 'Ничья';
            } else if (this.chess.in_stalemate()) {
                reason = 'Пат';
            } else if (this.chess.in_threefold_repetition()) {
                reason = 'Троекратное повторение';
            }

            // Отправляем событие окончания игры
            this.io.to(this.gameId).emit('tournament:game:over', {
                reason: reason,
                winner: winner,
                white: this.playerWhite.username,
                black: this.playerBlack.username
            });
            return { success: true, gameOver: true, reason, winner };
        }

        return { success: true, gameOver: false };

    } catch (error) {
        console.error(`[TournamentGame ${this.gameId}] Ошибка при совершении хода:`, error.message);
        return { success: false, error: error.message };
    }
}

// tournament-game-logic.js

// ЗАМЕНИТЕ ВЕСЬ ВАШ МЕТОД resign НА ЭТОТ
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

    // Отправляем событие на клиент (если нужно)
    this.io.to(this.gameId).emit('tournament:game:over', {
        reason: gameOverMessage,
        winner: winner.username,
        white: this.playerWhite.username,
        black: this.playerBlack.username
    });

    // Формируем успешный результат для server.js
    return {
        success: true,
        message: gameOverMessage,
        report: {
            gameId: this.gameId,
            tournamentId: this.tournamentId,
            winner: winner, // Возвращаем весь объект победителя
            loser: loser,   // Возвращаем весь объект проигравшего
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
