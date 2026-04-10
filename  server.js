const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.json());

const activeGames = new Map();

io.on('connection', (socket) => {
    console.log('✅ Подключен:', socket.id);
    
    socket.on('getGames', () => {
        const games = Array.from(activeGames.values())
            .filter(g => g.status === 'waiting' && g.playersCount < 2)
            .map(g => ({
                gameId: g.gameId,
                hostName: g.hostName,
                playersCount: g.playersCount,
                settings: g.settings
            }));
        socket.emit('gamesList', { games });
    });
    
    socket.on('createGame', (data) => {
        const gameId = 'g_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
        const game = {
            gameId, hostId: data.user.id, hostName: data.user.first_name,
            players: [{ id: data.user.id, name: data.user.first_name, socketId: socket.id, isHost: true }],
            playersCount: 1, settings: data.settings, status: 'waiting', createdAt: Date.now()
        };
        activeGames.set(gameId, game);
        socket.join(gameId);
        socket.emit('gameCreated', { gameId, gameData: game });
        broadcastGames();
    });
    
    socket.on('joinGame', (data) => {
        const game = activeGames.get(data.gameId);
        if (!game) return socket.emit('joinError', { message: 'Игра не найдена' });
        if (game.playersCount >= 2) return socket.emit('joinError', { message: 'Игра заполнена' });
        
        game.players.push({ id: data.user.id, name: data.user.first_name, socketId: socket.id, isHost: false });
        game.playersCount = 2;
        game.status = 'starting';
        activeGames.set(data.gameId, game);
        socket.join(data.gameId);
        
        io.to(data.gameId).emit('playerJoined', { gameId: data.gameId, players: game.players, settings: game.settings });
        socket.emit('joinSuccess', { gameId: data.gameId, players: game.players, settings: game.settings });
        
        setTimeout(() => {
            activeGames.delete(data.gameId);
            broadcastGames();
        }, 100);
        broadcastGames();
    });
    
    socket.on('disconnect', () => {
        for (const [id, game] of activeGames.entries()) {
            const idx = game.players.findIndex(p => p.socketId === socket.id);
            if (idx !== -1) {
                game.players.splice(idx, 1);
                game.playersCount--;
                if (game.playersCount === 0) activeGames.delete(id);
                else activeGames.set(id, game);
                broadcastGames();
                break;
            }
        }
    });
});

function broadcastGames() {
    const games = Array.from(activeGames.values())
        .filter(g => g.status === 'waiting' && g.playersCount < 2)
        .map(g => ({ gameId: g.gameId, hostName: g.hostName, playersCount: g.playersCount, settings: g.settings }));
    io.emit('gamesList', { games });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Сервер на порту ${PORT}`));