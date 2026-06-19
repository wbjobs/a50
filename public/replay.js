const replay = {
  data: null,
  currentIndex: 0,
  playInterval: null,
  isPlaying: false,

  $(id) { return document.getElementById(id); },

  init() {
    this.$('btnLoadReplay').addEventListener('click', () => this.loadReplay());
    this.$('roomIdInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.loadReplay();
    });
    this.$('timelineSlider').addEventListener('input', (e) => {
      this.goTo(parseInt(e.target.value));
    });
    this.$('btnPrev').addEventListener('click', () => this.prev());
    this.$('btnNext').addEventListener('click', () => this.next());
    this.$('btnPlay').addEventListener('click', () => this.togglePlay());

    const params = new URLSearchParams(location.search);
    const roomId = params.get('room');
    if (roomId) {
      this.$('roomIdInput').value = roomId.toUpperCase();
      this.loadReplay();
    }
  },

  toast(msg) {
    const t = this.$('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.add('hidden'), 2500);
  },

  formatTime(ms) {
    if (!ms && ms !== 0) return '--:--';
    const total = Math.floor(ms / 1000);
    const m = String(Math.floor(total / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    return `${m}:${s}`;
  },

  async loadReplay() {
    const roomId = this.$('roomIdInput').value.trim().toUpperCase();
    if (!roomId) return this.toast('请输入房间号');

    try {
      const res = await fetch(`/api/replay/${roomId}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || '加载失败');
      }
      this.data = await res.json();
      this.renderReplay();
    } catch (e) {
      this.toast(e.message);
    }
  },

  renderReplay() {
    const d = this.data;
    this.$('screen-enter').classList.remove('active');
    this.$('screen-replay').classList.add('active');

    this.$('roomIdDisplay').textContent = d.roomId;
    this.$('totalTimeDisplay').textContent = this.formatTime(d.solveTime);

    const solverPlayer = d.players.find(p => p.role === 'B');
    this.$('solverNameDisplay').textContent = solverPlayer ? solverPlayer.name : '—';

    this.$('puzzleExprDisplay').textContent = d.puzzle.expression;
    this.$('puzzleBaseDisplay').textContent = d.puzzle.base;
    this.$('letterCountDisplay').textContent = d.puzzle.uniqueLetters.length;

    this.renderDifficulty(d.difficultyRating);
    this.renderTimeline();
    this.renderExpression();
    this.goTo(0);
  },

  renderDifficulty(rating) {
    if (!rating) return;
    const starsEl = this.$('starsDisplay');
    let html = '';
    for (let i = 0; i < 5; i++) {
      if (i < rating.stars) {
        html += '⭐';
      } else {
        html += '<span class="star-empty">⭐</span>';
      }
    }
    starsEl.innerHTML = html;

    this.$('convergenceDisplay').textContent = `收敛速度: ${rating.convergenceSpeed}`;

    const breakdownEl = this.$('breakdownDisplay');
    breakdownEl.innerHTML = `
      <div class="breakdown-item">
        <span class="label">尝试次数</span>
        <span class="value">${rating.attempts}</span>
      </div>
      <div class="breakdown-item">
        <span class="label">用时</span>
        <span class="value">${rating.solveTimeSec}s</span>
      </div>
      <div class="breakdown-item">
        <span class="label">搜索空间</span>
        <span class="value">10^${rating.searchSpace}</span>
      </div>
      <div class="breakdown-item">
        <span class="label">空间权重</span>
        <span class="value">${rating.breakdown.spaceFactor}</span>
      </div>
      <div class="breakdown-item">
        <span class="label">尝试权重</span>
        <span class="value">${rating.breakdown.attemptsFactor}</span>
      </div>
      <div class="breakdown-item">
        <span class="label">时间权重</span>
        <span class="value">${rating.breakdown.timeFactor}</span>
      </div>
      <div class="breakdown-item">
        <span class="label">综合评分</span>
        <span class="value">${rating.rawScore}</span>
      </div>
    `;
  },

  renderTimeline() {
    const subs = this.data.submissions;
    const slider = this.$('timelineSlider');
    slider.max = Math.max(0, subs.length - 1);
    slider.value = 0;

    this.$('timelineEndBadge').textContent = this.formatTime(this.data.solveTime);
    this.$('attemptCountLabel').textContent = `第 0 / ${subs.length} 次尝试`;

    const marksEl = this.$('timelineMarks');
    marksEl.innerHTML = '';
    const totalTime = this.data.solveTime || 1;

    subs.forEach((sub, i) => {
      const pct = (sub.elapsedMs / totalTime) * 100;
      const mark = document.createElement('div');
      mark.className = 'timeline-mark' + (sub.valid ? ' valid' : '');
      mark.style.left = `${Math.min(100, Math.max(0, pct))}%`;
      mark.innerHTML = `
        <div class="mark-dot"></div>
        <span class="mark-time">#${i + 1} ${this.formatTime(sub.elapsedMs)}</span>
      `;
      mark.addEventListener('click', () => this.goTo(i));
      marksEl.appendChild(mark);
    });

    this.renderAttemptsList();
  },

  renderAttemptsList() {
    const listEl = this.$('attemptsList');
    const letters = [...this.data.puzzle.uniqueLetters].sort();
    listEl.innerHTML = this.data.submissions.map((sub, i) => {
      const preview = letters.map(l => `${l}=${sub.mapping[l] !== undefined ? sub.mapping[l] : '?'}`).join(', ');
      return `
        <div class="attempt-item ${sub.valid ? 'valid' : ''}" data-index="${i}">
          <div class="attempt-num">${i + 1}</div>
          <div class="attempt-info">
            <div class="attempt-time">${this.formatTime(sub.elapsedMs)} · ${sub.valid ? '✅ 正确解' : '❌ 错误'}</div>
            <div class="attempt-preview">${preview}</div>
          </div>
          <div class="attempt-status">${sub.valid ? 'SUCCESS' : 'FAIL'}</div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.attempt-item').forEach(el => {
      el.addEventListener('click', () => this.goTo(parseInt(el.dataset.index)));
    });
  },

  renderExpression() {
    const exprEl = this.$('expressionReplay');
    let html = '';
    for (const ch of this.data.puzzle.expression) {
      if (/[A-Z]/.test(ch)) {
        html += `<span class="letter" data-letter="${ch}">${ch}</span>`;
      } else {
        html += ch;
      }
    }
    exprEl.innerHTML = html;
  },

  renderMappingGrid(mapping, errorInfo) {
    const letters = [...this.data.puzzle.uniqueLetters].sort();
    const grid = this.$('mappingGridReplay');
    const problemLetter = errorInfo && errorInfo.problemLetter ? errorInfo.problemLetter.toUpperCase() : null;
    const errorLetters = new Set((errorInfo && errorInfo.errorLetters || []).map(l => l.toUpperCase()));

    grid.innerHTML = letters.map(letter => {
      const val = mapping[letter];
      let cls = 'mapping-item';
      if (val !== undefined) cls += ' filled';
      if (errorLetters.has(letter)) cls += ' error';
      if (problemLetter === letter) cls += ' problem';

      return `
        <div class="${cls}" data-letter="${letter}">
          <label>${letter}</label>
          <span class="digit">${val !== undefined ? val : '—'}</span>
        </div>
      `;
    }).join('');
  },

  highlightLetters(mapping, errorInfo) {
    const letters = document.querySelectorAll('.expression-replay .letter');
    const problemLetter = errorInfo && errorInfo.problemLetter ? errorInfo.problemLetter.toUpperCase() : null;
    const errorLetters = new Set((errorInfo && errorInfo.errorLetters || []).map(l => l.toUpperCase()));

    letters.forEach(el => {
      el.classList.remove('error-flash', 'error-problem', 'filled');
      const ch = el.dataset.letter;
      if (mapping[ch] !== undefined) {
        el.classList.add('filled');
        el.textContent = `${ch}(${mapping[ch]})`;
      } else {
        el.textContent = ch;
      }
      if (problemLetter === ch) {
        el.classList.add('error-problem');
      } else if (errorLetters.has(ch)) {
        el.classList.add('error-flash');
      }
    });
  },

  showErrorBox(errorInfo) {
    const box = this.$('replayErrorBox');
    if (!errorInfo) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');

    let titleText = '答案错误';
    if (errorInfo.columnName) titleText = `${errorInfo.columnName}出错`;
    else if (errorInfo.errorType === 'duplicate') titleText = '数字重复使用';
    else if (errorInfo.errorType === 'leading_zero') titleText = '首位字母不能为0';

    let infoHtml = `<div>${errorInfo.reason}</div>`;
    if (errorInfo.column !== undefined && errorInfo.expectedDigit !== undefined) {
      infoHtml += `
        <div class="digit-row">
          <span style="font-size:13px;">正确值:</span>
          <span class="digit-badge expected">${errorInfo.expectedDigit}</span>
          <span style="font-size:13px;">填入值:</span>
          <span class="digit-badge actual">${errorInfo.actualDigit}</span>
        </div>
      `;
    }
    if (errorInfo.errorLetters && errorInfo.errorLetters.length > 0) {
      infoHtml += `<div class="digit-row" style="margin-top:8px;">
        <span style="font-size:13px;">涉及字母:</span>
        ${errorInfo.errorLetters.map(l => {
          const isProblem = errorInfo.problemLetter && l.toUpperCase() === errorInfo.problemLetter.toUpperCase();
          return `<span class="digit-badge" style="background:${isProblem ? '#ff6b6b' : '#ffe3e3'};color:${isProblem ? '#fff' : '#c92a2a'};">${l}</span>`;
        }).join('')}
      </div>`;
    }

    box.innerHTML = `
      <div class="error-title">${titleText}</div>
      <div class="error-info">${infoHtml}</div>
    `;
  },

  updateSliderProgress() {
    const slider = this.$('timelineSlider');
    const max = parseInt(slider.max) || 1;
    const pct = (this.currentIndex / max) * 100;
    slider.style.setProperty('--progress', `${pct}%`);
  },

  goTo(index) {
    if (!this.data) return;
    const subs = this.data.submissions;
    if (index < 0 || index >= subs.length) return;

    this.currentIndex = index;
    const sub = subs[index];

    this.$('timelineSlider').value = index;
    this.updateSliderProgress();
    this.$('attemptCountLabel').textContent = `第 ${index + 1} / ${subs.length} 次尝试`;

    document.querySelectorAll('.timeline-mark').forEach((el, i) => {
      el.classList.toggle('active', i === index);
    });
    document.querySelectorAll('.attempt-item').forEach(el => {
      el.classList.toggle('active', parseInt(el.dataset.index) === index);
    });

    this.renderMappingGrid(sub.mapping, sub.errorInfo);
    this.highlightLetters(sub.mapping, sub.errorInfo);
    this.showErrorBox(sub.valid ? null : sub.errorInfo);

    const listEl = this.$('attemptsList');
    const activeItem = listEl.querySelector(`.attempt-item[data-index="${index}"]`);
    if (activeItem) {
      activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  },

  prev() {
    this.stopPlay();
    this.goTo(Math.max(0, this.currentIndex - 1));
  },

  next() {
    this.stopPlay();
    this.goTo(Math.min(this.data.submissions.length - 1, this.currentIndex + 1));
  },

  togglePlay() {
    if (this.isPlaying) {
      this.stopPlay();
    } else {
      this.startPlay();
    }
  },

  startPlay() {
    this.isPlaying = true;
    const btn = this.$('btnPlay');
    btn.textContent = '⏸ 暂停播放';
    btn.classList.add('btn-playing');

    if (this.currentIndex >= this.data.submissions.length - 1) {
      this.currentIndex = -1;
    }

    this.playInterval = setInterval(() => {
      if (this.currentIndex >= this.data.submissions.length - 1) {
        this.stopPlay();
        return;
      }
      this.goTo(this.currentIndex + 1);
    }, 1500);
  },

  stopPlay() {
    this.isPlaying = false;
    if (this.playInterval) {
      clearInterval(this.playInterval);
      this.playInterval = null;
    }
    const btn = this.$('btnPlay');
    if (btn) {
      btn.textContent = '▶ 自动播放';
      btn.classList.remove('btn-playing');
    }
  }
};

document.addEventListener('DOMContentLoaded', () => replay.init());
