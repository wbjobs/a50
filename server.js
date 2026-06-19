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
  const all = room.getAllConnected();
  for (const player of all) {
    if (player.ws && player.ws !== excludeWs && player.ws.readyState === player.ws.OPEN) {
      player.ws.send(message);
    }
  }
}

wss.on('connection', (ws) => {
  let currentRoomId = null;
  let currentPlayerId = null;
  let isSpectator = false;

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
        isSpectator = false;
        sendToClient(ws, 'ROOM_CREATED', {
          roomId: room.id,
          playerId: player.id,
          role: player.role,
          isSpectator: false,
          players: room.getPublicPlayers(),
          spectatorCount: room.getSpectatorCount()
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
        isSpectator = false;
        sendToClient(ws, 'ROOM_JOINED', {
          roomId: room.id,
          playerId: player.id,
          role: player.role,
          isSpectator: false,
          players: room.getPublicPlayers(),
          spectatorCount: room.getSpectatorCount(),
          puzzle: room.puzzle ? {
            base: room.puzzle.base,
            expression: room.puzzle.expression,
            uniqueLetters: room.puzzle.uniqueLetters
          } : null,
          gameState: room.state,
          submissions: room.submissions.map(s => ({
            mapping: s.mapping,
            elapsedMs: s.elapsedMs,
            valid: s.valid
          }))
        });
        broadcastToRoom(roomId, 'PLAYER_JOINED', {
          players: room.getPublicPlayers(),
          spectatorCount: room.getSpectatorCount()
        }, ws);
        break;
      }

      case 'SPECTATE_ROOM': {
        const { roomId, playerName } = data;
        const room = roomManager.getRoom(roomId);
        if (!room) {
          sendToClient(ws, 'ERROR', { message: '房间不存在' });
          return;
        }
        const spectator = roomManager.addSpectator(roomId, playerName || '观战者', ws);
        currentRoomId = roomId;
        currentPlayerId = spectator.id;
        isSpectator = true;
        sendToClient(ws, 'SPECTATE_JOINED', {
          roomId: room.id,
          playerId: spectator.id,
          role: 'spectator',
          isSpectator: true,
          players: room.getPublicPlayers(),
          spectatorCount: room.getSpectatorCount(),
          puzzle: room.puzzle ? {
            base: room.puzzle.base,
            expression: room.puzzle.expression,
            uniqueLetters: room.puzzle.uniqueLetters
          } : null,
          gameState: room.state,
          submissions: room.submissions.map(s => ({
            mapping: s.mapping,
            elapsedMs: s.elapsedMs,
            valid: s.valid,
            errorInfo: s.errorInfo
          })),
          solveTime: room.solveTime,
          winnerId: room.winnerId,
          difficultyRating: room.difficultyRating
        });
        broadcastToRoom(roomId, 'SPECTATOR_UPDATED', {
          spectatorCount: room.getSpectatorCount()
        }, ws);
        break;
      }

      case 'SET_PUZZLE': {
        if (isSpectator) return;
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
          gameState: room.state,
          spectatorCount: room.getSpectatorCount()
        });
        break;
      }

      case 'START_GAME': {
        if (isSpectator) return;
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
          gameState: room.state,
          spectatorCount: room.getSpectatorCount()
        });
        break;
      }

      case 'SUBMIT_SOLUTION': {
        if (isSpectator) return;
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
          room.addSubmission(mapping, true, null);
          room.completeGame(solveTime, currentPlayerId);
          broadcastToRoom(currentRoomId, 'SOLUTION_CORRECT', {
            solveTime,
            winnerId: currentPlayerId,
            mapping,
            gameState: room.state,
            difficultyRating: room.difficultyRating,
            totalSubmissions: room.submissions.length,
            spectatorCount: room.getSpectatorCount()
          });
        } else {
          const errorInfo = {
            reason: result.reason,
            errorLetters: result.errorLetters || [],
            errorType: result.errorType || 'unknown',
            column: result.column,
            columnName: result.columnName,
            expectedDigit: result.expectedDigit,
            actualDigit: result.actualDigit,
            problemLetter: result.problemLetter,
            leftValue: result.leftValue,
            rightValue: result.rightValue
          };
          room.addSubmission(mapping, false, errorInfo);
          const subIndex = room.submissions.length;
          sendToClient(ws, 'SOLUTION_INCORRECT', {
            ...errorInfo,
            submissionIndex: subIndex,
            totalSubmissions: subIndex
          });
          broadcastToRoom(currentRoomId, 'SUBMISSION_LOGGED', {
            submissionIndex: subIndex,
            totalSubmissions: subIndex,
            mapping,
            valid: false,
            elapsedMs: room.submissions[room.submissions.length - 1].elapsedMs
          }, ws);
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
        if (isSpectator) return;
        const room = roomManager.getRoom(currentRoomId);
        if (!room) return;
        room.resetGame();
        broadcastToRoom(currentRoomId, 'GAME_RESET', {
          gameState: room.state,
          players: room.getPublicPlayers(),
          spectatorCount: room.getSpectatorCount()
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
        const total = room.getPlayerCount() + room.getSpectatorCount();
        if (total === 0) {
          roomManager.removeRoom(currentRoomId);
        } else {
          broadcastToRoom(currentRoomId, isSpectator ? 'SPECTATOR_UPDATED' : 'PLAYER_LEFT', {
            players: room.getPublicPlayers(),
            spectatorCount: room.getSpectatorCount()
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
    spectatorCount: room.getSpectatorCount(),
    gameState: room.state,
    players: room.getPublicPlayers()
  });
});

app.get('/api/replay/:roomId', (req, res) => {
  const room = roomManager.getRoom(req.params.roomId);
  if (!room) {
    return res.status(404).json({ error: '房间不存在' });
  }
  if (room.state !== 'finished') {
    return res.status(400).json({ error: '对局尚未完成' });
  }
  res.json(room.getReplayData());
});

app.get('/replay', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'replay.html'));
});

server.listen(PORT, () => {
  console.log(`虫食算游戏服务器已启动: http://localhost:${PORT}`);
});
