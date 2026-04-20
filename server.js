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

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/health', (req, res) => res.json({ status: 'ok', tables: tables.size, players: players.size }));

const tables = new Map();
const players = new Map();

// ===========================
//   DOMINO SET & SHUFFLE
// ===========================
function createDominoSet() {
  const tiles = [];
  for (let i = 0; i <= 6; i++)
    for (let j = i; j <= 6; j++)
      tiles.push([i, j]);
  return tiles; // 28 tiles
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ===========================
//   TABLE CREATION
// ===========================
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
    scores: {},           // cumulative game scores
    roundScores: {},      // pip counts this round
    passCount: 0,
    consecutivePasses: 0, // for fish detection
    firstMove: true,      // first tile must be a double
    createdAt: Date.now(),
    totalGames: 0,
    chatHistory: []
  };
  tables.set(tableId, table);
  console.log(`[Table] Created ${tableId} by ${hostName} (${maxPlayers}p)`);
  return table;
}

// ===========================
//   DEAL TILES
// ===========================
function dealTiles(table) {
  const all = shuffle(createDominoSet());
  // 2 players: 7 each, 3-4 players: 6 each (leaving more in boneyard)
  const perPlayer = table.players.length === 2 ? 7 : 6;

  table.players.forEach(p => {
    p.hand = all.splice(0, perPlayer);
    p.handCount = p.hand.length;
    table.roundScores[p.id] = 0;
  });
  table.boneyard = all;
  table.board = [];
  table.boardEnds = null;
  table.passCount = 0;
  table.consecutivePasses = 0;
  table.firstMove = true;

  // Determine who goes first: highest double
  // If nobody has a double, player with highest pip sum goes first
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

  // If no doubles were found at all, pick by highest single tile
  if (highestDouble === -1) {
    let highPip = -1;
    table.players.forEach((p, i) => {
      const maxPip = Math.max(...p.hand.map(t => t[0] + t[1]));
      if (maxPip > highPip) { highPip = maxPip; startIdx = i; }
    });
  }

  table.currentTurn = startIdx;
  console.log(`[Game] Dealt. First: player ${startIdx} (highest double: ${highestDouble})`);
}

// ===========================
//   PUBLIC TABLE INFO
// ===========================
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
    firstMove: table.firstMove,
    players: table.players.map(p => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      handCount: p.hand ? p.hand.length : 0,
      score: table.scores[p.id] || 0
    })),
    myHand: player.hand || [],
    scores: table.scores,
    hostId: table.hostId,
    totalGames: table.totalGames,
    chatHistory: table.chatHistory.slice(-50)
  };
}

// ===========================
//   PLAY LOGIC
// ===========================
function canPlayTile(tile, boardEnds) {
  if (!boardEnds) return tile[0] === tile[1]; // First move: must be double
  return tile[0] === boardEnds.left || tile[1] === boardEnds.left ||
    tile[0] === boardEnds.right || tile[1] === boardEnds.right;
}

function canPlayTileAnywhere(tile, boardEnds) {
  if (!boardEnds) return true;
  return tile[0] === boardEnds.left || tile[1] === boardEnds.left ||
    tile[0] === boardEnds.right || tile[1] === boardEnds.right;
}

function playTile(table, playerId, tileIdx, side) {
  const player = table.players.find(p => p.id === playerId);
  if (!player) return { error: 'Игрок не найден' };

  const pIdx = table.players.indexOf(player);
  if (pIdx !== table.currentTurn) return { error: 'Сейчас не ваш ход' };

  const tile = player.hand[tileIdx];
  if (!tile) return { error: 'Неверная кость' };

  // First move rule: must be a double
  if (table.firstMove) {
    if (tile[0] !== tile[1]) return { error: 'Первый ход — только дубль!' };
    player.hand.splice(tileIdx, 1);
    player.handCount = player.hand.length;
    table.board.push({ tile: [...tile], side: 'center' });
    table.boardEnds = { left: tile[0], right: tile[1] };
    table.firstMove = false;
    table.passCount = 0;
    table.consecutivePasses = 0;
    if (player.hand.length === 0) return { win: true, winnerId: playerId };
    table.currentTurn = (table.currentTurn + 1) % table.players.length;
    return { success: true };
  }

  // Normal move
  if (!canPlayTileAnywhere(tile, table.boardEnds)) return { error: 'Эту кость нельзя поставить' };

  player.hand.splice(tileIdx, 1);
  player.handCount = player.hand.length;

  let placed = [...tile];
  if (side === 'left') {
    if (tile[1] === table.boardEnds.left) {
      table.boardEnds.left = tile[0];
    } else {
      placed = [tile[1], tile[0]];
      table.boardEnds.left = tile[1];
    }
    table.board.unshift({ tile: placed, side: 'left' });
  } else {
    if (tile[0] === table.boardEnds.right) {
      table.boardEnds.right = tile[1];
    } else {
      placed = [tile[1], tile[0]];
      table.boardEnds.right = tile[0];
    }
    table.board.push({ tile: placed, side: 'right' });
  }

  table.passCount = 0;
  table.consecutivePasses = 0;

  if (player.hand.length === 0) return { win: true, winnerId: playerId };

  table.currentTurn = (table.currentTurn + 1) % table.players.length;
  return { success: true };
}

function drawFromBoneyard(table, playerId) {
  const player = table.players.find(p => p.id === playerId);
  if (!player) return { error: 'Игрок не найден' };

  const pIdx = table.players.indexOf(player);
  if (pIdx !== table.currentTurn) return { error: 'Сейчас не ваш ход' };
  if (table.boneyard.length === 0) return { error: 'Базар пуст' };

  // Check they can't play any tile
  const canPlayAny = table.firstMove
    ? player.hand.some(t => t[0] === t[1]) // first move check
    : player.hand.some(t => canPlayTileAnywhere(t, table.boardEnds));

  if (canPlayAny) return { error: 'У вас есть ход! Поставьте кость' };

  const drawn = table.boneyard.shift();
  player.hand.push(drawn);
  player.handCount = player.hand.length;
  table.consecutivePasses = 0;

  return { success: true, drawnTile: drawn };
}

function passTurn(table, playerId) {
  const player = table.players.find(p => p.id === playerId);
  if (!player) return { error: 'Игрок не найден' };

  const pIdx = table.players.indexOf(player);
  if (pIdx !== table.currentTurn) return { error: 'Сейчас не ваш ход' };
  if (table.boneyard.length > 0) return { error: 'Сначала возьмите кость из базара' };

  const canPlayAny = table.firstMove
    ? player.hand.some(t => t[0] === t[1])
    : player.hand.some(t => canPlayTileAnywhere(t, table.boardEnds));

  if (canPlayAny) return { error: 'У вас есть ход!' };

  table.consecutivePasses++;
  table.passCount++;
  table.currentTurn = (table.currentTurn + 1) % table.players.length;

  // РЫБА: all players passed consecutively = nobody can play
  if (table.consecutivePasses >= table.players.length) {
    return { blocked: true }; // fish!
  }
  return { success: true };
}

// ===========================
//   SCORING
// ===========================
function calculateRoundScores(table, winnerId) {
  const pipCounts = {};
  let total = 0;

  table.players.forEach(p => {
    const pips = p.hand.reduce((s, t) => s + t[0] + t[1], 0);
    pipCounts[p.id] = pips;
    total += pips;
  });

  let actualWinner = winnerId;

  if (!actualWinner) {
    // Fish: winner = player with fewest pips (ties broken by player order)
    let minPips = Infinity;
    table.players.forEach(p => {
      if (pipCounts[p.id] < minPips) { minPips = pipCounts[p.id]; actualWinner = p.id; }
    });
  }

  if (actualWinner) {
    const pts = total - (pipCounts[actualWinner] || 0);
    table.scores[actualWinner] = (table.scores[actualWinner] || 0) + pts;
    console.log(`[Score] Winner ${actualWinner} +${pts}. Total: ${table.scores[actualWinner]}`);
    return { winner: actualWinner, pipCounts, totalPips: pts };
  }

  return { winner: null, pipCounts, totalPips: 0 };
}

function checkGameEnd(table) {
  // Classic rule: first player to reach 101+ loses (so opponent wins the game)
  // Actually: player who caused someone to reach 101+ wins the GAME
  // Standard domino: first to score 100+ cumulative points across rounds wins
  const TARGET = 101;
  for (const player of table.players) {
    if ((table.scores[player.id] || 0) >= TARGET) {
      // This player "lost" — so we need to find who caused it / has the most
      return { gameEnd: true, loser: player.id };
    }
  }
  return { gameEnd: false };
}

// ===========================
//   SOCKET.IO EVENTS
// ===========================
io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  socket.on('register', ({ name, avatar, telegramId }) => {
    players.set(socket.id, { id: socket.id, name: name || 'Игрок', avatar: avatar || '🎲', telegramId });
    socket.emit('registered', { id: socket.id });
  });

  socket.on('getTables', () => {
    socket.emit('tablesList', Array.from(tables.values()).filter(t => t.status === 'waiting').map(getPublicTable));
  });

  socket.on('createTable', ({ maxPlayers }) => {
    const player = players.get(socket.id);
    if (!player) { socket.emit('error', 'Не зарегистрирован'); return; }
    const table = createTable(socket.id, player.name, maxPlayers || 4);
    table.players.push({ ...player, hand: [], handCount: 0 });
    table.scores[socket.id] = 0;
    socket.join(table.id);
    socket.emit('tableCreated', { tableId: table.id });
    socket.emit('tableState', getTableState(table, socket.id));
    io.emit('tablesUpdate', Array.from(tables.values()).filter(t => t.status === 'waiting').map(getPublicTable));
  });

  socket.on('joinTable', ({ tableId }) => {
    const table = tables.get(tableId);
    if (!table) { socket.emit('error', 'Стол не найден'); return; }
    if (table.status !== 'waiting') { socket.emit('error', 'Игра уже началась'); return; }
    if (table.players.length >= table.maxPlayers) { socket.emit('error', 'Стол полный'); return; }
    const player = players.get(socket.id);
    if (!player) { socket.emit('error', 'Не зарегистрирован'); return; }
    if (table.players.find(p => p.id === socket.id)) {
      socket.join(tableId); socket.emit('tableState', getTableState(table, socket.id)); return;
    }
    table.players.push({ ...player, hand: [], handCount: 0 });
    if (!table.scores[socket.id]) table.scores[socket.id] = 0;
    socket.join(tableId);
    if (table.chatHistory.length > 0) socket.emit('chatHistory', table.chatHistory.slice(-50));
    io.to(tableId).emit('playerJoined', { player: { id: player.id, name: player.name, avatar: player.avatar } });
    io.to(tableId).emit('tableState', getTableState(table, socket.id));
    io.emit('tablesUpdate', Array.from(tables.values()).filter(t => t.status === 'waiting').map(getPublicTable));
  });

  socket.on('chatMessage', ({ tableId, message, playerName }) => {
    const table = tables.get(tableId);
    if (!table) return;
    const msg = { playerName: playerName || 'Игрок', message: String(message).substring(0, 200), timestamp: Date.now() };
    table.chatHistory.push(msg);
    if (table.chatHistory.length > 100) table.chatHistory.shift();
    io.to(tableId).emit('chatMessage', msg);
  });

  socket.on('startGame', ({ tableId }) => {
    const table = tables.get(tableId);
    if (!table) { socket.emit('error', 'Стол не найден'); return; }
    if (table.hostId !== socket.id) { socket.emit('error', 'Только хозяин может начать'); return; }
    if (table.players.length < 2) { socket.emit('error', 'Нужно минимум 2 игрока'); return; }
    table.status = 'playing';
    table.totalGames++;
    // Reset scores for new game
    table.players.forEach(p => { table.scores[p.id] = 0; });
    dealTiles(table);
    table.players.forEach(p => {
      const s = io.sockets.sockets.get(p.id);
      if (s) s.emit('gameStarted', getTableState(table, p.id));
    });
    io.emit('tablesUpdate', Array.from(tables.values()).filter(t => t.status === 'waiting').map(getPublicTable));
    console.log(`[Game] Started at ${tableId} with ${table.players.length} players`);
  });

  socket.on('playTile', ({ tableId, tileIdx, side }) => {
    const table = tables.get(tableId);
    if (!table) { socket.emit('error', 'Стол не найден'); return; }
    const player = table.players.find(p => p.id === socket.id);
    const result = playTile(table, socket.id, tileIdx, side || 'right');
    if (result.error) { socket.emit('error', result.error); return; }

    if (result.win) {
      const { winner, totalPips } = calculateRoundScores(table, socket.id);
      const { gameEnd, loser } = checkGameEnd(table);
      if (gameEnd) {
        table.status = 'finished';
        // Game winner = player with highest score (NOT the loser)
        let gameWinner = null;
        let maxScore = -1;
        table.players.forEach(p => {
          if ((table.scores[p.id] || 0) > maxScore && p.id !== loser) {
            maxScore = table.scores[p.id] || 0; gameWinner = p.id;
          }
        });
        if (!gameWinner) gameWinner = winner;
        io.to(tableId).emit('gameOver', { winner: gameWinner, scores: table.scores, reason: 'score101', totalPips });
      } else {
        io.to(tableId).emit('roundEnd', { winner, scores: table.scores, totalPips });
        dealTiles(table);
        table.players.forEach(p => {
          const s = io.sockets.sockets.get(p.id);
          if (s) s.emit('gameStarted', getTableState(table, p.id));
        });
      }
    } else {
      table.players.forEach(p => {
        const s = io.sockets.sockets.get(p.id);
        if (s) s.emit('tableState', getTableState(table, p.id));
      });
      io.to(tableId).emit('tilePlayed', { playerId: socket.id, playerName: player?.name });
    }
  });

  socket.on('drawTile', ({ tableId }) => {
    const table = tables.get(tableId);
    if (!table) { socket.emit('error', 'Стол не найден'); return; }
    const result = drawFromBoneyard(table, socket.id);
    if (result.error) { socket.emit('error', result.error); return; }
    table.players.forEach(p => {
      const s = io.sockets.sockets.get(p.id);
      if (s) s.emit('tableState', getTableState(table, p.id));
    });
    socket.emit('tileDrawn', { tile: result.drawnTile });
  });

  socket.on('passTurn', ({ tableId }) => {
    const table = tables.get(tableId);
    if (!table) { socket.emit('error', 'Стол не найден'); return; }
    const result = passTurn(table, socket.id);
    if (result.error) { socket.emit('error', result.error); return; }

    if (result.blocked) {
      // РЫБА — nobody can play
      io.to(tableId).emit('fish'); // Special fish announcement
      const { winner, totalPips } = calculateRoundScores(table, null);
      const { gameEnd, loser } = checkGameEnd(table);
      if (gameEnd) {
        table.status = 'finished';
        let gameWinner = null; let maxScore = -1;
        table.players.forEach(p => {
          if ((table.scores[p.id]||0) > maxScore) { maxScore = table.scores[p.id]||0; gameWinner = p.id; }
        });
        io.to(tableId).emit('gameOver', { winner: gameWinner || winner, scores: table.scores, reason: 'score101', totalPips });
      } else {
        io.to(tableId).emit('roundEnd', { winner, scores: table.scores, totalPips, isFish: true });
        dealTiles(table);
        table.players.forEach(p => {
          const s = io.sockets.sockets.get(p.id);
          if (s) s.emit('gameStarted', getTableState(table, p.id));
        });
      }
    } else {
      table.players.forEach(p => {
        const s = io.sockets.sockets.get(p.id);
        if (s) s.emit('tableState', getTableState(table, p.id));
      });
    }
  });

  socket.on('playAgain', ({ tableId }) => {
    const table = tables.get(tableId);
    if (!table) return;
    if (table.hostId !== socket.id) { socket.emit('error', 'Только хозяин может перезапустить'); return; }
    table.players.forEach(p => { table.scores[p.id] = 0; table.roundScores[p.id] = 0; });
    table.status = 'playing';
    dealTiles(table);
    table.players.forEach(p => {
      const s = io.sockets.sockets.get(p.id);
      if (s) s.emit('gameStarted', getTableState(table, p.id));
    });
    console.log(`[Game] Rematch at ${tableId}`);
  });

  socket.on('leaveTable', ({ tableId }) => handleLeave(socket, tableId));

  socket.on('disconnect', () => {
    tables.forEach((table, tableId) => {
      if (table.players.some(p => p.id === socket.id)) handleLeave(socket, tableId);
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
      console.log(`[Table] ${tableId} deleted`);
    } else {
      if (table.hostId === socket.id) {
        table.hostId = table.players[0].id;
        table.hostName = table.players[0].name;
      }
      if (table.status === 'playing' && table.players.length < 2) table.status = 'waiting';
      table.players.forEach(p => {
        const s = io.sockets.sockets.get(p.id);
        if (s) s.emit('tableState', getTableState(table, p.id));
      });
      io.to(tableId).emit('playerLeft', { playerId: socket.id });
    }
    io.emit('tablesUpdate', Array.from(tables.values()).filter(t => t.status === 'waiting').map(getPublicTable));
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`[Server] Running on port ${PORT}`));
