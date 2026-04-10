const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling']
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

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
  const tableId = 'T' + Date.now().toString(36).toUpperCase();
  const table = {
    id: tableId,
    hostId,
    hostName,
    maxPlayers,
    isPrivate,
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

  // Find who has [6,6] or highest double
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
    myHand: player ? player.hand : [],
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

  // Remove from hand
  player.hand.splice(tileIdx, 1);
  player.handCount = player.hand.length;

  // Place on board
  if (!table.boardEnds) {
    table.board.push({ tile, side: 'center', rotation: 0 });
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

  // Check win
  if (player.hand.length === 0) {
    return { win: true, winnerId: playerId };
  }

  // Next turn
  table.currentTurn = (table.currentTurn + 1) % table.players.length;
  return { success: true };
}

function drawFromBoneyard(table, playerId) {
  const player = table.players.find(p => p.id === playerId);
  if (!player) return { error: 'Player not found' };
  const pIdx = table.players.indexOf(player);
  if (pIdx !== table.currentTurn) return { error: 'Not your turn' };

  if (table.boneyard.length === 0) return { error: 'Boneyard empty' };

  // Check if can already play
  if (table.boardEnds && player.hand.some(t => canPlayTile(t, table.boardEnds))) {
    return { error: 'You can play a tile' };
  }

  const drawn = table.boneyard.splice(0, 1)[0];
  player.hand.push(drawn);
  player.handCount = player.hand.length;

  return { success: true, drawnTile: drawn };
}

function passTurn(table, playerId) {
  const player = table.players.find(p => p.id === playerId);
  if (!player) return { error: 'Player not found' };
  const pIdx = table.players.indexOf(player);
  if (pIdx !== table.currentTurn) return { error: 'Not your turn' };

  // Can only pass if boneyard empty and can't play
  if (table.boneyard.length > 0) return { error: 'Draw from boneyard first' };
  if (player.hand.some(t => canPlayTile(t, table.boardEnds))) return { error: 'You can play' };

  table.passCount++;
  table.currentTurn = (table.currentTurn + 1) % table.players.length;

  if (table.passCount >= table.players.length) {
    // Blocked game - count pips
    return { blocked: true };
  }
  return { success: true };
}

function calculateScores(table, winnerId) {
  const scores = {};
  table.players.forEach(p => {
    const pips = p.hand.reduce((sum, t) => sum + t[0] + t[1], 0);
    scores[p.id] = pips;
    if (!table.scores[p.id]) table.scores[p.id] = 0;
  });

  if (winnerId) {
    const totalPips = Object.values(scores).reduce((a, b) => a + b, 0);
    table.scores[winnerId] = (table.scores[winnerId] || 0) + totalPips;
  } else {
    // Blocked - lowest pip count wins
    let minPips = Infinity;
    let winner = null;
    table.players.forEach(p => {
      if (scores[p.id] < minPips) {
        minPips = scores[p.id];
        winner = p.id;
      }
    });
    const totalPips = Object.values(scores).reduce((a, b) => a + b, 0);
    if (winner) table.scores[winner] = (table.scores[winner] || 0) + totalPips;
    return { winner, scores };
  }
  return { winner: winnerId, scores };
}

// Socket.IO
io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  socket.on('register', ({ name, avatar, telegramId }) => {
    players.set(socket.id, { id: socket.id, name, avatar, telegramId });
    socket.emit('registered', { id: socket.id });
  });

  socket.on('getTables', () => {
    const publicTables = Array.from(tables.values())
      .filter(t => !t.isPrivate && t.status === 'waiting')
      .map(getPublicTable);
    socket.emit('tablesList', publicTables);
  });

  socket.on('createTable', ({ maxPlayers, isPrivate }) => {
    const player = players.get(socket.id);
    if (!player) return socket.emit('error', 'Not registered');

    const table = createTable(socket.id, player.name, maxPlayers || 4, isPrivate || false);
    table.players.push({ ...player, hand: [], handCount: 0, isActive: true });
    table.scores[socket.id] = 0;

    socket.join(table.id);
    socket.emit('tableCreated', { tableId: table.id });
    socket.emit('tableState', getTableState(table, socket.id));

    io.emit('tablesUpdate', Array.from(tables.values())
      .filter(t => !t.isPrivate && t.status === 'waiting')
      .map(getPublicTable));
  });

  socket.on('joinTable', ({ tableId }) => {
    const table = tables.get(tableId);
    if (!table) return socket.emit('error', 'Table not found');
    if (table.status !== 'waiting') return socket.emit('error', 'Game already started');
    if (table.players.length >= table.maxPlayers) return socket.emit('error', 'Table full');

    const player = players.get(socket.id);
    if (!player) return socket.emit('error', 'Not registered');

    if (table.players.find(p => p.id === socket.id)) {
      socket.join(tableId);
      socket.emit('tableState', getTableState(table, socket.id));
      return;
    }

    table.players.push({ ...player, hand: [], handCount: 0, isActive: true });
    table.scores[socket.id] = 0;
    socket.join(tableId);

    io.to(tableId).emit('playerJoined', { player: { id: player.id, name: player.name, avatar: player.avatar } });
    io.to(tableId).emit('tableState', getTableState(table, socket.id));

    io.emit('tablesUpdate', Array.from(tables.values())
      .filter(t => !t.isPrivate && t.status === 'waiting')
      .map(getPublicTable));
  });

  socket.on('startGame', ({ tableId }) => {
    const table = tables.get(tableId);
    if (!table) return socket.emit('error', 'Table not found');
    if (table.hostId !== socket.id) return socket.emit('error', 'Not host');
    if (table.players.length < 2) return socket.emit('error', 'Need at least 2 players');

    table.status = 'playing';
    dealTiles(table);

    table.players.forEach(p => {
      const pSocket = [...io.sockets.sockets.values()].find(s => s.id === p.id);
      if (pSocket) pSocket.emit('gameStarted', getTableState(table, p.id));
    });

    io.emit('tablesUpdate', Array.from(tables.values())
      .filter(t => !t.isPrivate && t.status === 'waiting')
      .map(getPublicTable));
  });

  socket.on('playTile', ({ tableId, tileIdx, side }) => {
    const table = tables.get(tableId);
    if (!table) return socket.emit('error', 'Table not found');

    const result = playTile(table, socket.id, tileIdx, side || 'right');
    if (result.error) return socket.emit('error', result.error);

    if (result.win) {
      const { winner, scores } = calculateScores(table, socket.id);
      table.status = 'finished';
      io.to(tableId).emit('gameOver', { winner, scores, reason: 'domino' });
    } else {
      table.players.forEach(p => {
        const pSocket = [...io.sockets.sockets.values()].find(s => s.id === p.id);
        if (pSocket) pSocket.emit('tableState', getTableState(table, p.id));
      });
      io.to(tableId).emit('tilePlayed', {
        playerId: socket.id,
        playerName: table.players.find(p => p.id === socket.id)?.name
      });
    }
  });

  socket.on('drawTile', ({ tableId }) => {
    const table = tables.get(tableId);
    if (!table) return socket.emit('error', 'Table not found');

    const result = drawFromBoneyard(table, socket.id);
    if (result.error) return socket.emit('error', result.error);

    table.players.forEach(p => {
      const pSocket = [...io.sockets.sockets.values()].find(s => s.id === p.id);
      if (pSocket) pSocket.emit('tableState', getTableState(table, p.id));
    });
    socket.emit('tileDrawn', { tile: result.drawnTile });
  });

  socket.on('passTurn', ({ tableId }) => {
    const table = tables.get(tableId);
    if (!table) return socket.emit('error', 'Table not found');

    const result = passTurn(table, socket.id);
    if (result.error) return socket.emit('error', result.error);

    if (result.blocked) {
      const { winner, scores } = calculateScores(table, null);
      table.status = 'finished';
      io.to(tableId).emit('gameOver', { winner, scores, reason: 'blocked' });
    } else {
      table.players.forEach(p => {
        const pSocket = [...io.sockets.sockets.values()].find(s => s.id === p.id);
        if (pSocket) pSocket.emit('tableState', getTableState(table, p.id));
      });
    }
  });

  socket.on('playAgain', ({ tableId }) => {
    const table = tables.get(tableId);
    if (!table) return;
    if (table.hostId !== socket.id) return socket.emit('error', 'Not host');

    table.status = 'playing';
    table.board = [];
    table.boardEnds = null;
    dealTiles(table);

    table.players.forEach(p => {
      const pSocket = [...io.sockets.sockets.values()].find(s => s.id === p.id);
      if (pSocket) pSocket.emit('gameStarted', getTableState(table, p.id));
    });
  });

  socket.on('leaveTable', ({ tableId }) => {
    handleLeave(socket, tableId);
  });

  socket.on('disconnect', () => {
    players.forEach((p, id) => {
      if (id === socket.id) {
        tables.forEach((table, tableId) => {
          if (table.players.find(p => p.id === socket.id)) {
            handleLeave(socket, tableId);
          }
        });
        players.delete(id);
      }
    });
  });

  function handleLeave(socket, tableId) {
    const table = tables.get(tableId);
    if (!table) return;

    table.players = table.players.filter(p => p.id !== socket.id);
    socket.leave(tableId);

    if (table.players.length === 0) {
      tables.delete(tableId);
    } else {
      if (table.hostId === socket.id) {
        table.hostId = table.players[0].id;
        table.hostName = table.players[0].name;
      }
      if (table.status === 'playing') {
        if (table.currentTurn >= table.players.length) {
          table.currentTurn = 0;
        }
        table.players.forEach(p => {
          const pSocket = [...io.sockets.sockets.values()].find(s => s.id === p.id);
          if (pSocket) pSocket.emit('tableState', getTableState(table, p.id));
        });
        io.to(tableId).emit('playerLeft', { playerId: socket.id });
      }
    }

    io.emit('tablesUpdate', Array.from(tables.values())
      .filter(t => !t.isPrivate && t.status === 'waiting')
      .map(getPublicTable));
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Domino server running on port ${PORT}`);
});
