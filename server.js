const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling']
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============ ИГРОВАЯ ЛОГИКА ============
const tables = new Map();

function createDominoSet() {
  const tiles = [];
  for (let i = 0; i <= 6; i++) {
    for (let j = i; j <= 6; j++) {
      tiles.push([i, j]);
    }
  }
  return tiles;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function createTable(hostId, hostName, maxPlayers = 4) {
  const tableId = 'T' + Date.now().toString(36).toUpperCase() + 
                  Math.random().toString(36).substr(2, 4).toUpperCase();
  const table = {
    id: tableId,
    hostId,
    hostName,
    maxPlayers,
    players: [],
    status: 'waiting',
    board: [],
    boardEnds: null,
    boneyard: [],
    currentTurn: 0,
    scores: {},
    passCount: 0,
    chatHistory: []
  };
  tables.set(tableId, table);
  console.log(`Table created: ${tableId} by ${hostName}`);
  return table;
}

function dealTiles(table) {
  const allTiles = shuffle(createDominoSet());
  const perPlayer = table.players.length <= 2 ? 7 : 6;
  
  table.players.forEach(p => {
    p.hand = allTiles.splice(0, perPlayer);
    p.handCount = p.hand.length;
  });
  table.boneyard = allTiles;
  table.board = [];
  table.boardEnds = null;
  table.passCount = 0;

  let startIdx = 0;
  let highestDouble = -1;
  table.players.forEach((p, i) => {
    p.hand.forEach(t => {
      if (t[0] === t[1] && t[0] > highestDouble) {
        highestDouble = t[0];
        startIdx = i;
      }
    });
  });
  table.currentTurn = startIdx;
}

function canPlayTile(tile, boardEnds) {
  if (!boardEnds) return true;
  return tile[0] === boardEnds.left || tile[1] === boardEnds.left ||
         tile[0] === boardEnds.right || tile[1] === boardEnds.right;
}

function playTile(table, playerId, tileIdx, side) {
  const player = table.players.find(p => p.id === playerId);
  const pIdx = table.players.indexOf(player);
  
  if (pIdx !== table.currentTurn) return { error: 'Не ваш ход' };
  
  const tile = player.hand[tileIdx];
  if (!tile) return { error: 'Неверная кость' };
  if (!canPlayTile(tile, table.boardEnds)) return { error: 'Нельзя поставить эту кость' };
  
  player.hand.splice(tileIdx, 1);
  
  if (!table.boardEnds) {
    table.board.push({ tile, side: 'center' });
    table.boardEnds = { left: tile[0], right: tile[1] };
  } else {
    let placedTile = [...tile];
    if (side === 'left') {
      if (tile[1] === table.boardEnds.left) {
        table.boardEnds.left = tile[0];
      } else if (tile[0] === table.boardEnds.left) {
        placedTile = [tile[1], tile[0]];
        table.boardEnds.left = tile[1];
      }
      table.board.unshift({ tile: placedTile, side: 'left' });
    } else {
      if (tile[0] === table.boardEnds.right) {
        table.boardEnds.right = tile[1];
      } else if (tile[1] === table.boardEnds.right) {
        placedTile = [tile[1], tile[0]];
        table.boardEnds.right = tile[0];
      }
      table.board.push({ tile: placedTile, side: 'right' });
    }
  }
  
  table.passCount = 0;
  
  if (player.hand.length === 0) {
    return { win: true, winnerId: playerId };
  }
  
  table.currentTurn = (table.currentTurn + 1) % table.players.length;
  return { success: true };
}

function drawFromBoneyard(table, playerId) {
  const player = table.players.find(p => p.id === playerId);
  const pIdx = table.players.indexOf(player);
  
  if (pIdx !== table.currentTurn) return { error: 'Не ваш ход' };
  if (table.boneyard.length === 0) return { error: 'Бонеярд пуст' };
  
  const canPlay = player.hand.some(t => canPlayTile(t, table.boardEnds));
  if (canPlay) return { error: 'У вас есть ход, поставьте кость' };
  
  const drawn = table.boneyard.shift();
  player.hand.push(drawn);
  return { success: true, drawnTile: drawn };
}

function passTurn(table, playerId) {
  const player = table.players.find(p => p.id === playerId);
  const pIdx = table.players.indexOf(player);
  
  if (pIdx !== table.currentTurn) return { error: 'Не ваш ход' };
  if (table.boneyard.length > 0) return { error: 'Сначала возьмите кость из бонеярда' };
  
  const canPlay = player.hand.some(t => canPlayTile(t, table.boardEnds));
  if (canPlay) return { error: 'У вас есть ход' };
  
  table.passCount++;
  table.currentTurn = (table.currentTurn + 1) % table.players.length;
  
  if (table.passCount >= table.players.length) {
    return { blocked: true };
  }
  return { success: true };
}

function calculateRoundScores(table, winnerId) {
  let totalPips = 0;
  const roundScores = {};
  
  table.players.forEach(p => {
    const pips = p.hand.reduce((sum, t) => sum + t[0] + t[1], 0);
    roundScores[p.id] = pips;
    totalPips += pips;
  });
  
  let winner = winnerId;
  if (!winner) {
    let minPips = Infinity;
    table.players.forEach(p => {
      if (roundScores[p.id] < minPips) {
        minPips = roundScores[p.id];
        winner = p.id;
      }
    });
  }
  
  if (winner) {
    const winnerPoints = totalPips - roundScores[winner];
    table.scores[winner] = (table.scores[winner] || 0) + winnerPoints;
  }
  
  return { winner, totalPips: winnerPoints };
}

function checkGameEnd(table) {
  for (const player of table.players) {
    if ((table.scores[player.id] || 0) >= 101) {
      let winner = null;
      let maxScore = -1;
      for (const p of table.players) {
        if ((table.scores[p.id] || 0) > maxScore) {
          maxScore = table.scores[p.id];
          winner = p.id;
        }
      }
      return { gameEnd: true, winner };
    }
  }
  return { gameEnd: false };
}

function getTableState(table, playerId) {
  const player = table.players.find(p => p.id === playerId);
  if (!player) return null;
  
  return {
    id: table.id,
    status: table.status,
    board: table.board,
    boardEnds: table.boardEnds,
    boneyardCount: table.boneyard.length,
    currentTurn: table.currentTurn,
    currentPlayerId: table.players[table.currentTurn]?.id,
    players: table.players.map(p => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      handCount: p.hand ? p.hand.length : 0,
      score: table.scores[p.id] || 0
    })),
    myHand: player.hand || [],
    scores: table.scores,
    hostId: table.hostId
  };
}

function getPublicTable(table) {
  return {
    id: table.id,
    hostName: table.hostName,
    maxPlayers: table.maxPlayers,
    playerCount: table.players.length,
    status: table.status
  };
}

// ============ SOCKET.IO ============
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  let currentPlayer = null;
  
  socket.on('register', ({ name, avatar }) => {
    currentPlayer = { id: socket.id, name: name || 'Игрок', avatar: avatar || '🎲' };
    socket.emit('registered', { id: socket.id });
    console.log(`Player registered: ${name}`);
  });
  
  socket.on('getTables', () => {
    const publicTables = Array.from(tables.values())
      .filter(t => t.status === 'waiting')
      .map(getPublicTable);
    socket.emit('tablesList', publicTables);
  });
  
  socket.on('createTable', ({ maxPlayers }) => {
    if (!currentPlayer) {
      socket.emit('error', 'Сначала зарегистрируйтесь');
      return;
    }
    
    const table = createTable(socket.id, currentPlayer.name, maxPlayers || 4);
    table.players.push({ ...currentPlayer, hand: [], handCount: 0 });
    table.scores[socket.id] = 0;
    
    socket.join(table.id);
    socket.emit('tableCreated', { tableId: table.id });
    socket.emit('tableState', getTableState(table, socket.id));
    
    broadcastTables();
  });
  
  socket.on('joinTable', ({ tableId }) => {
    const table = tables.get(tableId);
    if (!table) { socket.emit('error', 'Стол не найден'); return; }
    if (table.status !== 'waiting') { socket.emit('error', 'Игра уже началась'); return; }
    if (table.players.length >= table.maxPlayers) { socket.emit('error', 'Стол полон'); return; }
    if (!currentPlayer) { socket.emit('error', 'Сначала зарегистрируйтесь'); return; }
    
    if (table.players.find(p => p.id === socket.id)) {
      socket.join(tableId);
      socket.emit('tableState', getTableState(table, socket.id));
      return;
    }
    
    table.players.push({ ...currentPlayer, hand: [], handCount: 0 });
    if (!table.scores[socket.id]) table.scores[socket.id] = 0;
    socket.join(tableId);
    
    io.to(tableId).emit('playerJoined', { player: { id: currentPlayer.id, name: currentPlayer.name } });
    io.to(tableId).emit('tableState', getTableState(table, socket.id));
    
    broadcastTables();
  });
  
  socket.on('startGame', ({ tableId }) => {
    const table = tables.get(tableId);
    if (!table) return;
    if (table.hostId !== socket.id) { socket.emit('error', 'Только хозяин может начать'); return; }
    if (table.players.length < 2) { socket.emit('error', 'Нужно минимум 2 игрока'); return; }
    
    table.status = 'playing';
    dealTiles(table);
    
    table.players.forEach(p => {
      const playerSocket = io.sockets.sockets.get(p.id);
      if (playerSocket) {
        playerSocket.emit('gameStarted', getTableState(table, p.id));
      }
    });
    
    broadcastTables();
  });
  
  socket.on('playTile', ({ tableId, tileIdx, side }) => {
    const table = tables.get(tableId);
    if (!table) return;
    
    const result = playTile(table, socket.id, tileIdx, side);
    if (result.error) {
      socket.emit('error', result.error);
      return;
    }
    
    const player = table.players.find(p => p.id === socket.id);
    io.to(tableId).emit('tilePlayed', { playerId: socket.id, playerName: player?.name });
    
    if (result.win) {
      const { winner, totalPips } = calculateRoundScores(table, socket.id);
      const { gameEnd, winner: gameWinner } = checkGameEnd(table);
      
      if (gameEnd) {
        table.status = 'finished';
        io.to(tableId).emit('gameOver', { winner: gameWinner, scores: table.scores, reason: 'score101', totalPips });
      } else {
        io.to(tableId).emit('roundEnd', { winner, scores: table.scores, totalPips });
        dealTiles(table);
        table.players.forEach(p => {
          const ps = io.sockets.sockets.get(p.id);
          if (ps) ps.emit('gameStarted', getTableState(table, p.id));
        });
      }
    } else {
      table.players.forEach(p => {
        const ps = io.sockets.sockets.get(p.id);
        if (ps) ps.emit('tableState', getTableState(table, p.id));
      });
    }
  });
  
  socket.on('drawTile', ({ tableId }) => {
    const table = tables.get(tableId);
    if (!table) return;
    
    const result = drawFromBoneyard(table, socket.id);
    if (result.error) {
      socket.emit('error', result.error);
      return;
    }
    
    table.players.forEach(p => {
      const ps = io.sockets.sockets.get(p.id);
      if (ps) ps.emit('tableState', getTableState(table, p.id));
    });
    socket.emit('tileDrawn', { tile: result.drawnTile });
  });
  
  socket.on('passTurn', ({ tableId }) => {
    const table = tables.get(tableId);
    if (!table) return;
    
    const result = passTurn(table, socket.id);
    if (result.error) {
      socket.emit('error', result.error);
      return;
    }
    
    if (result.blocked) {
      const { winner, totalPips } = calculateRoundScores(table, null);
      const { gameEnd, winner: gameWinner } = checkGameEnd(table);
      
      if (gameEnd) {
        table.status = 'finished';
        io.to(tableId).emit('gameOver', { winner: gameWinner, scores: table.scores, reason: 'blocked', totalPips });
      } else {
        io.to(tableId).emit('roundEnd', { winner, scores: table.scores, totalPips });
        dealTiles(table);
        table.players.forEach(p => {
          const ps = io.sockets.sockets.get(p.id);
          if (ps) ps.emit('gameStarted', getTableState(table, p.id));
        });
      }
    } else {
      table.players.forEach(p => {
        const ps = io.sockets.sockets.get(p.id);
        if (ps) ps.emit('tableState', getTableState(table, p.id));
      });
    }
  });
  
  socket.on('playAgain', ({ tableId }) => {
    const table = tables.get(tableId);
    if (!table || table.hostId !== socket.id) return;
    
    table.players.forEach(p => { table.scores[p.id] = 0; });
    table.status = 'playing';
    dealTiles(table);
    
    table.players.forEach(p => {
      const ps = io.sockets.sockets.get(p.id);
      if (ps) ps.emit('gameStarted', getTableState(table, p.id));
    });
  });
  
  socket.on('chatMessage', ({ tableId, message, playerName }) => {
    const table = tables.get(tableId);
    if (!table) return;
    
    const chatMsg = { playerName: playerName || 'Игрок', message: message.substring(0, 200), timestamp: Date.now() };
    table.chatHistory.push(chatMsg);
    if (table.chatHistory.length > 100) table.chatHistory.shift();
    
    io.to(tableId).emit('chatMessage', chatMsg);
  });
  
  socket.on('leaveTable', ({ tableId }) => {
    handleLeave(socket, tableId);
  });
  
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    for (const [tableId, table] of tables) {
      if (table.players.some(p => p.id === socket.id)) {
        handleLeave(socket, tableId);
        break;
      }
    }
  });
  
  function handleLeave(socket, tableId) {
    const table = tables.get(tableId);
    if (!table) return;
    
    table.players = table.players.filter(p => p.id !== socket.id);
    socket.leave(tableId);
    
    if (table.players.length === 0) {
      tables.delete(tableId);
      console.log(`Table ${tableId} deleted`);
    } else {
      if (table.hostId === socket.id) {
        table.hostId = table.players[0].id;
        table.hostName = table.players[0].name;
      }
      if (table.status === 'playing' && table.players.length < 2) {
        table.status = 'waiting';
      }
      
      table.players.forEach(p => {
        const ps = io.sockets.sockets.get(p.id);
        if (ps) ps.emit('tableState', getTableState(table, p.id));
      });
      io.to(tableId).emit('playerLeft', { playerId: socket.id });
    }
    
    broadcastTables();
  }
  
  function broadcastTables() {
    const publicTables = Array.from(tables.values())
      .filter(t => t.status === 'waiting')
      .map(getPublicTable);
    io.emit('tablesUpdate', publicTables);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
