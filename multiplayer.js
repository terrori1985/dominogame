// Многопользовательская логика - версия с прямыми ссылками
class DominoMultiplayer {
    constructor() {
        this.tg = window.Telegram.WebApp;
        this.user = null;
        this.gameId = null;
        this.isHost = false;
        
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
        this.checkGameInvite();
    }
    
    displayUserInfo() {
        const userElement = document.getElementById('telegramUser');
        if (userElement && this.user) {
            userElement.innerHTML = `<span>👤 ${this.user.first_name}</span>`;
        }
    }
    
    setupEventListeners() {
        const createBtn = document.getElementById('createGameBtn');
        if (createBtn) {
            createBtn.addEventListener('click', () => this.createGame());
        }
        
        const copyBtn = document.getElementById('copyInviteBtn');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => this.copyInviteLink());
        }
        
        const cancelBtn = document.getElementById('cancelGameBtn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.cancelGame());
        }
    }
    
    createGame() {
        this.gameId = this.generateGameId();
        this.isHost = true;
        
        // Получаем настройки
        const stoneType = document.getElementById('gameStoneType')?.value || 'classic';
        const tableTheme = document.getElementById('gameTableTheme')?.value || 'green';
        
        // Сохраняем игру в localStorage
        const gameData = {
            gameId: this.gameId,
            host: this.user,
            players: [this.user],
            settings: { stoneType, tableTheme },
            status: 'waiting',
            createdAt: Date.now()
        };
        
        localStorage.setItem('domino_current_game', JSON.stringify(gameData));
        localStorage.setItem('domino_is_host', 'true');
        
        this.showWaitingRoom(gameData);
        this.startGameWatcher();
    }
    
    generateGameId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
    }
    
    showWaitingRoom(gameData) {
        // Скрываем блоки
        document.getElementById('createGameBox').classList.add('hidden');
        document.getElementById('joinGameBox').classList.add('hidden');
        document.getElementById('infoBox').classList.add('hidden');
        
        // Показываем окно ожидания
        const waitingDiv = document.getElementById('waitingGame');
        waitingDiv.classList.remove('hidden');
        
        // Показываем ссылку для приглашения
        const inviteLink = document.getElementById('inviteLink');
        const gameUrl = `${window.location.origin}${window.location.pathname}?game=${this.gameId}`;
        if (inviteLink) {
            inviteLink.value = gameUrl;
        }
        
        // Обновляем список игроков
        this.updatePlayersList(gameData.players);
    }
    
    updatePlayersList(players) {
        const list = document.getElementById('playersList');
        if (list) {
            list.innerHTML = players.map(p => `
                <li>${p.id === this.user?.id ? '👑' : '👤'} ${p.first_name} ${p.id === this.user?.id ? '(Вы)' : ''}</li>
            `).join('');
        }
    }
    
    copyInviteLink() {
        const inviteLink = document.getElementById('inviteLink')?.value;
        if (inviteLink) {
            navigator.clipboard.writeText(inviteLink).then(() => {
                this.tg.showAlert('✅ Ссылка-приглашение скопирована! Отправь её другу в Telegram.');
            });
        }
    }
    
    cancelGame() {
        localStorage.removeItem('domino_current_game');
        localStorage.removeItem('domino_is_host');
        window.location.reload();
    }
    
    startGameWatcher() {
        // Ждём второго игрока
        const checkInterval = setInterval(() => {
            const gameData = localStorage.getItem('domino_current_game');
            if (gameData) {
                const game = JSON.parse(gameData);
                if (game.players.length >= 2) {
                    clearInterval(checkInterval);
                    this.startGame(game);
                }
            }
        }, 1000);
    }
    
    checkGameInvite() {
        const urlParams = new URLSearchParams(window.location.search);
        const gameId = urlParams.get('game');
        
        if (gameId) {
            this.joinGameByLink(gameId);
        }
    }
    
    joinGameByLink(gameId) {
        // Получаем данные игры
        const gameData = localStorage.getItem('domino_current_game');
        
        if (!gameData) {
            this.tg.showAlert('❌ Игра не найдена! Создайте новую игру.');
            return;
        }
        
        const game = JSON.parse(gameData);
        
        if (game.gameId !== gameId) {
            this.tg.showAlert('❌ Неправильная ссылка!');
            return;
        }
        
        if (game.players.length >= 2) {
            this.tg.showAlert('❌ Игра уже заполнена!');
            return;
        }
        
        // Добавляем игрока
        game.players.push(this.user);
        localStorage.setItem('domino_current_game', JSON.stringify(game));
        localStorage.setItem('domino_is_host', 'false');
        
        this.startGame(game);
    }
    
    startGame(game) {
        // Сохраняем настройки
        localStorage.setItem('dominoSettings', JSON.stringify(game.settings));
        localStorage.setItem('dominoPlayers', JSON.stringify(game.players));
        
        this.tg.showAlert('🎲 Игра начинается!');
        
        setTimeout(() => {
            window.location.href = 'game.html';
        }, 500);
    }
}

// Запуск
const multiplayer = new DominoMultiplayer();
