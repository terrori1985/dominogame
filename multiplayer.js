// Многопользовательская логика с использованием localStorage и BroadcastChannel
// Для реального продакшена нужен сервер (см. server.js)

class DominoMultiplayer {
    constructor() {
        this.tg = window.Telegram.WebApp;
        this.user = this.tg.initDataUnsafe?.user;
        this.gameId = null;
        this.isHost = false;
        this.players = [];
        this.gameState = null;
        
        this.init();
    }
    
    init() {
        this.tg.expand();
        this.tg.ready();
        
        this.displayUserInfo();
        this.setupEventListeners();
        this.checkInviteLink();
        this.loadActiveGames();
    }
    
    displayUserInfo() {
        if (this.user) {
            document.getElementById('telegramUser').innerHTML = `
                <img src="${this.user.photo_url || 'https://via.placeholder.com/32'}" class="user-avatar">
                <span>${this.user.first_name} ${this.user.last_name || ''}</span>
            `;
        }
    }
    
    setupEventListeners() {
        document.getElementById('createGameBtn')?.addEventListener('click', () => this.createGame());
        document.getElementById('copyInviteBtn')?.addEventListener('click', () => this.copyInvite());
        document.getElementById('cancelGameBtn')?.addEventListener('click', () => this.cancelGame());
    }
    
    createGame() {
        this.gameId = this.generateGameCode();
        this.isHost = true;
        
        const stoneType = document.getElementById('gameStoneType').value;
        const tableTheme = document.getElementById('gameTableTheme').value;
        
        const gameData = {
            gameId: this.gameId,
            host: this.user,
            players: [this.user],
            settings: { stoneType, tableTheme },
            status: 'waiting',
            createdAt: Date.now()
        };
        
        this.saveGameToStorage(gameData);
        this.showWaitingRoom(gameData);
        this.startGameWatcher();
    }
    
    generateGameCode() {
        return Math.random().toString(36).substring(2, 8).toUpperCase();
    }
    
    saveGameToStorage(gameData) {
        const games = JSON.parse(localStorage.getItem('activeGames') || '{}');
        games[gameData.gameId] = gameData;
        localStorage.setItem('activeGames', JSON.stringify(games));
        
        // Сохраняем текущую игру для пользователя
        localStorage.setItem(`user_${this.user.id}_game`, gameData.gameId);
    }
    
    showWaitingRoom(gameData) {
        document.querySelector('.create-game-box')?.classList.add('hidden');
        document.querySelector('.active-games')?.classList.add('hidden');
        const waitingDiv = document.getElementById('waitingGame');
        waitingDiv.classList.remove('hidden');
        
        document.getElementById('gameCode').textContent = gameData.gameId;
        this.updatePlayersList(gameData.players);
    }
    
    updatePlayersList(players) {
        const list = document.getElementById('playersList');
        list.innerHTML = players.map(p => `
            <li>
                <img src="${p.photo_url || 'https://via.placeholder.com/24'}" class="mini-avatar">
                ${p.first_name} ${p.last_name || ''}
                ${p.id === this.user.id ? '(Вы)' : ''}
                ${p.id === this.user.id && this.isHost ? '👑' : ''}
            </li>
        `).join('');
    }
    
    copyInvite() {
        const inviteLink = `https://t.me/share/url?url=${encodeURIComponent(window.location.origin)}/game.html?gameId=${this.gameId}&startapp=${this.gameId}&text=Присоединяйся%20к%20игре%20в%20домино!`;
        
        // Используем Telegram API для копирования
        this.tg.showPopup({
            title: 'Приглашение',
            message: `Код игры: ${this.gameId}\nОтправь ссылку другу:`,
            buttons: [{ type: 'default', text: 'Скопировать' }]
        }, (buttonId) => {
            if (buttonId === 0) {
                navigator.clipboard.writeText(inviteLink);
                this.tg.showAlert('Ссылка скопирована!');
            }
        });
    }
    
    cancelGame() {
        const games = JSON.parse(localStorage.getItem('activeGames') || '{}');
        delete games[this.gameId];
        localStorage.setItem('activeGames', JSON.stringify(games));
        localStorage.removeItem(`user_${this.user.id}_game`);
        window.location.reload();
    }
    
    loadActiveGames() {
        const games = JSON.parse(localStorage.getItem('activeGames') || '{}');
        const activeGames = Object.values(games).filter(g => g.status === 'waiting');
        
        const gamesList = document.getElementById('gamesList');
        if (activeGames.length === 0) {
            gamesList.innerHTML = '<div class="empty-state">Нет активных игр</div>';
        } else {
            gamesList.innerHTML = activeGames.map(game => `
                <div class="game-card">
                    <div class="game-info">
                        <strong>${game.host.first_name}</strong>
                        <span>${game.players.length}/2 игроков</span>
                    </div>
                    <button onclick="window.multiplayer.joinGame('${game.gameId}')" class="btn-join">Присоединиться</button>
                </div>
            `).join('');
        }
    }
    
    joinGame(gameId) {
        const games = JSON.parse(localStorage.getItem('activeGames') || '{}');
        const game = games[gameId];
        
        if (game && game.players.length < 2) {
            game.players.push(this.user);
            game.status = 'starting';
            games[gameId] = game;
            localStorage.setItem('activeGames', JSON.stringify(games));
            
            // Переходим в игру
            window.location.href = `game.html?gameId=${gameId}`;
        } else {
            this.tg.showAlert('Игра уже началась или заполнена!');
        }
    }
    
    checkInviteLink() {
        const urlParams = new URLSearchParams(window.location.search);
        const gameId = urlParams.get('gameId') || urlParams.get('startapp');
        
        if (gameId) {
            this.joinGame(gameId);
        }
    }
    
    startGameWatcher() {
        // Обновляем список игроков каждые 2 секунды
        setInterval(() => {
            if (this.gameId) {
                const games = JSON.parse(localStorage.getItem('activeGames') || '{}');
                const game = games[this.gameId];
                if (game && game.players.length === 2 && game.status === 'waiting') {
                    game.status = 'starting';
                    games[this.gameId] = game;
                    localStorage.setItem('activeGames', JSON.stringify(games));
                    window.location.href = `game.html?gameId=${this.gameId}`;
                } else if (game) {
                    this.updatePlayersList(game.players);
                }
            }
        }, 2000);
    }
}

// Инициализация
window.multiplayer = new DominoMultiplayer();