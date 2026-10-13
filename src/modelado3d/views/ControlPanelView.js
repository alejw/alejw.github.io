import { FINGERS, FINGER_LABELS, ORIENTATION_AXES, ORIENTATION_LIMIT } from '../config/handConfig.js';
import { SIGN_CATALOG, findSign } from '../data/signs.js';
import { CAMERA_VIEWS } from '../services/SceneService.js';

const AXIS_INFO = {
  pitch: { label: 'Pitch', detail: 'Flexión · extensión' },
  yaw: { label: 'Yaw', detail: 'Desviación lateral' },
  roll: { label: 'Roll', detail: 'Pronación · supinación' },
};

const HISTORY_SIZE = 8;

export default class ControlPanelView {
  constructor(app) {
    this.app = app;
    this.el = (id) => document.getElementById(id);
    this.history = [];

    this.renderControls();
    this.cacheElements();
    this.bindEvents();

    this.app.state.subscribe((state) => this.syncControls(state));
    this.syncControls(this.app.state.getState());
  }

  // ---------------------------------------------------------------------------
  // Construcción del DOM
  // ---------------------------------------------------------------------------

  renderControls() {
    this.el('sensor-list').innerHTML = FINGERS.map(
      (finger) => `
        <div class="sensor" data-finger="${finger}">
          <div class="control-head">
            <label for="flex-${finger}">${FINGER_LABELS[finger]}</label>
            <output id="flex-out-${finger}" class="mono">0%</output>
          </div>
          <input class="slider" type="range" id="flex-${finger}" min="0" max="100" step="1" value="0" />
          <div class="sensor-meta mono">
            <span id="flex-r-${finger}">25.0 kΩ</span>
            <span id="flex-v-${finger}">3.27 V</span>
            <span id="flex-adc-${finger}">ADC 669</span>
          </div>
        </div>`
    ).join('');

    this.el('axis-list').innerHTML = ORIENTATION_AXES.map(
      (axis) => `
        <div class="axis" data-axis="${axis}">
          <div class="control-head">
            <label for="axis-${axis}">${AXIS_INFO[axis].label} <small>${AXIS_INFO[axis].detail}</small></label>
            <output id="axis-out-${axis}" class="mono">0°</output>
          </div>
          <input class="slider slider-center" type="range" id="axis-${axis}"
            min="${-ORIENTATION_LIMIT}" max="${ORIENTATION_LIMIT}" step="1" value="0" />
        </div>`
    ).join('');

    this.el('sign-grid').innerHTML = SIGN_CATALOG.map(
      (sign) => `
        <button class="sign-tile" type="button" data-sign="${sign.id}" title="${sign.name}: ${sign.hint}">
          <span class="sign-letter">${sign.id}</span>
        </button>`
    ).join('');

    this.el('view-buttons').innerHTML = Object.entries(CAMERA_VIEWS)
      .map(([id, view]) => `<button type="button" data-view="${id}" class="${id === 'angled' ? 'is-active' : ''}">${view.label}</button>`)
      .join('');

    this.el('supported-letters').textContent = SIGN_CATALOG.map((sign) => sign.id).join(' · ');
  }

  cacheElements() {
    this.sliders = {};
    FINGERS.forEach((finger) => {
      this.sliders[finger] = {
        input: this.el(`flex-${finger}`),
        out: this.el(`flex-out-${finger}`),
        resistance: this.el(`flex-r-${finger}`),
        voltage: this.el(`flex-v-${finger}`),
        adc: this.el(`flex-adc-${finger}`),
      };
    });

    this.axes = {};
    ORIENTATION_AXES.forEach((axis) => {
      this.axes[axis] = { input: this.el(`axis-${axis}`), out: this.el(`axis-out-${axis}`), hud: this.el(`hud-${axis}`) };
    });

    this.signTiles = [...document.querySelectorAll('.sign-tile')];
    this.hud = {
      root: this.el('hud-detect'),
      letter: this.el('detected-letter'),
      name: this.el('detected-name'),
      bar: this.el('confidence-bar'),
      confidence: this.el('detected-confidence'),
    };
  }

  bindEvents() {
    FINGERS.forEach((finger) => {
      this.sliders[finger].input.addEventListener('input', (event) => {
        this.app.setFinger(finger, Number(event.target.value));
      });
    });

    ORIENTATION_AXES.forEach((axis) => {
      this.axes[axis].input.addEventListener('input', (event) => {
        this.app.setOrientation(axis, Number(event.target.value));
      });
      this.axes[axis].input.addEventListener('dblclick', () => this.app.setOrientation(axis, 0));
    });

    this.el('sign-grid').addEventListener('click', (event) => {
      const tile = event.target.closest('[data-sign]');
      if (tile) this.app.playSign(tile.dataset.sign);
    });

    this.el('view-buttons').addEventListener('click', (event) => {
      const button = event.target.closest('[data-view]');
      if (!button) return;
      this.app.setView(button.dataset.view);
      this.el('view-buttons').querySelectorAll('button').forEach((item) => item.classList.toggle('is-active', item === button));
    });

    document.querySelectorAll('[data-preset]').forEach((button) => {
      button.addEventListener('click', () => this.app.applyPreset(button.dataset.preset));
    });

    this.el('reset-sim').addEventListener('click', () => this.app.reset());
    this.el('toggle-sensors').addEventListener('click', () => this.app.toggleSensors());
    this.el('toggle-rotate').addEventListener('click', () => this.app.toggleAutoRotate());

    const speed = this.el('spell-speed');
    const updateSpeedVisual = () => {
      const value = Number(speed.value);
      const min = Number(speed.min || 0);
      const max = Number(speed.max || 1);
      const percent = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
      speed.style.setProperty('--fill', `${percent}%`);
      this.el('spell-speed-out').textContent = `${(this.getSpellInterval() / 1000).toFixed(1)} s`;
    };

    speed.addEventListener('input', updateSpeedVisual);
    updateSpeedVisual();

    this.el('spell-form').addEventListener('submit', (event) => {
      event.preventDefault();
      if (this.app.animation.playing) {
        this.app.stopSequence();
        return;
      }
      this.app.spell(this.el('spell-input').value);
    });

    document.addEventListener('keydown', (event) => {
      const typing = event.target.closest?.('input, textarea, select, [contenteditable]');
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (findSign(event.key)) {
        this.app.playSign(event.key);
      } else if (event.key === 'Escape') {
        this.app.stopSequence();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Actualización
  // ---------------------------------------------------------------------------

  syncControls(state) {
    FINGERS.forEach((finger) => {
      const { input } = this.sliders[finger];
      input.value = state.fingers[finger];
      input.style.setProperty('--fill', `${state.fingers[finger]}%`);
    });

    ORIENTATION_AXES.forEach((axis) => {
      const { input, out } = this.axes[axis];
      const value = state.orientation[axis];
      input.value = value;
      this.setCenterFill(input, value);
      out.textContent = `${value > 0 ? '+' : ''}${value}°`;
    });

    this.signTiles.forEach((tile) => tile.classList.toggle('is-active', tile.dataset.sign === state.activeSign));
    const sign = findSign(state.activeSign || '');
    this.el('sign-hint').innerHTML = sign
      ? `<strong>${sign.name}.</strong> ${sign.hint}`
      : 'Elige una letra o pulsa su tecla para reproducirla.';

    this.setPressed('toggle-sensors', state.sensorsVisible);
    this.setPressed('toggle-rotate', state.autoRotate);
  }

  setCenterFill(input, value) {
    const percent = ((value + ORIENTATION_LIMIT) / (ORIENTATION_LIMIT * 2)) * 100;
    input.style.setProperty('--from', `${Math.min(50, percent)}%`);
    input.style.setProperty('--to', `${Math.max(50, percent)}%`);
  }

  setPressed(id, pressed) {
    this.el(id).setAttribute('aria-pressed', String(Boolean(pressed)));
  }

  updateLive({ fingers, orientation, readings, result }) {
    FINGERS.forEach((finger) => {
      const value = fingers[finger];
      const reading = readings[finger];
      const slider = this.sliders[finger];
      slider.out.textContent = `${Math.round(value)}%`;
      slider.resistance.textContent = `${reading.resistance.toFixed(1)} kΩ`;
      slider.voltage.textContent = `${reading.voltage.toFixed(2)} V`;
      slider.adc.textContent = `ADC ${String(reading.adc).padStart(4, '0')}`;
      slider.input.style.setProperty('--level', value / 100);
    });

    ORIENTATION_AXES.forEach((axis) => {
      const value = Math.round(orientation[axis]);
      this.axes[axis].hud.textContent = `${value > 0 ? '+' : ''}${value}°`;
    });

    const detected = Boolean(result.id);
    this.hud.root.dataset.state = detected ? 'match' : 'idle';
    this.hud.letter.textContent = detected ? result.id : '—';
    this.hud.name.textContent = detected ? result.name : 'Sin coincidencia';
    this.hud.bar.style.width = `${detected ? result.confidence : 0}%`;
    this.hud.confidence.textContent = detected ? `${result.confidence}% de coincidencia` : 'Buscando patrón…';
  }

  pushHistory(result) {
    this.history.unshift(result.id);
    this.history = this.history.slice(0, HISTORY_SIZE);
    this.el('history').innerHTML = this.history
      .map((id, index) => `<span class="history-chip${index === 0 ? ' is-new' : ''}">${id}</span>`)
      .join('');
  }

  getSpellInterval() {
    return Number(this.el('spell-speed').value) || 1100;
  }

  setSpellProgress(letters, activeIndex, playing) {
    const tape = this.el('spell-tape');
    tape.innerHTML = letters
      .map((letter, index) => {
        const classes = ['tape-cell'];
        if (!findSign(letter)) classes.push('is-unsupported');
        if (index === activeIndex) classes.push('is-active');
        if (index < activeIndex) classes.push('is-done');
        return `<span class="${classes.join(' ')}">${letter}</span>`;
      })
      .join('');

    const button = this.el('spell-button');
    button.textContent = playing ? 'Detener' : 'Reproducir';
    button.classList.toggle('is-playing', playing);

    if (!playing && letters.length && !letters.some((letter) => findSign(letter))) {
      tape.innerHTML += '<span class="tape-note">Ninguna letra disponible</span>';
    }
  }

  setLoading(progress) {
    const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100);
    this.el('loader-progress').textContent = `${percent}%`;
    this.el('loader-bar').style.width = `${percent}%`;
  }

  setModelStatus(status) {
    const pill = this.el('model-status');
    pill.dataset.state = status;
    pill.querySelector('span').textContent = status === 'ready' ? 'Modelo GLB activo' : 'Modo respaldo';
    this.el('stage-loader').classList.add('is-hidden');
  }

  setFps(fps) {
    this.el('fps-counter').textContent = `${fps} FPS`;
  }
}
