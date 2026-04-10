// Многопользовательская логика - полная версия
class DominoMultiplayer {
    constructor() {
        this.tg = window.Telegram.WebApp;
        this.user = null;
        this.gameId = null;
        this.isHost = false;
        this.players = [];
        this.checkInterval = null;
        
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
                first_name: 'Игрок',
                username: 'player'
            };
        }
        
        this.displayUserInfo();
        this.setupEventListeners();
        this.checkInviteInUrl();
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
        
        // Кнопка Enter в поле ввода кода
        const codeInput = document.getElementById('gameCodeInput');
        if (codeInput) {
            codeInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.joinByCode();
                }
            });
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
        
        // Сохраняем в localStorage
        localStorage.setItem(`domino_game_${this.gameId}`, JSON.stringify(gameData));
        localStorage.setItem('domino_current_game', this.gameId);
        
        // Показываем экран ожидания
        this.showWaitingRoom(gameData);
        
        // Запускаем проверку подключения игрока
        this.startWaitingForPlayer();
    }
    
    generateGameCode() {
        // Генерируем 6-значный код (например: A3F9K2)
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
        return code;
    }
    
    showWaitingRoom(gameData) {
        // Скрываем блоки создания и присоединения
        const createBox = document.getElementById('createGameBox');
        if (createBox) createBox.classList.add('hidden');
        
        const joinBox = document.getElementById('joinGameBox');
        if (joinBox) joinBox.classList.add('hidden');
        
        const infoBox = document.getElementById('infoBox');
        if (infoBox) infoBox.classList.add('hidden');
        
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
                    ${p.id === this.user?.id ? '👑' : '👤'} 
                    <strong>${p.first_name}</strong>
                    ${p.id === this.user?.id ? ' (Вы)' : ''}
                </li>
            `).join('');
        }
    }
    
    copyInviteCode() {
        const inviteText = `${this.gameId}`;
        
        navigator.clipboard.writeText(inviteText).then(() => {
            this.tg.showAlert('✅ Код игры скопирован! Отправь его другу в Telegram.');
        }).catch(() => {
            // Если не получилось скопировать, показываем код
            this.tg.showAlert(`Код игры: ${this.gameId}`);
        });
    }
    
    cancelGame() {
        // Удаляем игру
        localStorage.removeItem(`domino_game_${this.gameId}`);
        localStorage.removeItem('domino_current_game');
        
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
        }
        
        // Перезагружаем страницу
        window.location.reload();
    }
    
    startWaitingForPlayer() {
        // Проверяем каждую секунду, присоединился ли игрок
        this.checkInterval = setInterval(() => {
            const gameData = localStorage.getItem(`domino_game_${this.gameId}`);
            if (gameData) {
                const game = JSON.parse(gameData);
                if (game.players.length >= 2) {
                    clearInterval(this.checkInterval);
                    this.startGame(game);
                } else if (game.players.length > 1) {
                    this.updatePlayersList(game.players);
                }
            }
        }, 1000);
    }
    
    joinByCode() {
        const codeInput = document.getElementById('gameCodeInput');
        let code = codeInput?.value?.trim().toUpperCase();
        
        if (!code) {
            // Если нет поля ввода, спрашиваем через попап
            this.promptForGameCode();
            return;
        }
        
        if (code.length !== 6) {
            this.tg.showAlert('❌ Код должен состоять из 6 символов!');
            return;
        }
        
        this.joinGame(code);
    }
    
    promptForGameCode() {
        // Создаём простое поле для ввода
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
        `;
        
        modal.innerHTML = `
            <div style="background: white; padding: 20px; border-radius: 15px; width: 280px;">
                <h3 style="margin-bottom: 15px;">Введите код игры</h3>
                <input type="text" id="codeInputModal" maxlength="6" placeholder="A3F9K2" style="width: 100%; padding: 12px; font-size: 18px; text-align: center; letter-spacing: 3px; border: 2px solid #667eea; border-radius: 10px; margin-bottom: 15px;">
                <div style="display: flex; gap: 10px;">
                    <button id="modalJoinBtn" style="flex:1; padding: 10px; background: #667eea; color: white; border: none; border-radius: 8px;">Присоединиться</button>
                    <button id="modalCancelBtn" style="flex:1; padding: 10px; background: #ccc; border: none; border-radius: 8px;">Отмена</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        const input = modal.querySelector('#codeInputModal');
        input.focus();
        
        modal.querySelector('#modalJoinBtn').onclick = () => {
            const code = input.value.trim().toUpperCase();
            if (code.length === 6) {
                modal.remove();
                this.joinGame(code);
            } else {
                this.tg.showAlert('Введите корректный 6-значный код');
            }
        };
        
        modal.querySelector('#modalCancelBtn').onclick = () => {
            modal.remove();
        };
    }
    
    joinGame(gameId) {
        // Получаем данные игры
        const gameData = localStorage.getItem(`domino_game_${gameId}`);
        
        if (!gameData) {
            this.tg.showAlert('❌ Игра с таким кодом не найдена! Проверьте код.');
            return;
        }
        
        const game = JSON.parse(gameData);
        
        // Проверяем, не заполнена ли игра
        if (game.players.length >= 2) {
            this.tg.showAlert('❌ Игра уже заполнена!');
            return;
        }
        
        // Проверяем, не присоединился ли уже этот игрок
        if (game.players.some(p => p.id === this.user.id)) {
            this.tg.showAlert('❌ Вы уже в этой игре!');
            return;
        }
        
        // Добавляем игрока
        game.players.push(this.user);
        game.status = 'starting';
        localStorage.setItem(`domino_game_${gameId}`, JSON.stringify(game));
        
        // Сохраняем ID игры
        localStorage.setItem('domino_current_game', gameId);
        
        // Запускаем игру
        this.startGame(game);
    }
    
    checkInviteInUrl() {
        // Проверяем URL параметры
        const urlParams = new URLSearchParams(window.location.search);
        const gameCode = urlParams.get('code') || urlParams.get('startapp');
        
        if (gameCode) {
            // Автоматически заполняем поле ввода
            const codeInput = document.getElementById('gameCodeInput');
            if (codeInput) {
                codeInput.value = gameCode.toUpperCase();
            }
            // Через секунду присоединяемся
            setTimeout(() => {
                this.joinGame(gameCode.toUpperCase());
            }, 500);
        }
    }
    
    startGame(game) {
        // Сохраняем настройки игры
        localStorage.setItem('dominoSettings', JSON.stringify(game.settings));
        localStorage.setItem('gamePlayers', JSON.stringify(game.players));
        localStorage.setItem('isHost', this.isHost ? 'true' : 'false');
        
        // Показываем уведомление
        this.tg.showAlert('🎲 Игра начинается!');
        
        // Переходим на страницу игры
        setTimeout(() => {
            window.location.href = `game.html?gameId=${game.gameId}`;
        }, 500);
    }
}

// Запускаем приложение
const multiplayer = new DominoMultiplayer();

// Делаем функции глобальными
window.joinGame = (gameId) => multiplayer.joinGame(gameId);
window.createGame = () => multiplayer.createGame();