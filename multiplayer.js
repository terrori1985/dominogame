// Многопользовательская логика - версия с приглашениями по коду
class DominoMultiplayer {
    constructor() {
        this.tg = window.Telegram.WebApp;
        this.user = null;
        this.gameId = null;
        this.isHost = false;
        this.players = [];
        
        this.init();
    }
    
    init() {
        this.tg.expand();
        this.tg.ready();
        
        // Получаем данные пользователя из Telegram
        if (this.tg.initDataUnsafe && this.tg.initDataUnsafe.user) {
            this.user = this.tg.initDataUnsafe.user;
        } else {
            // Для тестирования вне Telegram
            this.user = {
                id: Math.random(),
                first_name: 'Игрок',
                username: 'player'
            };
        }
        
        this.displayUserInfo();
        this.setupEventListeners();
        this.checkInviteCode();
    }
    
    displayUserInfo() {
        const userElement = document.getElementById('telegramUser');
        if (userElement && this.user) {
            userElement.innerHTML = `
                <span>👤 ${this.user.first_name}</span>
            `;
        }
    }
    
    setupEventListeners() {
        // Создание игры
        const createBtn = document.getElementById('createGameBtn');
        if (createBtn) {
            createBtn.addEventListener('click', () => this.createGame());
        }
        
        // Присоединение по коду
        const joinBtn = document.getElementById('joinGameBtn');
        if (joinBtn) {
            joinBtn.addEventListener('click', () => this.joinByCode());
        }
        
        // Копирование кода
        const copyBtn = document.getElementById('copyInviteBtn');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => this.copyInviteCode());
        }
        
        // Отмена создания
        const cancelBtn = document.getElementById('cancelGameBtn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.cancelGame());
        }
    }
    
    createGame() {
        // Генерируем уникальный код игры
        this.gameId = this.generateGameCode();
        this.isHost = true;
        
        // Получаем настройки
        const stoneType = document.getElementById('gameStoneType')?.value || 'classic';
        const tableTheme = document.getElementById('gameTableTheme')?.value || 'green';
        
        // Создаём игру
        const gameData = {
            gameId: this.gameId,
            host: this.user,
            players: [this.user],
            settings: { stoneType, tableTheme },
            status: 'waiting',
            createdAt: Date.now()
        };
        
        // Сохраняем в sessionStorage (временное хранилище)
        sessionStorage.setItem(`game_${this.gameId}`, JSON.stringify(gameData));
        sessionStorage.setItem('currentGameId', this.gameId);
        
        // Показываем экран ожидания
        this.showWaitingRoom(gameData);
        
        // Запускаем проверку подключения игрока
        this.startWaitingForPlayer();
    }
    
    generateGameCode() {
        // Генерируем 6-значный код (например: A3F9K2)
        return Math.random().toString(36).substring(2, 8).toUpperCase();
    }
    
    showWaitingRoom(gameData) {
        // Скрываем форму создания игры
        const createBox = document.querySelector('.create-game-box');
        if (createBox) createBox.classList.add('hidden');
        
        // Скрываем список игр
        const gamesList = document.querySelector('.active-games');
        if (gamesList) gamesList.classList.add('hidden');
        
        // Показываем окно ожидания
        const waitingDiv = document.getElementById('waitingGame');
        if (waitingDiv) waitingDiv.classList.remove('hidden');
        
        // Отображаем код игры
        const codeSpan = document.getElementById('gameCode');
        if (codeSpan) codeSpan.textContent = this.gameId;
        
        // Обновляем список игроков
        this.updatePlayersList(gameData.players);
    }
    
    updatePlayersList(players) {
        const list = document.getElementById('playersList');
        if (list) {
            list.innerHTML = players.map(p => `
                <li>
                    <span>${p.id === this.user?.id ? '👑 ' : '👤 '}</span>
                    <strong>${p.first_name}</strong>
                    ${p.id === this.user?.id ? '(Вы)' : ''}
                    ${this.isHost && p.id === this.user?.id ? ' — Создатель' : ''}
                </li>
            `).join('');
        }
    }
    
    copyInviteCode() {
        const inviteText = `🎲 Приглашаю сыграть в Домино!\nКод игры: ${this.gameId}\nПерейди по ссылке и введи код: ${window.location.href}`;
        
        // Копируем в буфер
        navigator.clipboard.writeText(inviteText).then(() => {
            this.tg.showAlert('✅ Код игры скопирован! Отправь его другу в Telegram.');
        }).catch(() => {
            this.tg.showAlert(`Код игры: ${this.gameId}`);
        });
    }
    
    cancelGame() {
        // Удаляем игру
        sessionStorage.removeItem(`game_${this.gameId}`);
        sessionStorage.removeItem('currentGameId');
        
        // Перезагружаем страницу
        window.location.reload();
    }
    
    startWaitingForPlayer() {
        // Проверяем каждые 2 секунды, присоединился ли игрок
        const checkInterval = setInterval(() => {
            const gameData = sessionStorage.getItem(`game_${this.gameId}`);
            if (gameData) {
                const game = JSON.parse(gameData);
                if (game.players.length >= 2) {
                    clearInterval(checkInterval);
                    this.startGame(game);
                } else if (game.players.length > 1) {
                    this.updatePlayersList(game.players);
                }
            }
        }, 2000);
    }
    
    joinByCode() {
        // Показываем диалог для ввода кода
        this.tg.showPopup({
            title: 'Присоединиться к игре',
            message: 'Введите код игры:',
            buttons: [
                { type: 'default', text: 'Присоединиться' },
                { type: 'cancel', text: 'Отмена' }
            ]
        }, (buttonId) => {
            if (buttonId === 0) {
                // Здесь нужно получить ввод от пользователя
                this.promptForGameCode();
            }
        });
    }
    
    promptForGameCode() {
        // Используем простой prompt для ввода кода
        const code = prompt('Введите код игры:');
        if (code && code.length === 6) {
            this.joinGame(code);
        } else if (code) {
            this.tg.showAlert('Неверный формат кода. Код состоит из 6 символов.');
        }
    }
    
    joinGame(gameId) {
        // Получаем данные игры
        const gameData = sessionStorage.getItem(`game_${gameId}`);
        
        if (gameData) {
            const game = JSON.parse(gameData);
            
            // Проверяем, не заполнена ли игра
            if (game.players.length >= 2) {
                this.tg.showAlert('Игра уже заполнена!');
                return;
            }
            
            // Проверяем, не присоединился ли уже этот игрок
            if (game.players.some(p => p.id === this.user.id)) {
                this.tg.showAlert('Вы уже в этой игре!');
                return;
            }
            
            // Добавляем игрока
            game.players.push(this.user);
            game.status = 'starting';
            sessionStorage.setItem(`game_${gameId}`, JSON.stringify(game));
            
            // Сохраняем ID игры
            sessionStorage.setItem('currentGameId', gameId);
            
            // Запускаем игру
            this.startGame(game);
        } else {
            this.tg.showAlert('Игра с таким кодом не найдена! Проверьте код.');
        }
    }
    
    checkInviteCode() {
        // Проверяем URL параметры
        const urlParams = new URLSearchParams(window.location.search);
        const gameCode = urlParams.get('code');
        
        if (gameCode) {
            this.joinGame(gameCode.toUpperCase());
        }
    }
    
    startGame(game) {
        // Сохраняем настройки игры
        localStorage.setItem('dominoSettings', JSON.stringify(game.settings));
        localStorage.setItem('gamePlayers', JSON.stringify(game.players));
        localStorage.setItem('isHost', this.isHost ? 'true' : 'false');
        
        // Переходим на страницу игры
        window.location.href = `game.html?gameId=${game.gameId}`;
    }
}

// Инициализация
const multiplayer = new DominoMultiplayer();

// Делаем функцию доступной глобально
window.joinGame = (gameId) => multiplayer.joinGame(gameId);