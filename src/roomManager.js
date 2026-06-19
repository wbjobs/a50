class Player {
  constructor(id, name, ws, role) {
    this.id = id;
    this.name = name;
    this.ws = ws;
    this.role = role;
  }
}

class Submission {
  constructor(mapping, timestamp, elapsedMs, valid, errorInfo) {
    this.mapping = { ...mapping };
    this.timestamp = timestamp;
    this.elapsedMs = elapsedMs;
    this.valid = valid;
    this.errorInfo = errorInfo || null;
  }
}

class Room {
  constructor(id) {
    this.id = id;
    this.players = [];
    this.spectators = [];
    this.puzzle = null;
    this.state = 'waiting';
    this.startTime = null;
    this.solveTime = null;
    this.winnerId = null;
    this.createdAt = Date.now();
    this.submissions = [];
    this.difficultyRating = null;
  }

  addPlayer(name, ws) {
    const role = this.players.length === 0 ? 'A' : 'B';
    const id = 'p_' + Math.random().toString(36).slice(2, 9);
    const player = new Player(id, name, ws, role);
    this.players.push(player);
    return player;
  }

  addSpectator(name, ws) {
    const id = 's_' + Math.random().toString(36).slice(2, 9);
    const spectator = new Player(id, name, ws, 'spectator');
    this.spectators.push(spectator);
    return spectator;
  }

  getPlayer(playerId) {
    return this.players.find(p => p.id === playerId);
  }

  getSpectator(spectatorId) {
    return this.spectators.find(p => p.id === spectatorId);
  }

  removePlayer(playerId) {
    let idx = this.players.findIndex(p => p.id === playerId);
    if (idx !== -1) {
      this.players.splice(idx, 1);
      if (this.players.length > 0) {
        this.players[0].role = 'A';
      }
      return;
    }
    idx = this.spectators.findIndex(p => p.id === playerId);
    if (idx !== -1) {
      this.spectators.splice(idx, 1);
    }
  }

  getPlayerCount() {
    return this.players.length;
  }

  getSpectatorCount() {
    return this.spectators.length;
  }

  getAllConnected() {
    return [...this.players, ...this.spectators];
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
    this.submissions = [];
    this.difficultyRating = null;
  }

  addSubmission(mapping, valid, errorInfo) {
    const elapsed = this.startTime ? (Date.now() - this.startTime) : 0;
    const sub = new Submission(mapping, Date.now(), elapsed, valid, errorInfo);
    this.submissions.push(sub);
    return sub;
  }

  completeGame(solveTime, winnerId) {
    this.state = 'finished';
    this.solveTime = solveTime;
    this.winnerId = winnerId;
    this.difficultyRating = this.computeDifficultyRating();
  }

  computeDifficultyRating() {
    if (!this.puzzle) return null;
    const base = this.puzzle.base;
    const letterCount = this.puzzle.uniqueLetters.length;
    const submissions = this.submissions.length;
    const solveTimeSec = this.solveTime ? this.solveTime / 1000 : 0;

    const searchSpace = Math.log10(Math.pow(base, letterCount)) || 1;

    let attemptsFactor;
    if (submissions <= 1) attemptsFactor = 0.5;
    else if (submissions <= 3) attemptsFactor = 1.0;
    else if (submissions <= 6) attemptsFactor = 1.5;
    else if (submissions <= 10) attemptsFactor = 2.0;
    else attemptsFactor = 2.5;

    let timeFactor;
    if (solveTimeSec <= 10) timeFactor = 0.5;
    else if (solveTimeSec <= 30) timeFactor = 0.8;
    else if (solveTimeSec <= 60) timeFactor = 1.0;
    else if (solveTimeSec <= 120) timeFactor = 1.3;
    else if (solveTimeSec <= 300) timeFactor = 1.6;
    else timeFactor = 2.0;

    let spaceFactor;
    if (searchSpace <= 2) spaceFactor = 0.5;
    else if (searchSpace <= 4) spaceFactor = 1.0;
    else if (searchSpace <= 6) spaceFactor = 1.5;
    else if (searchSpace <= 8) spaceFactor = 2.0;
    else spaceFactor = 2.5;

    let firstTryCorrectness = 1.0;
    if (submissions === 1) firstTryCorrectness = 0.3;
    else if (submissions === 2) firstTryCorrectness = 0.7;

    const rawScore = (
      spaceFactor * 0.4 +
      attemptsFactor * 0.3 +
      timeFactor * 0.2 +
      firstTryCorrectness * 0.1
    );

    const stars = Math.min(5, Math.max(1, Math.round(rawScore)));

    let convergenceSpeed;
    if (submissions <= 1 && solveTimeSec <= 30) convergenceSpeed = '极快';
    else if (submissions <= 3 && solveTimeSec <= 60) convergenceSpeed = '快速';
    else if (submissions <= 6 && solveTimeSec <= 180) convergenceSpeed = '正常';
    else if (submissions <= 10) convergenceSpeed = '缓慢';
    else convergenceSpeed = '艰难';

    return {
      stars,
      searchSpace: searchSpace.toFixed(2),
      letterCount,
      base,
      attempts: submissions,
      solveTimeSec: Math.round(solveTimeSec),
      convergenceSpeed,
      rawScore: rawScore.toFixed(2),
      breakdown: {
        spaceFactor: spaceFactor.toFixed(2),
        attemptsFactor: attemptsFactor.toFixed(2),
        timeFactor: timeFactor.toFixed(2),
        firstTryCorrectness: firstTryCorrectness.toFixed(2)
      }
    };
  }

  resetGame() {
    this.state = 'waiting';
    this.puzzle = null;
    this.startTime = null;
    this.solveTime = null;
    this.winnerId = null;
    this.submissions = [];
    this.difficultyRating = null;
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

  getReplayData() {
    return {
      roomId: this.id,
      state: this.state,
      puzzle: this.puzzle,
      players: this.getPublicPlayers(),
      winnerId: this.winnerId,
      solveTime: this.solveTime,
      submissions: this.submissions.map(s => ({
        mapping: s.mapping,
        timestamp: s.timestamp,
        elapsedMs: s.elapsedMs,
        valid: s.valid,
        errorInfo: s.errorInfo
      })),
      difficultyRating: this.difficultyRating,
      createdAt: this.createdAt,
      startTime: this.startTime
    };
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

  addSpectator(roomId, name, ws) {
    const room = this.getRoom(roomId);
    if (!room) return null;
    return room.addSpectator(name, ws);
  }

  removePlayer(roomId, playerId) {
    const room = this.getRoom(roomId);
    if (room) room.removePlayer(playerId);
  }
}

module.exports = { Room, Player, Submission, RoomManager };
