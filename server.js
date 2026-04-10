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

// Хранилище активных игр
const activeGames = new Map();

// Генерация уникального ID игры
function generateGameId() {
    return 'game_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}

io.on('connection', (socket) => {
    console.log('✅ Новый игрок подключился:', socket.id);
    
    // Отправляем список игр новому игроку
    sendGamesList(socket);
    
    // Создание игры
    socket.on('createGame', (data) => {
        const gameId = generateGameId();
        const gameData = {
            gameId: gameId,
            hostId: data.user.id,
            hostName: data.user.first_name,
            players: [{
                id: data.user.id,
                name: data.user.first_name,
                socketId: socket.id,
                isHost: true
            }],
            playersCount: 1,
            maxPlayers: 2,
            settings: data.settings,
            status: 'waiting',
            createdAt: Date.now()
        };
        
        activeGames.set(gameId, gameData);
        socket.join(gameId);
        
        console.log(`🎲 Игра создана: ${gameId} от ${data.user.first_name}`);
        
        socket.emit('gameCreated', {
            gameId: gameId,
            gameData: gameData
        });
        
        // Рассылаем обновлённый список всем
        broadcastGamesList();
    });
    
    // Присоединение к игре
    socket.on('joinGame', (data) => {
        const game = activeGames.get(data.gameId);
        
        if (!game) {
            socket.emit('joinError', { message: 'Игра не найдена' });
            return;
        }
        
        if (game.playersCount >= game.maxPlayers) {
            socket.emit('joinError', { message: 'Игра уже заполнена' });
            return;
        }
        
        if (game.players.some(p => p.id === data.user.id)) {
            socket.emit('joinError', { message: 'Вы уже в этой игре' });
            return;
        }
        
        // Добавляем игрока
        game.players.push({
            id: data.user.id,
            name: data.user.first_name,
            socketId: socket.id,
            isHost: false
        });
        game.playersCount = 2;
        game.status = 'starting';
        
        activeGames.set(data.gameId, game);
        socket.join(data.gameId);
        
        console.log(`👥 Игрок ${data.user.first_name} присоединился к игре ${data.gameId}`);
        
        // Уведомляем обоих игроков
        io.to(data.gameId).emit('playerJoined', {
            gameId: data.gameId,
            players: game.players,
            settings: game.settings
        });
        
        // Удаляем игру из активных (она началась)
        setTimeout(() => {
            activeGames.delete(data.gameId);
            broadcastGamesList();
        }, 1000);
        
        socket.emit('joinSuccess', {
            gameId: data.gameId,
            players: game.players,
            settings: game.settings
        });
        
        // Рассылаем обновлённый список
        broadcastGamesList();
    });
    
    // Ход в игре
    socket.on('makeMove', (data) => {
        io.to(data.gameId).emit('moveMade', {
            playerId: data.playerId,
            move: data.move,
            gameState: data.gameState
        });
    });
    
    // Пропуск хода
    socket.on('passMove', (data) => {
        io.to(data.gameId).emit('movePassed', {
            playerId: data.playerId,
            gameState: data.gameState
        });
    });
    
    // Обновление состояния игры
    socket.on('updateGame', (data) => {
        io.to(data.gameId).emit('gameUpdated', {
            gameState: data.gameState,
            currentTurn: data.currentTurn
        });
    });
    
    // Игрок вышел
    socket.on('leaveGame', (data) => {
        const game = activeGames.get(data.gameId);
        if (game) {
            game.players = game.players.filter(p => p.socketId !== socket.id);
            game.playersCount--;
            
            if (game.playersCount === 0) {
                activeGames.delete(data.gameId);
                console.log(`🗑️ Игра ${data.gameId} удалена (нет игроков)`);
            } else {
                activeGames.set(data.gameId, game);
                io.to(data.gameId).emit('playerLeft', {
                    players: game.players
                });
            }
            broadcastGamesList();
        }
        socket.leave(data.gameId);
    });
    
    // Отключение
    socket.on('disconnect', () => {
        console.log('❌ Игрок отключился:', socket.id);
        
        // Удаляем игрока из всех игр
        for (const [gameId, game] of activeGames.entries()) {
            const playerIndex = game.players.findIndex(p => p.socketId === socket.id);
            if (playerIndex !== -1) {
                game.players.splice(playerIndex, 1);
                game.playersCount--;
                
                if (game.playersCount === 0) {
                    activeGames.delete(gameId);
                    console.log(`🗑️ Игра ${gameId} удалена`);
                } else {
                    activeGames.set(gameId, game);
                    io.to(gameId).emit('playerLeft', {
                        players: game.players
                    });
                }
                broadcastGamesList();
                break;
            }
        }
    });
});

// Отправка списка игр
function sendGamesList(socket) {
    const games = Array.from(activeGames.values())
        .filter(game => game.status === 'waiting' && game.playersCount < game.maxPlayers)
        .map(game => ({
            gameId: game.gameId,
            hostName: game.hostName,
            playersCount: game.playersCount,
            maxPlayers: game.maxPlayers,
            settings: game.settings,
            createdAt: game.createdAt
        }));
    
    socket.emit('gamesList', { games });
}

// Рассылка списка всем
function broadcastGamesList() {
    const games = Array.from(activeGames.values())
        .filter(game => game.status === 'waiting' && game.playersCount < game.maxPlayers)
        .map(game => ({
            gameId: game.gameId,
            hostName: game.hostName,
            playersCount: game.playersCount,
            maxPlayers: game.maxPlayers,
            settings: game.settings,
            createdAt: game.createdAt
        }));
    
    io.emit('gamesList', { games });
}

// Периодическая очистка старых игр (каждые 30 секунд)
setInterval(() => {
    const now = Date.now();
    for (const [gameId, game] of activeGames.entries()) {
        if (game.status === 'waiting' && (now - game.createdAt) > 600000) { // 10 минут
            activeGames.delete(gameId);
            console.log(`🗑️ Удалена старая игра: ${gameId}`);
        }
    }
    broadcastGamesList();
}, 30000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📡 WebSocket готов к подключениям`);
});
