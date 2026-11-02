(() => {
  const CONFIG = {
    size: 560,
    rings: [80, 135, 190],
    startRing: 1,
    ringTolerance: 13,
    orbRadius: 20,
    trailLength: 22,
    baseSpeed: 1.5,
    extraSpeed: 1.4,
    rampSeconds: 40,
    spawnStart: 1.5,
    spawnEnd: 0.65,
    warningSeconds: 1,
    storageKey: 'orbita-best',
  };

  const TAU = Math.PI * 2;
  const CENTER = CONFIG.size / 2;

  const dom = {
    canvas: document.getElementById('canvas'),
    menu: document.getElementById('menu'),
    title: document.getElementById('title'),
    subtitle: document.getElementById('subtitle'),
    legend: document.getElementById('legend'),
    controls: document.getElementById('controls'),
    play: document.getElementById('play'),
    mute: document.getElementById('mute'),
    orbs: document.getElementById('orbs'),
    best: document.getElementById('best'),
    tip: document.getElementById('tip'),
  };

  const ctx = dom.canvas.getContext('2d');
  ctx.scale(dom.canvas.width / CONFIG.size, dom.canvas.height / CONFIG.size);

  const styles = getComputedStyle(document.documentElement);
  const COLORS = Object.fromEntries(
    ['paper', 'ink', 'pink', 'blue', 'sun'].map((name) => [name, styles.getPropertyValue(`--${name}`).trim()])
  );

  const state = {
    phase: 'idle',
    player: null,
    obstacles: [],
    orb: null,
    trail: [],
    time: 0,
    orbs: 0,
    best: 0,
    spawnTimer: 0,
    shake: 0,
    lastFrame: 0,
  };

  const normalizeAngle = (angle) => ((angle % TAU) + TAU) % TAU;
  const isInsideArc = (angle, start, length) => normalizeAngle(angle - start) < length;
  const randomBetween = (min, max) => min + Math.random() * (max - min);
  const ringPoint = (ring, angle) => ({
    x: CENTER + Math.cos(angle) * CONFIG.rings[ring],
    y: CENTER + Math.sin(angle) * CONFIG.rings[ring],
  });

  const storage = {
    loadBest() {
      try {
        return Number(localStorage.getItem(CONFIG.storageKey)) || 0;
      } catch {
        return 0;
      }
    },
    saveBest(value) {
      try {
        localStorage.setItem(CONFIG.storageKey, value);
      } catch {}
    },
  };

  const audio = {
    enabled: true,
    context: null,
    play(frequency, duration = 0.1, type = 'sine', volume = 0.08, slide = 1) {
      if (!this.enabled) return;
      try {
        this.context = this.context || new AudioContext();
        const now = this.context.currentTime;
        const oscillator = this.context.createOscillator();
        const gain = this.context.createGain();

        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, now);
        oscillator.frequency.exponentialRampToValueAtTime(frequency * slide, now + duration);
        gain.gain.setValueAtTime(volume, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

        oscillator.connect(gain).connect(this.context.destination);
        oscillator.start();
        oscillator.stop(now + duration);
      } catch {}
    },
    toggle() {
      this.enabled = !this.enabled;
      return this.enabled;
    },
  };

  const hud = {
    setOrbs(value) {
      dom.orbs.textContent = value;
    },
    setBest(value) {
      dom.best.textContent = value;
    },
    showMenu() {
      dom.menu.classList.remove('hidden');
    },
    hideMenu() {
      dom.menu.classList.add('hidden');
    },
    showTip(message) {
      dom.tip.textContent = message;
      dom.tip.style.opacity = message ? 1 : 0;
    },
    showResult({ isRecord, orbs, seconds }) {
      dom.title.textContent = isRecord ? 'Récord' : 'Chocaste';
      dom.subtitle.textContent = `Juntaste ${orbs} orbes en ${seconds.toFixed(1)} segundos.`;
      dom.play.textContent = 'Otra vez';
      dom.legend.hidden = true;
      dom.controls.hidden = true;
    },
  };

  function createPlayer() {
    return {
      angle: -Math.PI / 2,
      ring: CONFIG.startRing,
      radius: CONFIG.rings[CONFIG.startRing],
    };
  }

  function createOrb(player) {
    let ring;
    let angle;
    do {
      ring = Math.floor(Math.random() * CONFIG.rings.length);
      angle = Math.random() * TAU;
    } while (ring === player.ring && Math.abs(normalizeAngle(angle - player.angle + Math.PI) - Math.PI) < 0.6);
    return { ring, angle, pulse: 0 };
  }

  function createObstacle() {
    const direction = Math.random() < 0.5 ? -1 : 1;
    return {
      ring: Math.floor(Math.random() * CONFIG.rings.length),
      start: Math.random() * TAU,
      length: randomBetween(0.7, 1.8),
      speed: direction * randomBetween(0.3, 0.9),
      age: 0,
      warning: CONFIG.warningSeconds,
      lifetime: randomBetween(5, 7),
    };
  }

  function difficulty() {
    return Math.min(state.time / CONFIG.rampSeconds, 1);
  }

  function changeRing(direction) {
    if (state.phase !== 'playing') return;
    const next = Math.max(0, Math.min(CONFIG.rings.length - 1, state.player.ring + direction));
    if (next === state.player.ring) return;
    state.player.ring = next;
    audio.play(300 + next * 120, 0.07, 'triangle', 0.06);
  }

  function updatePlayer(dt) {
    const player = state.player;
    player.angle = normalizeAngle(player.angle + (CONFIG.baseSpeed + difficulty() * CONFIG.extraSpeed) * dt);
    player.radius += (CONFIG.rings[player.ring] - player.radius) * Math.min(1, dt * 14);

    state.trail.push({
      x: CENTER + Math.cos(player.angle) * player.radius,
      y: CENTER + Math.sin(player.angle) * player.radius,
    });
    if (state.trail.length > CONFIG.trailLength) state.trail.shift();
  }

  function updateObstacles(dt) {
    const { player } = state;
    let hit = false;

    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
      state.obstacles.push(createObstacle());
      state.spawnTimer = CONFIG.spawnStart - difficulty() * (CONFIG.spawnStart - CONFIG.spawnEnd);
    }

    for (const obstacle of state.obstacles) {
      obstacle.start = normalizeAngle(obstacle.start + obstacle.speed * dt);

      const touchesPlayer =
        isInsideArc(player.angle, obstacle.start - 0.12, obstacle.length + 0.24) &&
        Math.abs(player.radius - CONFIG.rings[obstacle.ring]) < CONFIG.ringTolerance;

      if (obstacle.warning > 0) {
        obstacle.warning -= dt;
      } else if (touchesPlayer && obstacle.age === 0) {
        obstacle.warning = 0.02;
      } else {
        obstacle.age += dt;
        if (touchesPlayer && obstacle.age < obstacle.lifetime) hit = true;
      }
    }

    state.obstacles = state.obstacles.filter((obstacle) => obstacle.age < obstacle.lifetime + 0.4);
    return hit;
  }

  function updateOrb(dt) {
    const { orb, trail } = state;
    const head = trail[trail.length - 1];
    const target = ringPoint(orb.ring, orb.angle);

    orb.pulse += dt * 6;
    if (Math.hypot(head.x - target.x, head.y - target.y) >= CONFIG.orbRadius) return;

    state.orbs += 1;
    hud.setOrbs(state.orbs);
    audio.play(520 + Math.min(state.orbs, 20) * 25, 0.12, 'sine', 0.09, 1.5);
    state.orb = createOrb(state.player);
  }

  function currentTip() {
    const { orbs, time, orb, player, obstacles } = state;
    const hasWarning = obstacles.some((obstacle) => obstacle.warning > 0);
    const hasLiveArc = obstacles.some((obstacle) => obstacle.warning <= 0 && obstacle.age < obstacle.lifetime);

    if (orbs === 0 && time < 8) {
      return orb.ring === player.ring
        ? 'El orbe está en tu anillo: solo espera a llegar'
        : 'Cambia de anillo para alcanzar el orbe';
    }
    if (orbs < 3 && hasWarning) return 'Los arcos punteados se activarán en un segundo';
    if (orbs < 3 && hasLiveArc) return 'Si hay un arco sólido en tu anillo, cámbiate';
    return '';
  }

  function update(dt) {
    state.time += dt;
    updatePlayer(dt);
    if (updateObstacles(dt)) return endGame();
    updateOrb(dt);
    hud.showTip(currentTip());
  }

  function drawGuideRings() {
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = COLORS.blue;
    ctx.globalAlpha = 0.3;
    ctx.setLineDash([2, 7]);
    for (const radius of CONFIG.rings) {
      ctx.beginPath();
      ctx.arc(CENTER, CENTER, radius, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSun() {
    const pulse = 1 + Math.sin(performance.now() / 400) * 0.04;

    ctx.fillStyle = COLORS.sun;
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, 38 * pulse, 0, TAU);
    ctx.fill();

    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = COLORS.pink;
    ctx.beginPath();
    ctx.arc(CENTER + 5, CENTER + 4, 30 * pulse, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawObstacles() {
    for (const obstacle of state.obstacles) {
      const radius = CONFIG.rings[obstacle.ring];
      const isWarning = obstacle.warning > 0;
      const fade = obstacle.age > obstacle.lifetime ? 1 - (obstacle.age - obstacle.lifetime) / 0.4 : 1;
      const end = obstacle.start + obstacle.length;

      ctx.save();
      ctx.globalAlpha = (isWarning ? 0.45 : 1) * fade;
      ctx.lineWidth = 16;
      ctx.lineCap = 'round';
      ctx.setLineDash(isWarning ? [3, 9] : []);

      ctx.strokeStyle = COLORS.blue;
      ctx.beginPath();
      ctx.arc(CENTER + 3, CENTER + 3, radius, obstacle.start, end);
      ctx.stroke();

      ctx.strokeStyle = COLORS.pink;
      ctx.beginPath();
      ctx.arc(CENTER, CENTER, radius, obstacle.start, end);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawOrb() {
    const { orb } = state;
    const { x, y } = ringPoint(orb.ring, orb.angle);
    const wobble = Math.sin(orb.pulse) * 2;

    ctx.fillStyle = COLORS.sun;
    ctx.beginPath();
    ctx.arc(x, y, 9 + wobble, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 14 + wobble, 0, TAU);
    ctx.stroke();
  }

  function drawPlayer() {
    const { trail } = state;

    trail.forEach((point, index) => {
      const progress = index / trail.length;
      ctx.save();
      ctx.globalAlpha = progress * 0.6;
      ctx.fillStyle = COLORS.blue;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 2 + progress * 5, 0, TAU);
      ctx.fill();
      ctx.restore();
    });

    if (!trail.length || state.phase === 'over') return;
    const head = trail[trail.length - 1];

    ctx.fillStyle = COLORS.blue;
    ctx.beginPath();
    ctx.arc(head.x, head.y, 9, 0, TAU);
    ctx.fill();

    ctx.fillStyle = COLORS.paper;
    ctx.beginPath();
    ctx.arc(head.x, head.y, 3.5, 0, TAU);
    ctx.fill();
  }

  function render() {
    ctx.clearRect(0, 0, CONFIG.size, CONFIG.size);
    ctx.save();

    if (state.shake > 0) {
      ctx.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
      state.shake *= 0.88;
    }

    ctx.globalCompositeOperation = 'screen';
    drawGuideRings();
    drawSun();
    drawObstacles();
    drawOrb();
    drawPlayer();
    ctx.restore();
  }

  function resetState() {
    state.player = createPlayer();
    state.obstacles = [];
    state.trail = [];
    state.time = 0;
    state.orbs = 0;
    state.spawnTimer = 1;
    state.shake = 0;
    state.orb = createOrb(state.player);
    hud.setOrbs(0);
  }

  function startGame() {
    resetState();
    state.phase = 'playing';
    hud.hideMenu();
    audio.play(392, 0.15, 'triangle', 0.07, 1.5);
  }

  function endGame() {
    const isRecord = state.orbs > state.best;

    state.phase = 'over';
    state.shake = 18;
    hud.showTip('');
    audio.play(220, 0.5, 'sawtooth', 0.12, 0.25);

    if (isRecord) {
      state.best = state.orbs;
      hud.setBest(state.best);
      storage.saveBest(state.best);
    }

    hud.showResult({ isRecord, orbs: state.orbs, seconds: state.time });
    setTimeout(hud.showMenu, 600);
  }

  function loop(now) {
    const dt = Math.min((now - state.lastFrame) / 1000, 0.05);
    state.lastFrame = now;

    if (state.phase === 'playing') update(dt);
    if (state.phase !== 'idle') render();

    requestAnimationFrame(loop);
  }

  function bindEvents() {
    const UP_KEYS = ['ArrowUp', 'w', 'W'];
    const DOWN_KEYS = ['ArrowDown', 's', 'S'];

    dom.play.addEventListener('click', startGame);

    window.addEventListener('keydown', (event) => {
      if (UP_KEYS.includes(event.key)) {
        event.preventDefault();
        changeRing(1);
      } else if (DOWN_KEYS.includes(event.key)) {
        event.preventDefault();
        changeRing(-1);
      }
    });

    dom.canvas.addEventListener('pointerdown', (event) => {
      const bounds = dom.canvas.getBoundingClientRect();
      const isRightHalf = event.clientX > bounds.left + bounds.width / 2;
      changeRing(isRightHalf ? 1 : -1);
    });

    dom.mute.addEventListener('click', () => {
      const enabled = audio.toggle();
      dom.mute.textContent = `sonido: ${enabled ? 'sí' : 'no'}`;
      dom.mute.setAttribute('aria-pressed', String(!enabled));
    });
  }

  function init() {
    state.best = storage.loadBest();
    hud.setBest(state.best);
    resetState();
    render();
    bindEvents();
    requestAnimationFrame(loop);
  }

  init();
})();
