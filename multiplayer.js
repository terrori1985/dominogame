// Многопользовательская логика - полная версия со списком столов
class DominoMultiplayer {
    constructor() {
        this.tg = window.Telegram.WebApp;
        this.user = null;
        this.gameId = null;
        this.isHost = false;
        this.gamesList = [];
        this.refreshInterval = null;
        
        this.init();
    }
    
    init() {
        this.tg.expand();
        this.tg.ready();
        
        // Получаем данные пользователя
        if (this.tg.initDataUnsafe && this.tg.initDataUnsafe.user) {
            this.user = this.tg.initDataUnsafe.user;
        } else {
            this.user = {
                id: Date.now(),
                first_name: 'Игрок',
                username: 'player'
            };
        }
        
        this.displayUserInfo();
        this.setupEventListeners();
        this.loadActiveGames();
        this.checkGameInvite();
        
        // Обновляем список столов каждые 3 секунды
        this.refreshInterval = setInterval(() => this.loadActiveGames(), 3000);
    }
    
    displayUserInfo() {
        const userElement = document.getElementById('telegramUser');
        if (userElement && this.user) {
            userElement.innerHTML = `<span>👤 ${this.user.first_name}</span>`;
        }
    }
    
    setupEventListeners() {
        // Создание игры
        const createBtn = document.getElementById('createGameBtn');
        if (createBtn) {
            createBtn.addEventListener('click', () => this.createGame());
        }
        
        // Копирование ссылки
        const copyBtn = document.getElementById('copyInviteBtn');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => this.copyInviteLink());
        }
        
        // Отмена создания
        const cancelBtn = document.getElementById('cancelGameBtn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.cancelGame());
        }
        
        // Обновить список
        const refreshBtn = document.getElementById('refreshGamesBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.loadActiveGames());
        }
    }
    
    createGame() {
        this.gameId = this.generateGameId();
        this.isHost = true;
        
        // Получаем настройки
        const stoneType = document.getElementById('gameStoneType')?.value || 'classic';
        const tableTheme = document.getElementById('gameTableTheme')?.value || 'green';
        
        // Создаём игру
        const gameData = {
            gameId: this.gameId,
            host: this.user,
            hostName: this.user.first_name,
            players: [this.user],
            playersCount: 1,
            maxPlayers: 2,
            settings: { stoneType, tableTheme },
            status: 'waiting',
            createdAt: Date.now()
        };
        
        // Сохраняем в глобальное хранилище
        this.saveGameToGlobal(gameData);
        
        // Показываем экран ожидания
        this.showWaitingRoom(gameData);
        
        // Запускаем проверку подключения
        this.startWaitingForPlayer();
    }
    
    generateGameId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
    }
    
    saveGameToGlobal(gameData) {
        // Получаем все игры из localStorage
        let allGames = JSON.parse(localStorage.getItem('domino_all_games') || '{}');
        allGames[gameData.gameId] = gameData;
        localStorage.setItem('domino_all_games', JSON.stringify(allGames));
        
        // Сохраняем текущую игру
        localStorage.setItem('domino_current_game', gameData.gameId);
        localStorage.setItem('domino_is_host', 'true');
    }
    
    loadActiveGames() {
        // Получаем все игры
        const allGames = JSON.parse(localStorage.getItem('domino_all_games') || '{}');
        const now = Date.now();
        
        // Фильтруем активные игры (созданные менее 10 минут назад и не начатые)
        const activeGames = Object.values(allGames).filter(game => {
            return game.status === 'waiting' && 
                   game.playersCount < 2 && 
                   (now - game.createdAt) < 600000; // 10 минут
        });
        
        // Удаляем старые игры
        Object.keys(allGames).forEach(gameId => {
            if ((now - allGames[gameId].createdAt) > 600000) {
                delete allGames[gameId];
            }
        });
        localStorage.setItem('domino_all_games', JSON.stringify(allGames));
        
        // Отображаем список
        this.displayGamesList(activeGames);
    }
    
    displayGamesList(games) {
        const gamesList = document.getElementById('gamesList');
        if (!gamesList) return;
        
        if (games.length === 0) {
            gamesList.innerHTML = `
                <div class="empty-games">
                    <span>🎲</span>
                    <p>Нет активных столов</p>
                    <small>Создайте новый стол, чтобы начать игру</small>
                </div>
            `;
            return;
        }
        
        gamesList.innerHTML = games.map(game => `
            <div class="game-card">
                <div class="game-card-header">
                    <span class="game-host">👑 ${game.hostName}</span>
                    <span class="game-status">🟢 Ожидает</span>
                </div>
                <div class="game-card-info">
                    <span>🎴 ${this.getStoneTypeName(game.settings.stoneType)}</span>
                    <span>👥 ${game.playersCount}/2</span>
                </div>
                <button onclick="window.multiplayer.joinGame('${game.gameId}')" class="btn-join-game">
                    🔗 Присоединиться
                </button>
            </div>
        `).join('');
    }
    
    getStoneTypeName(type) {
        const types = {
            classic: 'Классические',
            extended: 'Расширенные',
            max: 'Максимальные'
        };
        return types[type] || 'Классические';
    }
    
    joinGame(gameId) {
        // Получаем данные игры
        const allGames = JSON.parse(localStorage.getItem('domino_all_games') || '{}');
        const game = allGames[gameId];
        
        if (!game) {
            this.tg.showAlert('❌ Игра не найдена!');
            return;
        }
        
        if (game.playersCount >= 2) {
            this.tg.showAlert('❌ Стол уже заполнен!');
            return;
        }
        
        if (game.players.some(p => p.id === this.user.id)) {
            this.tg.showAlert('❌ Вы уже в этой игре!');
            return;
        }
        
        // Добавляем игрока
        game.players.push(this.user);
        game.playersCount = 2;
        game.status = 'starting';
        allGames[gameId] = game;
        localStorage.setItem('domino_all_games', JSON.stringify(allGames));
        
        // Сохраняем информацию для текущего игрока
        localStorage.setItem('domino_current_game', gameId);
        localStorage.setItem('domino_is_host', 'false');
        localStorage.setItem('dominoSettings', JSON.stringify(game.settings));
        
        this.tg.showAlert('✅ Вы присоединились к игре!');
        
        // Запускаем игру
        setTimeout(() => {
            window.location.href = 'game.html';
        }, 500);
    }
    
    showWaitingRoom(gameData) {
        // Скрываем блоки
        const createBox = document.getElementById('createGameBox');
        if (createBox) createBox.classList.add('hidden');
        
        const gamesBox = document.getElementById('activeGamesBox');
        if (gamesBox) gamesBox.classList.add('hidden');
        
        const infoBox = document.getElementById('infoBox');
        if (infoBox) infoBox.classList.add('hidden');
        
        // Показываем окно ожидания
        const waitingDiv = document.getElementById('waitingGame');
        if (waitingDiv) waitingDiv.classList.remove('hidden');
        
        // Формируем ссылку для приглашения
        const inviteUrl = `${window.location.origin}${window.location.pathname}?game=${gameData.gameId}`;
        const inviteLink = document.getElementById('inviteLink');
        if (inviteLink) {
            inviteLink.value = inviteUrl;
        }
        
        // Обновляем список игроков
        this.updatePlayersList(gameData.players);
    }
    
    updatePlayersList(players) {
        const list = document.getElementById('playersList');
        if (list) {
            list.innerHTML = players.map(p => `
                <li>
                    ${p.id === this.user?.id ? '👑' : '👤'} 
                    <strong>${p.first_name}</strong>
                    ${p.id === this.user?.id ? ' (Вы)' : ''}
                </li>
            `).join('');
        }
    }
    
    copyInviteLink() {
        const inviteLink = document.getElementById('inviteLink')?.value;
        if (inviteLink) {
            navigator.clipboard.writeText(inviteLink).then(() => {
                this.tg.showAlert('✅ Ссылка скопирована! Отправьте её другу.');
            });
        }
    }
    
    cancelGame() {
        // Удаляем игру из глобального хранилища
        const allGames = JSON.parse(localStorage.getItem('domino_all_games') || '{}');
        delete allGames[this.gameId];
        localStorage.setItem('domino_all_games', JSON.stringify(allGames));
        
        localStorage.removeItem('domino_current_game');
        localStorage.removeItem('domino_is_host');
        
        window.location.reload();
    }
    
    startWaitingForPlayer() {
        const checkInterval = setInterval(() => {
            const allGames = JSON.parse(localStorage.getItem('domino_all_games') || '{}');
            const game = allGames[this.gameId];
            
            if (game && game.playersCount >= 2) {
                clearInterval(checkInterval);
                this.tg.showAlert('🎲 Соперник присоединился! Игра начинается!');
                localStorage.setItem('dominoSettings', JSON.stringify(game.settings));
                window.location.href = 'game.html';
            } else if (game && game.players.length > 1) {
                this.updatePlayersList(game.players);
            }
        }, 2000);
    }
    
    checkGameInvite() {
        const urlParams = new URLSearchParams(window.location.search);
        const gameId = urlParams.get('game');
        
        if (gameId) {
            setTimeout(() => {
                this.joinGame(gameId);
            }, 500);
        }
    }
}

// Запуск
const multiplayer = new DominoMultiplayer();
window.multiplayer = multiplayer;
