// ============ ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ============
let socket = null;
let currentUser = null;
let currentGameId = null;
let isHost = false;
let currentTurn = null;
let playerHand = [];
let tableDominoes = [];
let opponentCardsCount = 7;
let playerScore = 0;
let opponentScore = 0;
let gameActive = true;

// URL сервера - ЗАМЕНИ НА СВОЙ ОТ RENDER!
const SERVER_URL = 'https://domino-server.onrender.com';

// ============ ИНИЦИАЛИЗАЦИЯ ============
function init() {
    const tg = window.Telegram.WebApp;
    tg.expand();
    tg.ready();
    
    if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
        currentUser = tg.initDataUnsafe.user;
    } else {
        currentUser = {
            id: Date.now(),
            first_name: 'Player_' + Math.floor(Math.random() * 1000)
        };
    }
    
    document.getElementById('userInfo').innerHTML = `👤 ${currentUser.first_name}`;
    document.getElementById('yourName').innerHTML = currentUser.first_name;
    
    connectToServer();
    setupEventListeners();
}

// ============ ПОДКЛЮЧЕНИЕ К СЕРВЕРУ ============
function connectToServer() {
    updateConnectionStatus('connecting');
    
    socket = io(SERVER_URL, {
        transports: ['websocket', 'polling'],
        reconnection: true
    });
    
    socket.on('connect', () => {
        console.log('✅ Подключено к серверу');
        updateConnectionStatus('connected');
        socket.emit('getGames');
    });
    
    socket.on('connect_error', () => {
        updateConnectionStatus('error');
    });
    
    socket.on('disconnect', () => {
        updateConnectionStatus('disconnected');
    });
    
    socket.on('gamesList', (data) => {
        displayGamesList(data.games);
    });
    
    socket.on('gameCreated', (data) => {
        currentGameId = data.gameId;
        isHost = true;
        showScreen('waitingScreen');
        document.getElementById('hostName').innerHTML = currentUser.first_name;
    });
    
    socket.on('joinSuccess', (data) => {
        currentGameId = data.gameId;
        isHost = false;
        startGame(data.players, data.settings);
    });
    
    socket.on('playerJoined', (data) => {
        if (data.gameId === currentGameId) {
            playSound('place');
            showToast('🎉 Соперник присоединился!');
            setTimeout(() => {
                startGame(data.players, data.settings);
            }, 1000);
        }
    });
    
    socket.on('gameStarted', (data) => {
        startGame(data.players, data.settings);
    });
    
    socket.on('moveMade', (data) => {
        updateGameState(data);
    });
    
    socket.on('joinError', (data) => {
        showToast(data.message);
    });
}

// ============ ОТОБРАЖЕНИЕ СПИСКА ИГР ============
function displayGamesList(games) {
    const container = document.getElementById('gamesList');
    
    if (!games || games.length === 0) {
        container.innerHTML = `
            <div class="empty-games">
                <span>🎲</span>
                <p>Нет активных столов</p>
                <small>Создайте новый стол</small>
            </div>
        `;
        return;
    }
    
    container.innerHTML = games.map(game => `
        <div class="game-card" onclick="joinGame('${game.gameId}')">
            <div class="game-card-info">
                <div class="game-host">👑 ${escapeHtml(game.hostName)}</div>
                <div class="game-details">
                    <span>🎴 ${getStoneTypeName(game.settings.stoneType)}</span>
                    <span>👥 ${game.playersCount}/2</span>
                </div>
            </div>
            <button class="btn-join">Присоединиться</button>
        </div>
    `).join('');
}

// ============ СОЗДАНИЕ ИГРЫ ============
function createGame() {
    if (!socket) return;
    
    const stoneType = document.getElementById('stoneType').value;
    const tableTheme = document.getElementById('tableTheme').value;
    
    socket.emit('createGame', {
        user: currentUser,
        settings: { stoneType, tableTheme }
    });
    
    // Анимация нажатия
    const btn = document.getElementById('createGameBtn');
    btn.style.transform = 'scale(0.95)';
    setTimeout(() => btn.style.transform = '', 200);
}

// ============ ПРИСОЕДИНЕНИЕ К ИГРЕ ============
function joinGame(gameId) {
    if (!socket) return;
    
    socket.emit('joinGame', {
        gameId: gameId,
        user: currentUser
    });
}

// ============ НАЧАЛО ИГРЫ ============
function startGame(players, settings) {
    // Применяем тему стола
    const table = document.getElementById('gameTable');
    table.className = `game-table ${settings.tableTheme}`;
    
    // Определяем кто ходит первым
    currentTurn = players[0].id;
    isHost = players[0].id === currentUser.id;
    
    // Обновляем интерфейс
    document.getElementById('opponentName').innerHTML = players.find(p => p.id !== currentUser.id)?.name || 'Противник';
    
    showScreen('gameScreen');
    initGameLogic(settings);
}

// ============ ЛОГИКА ИГРЫ ============
function initGameLogic(settings) {
    // Здесь будет логика домино
    // Создаем демо-руку для теста
    playerHand = [[6,6], [6,5], [5,5], [4,6], [3,3], [2,2], [1,1]];
    tableDominoes = [[6,6]];
    
    updateUI();
}

function updateUI() {
    // Обновляем руку игрока
    const handContainer = document.getElementById('playerHand');
    handContainer.innerHTML = playerHand.map((card, index) => `
        <div class="domino-card ${canPlayCard(card) ? 'playable' : 'disabled'}" onclick="tryPlayCard(${index})">
            <div class="domino-values">
                ${card[0]}<span class="domino-separator">|</span>${card[1]}
            </div>
        </div>
    `).join('');
    
    // Обновляем стол
    const tableContainer = document.getElementById('tableDominoes');
    tableContainer.innerHTML = tableDominoes.map(card => `
        <div class="domino-card">
            <div class="domino-values">
                ${card[0]}<span class="domino-separator">|</span>${card[1]}
            </div>
        </div>
    `).join('');
    
    // Обновляем индикатор хода
    const turnIndicator = document.getElementById('turnIndicator');
    const isMyTurn = currentTurn === currentUser.id;
    
    if (isMyTurn) {
        turnIndicator.className = 'turn-indicator your-turn';
        turnIndicator.innerHTML = '🎯 ВАШ ХОД';
    } else {
        turnIndicator.className = 'turn-indicator opponent-turn';
        turnIndicator.innerHTML = '⏳ ХОД СОПЕРНИКА';
    }
    
    document.getElementById('opponentCards').innerHTML = `${opponentCardsCount} камней`;
}

function canPlayCard(card) {
    if (currentTurn !== currentUser.id) return false;
    if (tableDominoes.length === 0) return true;
    
    const left = tableDominoes[0][0];
    const right = tableDominoes[tableDominoes.length - 1][1];
    
    return card[0] === left || card[1] === left || card[0] === right || card[1] === right;
}

function tryPlayCard(index) {
    if (currentTurn !== currentUser.id) return;
    if (!canPlayCard(playerHand[index])) return;
    
    playSound('place');
    
    // Анимация
    const card = playerHand[index];
    playerHand.splice(index, 1);
    tableDominoes.push(card);
    
    // Меняем ход
    currentTurn = null; // Будет передан от сервера
    
    updateUI();
    
    // Отправляем ход на сервер
    socket.emit('makeMove', {
        gameId: currentGameId,
        move: { card, playerId: currentUser.id }
    });
}

function updateGameState(data) {
    // Обновление состояния от сервера
    updateUI();
}

// ============ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ============
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');
}

function updateConnectionStatus(status) {
    const statusDiv = document.getElementById('connectionStatus');
    const dot = statusDiv.querySelector('.dot');
    
    switch(status) {
        case 'connected':
            statusDiv.innerHTML = '<span class="dot"></span> ✅ Подключено к серверу';
            break;
        case 'connecting':
            statusDiv.innerHTML = '<span class="dot"></span> 🔄 Подключение...';
            break;
        case 'error':
            statusDiv.innerHTML = '<span class="dot" style="background:#f44336"></span> ❌ Ошибка подключения';
            break;
        default:
            statusDiv.innerHTML = '<span class="dot" style="background:#ff9800"></span> ⚠️ Потеряно соединение';
    }
}

function showToast(message) {
    const tg = window.Telegram.WebApp;
    tg.showAlert(message);
}

function playSound(type) {
    // Звуки (опционально)
    try {
        if (type === 'place') {
            new Audio('https://www.soundjay.com/misc/sounds/button-click-01.mp3').play();
        } else if (type === 'win') {
            new Audio('https://www.soundjay.com/misc/sounds/bell-ringing-05.mp3').play();
        }
    } catch(e) {}
}

function getStoneTypeName(type) {
    const types = { classic: 'Классические', extended: 'Расширенные', max: 'Максимальные' };
    return types[type] || 'Классические';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function setupEventListeners() {
    document.getElementById('createGameBtn')?.addEventListener('click', createGame);
    document.getElementById('refreshBtn')?.addEventListener('click', () => socket?.emit('getGames'));
    document.getElementById('cancelWaitBtn')?.addEventListener('click', () => window.location.reload());
    document.getElementById('leaveGameBtn')?.addEventListener('click', () => window.location.reload());
    document.getElementById('passBtn')?.addEventListener('click', () => {
        if (currentTurn === currentUser.id) {
            playSound('place');
            socket.emit('passMove', { gameId: currentGameId, playerId: currentUser.id });
        }
    });
}

// ============ ЗАПУСК ============
init();