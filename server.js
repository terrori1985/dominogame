const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

// Хранилище игр
const games = new Map();

io.on('connection', (socket) => {
    console.log('Новый игрок подключён:', socket.id);
    
    socket.on('createGame', (data) => {
        const gameId = generateGameId();
        const game = {
            id: gameId,
            host: data.user,
            players: [data.user],
            settings: data.settings,
            status: 'waiting',
            gameState: null
        };
        
        games.set(gameId, game);
        socket.join(gameId);
        socket.emit('gameCreated', { gameId, game });
        
        console.log(`Игра ${gameId} создана пользователем ${data.user.first_name}`);
    });
    
    socket.on('joinGame', ({ gameId, user }) => {
        const game = games.get(gameId);
        
        if (game && game.players.length < 2) {
            game.players.push(user);
            game.status = 'starting';
            
            socket.join(gameId);
            io.to(gameId).emit('playerJoined', { players: game.players });
            
            // Запускаем игру
            startGame(gameId);
        } else {
            socket.emit('joinError', { message: 'Игра не найдена или заполнена' });
        }
    });
    
    socket.on('makeMove', ({ gameId, move }) => {
        const game = games.get(gameId);
        if (game && game.gameState && game.gameState.currentTurn === move.playerId) {
            // Обновляем состояние игры
            updateGameState(game, move);
            io.to(gameId).emit('gameUpdate', { gameState: game.gameState });
        }
    });
    
    socket.on('disconnect', () => {
        console.log('Игрок отключён:', socket.id);
        // Обработка выхода из игры
    });
});

function generateGameId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function startGame(gameId) {
    const game = games.get(gameId);
    if (!game) return;
    
    // Инициализация игры в домино
    const gameState = initializeDominoGame(game.players, game.settings);
    game.gameState = gameState;
    game.status = 'playing';
    games.set(gameId, game);
    
    io.to(gameId).emit('gameStarted', { gameState });
}

function initializeDominoGame(players, settings) {
    // Логика создания колоды и раздачи карт
    return {
        players: players.map(p => ({ id: p.id, name: p.first_name, hand: [] })),
        table: [],
        currentTurn: players[0].id,
        status: 'playing'
    };
}

function updateGameState(game, move) {
    // Обновление состояния игры после хода
    console.log(`Ход в игре ${game.id}:`, move);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📡 WebSocket готов к подключениям`);
});