// Многопользовательская логика с WebSocket
let socket = null;
let currentGameId = null;
let isHost = false;
let currentUser = null;
let gamesList = [];
let gameState = null;

// Инициализация
function initMultiplayer() {
    const tg = window.Telegram.WebApp;
    tg.expand();
    tg.ready();
    
    // Получаем данные пользователя
    if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
        currentUser = tg.initDataUnsafe.user;
    } else {
        currentUser = {
            id: Date.now(),
            first_name: 'Игрок_' + Math.floor(Math.random() * 1000)
        };
    }
    
    displayUserInfo();
    connectToServer();
    setupEventListeners();
}

// Подключение к серверу
function connectToServer() {
    const SERVER_URL = 'https://domino-server.onrender.com'; // Замени на свой URL
    
    socket = io(SERVER_URL, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5
    });
    
    socket.on('connect', () => {
        console.log('✅ Подключено к серверу');
        showToast('Подключено к серверу', 'success');
    });
    
    socket.on('disconnect', () => {
        console.log('❌ Отключено от сервера');
        showToast('Потеряно соединение с сервером', 'error');
    });
    
    socket.on('gamesList', (data) => {
        gamesList = data.games;
        displayGamesList(gamesList);
    });
    
    socket.on('gameCreated', (data) => {
        currentGameId = data.gameId;
        isHost = true;
        showWaitingRoom(data.gameData);
        showToast('Игра создана! Ожидаем соперника...', 'success');
    });
    
    socket.on('joinSuccess', (data) => {
        currentGameId = data.gameId;
        isHost = false;
        localStorage.setItem('dominoSettings', JSON.stringify(data.settings));
        startGame(data.players, data.settings);
    });
    
    socket.on('playerJoined', (data) => {
        if (data.gameId === currentGameId) {
            showToast('Соперник присоединился! Игра начинается...', 'success');
            setTimeout(() => {
                startGame(data.players, data.settings);
            }, 1000);
        }
    });
    
    socket.on('joinError', (data) => {
        showToast(data.message, 'error');
    });
    
    socket.on('moveMade', (data) => {
        if (window.updateGameFromServer) {
            window.updateGameFromServer(data);
        }
    });
    
    socket.on('movePassed', (data) => {
        if (window.handlePassFromServer) {
            window.handlePassFromServer(data);
        }
    });
    
    socket.on('gameUpdated', (data) => {
        if (window.syncGameState) {
            window.syncGameState(data);
        }
    });
    
    socket.on('playerLeft', (data) => {
        showToast('Соперник покинул игру', 'error');
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 2000);
    });
}

// Отображение информации о пользователе
function displayUserInfo() {
    const userElement = document.getElementById('telegramUser');
    if (userElement && currentUser) {
        userElement.innerHTML = `<span>👤 ${currentUser.first_name}</span>`;
    }
}

// Настройка обработчиков событий
function setupEventListeners() {
    const createBtn = document.getElementById('createGameBtn');
    if (createBtn) {
        createBtn.addEventListener('click', () => createGame());
    }
    
    const copyBtn = document.getElementById('copyInviteBtn');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => copyInviteLink());
    }
    
    const cancelBtn = document.getElementById('cancelGameBtn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => cancelGame());
    }
    
    const refreshBtn = document.getElementById('refreshGamesBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => refreshGames());
    }
}

// Создание игры
function createGame() {
    const stoneType = document.getElementById('gameStoneType')?.value || 'classic';
    const tableTheme = document.getElementById('gameTableTheme')?.value || 'green';
    
    socket.emit('createGame', {
        user: currentUser,
        settings: { stoneType, tableTheme }
    });
}

// Присоединение к игре
function joinGame(gameId) {
    socket.emit('joinGame', {
        gameId: gameId,
        user: currentUser
    });
}

// Отображение списка игр
function displayGamesList(games) {
    const gamesListEl = document.getElementById('gamesList');
    if (!gamesListEl) return;
    
    if (games.length === 0) {
        gamesListEl.innerHTML = `
            <div class="empty-games">
                <span>🎲</span>
                <p>Нет активных столов</p>
                <small>Создайте новый стол, чтобы начать игру</small>
            </div>
        `;
        return;
    }
    
    gamesListEl.innerHTML = games.map(game => `
        <div class="game-card">
            <div class="game-card-header">
                <span class="game-host">👑 ${escapeHtml(game.hostName)}</span>
                <span class="game-status">🟢 Ожидает</span>
            </div>
            <div class="game-card-info">
                <span>🎴 ${getStoneTypeName(game.settings.stoneType)}</span>
                <span>🪑 ${getTableThemeName(game.settings.tableTheme)}</span>
                <span>👥 ${game.playersCount}/${game.maxPlayers}</span>
            </div>
            <button onclick="joinGame('${game.gameId}')" class="btn-join-game">
                🔗 Присоединиться
            </button>
        </div>
    `).join('');
}

// Отображение окна ожидания
function showWaitingRoom(gameData) {
    const createBox = document.getElementById('createGameBox');
    const gamesBox = document.getElementById('activeGamesBox');
    const infoBox = document.getElementById('infoBox');
    const waitingDiv = document.getElementById('waitingGame');
    
    if (createBox) createBox.classList.add('hidden');
    if (gamesBox) gamesBox.classList.add('hidden');
    if (infoBox) infoBox.classList.add('hidden');
    if (waitingDiv) waitingDiv.classList.remove('hidden');
    
    const inviteLink = document.getElementById('inviteLink');
    if (inviteLink) {
        const inviteUrl = `${window.location.origin}${window.location.pathname}?game=${gameData.gameId}`;
        inviteLink.value = inviteUrl;
    }
    
    updatePlayersList(gameData.players);
}

// Обновление списка игроков
function updatePlayersList(players) {
    const list = document.getElementById('playersList');
    if (list) {
        list.innerHTML = players.map(p => `
            <li>
                ${p.isHost ? '👑' : '👤'} 
                <strong>${escapeHtml(p.name)}</strong>
                ${p.id === currentUser?.id ? ' (Вы)' : ''}
            </li>
        `).join('');
    }
}

// Копирование ссылки-приглашения
function copyInviteLink() {
    const inviteLink = document.getElementById('inviteLink')?.value;
    if (inviteLink) {
        navigator.clipboard.writeText(inviteLink).then(() => {
            showToast('✅ Ссылка скопирована!', 'success');
        });
    }
}

// Отмена создания игры
function cancelGame() {
    if (socket && currentGameId) {
        socket.emit('leaveGame', { gameId: currentGameId });
    }
    window.location.reload();
}

// Обновление списка игр
function refreshGames() {
    if (socket) {
        socket.emit('refreshGames');
    }
}

// Запуск игры
function startGame(players, settings) {
    localStorage.setItem('dominoSettings', JSON.stringify(settings));
    localStorage.setItem('dominoPlayers', JSON.stringify(players));
    localStorage.setItem('isHost', isHost ? 'true' : 'false');
    localStorage.setItem('currentGameId', currentGameId);
    
    window.location.href = 'game.html';
}

// Утилиты
function getStoneTypeName(type) {
    const types = {
        classic: 'Классические',
        extended: 'Расширенные',
        max: 'Максимальные'
    };
    return types[type] || 'Классические';
}

function getTableThemeName(theme) {
    const themes = {
        green: 'Зелёный',
        wood: 'Деревянный',
        dark: 'Тёмный'
    };
    return themes[theme] || 'Зелёный';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(message, type = 'info') {
    const tg = window.Telegram.WebApp;
    tg.showAlert(message);
}

// Экспорт глобальных функций
window.initMultiplayer = initMultiplayer;
window.joinGame = joinGame;
window.createGame = createGame;

// Запуск
document.addEventListener('DOMContentLoaded', () => {
    initMultiplayer();
});
