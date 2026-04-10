// Игровая логика домино
class DominoGame {
    constructor() {
        this.deck = [];
        this.table = [];
        this.playerHand = [];
        this.botHand = [];
        this.currentTurn = 'player'; // 'player' или 'bot'
        this.playerScore = 0;
        this.botScore = 0;
        this.passes = 0;
        this.settings = {
            stoneType: 'classic',
            tableTheme: 'green',
            botDifficulty: 'medium'
        };
        
        this.loadSettings();
        this.init();
    }
    
    loadSettings() {
        const saved = localStorage.getItem('dominoSettings');
        if (saved) {
            this.settings = JSON.parse(saved);
        }
    }
    
    saveSettings() {
        localStorage.setItem('dominoSettings', JSON.stringify(this.settings));
    }
    
    getMaxStone() {
        switch(this.settings.stoneType) {
            case 'classic': return 6;
            case 'double': return 6;
            case 'extended': return 9;
            case 'max': return 12;
            default: return 6;
        }
    }
    
    createDeck() {
        const deck = [];
        const max = this.getMaxStone();
        
        for (let i = 0; i <= max; i++) {
            for (let j = i; j <= max; j++) {
                if (this.settings.stoneType === 'double' && i !== j) continue;
                deck.push([i, j]);
            }
        }
        
        return this.shuffle(deck);
    }
    
    shuffle(deck) {
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        return deck;
    }
    
    dealCards() {
        const deck = this.createDeck();
        this.playerHand = deck.slice(0, 7);
        this.botHand = deck.slice(7, 14);
        this.table = [];
        
        // Находим дубль для начала игры
        let startDouble = null;
        let allCards = [...this.playerHand, ...this.botHand];
        
        for (let card of allCards) {
            if (card[0] === card[1] && (!startDouble || card[0] > startDouble[0])) {
                startDouble = card;
            }
        }
        
        if (startDouble) {
            this.table.push(startDouble);
            if (this.playerHand.includes(startDouble)) {
                this.playerHand = this.playerHand.filter(c => c !== startDouble);
                this.currentTurn = 'bot';
            } else {
                this.botHand = this.botHand.filter(c => c !== startDouble);
                this.currentTurn = 'player';
            }
        } else {
            this.table.push(this.playerHand[0]);
            this.playerHand = this.playerHand.slice(1);
            this.currentTurn = 'bot';
        }
    }
    
    canPlay(card, tableStart, tableEnd) {
        return card[0] === tableStart || card[1] === tableStart ||
               card[0] === tableEnd || card[1] === tableEnd;
    }
    
    playCard(card, player) {
        const tableStart = this.table[0][0];
        const tableEnd = this.table[this.table.length - 1][1];
        
        if (card[1] === tableStart) {
            card = [card[1], card[0]];
        }
        
        if (card[0] === tableStart) {
            this.table.unshift(card);
        } else if (card[1] === tableEnd) {
            this.table.push(card);
        } else if (card[0] === tableEnd) {
            this.table.push([card[1], card[0]]);
        } else {
            return false;
        }
        
        if (player === 'player') {
            const index = this.playerHand.findIndex(c => c === card || (c[0] === card[1] && c[1] === card[0]));
            if (index !== -1) this.playerHand.splice(index, 1);
        } else {
            const index = this.botHand.findIndex(c => c === card || (c[0] === card[1] && c[1] === card[0]));
            if (index !== -1) this.botHand.splice(index, 1);
        }
        
        this.passes = 0;
        return true;
    }
    
    getPlayableCards(hand, tableStart, tableEnd) {
        return hand.filter(card => this.canPlay(card, tableStart, tableEnd));
    }
    
    botMove() {
        const tableStart = this.table[0][0];
        const tableEnd = this.table[this.table.length - 1][1];
        const playable = this.getPlayableCards(this.botHand, tableStart, tableEnd);
        
        if (playable.length > 0) {
            let chosenCard;
            
            switch(this.settings.botDifficulty) {
                case 'easy':
                    chosenCard = playable[Math.floor(Math.random() * playable.length)];
                    break;
                case 'hard':
                    chosenCard = playable.reduce((best, card) => {
                        const value = card[0] + card[1];
                        return value > (best[0] + best[1]) ? card : best;
                    });
                    break;
                default:
                    chosenCard = playable[0];
            }
            
            this.playCard(chosenCard, 'bot');
            return true;
        }
        
        this.passes++;
        return false;
    }
    
    checkWinner() {
        if (this.playerHand.length === 0) {
            this.updateScore('player');
            return 'player';
        }
        if (this.botHand.length === 0) {
            this.updateScore('bot');
            return 'bot';
        }
        if (this.passes >= 2) {
            const playerTotal = this.playerHand.reduce((sum, card) => sum + card[0] + card[1], 0);
            const botTotal = this.botHand.reduce((sum, card) => sum + card[0] + card[1], 0);
            
            if (playerTotal < botTotal) {
                this.updateScore('player');
                return 'player';
            } else {
                this.updateScore('bot');
                return 'bot';
            }
        }
        return null;
    }
    
    updateScore(winner) {
        if (winner === 'player') {
            this.playerScore++;
        } else {
            this.botScore++;
        }
    }
    
    resetGame() {
        this.dealCards();
        this.currentTurn = 'player';
        this.passes = 0;
    }
    
    getGameState() {
        return {
            table: this.table,
            playerHand: this.playerHand,
            botHandCount: this.botHand.length,
            currentTurn: this.currentTurn,
            playerScore: this.playerScore,
            botScore: this.botScore
        };
    }
}

// Инициализация игры и UI
let game;

function initGame() {
    game = new DominoGame();
    game.dealCards();
    updateUI();
}

function updateUI() {
    const state = game.getGameState();
    
    // Обновляем счёт
    document.getElementById('playerScore').textContent = state.playerScore;
    document.getElementById('botScore').textContent = state.botScore;
    
    // Обновляем стол
    const tableContainer = document.getElementById('tableDominoes');
    tableContainer.innerHTML = '';
    state.table.forEach((card, index) => {
        const cardDiv = createDominoElement(card, false);
        tableContainer.appendChild(cardDiv);
    });
    
    // Обновляем руку игрока
    const handContainer = document.getElementById('playerHand');
    handContainer.innerHTML = '';
    const tableStart = state.table[0]?.[0];
    const tableEnd = state.table[state.table.length - 1]?.[1];
    
    state.playerHand.forEach(card => {
        const cardDiv = createDominoElement(card, true);
        const canPlay = game.canPlay(card, tableStart, tableEnd);
        if (canPlay && state.currentTurn === 'player') {
            cardDiv.classList.add('playable');
            cardDiv.onclick = () => makeMove(card);
        } else {
            cardDiv.classList.add('disabled');
        }
        handContainer.appendChild(cardDiv);
    });
    
    // Обновляем статус
    const statusDiv = document.getElementById('gameStatus');
    const winner = game.checkWinner();
    if (winner) {
        statusDiv.textContent = `${winner === 'player' ? 'Вы победили!' : 'Бот победил!'} 🎉`;
        statusDiv.style.background = winner === 'player' ? '#4caf50' : '#f44336';
        statusDiv.style.color = 'white';
    } else {
        statusDiv.textContent = state.currentTurn === 'player' ? 'Ваш ход!' : 'Ход бота...';
        statusDiv.style.background = '#f5f5f5';
        statusDiv.style.color = '#333';
        
        if (state.currentTurn === 'bot' && !winner) {
            setTimeout(() => {
                game.botMove();
                updateUI();
            }, 1000);
        }
    }
}

function makeMove(card) {
    const state = game.getGameState();
    if (state.currentTurn !== 'player') return;
    
    const tableStart = state.table[0][0];
    const tableEnd = state.table[state.table.length - 1][1];
    
    if (game.canPlay(card, tableStart, tableEnd)) {
        game.playCard(card, 'player');
        updateUI();
    }
}

function createDominoElement(card, clickable) {
    const div = document.createElement('div');
    div.className = 'domino-card';
    div.innerHTML = `
        <div class="domino-values">
            <span>${card[0]}</span>
            <span class="domino-separator">|</span>
            <span>${card[1]}</span>
        </div>
    `;
    return div;
}

// Настройки
document.getElementById('settingsBtn').onclick = () => {
    const panel = document.getElementById('settingsPanel');
    panel.classList.toggle('hidden');
};

document.getElementById('applySettings').onclick = () => {
    game.settings.stoneType = document.getElementById('stoneType').value;
    game.settings.tableTheme = document.getElementById('tableTheme').value;
    game.settings.botDifficulty = document.getElementById('botDifficulty').value;
    
    const table = document.getElementById('gameTable');
    table.className = `game-table ${game.settings.tableTheme}`;
    
    game.saveSettings();
    document.getElementById('settingsPanel').classList.add('hidden');
    game.resetGame();
    updateUI();
};

document.getElementById('newGameBtn').onclick = () => {
    game.resetGame();
    updateUI();
};

document.getElementById('passBtn').onclick = () => {
    const state = game.getGameState();
    if (state.currentTurn === 'player') {
        game.passes++;
        game.currentTurn = 'bot';
        updateUI();
    }
};

// Загрузка темы при старте
const savedTheme = localStorage.getItem('dominoSettings');
if (savedTheme) {
    const settings = JSON.parse(savedTheme);
    document.getElementById('gameTable').className = `game-table ${settings.tableTheme}`;
}

initGame();

// Telegram WebApp инициализация
const tg = window.Telegram.WebApp;
tg.expand();
tg.ready();