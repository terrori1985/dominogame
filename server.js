const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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
    scores: {},      // Общие очки за все раунды (до 101)
    roundScores: {}, // Очки текущего раунда
    passCount: 0,
    createdAt: Date.now(),
    totalGames: 0
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
    // Сбрасываем очки раунда для каждого игрока
    table.roundScores[p.id] = 0;
  });
  table.boneyard = allTiles;
  table.board = [];
  table.boardEnds = null;
  table.passCount = 0;
  table.currentTurn = 0;

  // Находим игрока с самым большим дублем для первого хода
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
  console.log(`Game dealt, first turn: player ${startIdx}`);
}

function getPublicTable(table) {
  return {
    id: table.id,
    hostName: table.hostName,
    maxPlayers: table.maxPlayers,
    playerCount: table.players.length,
    status: table.status,
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
      score: table.scores[p.id] || 0  // ВАЖНО: передаем общие очки
    })),
    myHand: player.hand || [],
    scores: table.scores,  // ВАЖНО: передаем объект со всеми очками
    hostId: table.hostId,
    totalGames: table.totalGames
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
  if (!player) return { error: 'Player not found' };
  
  const pIdx = table.players.indexOf(player);
  if (pIdx !== table.currentTurn) return { error: 'Not your turn' };

  if (table.boneyard.length === 0) return { error: 'Boneyard empty' };

  // Проверяем, может ли игрок походить
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

// Подсчет очков в конце раунда
function calculateRoundScores(table, winnerId) {
  const roundScores = {};
  let totalPips = 0;
  
  table.players.forEach(p => {
    // Суммируем очки на руках у каждого игрока
    const pips = p.hand.reduce((sum, t) => sum + t[0] + t[1], 0);
    roundScores[p.id] = pips;
    totalPips += pips;
  });

  // Победитель получает сумму очков всех соперников
  if (winnerId) {
    const winnerPoints = totalPips - roundScores[winnerId];
    // Добавляем к общему счету
    table.scores[winnerId] = (table.scores[winnerId] || 0) + winnerPoints;
    console.log(`Winner ${winnerId} gets ${winnerPoints} points. Total: ${table.scores[winnerId]}`);
    return { winner: winnerId, roundScores, totalPips: winnerPoints };
  } 
  // При рыбе - побеждает игрок с наименьшим количеством очков
  else {
    let minPips = Infinity;
    let winner = null;
    table.players.forEach(p => {
      if (roundScores[p.id] < minPips) {
        minPips = roundScores[p.id];
        winner = p.id;
      }
    });
    if (winner) {
      const winnerPoints = totalPips - roundScores[winner];
      table.scores[winner] = (table.scores[winner] || 0) + winnerPoints;
      console.log(`Fish! Winner ${winner} gets ${winnerPoints} points. Total: ${table.scores[winner]}`);
    }
    return { winner, roundScores, totalPips: winnerPoints };
  }
}

// Проверка, не закончилась ли партия (кто-то набрал 101+ очков)
function checkGameEnd(table) {
  for (const player of table.players) {
    if ((table.scores[player.id] || 0) >= 101) {
      return { gameEnd: true, loserId: player.id };
    }
  }
  return { gameEnd: false };
}

// Socket.IO
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on('register', ({ name, avatar, telegramId }) => {
    players.set(socket.id, { id: socket.id, name, avatar, telegramId });
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
    const player = players.get(socket.id);
    if (!player) {
      socket.emit('error', 'Not registered');
      return;
    }

    const table = createTable(socket.id, player.name, maxPlayers || 4);
    table.players.push({ ...player, hand: [], handCount: 0 });
    table.scores[socket.id] = 0;
    table.roundScores[socket.id] = 0;

    socket.join(table.id);
    socket.emit('tableCreated', { tableId: table.id });
    socket.emit('tableState', getTableState(table, socket.id));

    const publicTables = Array.from(tables.values())
      .filter(t => t.status === 'waiting')
      .map(getPublicTable);
    io.emit('tablesUpdate', publicTables);
    console.log(`Table created: ${table.id}`);
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

    table.players.push({ ...player, hand: [], handCount: 0 });
    if (!table.scores[socket.id]) table.scores[socket.id] = 0;
    if (!table.roundScores[socket.id]) table.roundScores[socket.id] = 0;
    socket.join(tableId);

    io.to(tableId).emit('playerJoined', { 
      player: { id: player.id, name: player.name, avatar: player.avatar } 
    });
    io.to(tableId).emit('tableState', getTableState(table, socket.id));

    const publicTables = Array.from(tables.values())
      .filter(t => t.status === 'waiting')
      .map(getPublicTable);
    io.emit('tablesUpdate', publicTables);
    console.log(`Player ${player.name} joined table ${tableId}`);
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
    table.totalGames++;
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
    console.log(`Game started at table ${tableId}`);
  });

  socket.on('playTile', ({ tableId, tileIdx, side }) => {
    const table = tables.get(tableId);
    if (!table) {
      socket.emit('error', 'Table not found');
      return;
    }

    const result = playTile(table, socket.id, tileIdx, side);
    if (result.error) {
      socket.emit('error', result.error);
      return;
    }

    if (result.win) {
      // Раунд закончен, считаем очки
      const { winner, totalPips } = calculateRoundScores(table, socket.id);
      
      // Проверяем, не закончилась ли партия
      const { gameEnd, loserId } = checkGameEnd(table);
      
      if (gameEnd) {
        // Партия закончена (кто-то набрал 101+ очков)
        table.status = 'finished';
        io.to(tableId).emit('gameOver', { 
          winner, 
          scores: table.scores, 
          reason: 'score101',
          totalPips,
          loser: loserId
        });
        console.log(`Game over by score 101! Winner: ${winner}, Loser: ${loserId}`);
      } else {
        // Просто конец раунда, начинаем новый
        io.to(tableId).emit('roundEnd', { winner, scores: table.scores, totalPips });
        // Начинаем новый раунд
        dealTiles(table);
        table.players.forEach(p => {
          const playerSocket = io.sockets.sockets.get(p.id);
          if (playerSocket) {
            playerSocket.emit('gameStarted', getTableState(table, p.id));
          }
        });
      }
    } else {
      // Просто обновляем состояние
      table.players.forEach(p => {
        const playerSocket = io.sockets.sockets.get(p.id);
        if (playerSocket) {
          playerSocket.emit('tableState', getTableState(table, p.id));
        }
      });
      io.to(tableId).emit('tilePlayed', { playerId: socket.id });
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
      // Рыба - считаем очки
      const { winner, totalPips } = calculateRoundScores(table, null);
      
      const { gameEnd, loserId } = checkGameEnd(table);
      
      if (gameEnd) {
        table.status = 'finished';
        io.to(tableId).emit('gameOver', { 
          winner, 
          scores: table.scores, 
          reason: 'score101',
          totalPips,
          loser: loserId
        });
      } else {
        io.to(tableId).emit('roundEnd', { winner, scores: table.scores, totalPips });
        dealTiles(table);
        table.players.forEach(p => {
          const playerSocket = io.sockets.sockets.get(p.id);
          if (playerSocket) {
            playerSocket.emit('gameStarted', getTableState(table, p.id));
          }
        });
      }
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

    // Сбрасываем общие очки для новой партии
    table.players.forEach(p => {
      table.scores[p.id] = 0;
      table.roundScores[p.id] = 0;
    });
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
    console.log(`Rematch started at table ${tableId}, scores reset`);
  });

  socket.on('leaveTable', ({ tableId }) => handleLeave(socket, tableId));
  
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
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
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
