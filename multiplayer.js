// Многопользовательская логика с WebSocket
let socket = null;
let currentGameId = null;
let isHost = false;
let currentUser = null;
let gamesList = [];
let isConnected = false;

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
    // ⚠️ ЗАМЕНИ НА СВОЙ URL ОТ RENDER
    const SERVER_URL = 'https://domino-server.onrender.com';
    
    showLoading('Подключение к серверу...');
    
    socket = io(SERVER_URL, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        timeout: 10000
    });
    
    socket.on('connect', () => {
        console.log('✅ Подключено к серверу');
        isConnected = true;
        hideLoading();
        showToast('Подключено к серверу', 'success');
        enableButtons(true);
        
        // Запрашиваем список игр
        socket.emit('refreshGames');
    });
    
    socket.on('connect_error', (error) => {
        console.error('❌ Ошибка подключения:', error);
        hideLoading();
        showToast('Не удалось подключиться к серверу. Проверьте интернет.', 'error');
        enableButtons(false);
        showServerError();
    });
    
    socket.on('disconnect', () => {
        console.log('❌ Отключено от сервера');
        isConnected = false;
        showToast('Потеряно соединение с сервером', 'error');
        enableButtons(false);
    });
    
    socket.on('gamesList', (data) => {
        console.log('Получен список игр:', data.games.length);
        gamesList = data.games || [];
        displayGamesList(gamesList);
    });
    
    socket.on('gameCreated', (data) => {
        console.log('Игра создана:', data.gameId);
        currentGameId = data.gameId;
        isHost = true;
        showWaitingRoom(data.gameData);
        showToast('Игра создана! Ожидаем соперника...', 'success');
    });
    
    socket.on('joinSuccess', (data) => {
        console.log('Успешно присоединился к игре:', data.gameId);
        currentGameId = data.gameId;
        isHost = false;
        localStorage.setItem('dominoSettings', JSON.stringify(data.settings));
        localStorage.setItem('currentGameId', data.gameId);
        localStorage.setItem('isHost', 'false');
        startGame(data.players, data.settings);
    });
    
    socket.on('playerJoined', (data) => {
        console.log('Игрок присоединился к игре:', data.gameId);
        if (data.gameId === currentGameId) {
            showToast('Соперник присоединился! Игра начинается...', 'success');
            setTimeout(() => {
                startGame(data.players, data.settings);
            }, 1000);
        }
    });
    
    socket.on('joinError', (data) => {
        console.error('Ошибка присоединения:', data.message);
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

// Включение/отключение кнопок
function enableButtons(enabled) {
    const createBtn = document.getElementById('createGameBtn');
    const refreshBtn = document.getElementById('refreshGamesBtn');
    
    if (createBtn) {
        createBtn.disabled = !enabled;
        if (enabled) {
            createBtn.style.opacity = '1';
            createBtn.style.cursor = 'pointer';
        } else {
            createBtn.style.opacity = '0.5';
            createBtn.style.cursor = 'not-allowed';
        }
    }
    
    if (refreshBtn) {
        refreshBtn.disabled = !enabled;
        if (enabled) {
            refreshBtn.style.opacity = '1';
            refreshBtn.style.cursor = 'pointer';
        } else {
            refreshBtn.style.opacity = '0.5';
            refreshBtn.style.cursor = 'not-allowed';
        }
    }
}

// Показать ошибку сервера
function showServerError() {
    const gamesListEl = document.getElementById('gamesList');
    if (gamesListEl) {
        gamesListEl.innerHTML = `
            <div class="error-games">
                <span>⚠️</span>
                <p>Не удалось подключиться к серверу</p>
                <button onclick="window.location.reload()" class="btn-retry">
                    🔄 Попробовать снова
                </button>
            </div>
        `;
    }
}

// Показать загрузку
function showLoading(message) {
    const gamesListEl = document.getElementById('gamesList');
    if (gamesListEl) {
        gamesListEl.innerHTML = `
            <div class="loading-games">
                <span class="loading-spinner">⏳</span>
                <p>${message}</p>
            </div>
        `;
    }
}

function hideLoading() {
    // Очищается при получении списка
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
        createBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (!isConnected) {
                showToast('Подождите, идёт подключение к серверу...', 'error');
                return;
            }
            createGame();
        });
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
        refreshBtn.addEventListener('click', () => {
            if (isConnected && socket) {
                socket.emit('refreshGames');
                showToast('Обновление списка...', 'info');
            }
        });
    }
}

// Создание игры
function createGame() {
    if (!socket || !isConnected) {
        showToast('Нет соединения с сервером', 'error');
        return;
    }
    
    const stoneType = document.getElementById('gameStoneType')?.value || 'classic';
    const tableTheme = document.getElementById('gameTableTheme')?.value || 'green';
    
    console.log('Создание игры с настройками:', { stoneType, tableTheme });
    
    socket.emit('createGame', {
        user: currentUser,
        settings: { stoneType, tableTheme }
    });
}

// Присоединение к игре
function joinGame(gameId) {
    if (!socket || !isConnected) {
        showToast('Нет соединения с сервером', 'error');
        return;
    }
    
    console.log('Присоединение к игре:', gameId);
    
    socket.emit('joinGame', {
        gameId: gameId,
        user: currentUser
    });
}

// Отображение списка игр
function displayGamesList(games) {
    const gamesListEl = document.getElementById('gamesList');
    if (!gamesListEl) return;
    
    if (!games || games.length === 0) {
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
        if (!players || players.length === 0) {
            list.innerHTML = '<li>👑 Ожидание игроков...</li>';
        } else {
            list.innerHTML = players.map(p => `
                <li>
                    ${p.isHost ? '👑' : '👤'} 
                    <strong>${escapeHtml(p.name)}</strong>
                    ${p.id === currentUser?.id ? ' (Вы)' : ''}
                </li>
            `).join('');
        }
    }
}

// Копирование ссылки-приглашения
function copyInviteLink() {
    const inviteLink = document.getElementById('inviteLink')?.value;
    if (inviteLink) {
        navigator.clipboard.writeText(inviteLink).then(() => {
            showToast('✅ Ссылка скопирована!', 'success');
        }).catch(() => {
            showToast('📋 Ссылка: ' + inviteLink, 'info');
        });
    }
}

// Отмена создания игры
function cancelGame() {
    if (socket && socket.connected && currentGameId) {
        socket.emit('leaveGame', { gameId: currentGameId });
    }
    window.location.reload();
}

// Запуск игры
function startGame(players, settings) {
    localStorage.setItem('dominoSettings', JSON.stringify(settings));
    localStorage.setItem('dominoPlayers', JSON.stringify(players));
    localStorage.setItem('isHost', isHost ? 'true' : 'false');
    localStorage.setItem('currentGameId', currentGameId);
    
    setTimeout(() => {
        window.location.href = 'game.html';
    }, 500);
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
    console.log(`[${type}] ${message}`);
}

// Экспорт глобальных функций
window.initMultiplayer = initMultiplayer;
window.joinGame = joinGame;
window.createGame = createGame;

// Запуск после загрузки страницы
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initMultiplayer();
    });
} else {
    initMultiplayer();
}
