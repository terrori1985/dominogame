// Многопользовательская логика - автономная версия (без сервера)
class DominoMultiplayer {
    constructor() {
        this.tg = window.Telegram.WebApp;
        this.user = null;
        this.gameId = null;
        this.isHost = false;
        this.refreshInterval = null;
        
        this.init();
    }
    
    init() {
        // Разворачиваем на весь экран
        this.tg.expand();
        this.tg.ready();
        
        // Получаем данные пользователя из Telegram
        if (this.tg.initDataUnsafe && this.tg.initDataUnsafe.user) {
            this.user = this.tg.initDataUnsafe.user;
        } else {
            // Для тестирования вне Telegram
            this.user = {
                id: Date.now(),
                first_name: 'Игрок_' + Math.floor(Math.random() * 1000),
                username: 'player'
            };
        }
        
        console.log('Пользователь:', this.user);
        
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
            createBtn.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('Кнопка создания нажата');
                this.createGame();
            });
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
            refreshBtn.addEventListener('click', () => {
                console.log('Обновление списка');
                this.loadActiveGames();
            });
        }
    }
    
    createGame() {
        console.log('Создание игры...');
        
        // Генерируем уникальный ID игры
        this.gameId = this.generateGameId();
        this.isHost = true;
        
        // Получаем настройки
        const stoneType = document.getElementById('gameStoneType')?.value || 'classic';
        const tableTheme = document.getElementById('gameTableTheme')?.value || 'green';
        
        console.log('Настройки:', { stoneType, tableTheme });
        
        // Создаём игру
        const gameData = {
            gameId: this.gameId,
            hostId: this.user.id,
            hostName: this.user.first_name,
            players: [{
                id: this.user.id,
                name: this.user.first_name,
                isHost: true
            }],
            playersCount: 1,
            maxPlayers: 2,
            settings: { 
                stoneType: stoneType,
                tableTheme: tableTheme 
            },
            status: 'waiting',
            createdAt: Date.now()
        };
        
        // Сохраняем в localStorage
        this.saveGameToStorage(gameData);
        
        // Показываем экран ожидания
        this.showWaitingRoom(gameData);
        
        // Запускаем проверку подключения
        this.startWaitingForPlayer();
        
        this.tg.showAlert('✅ Стол создан! Ожидаем соперника...');
    }
    
    generateGameId() {
        return 'game_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    }
    
    saveGameToStorage(gameData) {
        // Получаем все игры
        let allGames = this.getAllGames();
        allGames[gameData.gameId] = gameData;
        
        // Сохраняем
        localStorage.setItem('domino_all_games', JSON.stringify(allGames));
        localStorage.setItem('domino_current_game', gameData.gameId);
        localStorage.setItem('domino_is_host', 'true');
        
        console.log('Игра сохранена:', gameData.gameId);
        console.log('Все игры:', Object.keys(allGames));
    }
    
    getAllGames() {
        return JSON.parse(localStorage.getItem('domino_all_games') || '{}');
    }
    
    loadActiveGames() {
        console.log('Загрузка активных игр...');
        
        // Получаем все игры
        const allGames = this.getAllGames();
        const now = Date.now();
        
        // Очищаем старые игры (старше 10 минут)
        let changed = false;
        Object.keys(allGames).forEach(gameId => {
            if ((now - allGames[gameId].createdAt) > 600000) {
                delete allGames[gameId];
                changed = true;
            }
        });
        
        if (changed) {
            localStorage.setItem('domino_all_games', JSON.stringify(allGames));
        }
        
        // Фильтруем активные игры (ожидающие и не полные, и не свои)
        const activeGames = Object.values(allGames).filter(game => {
            return game.status === 'waiting' && 
                   game.playersCount < game.maxPlayers &&
                   game.hostId !== this.user.id;
        });
        
        console.log('Найдено активных столов:', activeGames.length);
        
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
                    <span class="game-host">👑 ${this.escapeHtml(game.hostName)}</span>
                    <span class="game-status">🟢 Ожидает</span>
                </div>
                <div class="game-card-info">
                    <span>🎴 ${this.getStoneTypeName(game.settings.stoneType)}</span>
                    <span>🪑 ${this.getTableThemeName(game.settings.tableTheme)}</span>
                    <span>👥 ${game.playersCount}/${game.maxPlayers}</span>
                </div>
                <button onclick="window.multiplayer.joinGame('${game.gameId}')" class="btn-join-game">
                    🔗 Присоединиться
                </button>
            </div>
        `).join('');
    }
    
    joinGame(gameId) {
        console.log('Попытка присоединиться к игре:', gameId);
        
        // Получаем данные игры
        const allGames = this.getAllGames();
        const game = allGames[gameId];
        
        if (!game) {
            this.tg.showAlert('❌ Игра не найдена!');
            return;
        }
        
        if (game.playersCount >= game.maxPlayers) {
            this.tg.showAlert('❌ Стол уже заполнен!');
            return;
        }
        
        if (game.players.some(p => p.id === this.user.id)) {
            this.tg.showAlert('❌ Вы уже в этой игре!');
            return;
        }
        
        // Добавляем игрока
        game.players.push({
            id: this.user.id,
            name: this.user.first_name,
            isHost: false
        });
        game.playersCount = 2;
        game.status = 'starting';
        
        // Сохраняем обновлённую игру
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
        const gamesBox = document.getElementById('activeGamesBox');
        const infoBox = document.getElementById('infoBox');
        const waitingDiv = document.getElementById('waitingGame');
        
        if (createBox) createBox.classList.add('hidden');
        if (gamesBox) gamesBox.classList.add('hidden');
        if (infoBox) infoBox.classList.add('hidden');
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
            if (!players || players.length === 0) {
                list.innerHTML = '<li>👑 Ожидание игроков...</li>';
            } else {
                list.innerHTML = players.map(p => `
                    <li>
                        ${p.isHost ? '👑' : '👤'} 
                        <strong>${this.escapeHtml(p.name)}</strong>
                        ${p.id === this.user?.id ? ' (Вы)' : ''}
                        ${p.isHost ? ' — Создатель' : ''}
                    </li>
                `).join('');
            }
        }
    }
    
    copyInviteLink() {
        const inviteLink = document.getElementById('inviteLink')?.value;
        if (inviteLink) {
            navigator.clipboard.writeText(inviteLink).then(() => {
                this.tg.showAlert('✅ Ссылка скопирована! Отправьте её другу.');
            }).catch(() => {
                this.tg.showAlert('📋 Ссылка: ' + inviteLink);
            });
        }
    }
    
    cancelGame() {
        // Удаляем игру из хранилища
        const allGames = this.getAllGames();
        delete allGames[this.gameId];
        localStorage.setItem('domino_all_games', JSON.stringify(allGames));
        
        localStorage.removeItem('domino_current_game');
        localStorage.removeItem('domino_is_host');
        
        this.tg.showAlert('❌ Создание игры отменено');
        window.location.reload();
    }
    
    startWaitingForPlayer() {
        // Проверяем каждую секунду, присоединился ли игрок
        const checkInterval = setInterval(() => {
            const allGames = this.getAllGames();
            const game = allGames[this.gameId];
            
            if (game && game.playersCount >= 2) {
                clearInterval(checkInterval);
                this.tg.showAlert('🎲 Соперник присоединился! Игра начинается!');
                
                // Сохраняем настройки
                localStorage.setItem('dominoSettings', JSON.stringify(game.settings));
                localStorage.setItem('dominoPlayers', JSON.stringify(game.players));
                
                setTimeout(() => {
                    window.location.href = 'game.html';
                }, 500);
            } else if (game && game.players.length > 1) {
                this.updatePlayersList(game.players);
            }
        }, 1000);
    }
    
    checkGameInvite() {
        const urlParams = new URLSearchParams(window.location.search);
        const gameId = urlParams.get('game');
        
        if (gameId) {
            console.log('Найдена ссылка-приглашение:', gameId);
            setTimeout(() => {
                this.joinGame(gameId);
            }, 1000);
        }
    }
    
    getStoneTypeName(type) {
        const types = {
            classic: 'Классические',
            extended: 'Расширенные',
            max: 'Максимальные'
        };
        return types[type] || 'Классические';
    }
    
    getTableThemeName(theme) {
        const themes = {
            green: 'Зелёный',
            wood: 'Деревянный',
            dark: 'Тёмный'
        };
        return themes[theme] || 'Зелёный';
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // Очистка интервала
    destroy() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
    }
}

// Создаём экземпляр
const multiplayer = new DominoMultiplayer();

// Делаем глобальным для доступа из onclick
window.multiplayer = multiplayer;

// Очищаем при выгрузке
window.addEventListener('beforeunload', () => {
    if (multiplayer) {
        multiplayer.destroy();
    }
});

console.log('Multiplayer инициализирован');
