const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Настройка Socket.IO
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000
});

// Middleware
app.use(express.json());
// ВАЖНО: указываем правильную директорию для статических файлов
app.use(express.static(path.join(__dirname, 'public')));

// Для отладки - выводим путь к статическим файлам
console.log('Static files served from:', path.join(__dirname, 'public'));

// Главный маршрут - отдаем index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    tables: tables.size,
    players: players.size,
    uptime: process.uptime(),
    staticPath: path.join(__dirname, 'public')
  });
});

// Game state
const tables = new Map();
const players = new Map();

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
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function createTable(hostId, hostName, maxPlayers = 4, isPrivate = false) {
  const tableId = 'T' + Date.now().toString(36).toUpperCase() + 
                  Math.random().toString(36).substr(2, 4).toUpperCase();
  const table = {
    id: tableId,
    hostId,
    hostName,
    maxPlayers,
    isPrivate: false, // Все столы публичные для тестирования
    players: [],
    status: 'waiting',
    board: [],
    boardEnds: null,
    boneyard: [],
    currentTurn: 0,
    scores: {},
    passCount: 0,
    createdAt: Date.now()
  };
  tables.set(tableId, table);
  console.log(`✅ Table created: ${tableId} by ${hostName}`);
  return table;
}

function dealTiles(table) {
  const allTiles = shuffle(createDominoSet());
  const perPlayer = table.players.length <= 2 ? 7 : 6;
  
  table.players.forEach((p, i) => {
    p.hand = allTiles.splice(0, perPlayer);
    p.handCount = p.hand.length;
  });
  table.boneyard = allTiles;
  table.board = [];
  table.boardEnds = null;
  table.passCount = 0;
  table.currentTurn = 0;

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

function getPublicTable(table) {
  return {
    id: table.id,
    hostName: table.hostName,
    maxPlayers: table.maxPlayers,
    playerCount: table.players.length,
    status: table.status,
    isPrivate: table.isPrivate,
    createdAt: table.createdAt
  };
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
      score: table.scores[p.id] || 0,
      isActive: p.isActive
    })),
    myHand: player.hand || [],
    scores: table.scores,
    hostId: table.hostId
  };
}

function canPlayTile(tile, boardEnds) {
  if (!boardEnds) return true;
  return tile[0] === boardEnds.left || tile[1] === boardEnds.left ||
         tile[0] === boardEnds.right || tile[1] === boardEnds.right;
}

function playTile(table, playerId, tileIdx, side) {
  const player = table.players.find(p => p.id === playerId);
  if (!player) return { error: 'Player not found' };

  const pIdx = table.players.indexOf(player);
  if (pIdx !== table.currentTurn) return { error: 'Not your turn' };

  const tile = player.hand[tileIdx];
  if (!tile) return { error: 'Invalid tile' };

  if (!canPlayTile(tile, table.boardEnds)) return { error: 'Cannot play this tile' };

  player.hand.splice(tileIdx, 1);
  player.handCount = player.hand.length;

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
      } else {
        return { error: 'Tile does not match left end' };
      }
      table.board.unshift({ tile: placedTile, side: 'left' });
    } else {
      if (tile[0] === table.boardEnds.right) {
        table.boardEnds.right = tile[1];
      } else if (tile[1] === table.boardEnds.right) {
        placedTile = [tile[1], tile[0]];
        table.boardEnds.right = tile[0];
      } else {
        return { error: 'Tile does not match right end' };
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
  if (!player) return { error: 'Player not found' };
  
  const pIdx = table.players.indexOf(player);
  if (pIdx !== table.currentTurn) return { error: 'Not your turn' };

  if (table.boneyard.length === 0) return { error: 'Boneyard empty' };

  if (table.boardEnds && player.hand.some(t => canPlayTile(t, table.boardEnds))) {
    return { error: 'You have a playable tile' };
  }

  const drawn = table.boneyard.shift();
  player.hand.push(drawn);
  player.handCount = player.hand.length;

  return { success: true, drawnTile: drawn };
}

function passTurn(table, playerId) {
  const player = table.players.find(p => p.id === playerId);
  if (!player) return { error: 'Player not found' };
  
  const pIdx = table.players.indexOf(player);
  if (pIdx !== table.currentTurn) return { error: 'Not your turn' };

  if (table.boneyard.length > 0) return { error: 'Draw from boneyard first' };
  if (player.hand.some(t => canPlayTile(t, table.boardEnds))) return { error: 'You have a playable tile' };

  table.passCount++;
  table.currentTurn = (table.currentTurn + 1) % table.players.length;

  if (table.passCount >= table.players.length) {
    return { blocked: true };
  }
  return { success: true };
}

function calculateScores(table, winnerId) {
  const scores = {};
  let totalPips = 0;
  
  table.players.forEach(p => {
    const pips = p.hand.reduce((sum, t) => sum + t[0] + t[1], 0);
    scores[p.id] = pips;
    totalPips += pips;
    if (!table.scores[p.id]) table.scores[p.id] = 0;
  });

  if (winnerId) {
    table.scores[winnerId] = (table.scores[winnerId] || 0) + totalPips;
    return { winner: winnerId, scores };
  } else {
    let minPips = Infinity;
    let winner = null;
    table.players.forEach(p => {
      if (scores[p.id] < minPips) {
        minPips = scores[p.id];
        winner = p.id;
      }
    });
    if (winner) table.scores[winner] = (table.scores[winner] || 0) + totalPips;
    return { winner, scores };
  }
}

// Socket.IO
io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  socket.on('register', ({ name, avatar, telegramId }) => {
    const player = { 
      id: socket.id, 
      name: name || 'Игрок', 
      avatar: avatar || '🎲', 
      telegramId: telegramId || null 
    };
    players.set(socket.id, player);
    socket.emit('registered', { id: socket.id });
    console.log(`📝 Player registered: ${name} (${socket.id})`);
  });

  socket.on('getTables', () => {
    const publicTables = Array.from(tables.values())
      .filter(t => t.status === 'waiting')
      .map(getPublicTable);
    socket.emit('tablesList', publicTables);
    console.log(`📋 Sent ${publicTables.length} tables to ${socket.id}`);
  });

  socket.on('createTable', ({ maxPlayers, isPrivate }) => {
    const player = players.get(socket.id);
    if (!player) {
      socket.emit('error', 'Not registered');
      return;
    }

    const table = createTable(socket.id, player.name, maxPlayers || 4, false);
    table.players.push({ 
      ...player, 
      hand: [], 
      handCount: 0, 
      isActive: true 
    });
    table.scores[socket.id] = 0;

    socket.join(table.id);
    socket.emit('tableCreated', { tableId: table.id });
    socket.emit('tableState', getTableState(table, socket.id));

    const publicTables = Array.from(tables.values())
      .filter(t => t.status === 'waiting')
      .map(getPublicTable);
    io.emit('tablesUpdate', publicTables);
    
    console.log(`✨ Table created: ${table.id} by ${player.name}`);
    console.log(`📊 Total tables: ${tables.size}`);
  });

  socket.on('joinTable', ({ tableId }) => {
    const table = tables.get(tableId);
    if (!table) {
      socket.emit('error', 'Table not found');
      return;
    }
    if (table.status !== 'waiting') {
      socket.emit('error', 'Game already started');
      return;
    }
    if (table.players.length >= table.maxPlayers) {
      socket.emit('error', 'Table full');
      return;
    }

    const player = players.get(socket.id);
    if (!player) {
      socket.emit('error', 'Not registered');
      return;
    }

    if (table.players.find(p => p.id === socket.id)) {
      socket.join(tableId);
      socket.emit('tableState', getTableState(table, socket.id));
      return;
    }

    table.players.push({ 
      ...player, 
      hand: [], 
      handCount: 0, 
      isActive: true 
    });
    table.scores[socket.id] = 0;
    socket.join(tableId);

    io.to(tableId).emit('playerJoined', { 
      player: { id: player.id, name: player.name, avatar: player.avatar } 
    });
    io.to(tableId).emit('tableState', getTableState(table, socket.id));

    const publicTables = Array.from(tables.values())
      .filter(t => t.status === 'waiting')
      .map(getPublicTable);
    io.emit('tablesUpdate', publicTables);
    
    console.log(`👤 Player ${player.name} joined table ${tableId}`);
  });

  socket.on('startGame', ({ tableId }) => {
    const table = tables.get(tableId);
    if (!table) {
      socket.emit('error', 'Table not found');
      return;
    }
    if (table.hostId !== socket.id) {
      socket.emit('error', 'Not host');
      return;
    }
    if (table.players.length < 2) {
      socket.emit('error', 'Need at least 2 players');
      return;
    }

    table.status = 'playing';
    dealTiles(table);

    table.players.forEach(p => {
      const playerSocket = io.sockets.sockets.get(p.id);
      if (playerSocket) {
        playerSocket.emit('gameStarted', getTableState(table, p.id));
      }
    });

    const publicTables = Array.from(tables.values())
      .filter(t => t.status === 'waiting')
      .map(getPublicTable);
    io.emit('tablesUpdate', publicTables);
    
    console.log(`🎮 Game started at table ${tableId}`);
  });

  socket.on('playTile', ({ tableId, tileIdx, side }) => {
    const table = tables.get(tableId);
    if (!table) {
      socket.emit('error', 'Table not found');
      return;
    }

    const result = playTile(table, socket.id, tileIdx, side || 'right');
    if (result.error) {
      socket.emit('error', result.error);
      return;
    }

    if (result.win) {
      const { winner, scores } = calculateScores(table, socket.id);
      table.status = 'finished';
      io.to(tableId).emit('gameOver', { winner, scores, reason: 'domino' });
      console.log(`🏆 Game over at table ${tableId}, winner: ${winner}`);
    } else {
      table.players.forEach(p => {
        const playerSocket = io.sockets.sockets.get(p.id);
        if (playerSocket) {
          playerSocket.emit('tableState', getTableState(table, p.id));
        }
      });
      io.to(tableId).emit('tilePlayed', {
        playerId: socket.id,
        playerName: table.players.find(p => p.id === socket.id)?.name
      });
    }
  });

  socket.on('drawTile', ({ tableId }) => {
    const table = tables.get(tableId);
    if (!table) {
      socket.emit('error', 'Table not found');
      return;
    }

    const result = drawFromBoneyard(table, socket.id);
    if (result.error) {
      socket.emit('error', result.error);
      return;
    }

    table.players.forEach(p => {
      const playerSocket = io.sockets.sockets.get(p.id);
      if (playerSocket) {
        playerSocket.emit('tableState', getTableState(table, p.id));
      }
    });
    socket.emit('tileDrawn', { tile: result.drawnTile });
  });

  socket.on('passTurn', ({ tableId }) => {
    const table = tables.get(tableId);
    if (!table) {
      socket.emit('error', 'Table not found');
      return;
    }

    const result = passTurn(table, socket.id);
    if (result.error) {
      socket.emit('error', result.error);
      return;
    }

    if (result.blocked) {
      const { winner, scores } = calculateScores(table, null);
      table.status = 'finished';
      io.to(tableId).emit('gameOver', { winner, scores, reason: 'blocked' });
      console.log(`🚫 Game blocked at table ${tableId}`);
    } else {
      table.players.forEach(p => {
        const playerSocket = io.sockets.sockets.get(p.id);
        if (playerSocket) {
          playerSocket.emit('tableState', getTableState(table, p.id));
        }
      });
    }
  });

  socket.on('playAgain', ({ tableId }) => {
    const table = tables.get(tableId);
    if (!table) return;
    if (table.hostId !== socket.id) {
      socket.emit('error', 'Not host');
      return;
    }

    table.status = 'playing';
    table.board = [];
    table.boardEnds = null;
    dealTiles(table);

    table.players.forEach(p => {
      const playerSocket = io.sockets.sockets.get(p.id);
      if (playerSocket) {
        playerSocket.emit('gameStarted', getTableState(table, p.id));
      }
    });
  });

  socket.on('leaveTable', ({ tableId }) => {
    handleLeave(socket, tableId);
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
    
    tables.forEach((table, tableId) => {
      if (table.players.some(p => p.id === socket.id)) {
        handleLeave(socket, tableId);
      }
    });
    
    players.delete(socket.id);
  });

  function handleLeave(socket, tableId) {
    const table = tables.get(tableId);
    if (!table) return;

    const leavingPlayer = table.players.find(p => p.id === socket.id);
    if (!leavingPlayer) return;

    table.players = table.players.filter(p => p.id !== socket.id);
    socket.leave(tableId);

    if (table.players.length === 0) {
      tables.delete(tableId);
      console.log(`🗑️ Table ${tableId} deleted`);
    } else {
      if (table.hostId === socket.id) {
        table.hostId = table.players[0].id;
        table.hostName = table.players[0].name;
      }
      
      if (table.status === 'playing') {
        if (table.currentTurn >= table.players.length) {
          table.currentTurn = 0;
        }
        
        if (table.players.length < 2) {
          table.status = 'waiting';
        }
      }
      
      table.players.forEach(p => {
        const playerSocket = io.sockets.sockets.get(p.id);
        if (playerSocket) {
          playerSocket.emit('tableState', getTableState(table, p.id));
        }
      });
      io.to(tableId).emit('playerLeft', { playerId: socket.id });
    }

    const publicTables = Array.from(tables.values())
      .filter(t => t.status === 'waiting')
      .map(getPublicTable);
    io.emit('tablesUpdate', publicTables);
    
    console.log(`👋 Player ${leavingPlayer.name} left`);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════════════╗
║                                                   ║
║      🎲 DOMINO SERVER STARTED 🎲                  ║
║                                                   ║
║   Port: ${PORT}                                      ║
║   URL: http://localhost:${PORT}                    ║
║                                                   ║
╚═══════════════════════════════════════════════════╝
  `);
});
