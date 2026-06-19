const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const { RoomManager } = require('./src/roomManager');
const { validateSolution } = require('./src/validator');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 4396;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const roomManager = new RoomManager();

function sendToClient(ws, type, data) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type, data }));
  }
}

function broadcastToRoom(roomId, type, data, excludeWs = null) {
  const room = roomManager.getRoom(roomId);
  if (!room) return;
  const message = JSON.stringify({ type, data });
  for (const player of room.players) {
    if (player.ws && player.ws !== excludeWs && player.ws.readyState === player.ws.OPEN) {
      player.ws.send(message);
    }
  }
}

wss.on('connection', (ws) => {
  let currentRoomId = null;
  let currentPlayerId = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }
    const { type, data } = msg;

    switch (type) {
      case 'CREATE_ROOM': {
        const { playerName } = data;
        const room = roomManager.createRoom();
        const player = roomManager.addPlayer(room.id, playerName, ws);
        currentRoomId = room.id;
        currentPlayerId = player.id;
        sendToClient(ws, 'ROOM_CREATED', {
          roomId: room.id,
          playerId: player.id,
          role: player.role,
          players: room.getPublicPlayers()
        });
        break;
      }

      case 'JOIN_ROOM': {
        const { roomId, playerName } = data;
        const room = roomManager.getRoom(roomId);
        if (!room) {
          sendToClient(ws, 'ERROR', { message: '房间不存在' });
          return;
        }
        if (room.getPlayerCount() >= 2) {
          sendToClient(ws, 'ERROR', { message: '房间已满' });
          return;
        }
        const player = roomManager.addPlayer(roomId, playerName, ws);
        currentRoomId = roomId;
        currentPlayerId = player.id;
        sendToClient(ws, 'ROOM_JOINED', {
          roomId: room.id,
          playerId: player.id,
          role: player.role,
          players: room.getPublicPlayers(),
          puzzle: room.puzzle ? {
            base: room.puzzle.base,
            expression: room.puzzle.expression,
            uniqueLetters: room.puzzle.uniqueLetters
          } : null,
          gameState: room.state
        });
        broadcastToRoom(roomId, 'PLAYER_JOINED', {
          players: room.getPublicPlayers()
        }, ws);
        break;
      }

      case 'SET_PUZZLE': {
        const { base, expression } = data;
        const room = roomManager.getRoom(currentRoomId);
        if (!room) return;
        const player = room.getPlayer(currentPlayerId);
        if (!player || player.role !== 'A') {
          sendToClient(ws, 'ERROR', { message: '只有出题人可以设置题目' });
          return;
        }
        const letters = [...new Set(expression.toUpperCase().match(/[A-Z]/g) || [])];
        if (letters.length > base) {
          sendToClient(ws, 'ERROR', { message: `不同字母数量(${letters.length})不能超过进制(${base})` });
          return;
        }
        room.setPuzzle(base, expression, letters);
        broadcastToRoom(currentRoomId, 'PUZZLE_SET', {
          base,
          expression,
          uniqueLetters: letters,
          gameState: room.state
        });
        break;
      }

      case 'START_GAME': {
        const room = roomManager.getRoom(currentRoomId);
        if (!room) return;
        const player = room.getPlayer(currentPlayerId);
        if (!player || player.role !== 'A') {
          sendToClient(ws, 'ERROR', { message: '只有出题人可以开始游戏' });
          return;
        }
        if (!room.puzzle) {
          sendToClient(ws, 'ERROR', { message: '请先设置题目' });
          return;
        }
        if (room.getPlayerCount() < 2) {
          sendToClient(ws, 'ERROR', { message: '需要2名玩家才能开始' });
          return;
        }
        room.startGame();
        broadcastToRoom(currentRoomId, 'GAME_STARTED', {
          startTime: room.startTime,
          gameState: room.state
        });
        break;
      }

      case 'SUBMIT_SOLUTION': {
        const { mapping } = data;
        const room = roomManager.getRoom(currentRoomId);
        if (!room || room.state !== 'playing') return;
        const player = room.getPlayer(currentPlayerId);
        if (!player || player.role !== 'B') {
          sendToClient(ws, 'ERROR', { message: '只有解题人可以提交答案' });
          return;
        }
        const result = validateSolution(room.puzzle.base, room.puzzle.expression, mapping);
        if (result.valid) {
          const solveTime = Date.now() - room.startTime;
          room.completeGame(solveTime, currentPlayerId);
          broadcastToRoom(currentRoomId, 'SOLUTION_CORRECT', {
            solveTime,
            winnerId: currentPlayerId,
            mapping,
            gameState: room.state
          });
        } else {
          sendToClient(ws, 'SOLUTION_INCORRECT', {
            reason: result.reason
          });
        }
        break;
      }

      case 'TIME_UPDATE': {
        const room = roomManager.getRoom(currentRoomId);
        if (room && room.state === 'playing') {
          const elapsed = Date.now() - room.startTime;
          broadcastToRoom(currentRoomId, 'TIME_SYNC', { elapsed });
        }
        break;
      }

      case 'RESET_GAME': {
        const room = roomManager.getRoom(currentRoomId);
        if (!room) return;
        room.resetGame();
        broadcastToRoom(currentRoomId, 'GAME_RESET', {
          gameState: room.state,
          players: room.getPublicPlayers()
        });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (currentRoomId && currentPlayerId) {
      const room = roomManager.getRoom(currentRoomId);
      if (room) {
        roomManager.removePlayer(currentRoomId, currentPlayerId);
        if (room.getPlayerCount() === 0) {
          roomManager.removeRoom(currentRoomId);
        } else {
          broadcastToRoom(currentRoomId, 'PLAYER_LEFT', {
            players: room.getPublicPlayers()
          });
        }
      }
    }
  });
});

app.get('/api/rooms/:roomId', (req, res) => {
  const room = roomManager.getRoom(req.params.roomId);
  if (!room) {
    return res.status(404).json({ error: '房间不存在' });
  }
  res.json({
    roomId: room.id,
    playerCount: room.getPlayerCount(),
    gameState: room.state,
    players: room.getPublicPlayers()
  });
});

server.listen(PORT, () => {
  console.log(`虫食算游戏服务器已启动: http://localhost:${PORT}`);
});
