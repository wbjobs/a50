const app = {
  ws: null,
  roomId: null,
  playerId: null,
  playerName: '',
  role: null,
  gameState: 'waiting',
  puzzle: null,
  mapping: {},
  timerInterval: null,
  elapsed: 0,
  startTime: 0,

  $(id) { return document.getElementById(id); },

  init() {
    this.$('btnCreateRoom').addEventListener('click', () => this.createRoom());
    this.$('btnJoinRoom').addEventListener('click', () => {
      this.$('joinForm').classList.toggle('hidden');
    });
    this.$('btnConfirmJoin').addEventListener('click', () => this.joinRoom());
    this.$('btnCopyRoomId').addEventListener('click', () => this.copyRoomId());
    this.$('btnSetPuzzle').addEventListener('click', () => this.setPuzzle());
    this.$('btnStartGame').addEventListener('click', () => this.startGame());
    this.$('btnSubmit').addEventListener('click', () => this.submitSolution());
    this.$('btnClear').addEventListener('click', () => this.clearMapping());
    this.$('btnReset').addEventListener('click', () => this.resetGame());
    this.$('expressionInput').addEventListener('input', () => this.updatePuzzleHint());
    this.$('baseInput').addEventListener('input', () => this.updatePuzzleHint());
  },

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${proto}://${location.host}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.log('已连接服务器', 'success');
    };

    this.ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch (_) { return; }
      this.handleMessage(msg);
    };

    this.ws.onclose = () => {
      this.log('连接已断开', 'error');
      setTimeout(() => this.connect(), 2000);
    };

    this.ws.onerror = () => {
      this.log('连接错误', 'error');
    };
  },

  send(type, data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, data }));
    }
  },

  handleMessage(msg) {
    const { type, data } = msg;
    switch (type) {
      case 'ROOM_CREATED':
        this.roomId = data.roomId;
        this.playerId = data.playerId;
        this.role = data.role;
        this.gameState = 'waiting';
        this.showGameScreen();
        this.updateRoomInfo();
        this.updatePlayers(data.players);
        this.updateRoleUI();
        break;

      case 'ROOM_JOINED':
        this.roomId = data.roomId;
        this.playerId = data.playerId;
        this.role = data.role;
        this.gameState = data.gameState;
        if (data.puzzle) this.puzzle = data.puzzle;
        this.showGameScreen();
        this.updateRoomInfo();
        this.updatePlayers(data.players);
        this.updateRoleUI();
        if (this.puzzle) this.showPuzzle();
        break;

      case 'PLAYER_JOINED':
        this.updatePlayers(data.players);
        this.log('新玩家加入房间');
        this.updateRoleUI();
        break;

      case 'PLAYER_LEFT':
        this.updatePlayers(data.players);
        this.log('有玩家离开房间', 'error');
        this.updateRoleUI();
        break;

      case 'PUZZLE_SET':
        this.puzzle = { base: data.base, expression: data.expression, uniqueLetters: data.uniqueLetters };
        this.gameState = data.gameState;
        this.showPuzzle();
        this.log('题目已设置');
        this.updateStatus();
        break;

      case 'GAME_STARTED':
        this.gameState = 'playing';
        this.startTime = data.startTime;
        this.startTimer();
        this.updateStatus();
        if (this.role === 'B') this.renderMappingInputs();
        this.log('🎮 游戏开始！');
        break;

      case 'SOLUTION_CORRECT':
        this.gameState = 'finished';
        this.stopTimer();
        this.showResult(data);
        this.log('🎉 答案正确！挑战成功！', 'success');
        break;

      case 'SOLUTION_INCORRECT':
        this.log(`❌ 答案错误：${data.reason}`, 'error');
        this.toast('答案错误：' + data.reason);
        break;

      case 'TIME_SYNC':
        this.elapsed = data.elapsed;
        this.updateTimerDisplay();
        break;

      case 'GAME_RESET':
        this.gameState = data.gameState;
        this.puzzle = null;
        this.stopTimer();
        this.elapsed = 0;
        this.updateTimerDisplay();
        this.updatePlayers(data.players);
        this.resetUI();
        this.updateRoleUI();
        this.updateStatus();
        this.log('游戏已重置');
        break;

      case 'ERROR':
        this.log(data.message, 'error');
        this.toast(data.message);
        break;
    }
  },

  createRoom() {
    const name = this.$('playerName').value.trim();
    if (!name) return this.toast('请输入昵称');
    this.playerName = name;
    this.connect();
    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({ type: 'CREATE_ROOM', data: { playerName: name } }));
    };
  },

  joinRoom() {
    const name = this.$('playerName').value.trim();
    const roomId = this.$('roomIdInput').value.trim().toUpperCase();
    if (!name) return this.toast('请输入昵称');
    if (!roomId) return this.toast('请输入房间号');
    this.playerName = name;
    this.connect();
    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({ type: 'JOIN_ROOM', data: { roomId, playerName: name } }));
    };
  },

  showGameScreen() {
    this.$('screen-home').classList.remove('active');
    this.$('screen-game').classList.add('active');
  },

  updateRoomInfo() {
    this.$('roomIdDisplay').textContent = this.roomId;
  },

  copyRoomId() {
    navigator.clipboard.writeText(this.roomId).then(() => {
      this.toast('房间号已复制：' + this.roomId);
    }).catch(() => {
      this.toast('房间号：' + this.roomId);
    });
  },

  updatePlayers(players) {
    const container = this.$('playersList');
    container.innerHTML = '';
    const slots = [
      { role: 'A', label: '出题人' },
      { role: 'B', label: '解题人' }
    ];
    slots.forEach(slot => {
      const p = players.find(x => x.role === slot.role);
      const div = document.createElement('div');
      div.className = 'player-chip' + (p ? ' role-' + slot.role : ' empty');
      if (p && p.id === this.playerId) div.classList.add('me');
      div.innerHTML = p
        ? `<span class="role">${slot.role}</span><span>${p.name}${p.id === this.playerId ? ' (我)' : ''}</span>`
        : `<span class="role">${slot.role}</span><span>等待${slot.label}...</span>`;
      container.appendChild(div);
    });
  },

  updateRoleUI() {
    this.$('setterArea').classList.toggle('hidden', this.role !== 'A');
    if (this.role === 'A') {
      this.$('solverArea').classList.add('hidden');
    } else if (this.role === 'B' && this.gameState === 'playing') {
      this.$('solverArea').classList.remove('hidden');
    }
    if (this.gameState === 'finished') {
      this.$('setterArea').classList.add('hidden');
      this.$('solverArea').classList.add('hidden');
    }
  },

  updateStatus() {
    const statusEl = this.$('gameStatus');
    statusEl.classList.remove('ready', 'playing', 'finished');
    switch (this.gameState) {
      case 'waiting':
        statusEl.textContent = '等待玩家加入...';
        break;
      case 'ready':
        statusEl.textContent = '题目已就绪，等待出题人开始游戏';
        statusEl.classList.add('ready');
        break;
      case 'playing':
        statusEl.textContent = this.role === 'A' ? '解题中，等待解题人提交答案...' : '🎯 解题时间！加油！';
        statusEl.classList.add('playing');
        break;
      case 'finished':
        statusEl.textContent = '游戏结束';
        statusEl.classList.add('finished');
        break;
    }
  },

  updatePuzzleHint() {
    const base = parseInt(this.$('baseInput').value) || 0;
    const expr = this.$('expressionInput').value;
    const letters = [...new Set(expr.toUpperCase().match(/[A-Z]/g) || [])];
    const hint = this.$('puzzleHint');
    hint.textContent = `已识别 ${letters.length} 个不同字母，进制 ${base}。${letters.length > base ? '⚠️ 字母数不能超过进制！' : (letters.length > 0 ? '字母: ' + letters.join(', ') : '')}`;
    hint.style.color = letters.length > base ? '#e53e3e' : '';
  },

  setPuzzle() {
    const base = parseInt(this.$('baseInput').value);
    const expression = this.$('expressionInput').value.trim().toUpperCase();
    if (!base || base < 2 || base > 36) return this.toast('进制需在 2-36 之间');
    if (!expression) return this.toast('请输入算式');
    if (!expression.includes('=')) return this.toast('算式需要包含等号');
    const letters = [...new Set(expression.match(/[A-Z]/g) || [])];
    if (letters.length === 0) return this.toast('算式中需要包含字母');
    if (letters.length > base) return this.toast(`字母数(${letters.length})不能超过进制(${base})`);
    this.send('SET_PUZZLE', { base, expression });
  },

  startGame() {
    this.send('START_GAME', {});
  },

  showPuzzle() {
    this.$('puzzleArea').classList.remove('hidden');
    this.$('puzzleBase').textContent = this.puzzle.base;
    const expr = this.puzzle.expression;
    let html = '';
    for (const ch of expr) {
      if (/[A-Z]/.test(ch)) {
        html += `<span class="letter">${ch}</span>`;
      } else {
        html += ch;
      }
    }
    this.$('puzzleExpression').innerHTML = html;
    this.$('digitRange').textContent = `0-${this.puzzle.base - 1}`;
    if (this.role === 'A') {
      this.$('btnSetPuzzle').classList.add('hidden');
      this.$('btnStartGame').classList.remove('hidden');
    }
    if (this.role === 'B' && this.gameState === 'playing') {
      this.renderMappingInputs();
    }
  },

  renderMappingInputs() {
    this.$('solverArea').classList.remove('hidden');
    const grid = this.$('mappingGrid');
    grid.innerHTML = '';
    this.mapping = {};
    const letters = this.puzzle.uniqueLetters.sort();
    letters.forEach(letter => {
      const div = document.createElement('div');
      div.className = 'mapping-item';
      div.innerHTML = `
        <label>${letter}</label>
        <input type="number" data-letter="${letter}" min="0" max="${this.puzzle.base - 1}" step="1" />
      `;
      grid.appendChild(div);
      const input = div.querySelector('input');
      input.addEventListener('input', (e) => {
        const val = e.target.value;
        if (val === '') {
          delete this.mapping[letter];
        } else {
          const num = parseInt(val);
          if (!isNaN(num) && num >= 0 && num < this.puzzle.base) {
            this.mapping[letter] = num;
          }
        }
        this.checkDuplicates();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const inputs = grid.querySelectorAll('input');
          const idx = Array.from(inputs).indexOf(e.target);
          if (idx < inputs.length - 1) inputs[idx + 1].focus();
          else this.submitSolution();
        }
      });
    });
  },

  checkDuplicates() {
    const grid = this.$('mappingGrid');
    const inputs = grid.querySelectorAll('input');
    const counts = {};
    inputs.forEach(inp => {
      const val = inp.value;
      if (val !== '') counts[val] = (counts[val] || 0) + 1;
    });
    inputs.forEach(inp => {
      if (inp.value !== '' && counts[inp.value] > 1) {
        inp.classList.add('duplicate');
      } else {
        inp.classList.remove('duplicate');
      }
    });
  },

  clearMapping() {
    const grid = this.$('mappingGrid');
    const inputs = grid.querySelectorAll('input');
    inputs.forEach(inp => {
      inp.value = '';
      inp.classList.remove('duplicate');
    });
    this.mapping = {};
  },

  submitSolution() {
    const letters = this.puzzle.uniqueLetters;
    if (Object.keys(this.mapping).length !== letters.length) {
      return this.toast('请为所有字母填入数字');
    }
    const vals = Object.values(this.mapping);
    if (new Set(vals).size !== vals.length) {
      return this.toast('存在重复的数字');
    }
    this.send('SUBMIT_SOLUTION', { mapping: this.mapping });
  },

  startTimer() {
    this.stopTimer();
    this.elapsed = 0;
    const baseTime = Date.now();
    this.timerInterval = setInterval(() => {
      this.elapsed = Date.now() - baseTime;
      this.updateTimerDisplay();
    }, 100);
  },

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  },

  updateTimerDisplay() {
    const totalSec = Math.floor(this.elapsed / 1000);
    const min = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const sec = String(totalSec % 60).padStart(2, '0');
    this.$('timerDisplay').textContent = `${min}:${sec}`;
  },

  showResult(data) {
    this.$('resultArea').classList.remove('hidden');
    this.$('resultTitle').textContent = '🎉 挑战成功！';
    const totalSec = Math.floor(data.solveTime / 1000);
    const min = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const sec = String(totalSec % 60).padStart(2, '0');
    this.$('resultTime').textContent = `用时: ${min}:${sec}`;

    const grid = this.$('resultMapping');
    grid.innerHTML = '';
    Object.keys(data.mapping).sort().forEach(letter => {
      const div = document.createElement('div');
      div.className = 'mapping-item';
      div.innerHTML = `<label>${letter}</label><input type="text" value="${data.mapping[letter]}" readonly />`;
      grid.appendChild(div);
    });
  },

  resetGame() {
    this.send('RESET_GAME', {});
  },

  resetUI() {
    this.$('puzzleArea').classList.add('hidden');
    this.$('resultArea').classList.add('hidden');
    this.$('solverArea').classList.add('hidden');
    this.$('btnSetPuzzle').classList.remove('hidden');
    this.$('btnStartGame').classList.add('hidden');
    this.$('expressionInput').value = '';
    this.$('baseInput').value = '10';
    this.$('puzzleHint').textContent = '字母数量不能超过进制数';
    this.$('puzzleHint').style.color = '';
    this.updateStatus();
  },

  log(msg, type) {
    const log = this.$('messageLog');
    const div = document.createElement('div');
    div.className = 'msg' + (type ? ' ' + type : '');
    const t = new Date();
    const ts = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
    div.textContent = `[${ts}] ${msg}`;
    log.insertBefore(div, log.firstChild);
  },

  toast(msg) {
    const t = this.$('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.add('hidden'), 2500);
  }
};

document.addEventListener('DOMContentLoaded', () => app.init());
