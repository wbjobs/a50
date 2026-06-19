class Player {
  constructor(id, name, ws, role) {
    this.id = id;
    this.name = name;
    this.ws = ws;
    this.role = role;
  }
}

class Room {
  constructor(id) {
    this.id = id;
    this.players = [];
    this.puzzle = null;
    this.state = 'waiting';
    this.startTime = null;
    this.solveTime = null;
    this.winnerId = null;
    this.createdAt = Date.now();
  }

  addPlayer(name, ws) {
    const role = this.players.length === 0 ? 'A' : 'B';
    const id = 'p_' + Math.random().toString(36).slice(2, 9);
    const player = new Player(id, name, ws, role);
    this.players.push(player);
    return player;
  }

  getPlayer(playerId) {
    return this.players.find(p => p.id === playerId);
  }

  removePlayer(playerId) {
    const idx = this.players.findIndex(p => p.id === playerId);
    if (idx !== -1) {
      this.players.splice(idx, 1);
      if (this.players.length > 0) {
        this.players[0].role = 'A';
      }
    }
  }

  getPlayerCount() {
    return this.players.length;
  }

  setPuzzle(base, expression, uniqueLetters) {
    this.puzzle = {
      base: parseInt(base),
      expression,
      uniqueLetters
    };
    this.state = 'ready';
  }

  startGame() {
    this.state = 'playing';
    this.startTime = Date.now();
    this.solveTime = null;
    this.winnerId = null;
  }

  completeGame(solveTime, winnerId) {
    this.state = 'finished';
    this.solveTime = solveTime;
    this.winnerId = winnerId;
  }

  resetGame() {
    this.state = 'waiting';
    this.puzzle = null;
    this.startTime = null;
    this.solveTime = null;
    this.winnerId = null;
    if (this.players.length >= 1) this.players[0].role = 'A';
    if (this.players.length >= 2) this.players[1].role = 'B';
  }

  getPublicPlayers() {
    return this.players.map(p => ({
      id: p.id,
      name: p.name,
      role: p.role
    }));
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  createRoom() {
    let id;
    do {
      id = Math.random().toString(36).slice(2, 8).toUpperCase();
    } while (this.rooms.has(id));
    const room = new Room(id);
    this.rooms.set(id, room);
    return room;
  }

  getRoom(id) {
    return this.rooms.get(id);
  }

  removeRoom(id) {
    this.rooms.delete(id);
  }

  addPlayer(roomId, name, ws) {
    const room = this.getRoom(roomId);
    if (!room) return null;
    return room.addPlayer(name, ws);
  }

  removePlayer(roomId, playerId) {
    const room = this.getRoom(roomId);
    if (room) room.removePlayer(playerId);
  }
}

module.exports = { Room, Player, RoomManager };
