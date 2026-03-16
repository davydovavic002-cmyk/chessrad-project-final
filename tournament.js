import { TournamentGame } from './tournament-game-logic.js';
import { randomUUID } from 'crypto';
import { addTrophyToUser } from './db.js';

export class Tournament {
    constructor({ io, games, id, name }) {
        if (!io || !games) {
            throw new Error('Tournament requires io and games parameters.');
        }
        this.io = io;
        this.games = games;

        this.id = id || `tourney-${randomUUID()}`;
        this.name = name || 'Еженедельный Турнир';

        // Константа времени: 5 минут (300 000 мс)
        this.GAME_TIME_LIMIT = 5 * 60 * 1000;

        this.players = new Map();
        this.status = 'waiting';
        this.rounds = [];
        this.currentRound = 0;
        this.totalRounds = 0;
        this.activeGames = new Map();

        console.log(`[Tournament ${this.id}] ${this.name} создан. Режим: 5+0`);
    }

    register(user, socket) {
        if (this.status !== 'waiting') {
            return { success: false, message: 'Турнир уже начался или завершен.' };
        }

        if (this.players.has(user.id)) {
            const playerInfo = this.players.get(user.id);
            playerInfo.socketId = socket.id;
            socket.join(this.id);
            console.log(`[Tournament] Пользователь ${user.username} вернулся в лобби.`);
            this.broadcastStateUpdate();
            return { success: true, message: 'Вы снова в лобби турнира.' };
        } else {
            const playerInfo = {
                user: user,
                socketId: socket.id,
                score: 0,
                opponentsPlayedIds: new Set()
            };
            this.players.set(user.id, playerInfo);
            socket.join(this.id);
            console.log(`[Tournament] Новый участник: ${user.username} (ID: ${user.id})`);
            this.broadcastStateUpdate();
            return { success: true, message: 'Вы успешно зарегистрированы.' };
        }
    }

    removePlayer(socket) {
        if (!socket || !socket.user) return;
        const userId = socket.user.id;

        if (this.status === 'waiting' && this.players.has(userId)) {
            this.players.delete(userId);
            socket.leave(this.id);
            console.log(`[Tournament] Пользователь ${socket.user.username} покинул турнир.`);
            this.broadcastStateUpdate();
        }
    }

    start() {
        if (this.status !== 'waiting' || this.players.size < 2) {
            console.log(`[Tournament] Ошибка запуска: недостаточно игроков (${this.players.size})`);
            return false;
        }

        this.status = 'running';
        const playerCount = this.players.size;
        this.totalRounds = Math.max(2, Math.ceil(Math.log2(playerCount)));

        console.log(`[Tournament ${this.id}] СТАРТ. Игроков: ${playerCount}, Раундов: ${this.totalRounds}`);
        this.startNextRound();
        return true;
    }

    startNextRound() {
        if (this.status !== 'running') return;

        this.currentRound++;
        this.activeGames.clear();
        console.log(`[Tournament] --- Начало раунда №${this.currentRound} ---`);

        const currentRoundMatchups = [];
        const playersInThisRound = new Set();
        const sortedPlayers = Array.from(this.players.values()).sort((a, b) => b.score - a.score);

        for (let i = 0; i < sortedPlayers.length; i++) {
            const player = sortedPlayers[i];
            if (playersInThisRound.has(player.user.id)) continue;

            const opponent = sortedPlayers.find(p =>
                p.user.id !== player.user.id &&
                !playersInThisRound.has(p.user.id)
            );

            if (opponent) {
                const gameId = this.createGameForPlayers(player, opponent);
                this.activeGames.set(gameId, { p1: player.user.id, p2: opponent.user.id });
                playersInThisRound.add(player.user.id);
                playersInThisRound.add(opponent.user.id);
                currentRoundMatchups.push({ id: gameId, players: [player.user.id, opponent.user.id], result: null });
                console.log(`[Tournament] Пара создана: ${player.user.username} vs ${opponent.user.username}`);
            } else {
                player.score += 1;
                playersInThisRound.add(player.user.id);
                console.log(`[Tournament] Игрок ${player.user.username} получает "Bye" (авто-очко)`);
            }
        }

        this.rounds.push({ round: this.currentRound, games: currentRoundMatchups });
        this.broadcastStateUpdate();

        if (this.activeGames.size === 0) {
            this._checkRoundCompletion();
        }
    }

    createGameForPlayers(p1, p2) {
        const isP1White = Math.random() > 0.5;
        const white = isP1White ? p1 : p2;
        const black = isP1White ? p2 : p1;

        const newGame = new TournamentGame({
            playerWhite: white.user,
            playerBlack: black.user,
            io: this.io,
            tournament: this,
            timeLimit: this.GAME_TIME_LIMIT
        });

        this.games.set(newGame.gameId, newGame);

        this.io.to(white.socketId).emit('tournament:gameCreated', {
            gameId: newGame.gameId,
            color: 'w',
            timeLimit: this.GAME_TIME_LIMIT
        });
        this.io.to(black.socketId).emit('tournament:gameCreated', {
            gameId: newGame.gameId,
            color: 'b',
            timeLimit: this.GAME_TIME_LIMIT
        });

        return newGame.gameId;
    }

    handleMatchCompletion({ gameId, winner, loser, draw }) {
        if (!this.activeGames.has(gameId)) return;

        let resultText = '';
        if (draw) {
            const p1 = this.players.get(winner.id);
            const p2 = this.players.get(loser.id);
            if (p1) p1.score += 0.5;
            if (p2) p2.score += 0.5;
            resultText = '½-½';
            console.log(`[Tournament] Матч ${gameId} завершен вничью.`);
        } else {
            const winnerInfo = this.players.get(winner.id);
            if (winnerInfo) {
                winnerInfo.score += 1;
                resultText = `1-0 (${winner.username})`;
                console.log(`[Tournament] Матч ${gameId} завершен. Победитель: ${winner.username}`);
            }
        }

        const roundData = this.rounds.find(r => r.round === this.currentRound);
        if (roundData) {
            const match = roundData.games.find(g => g.id === gameId);
            if (match) match.result = resultText;
        }

        this.activeGames.delete(gameId);
        this.games.delete(gameId);
        this.broadcastStateUpdate();
        this._checkRoundCompletion();
    }

    _checkRoundCompletion() {
        if (this.status === 'running' && this.activeGames.size === 0) {
            console.log(`[Tournament] Раунд ${this.currentRound} завершен.`);
            if (this.currentRound >= this.totalRounds) {
                this.finishTournament();
            } else {
                console.log(`[Tournament] Следующий раунд через 5 секунд...`);
                setTimeout(() => this.startNextRound(), 5000);
            }
        }
    }

    async finishTournament() {
        this.status = 'finished';
        const sortedResults = Array.from(this.players.values()).sort((a, b) => b.score - a.score);
        const medalColors = ['red', 'blue', 'green', 'yellow', 'white'];

        console.log(`[Tournament ${this.id}] ТУРНИР ЗАВЕРШЕН. Распределение наград...`);

        for (let i = 0; i < Math.min(sortedResults.length, 5); i++) {
            const player = sortedResults[i];
            const medalColor = medalColors[i];

            try {
                await addTrophyToUser(player.user.id, {
                    tournamentName: this.name,
                    place: i + 1,
                    color: medalColor
                });
                console.log(`[Tournament] Награда вручена: ${player.user.username} за ${i+1} место.`);
            } catch (err) {
                console.error(`[Tournament] Ошибка сохранения награды для ${player.user.username}:`, err);
            }
        }

        this.broadcastStateUpdate();
        this.io.to(this.id).emit('tournament:finished', this.getState());
    }

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
                score: p.score
            })).sort((a, b) => b.score - a.score),
            rounds: this.rounds
        };
    }

    broadcastStateUpdate() {
        this.io.to(this.id).emit('tournament:stateUpdate', this.getState());
    }
}
