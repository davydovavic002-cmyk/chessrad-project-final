
import { TournamentGame } from './tournament-game-logic.js'; // Убедитесь, что путь верный
import { randomUUID } from 'crypto';

export class Tournament {
    // 1. КОНСТРУКТОР

// tournament.js - ЗАМЕНИТЬ НА ЭТО

// 1. КОНСТРУКТОР
constructor({ io, games, id, name }) { // <--- ИЗМЕНЕНИЕ ЗДЕСЬ
    if (!io || !games) {
        throw new Error('Tournament requires io and games parameters.');
    }
    this.io = io;
    this.games = games; // Глобальная карта всех игр сервера

    this.id = id || `tourney-${randomUUID()}`;
    this.name = name || 'Еженедельный Турнир';
    this.totalRounds = 0;

    this.players = new Map(); // Map<userId, playerInfo>
    this.status = 'waiting'; // 'waiting', 'running', 'finished'
    this.rounds = [];
    this.currentRound = 0;
    this.activeGames = new Map(); // Карта активных игр ТОЛЬКО этого турнира

    console.log(`[Tournament ${this.id}] ${this.name} создан.`);
}
    // 2. УПРАВЛЕНИЕ ИГРОКАМИ
    register(user, socket) {
        if (this.state !== 'waiting') {
            return { success: false, message: 'Турнир уже начался или завершен.' };
        }

        if (this.players.has(user.id)) {
            const playerInfo = this.players.get(user.id);
            playerInfo.socketId = socket.id;
            this.players.set(user.id, playerInfo);
            socket.join(this.id);
            console.log(`[Tournament ${this.id}] Игрок ${user.username} переподключился.`);
            this.broadcastStateUpdate();
            return { success: true, message: 'Вы снова в турнире.' };
        } else {
            const playerInfo = {
                user: user,
                socketId: socket.id,
                score: 0,
                opponentsPlayedIds: new Set()
            };
            this.players.set(user.id, playerInfo);
            socket.join(this.id);
            console.log(`[Tournament ${this.id}] Игрок ${user.username} присоединился.`);
            this.broadcastStateUpdate();
            return { success: true, message: 'Вы успешно зарегистрированы.' };
        }
    }

    removePlayer(socket) {
        if (!socket || !socket.user) return;
        const userId = socket.user.id;
        if (this.players.has(userId)) {
            const player = this.players.get(userId);
            this.players.delete(userId);
            socket.leave(this.id);
            console.log(`[Tournament ${this.id}] Игрок ${player.user.username} покинул турнир. Всего: ${this.players.size}`);
            this.broadcastStateUpdate();
        }
    }

    // 3. ЛОГИКА ТУРНИРА
    start() {
        if (this.state !== 'waiting' || this.players.size < 2) {
            console.log(`[Tournament ${this.id}] Ошибка старта: турнир уже запущен или недостаточно игроков.`);
            return false;
        }

        this.state = 'running';
        const playerCount = this.players.size;
        // Простая логика определения кол-ва раундов, можно усложнить
        this.totalRounds = Math.max(3, Math.ceil(Math.log2(playerCount)));

        console.log(`[Tournament ${this.id}] Запуск турнира. Игроков: ${playerCount}. Раундов: ${this.totalRounds}`);
        this.startNextRound();
        return true;
    }

    startNextRound() {
        if (this.state !== 'running') return;
        if (this.players.size < 2) {
            console.log(`[Tournament ${this.id}] Остался один или ноль игроков. Завершаем турнир досрочно.`);
            this.finishTournament();
            return;
        }

        this.currentRound++; // <-- ИСПРАВЛЕНО: убран двойной вызов
        console.log(`[Tournament ${this.id}] Начинается раунд ${this.currentRound}`);

        this.activeGames.clear();
        const currentRoundMatchups = [];
        const playersInThisRound = new Set();
        const sortedPlayers = Array.from(this.players.values()).sort((a, b) => b.score - a.score);

        for (const player of sortedPlayers) {
            if (playersInThisRound.has(player.user.id)) continue;

            const opponent = sortedPlayers.find(p => {
                if (p.user.id === player.user.id) return false;
                if (playersInThisRound.has(p.user.id)) return false;
                // Не играть с тем же оппонентом, если есть другие варианты
                if (this.players.size > 2 && player.opponentsPlayedIds.has(p.user.id)) return false;
                return true;
            });

            if (opponent) {
                const gameId = this.createGameForPlayers(player, opponent);
                this.activeGames.set(gameId, { player1Id: player.user.id, player2Id: opponent.user.id });
                playersInThisRound.add(player.user.id);
                playersInThisRound.add(opponent.user.id);
                currentRoundMatchups.push({ id: gameId, players: [player.user.id, opponent.user.id], result: null });
            } else {
                player.score += 1;
                console.log(`[Tournament ${this.id}] Оппонент не найден для ${player.user.username}. Выдаем очко (bye).`);
            }
        }

        // Только если были созданы матчи, добавляем запись о раунде
        if (currentRoundMatchups.length > 0) {
            this.rounds.push({ round: this.currentRound, games: currentRoundMatchups });
        }

        this.broadcastStateUpdate();

        if (this.activeGames.size === 0) {
            this._checkRoundCompletion();
        }
    }

    createGameForPlayers(player1, player2) {
        const whitePlayer = Math.random() > 0.5 ? player1 : player2;
        const blackPlayer = whitePlayer === player1 ? player2 : player1;

        const newGame = new TournamentGame({
            playerWhite: whitePlayer.user,
            playerBlack: blackPlayer.user,
            io: this.io,
            tournament: this // Передаем ссылку на сам турнир!
        });

        this.games.set(newGame.gameId, newGame);
        player1.opponentsPlayedIds.add(player2.user.id);
        player2.opponentsPlayedIds.add(player1.user.id);

        console.log(`[Tournament ${this.id}] Создана игра ${newGame.gameId} для ${whitePlayer.user.username} и ${blackPlayer.user.username}`);
        this.io.to(whitePlayer.socketId).emit('tournament:gameCreated', { gameId: newGame.gameId });
        this.io.to(blackPlayer.socketId).emit('tournament:gameCreated', { gameId: newGame.gameId });
        return newGame.gameId;
    }

    // <<< ----- ВОТ ГЛАВНОЕ ИСПРАВЛЕНИЕ ----- >>>
    handleMatchCompletion(report) {
        const { winner, loser, draw, gameId } = report;

        if (!this.activeGames.has(gameId)) {
            console.log(`[Tournament ${this.id}] Получен результат для уже завершенной игры ${gameId}.`);
            return;
        }

        // --- ОБНОВЛЕНИЕ ОЧКОВ ---
        let resultString = '';
        if (draw) {
            // В `winner` и `loser` при ничьей передаются оба игрока
            const player1 = this.players.get(winner.id);
            const player2 = this.players.get(loser.id);
            if (player1) player1.score += 0.5;
            if (player2) player2.score += 0.5;
            resultString = '1/2-1/2';
            console.log(`[Tournament ${this.id}] Игра ${gameId} завершилась вничью.`);
        } else {
            const winnerInfo = this.players.get(winner.id);
            if (winnerInfo) {
                winnerInfo.score += 1;
                resultString = `${winnerInfo.user.username} won`;
                console.log(`[Tournament ${this.id}] В игре ${gameId} победил ${winner.username}. Очки: ${winnerInfo.score}`);
            }
        }

        // --- ОБНОВЛЕНИЕ ЗАПИСИ О МАТЧЕ В ТЕКУЩЕМ РАУНДЕ ---
        const currentRoundData = this.rounds.find(r => r.round === this.currentRound);
        if (currentRoundData) {
            const matchData = currentRoundData.games.find(g => g.id === gameId);
            if (matchData) {
                matchData.result = resultString; // Записываем результат
            }
        }

        this.activeGames.delete(gameId);

        // --- САМЫЙ ВАЖНЫЙ ВЫЗОВ ---
        console.log(`[Tournament ${this.id}] Отправка обновления состояния после завершения игры ${gameId}.`);
        this.broadcastStateUpdate(); // Отправляем обновленное состояние ВСЕМ

        this._checkRoundCompletion();
    }

    _checkRoundCompletion() {
        console.log(`[Tournament ${this.id}] Проверка завершения раунда. Активных игр: ${this.activeGames.size}`);
        if (this.state === 'running' && this.activeGames.size === 0) {
            console.log(`[Tournament ${this.id}] Все игры раунда ${this.currentRound} завершены.`);
            if (this.currentRound >= this.totalRounds) {
                this.finishTournament();
            } else {
                setTimeout(() => this.startNextRound(), 5000);
            }
        }
    }

    finishTournament() {
        console.log(`[Tournament ${this.id}] Турнир "${this.name}" завершен!`);
        this.state = 'finished';

        const sortedPlayers = Array.from(this.players.values()).sort((a, b) => b.score - a.score);
        const winner = sortedPlayers[0];

        if (winner) {
            console.log(`[Tournament ${this.id}] Победитель: ${winner.user.username} со счетом ${winner.score}`);
            this.io.to(this.id).emit('tournament:finished', { winner: winner.user, players: this.getState().players });
        } else {
            console.log(`[Tournament ${this.id}] Турнир завершен, но победителя нет.`);
            this.io.to(this.id).emit('tournament:finished', { winner: null, players: [] });
        }

        this.broadcastStateUpdate();
    }

    // 4. МЕТОДЫ СОСТОЯНИЯ
    getState() {
        return {
            id: this.id,
            name: this.name,
            status: this.status,
            currentRound: this.currentRound,
            totalRounds: this.totalRounds,
            players: Array.from(this.players.values()).map(p => ({
                id: p.user.id,
                username: p.user.username,
                rating: p.user.rating, // предполагаем, что эти поля есть в user
                level: p.user.level,
                score: p.score
            })).sort((a, b) => b.score - a.score),
            rounds: this.rounds
        };
    }

    broadcastStateUpdate() {
        this.io.to(this.id).emit('tournament:stateUpdate', this.getState());
    }
}
