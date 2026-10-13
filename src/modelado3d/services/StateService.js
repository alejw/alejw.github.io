import { FINGERS, ORIENTATION_AXES, ORIENTATION_LIMIT } from '../config/handConfig.js';

/**
 * Estado objetivo de la simulación (lo que marcan los controles).
 * La pose animada que se ve en pantalla vive en HandModelService.
 */
export default class StateService {
  constructor() {
    this.state = {
      fingers: Object.fromEntries(FINGERS.map((finger) => [finger, 0])),
      orientation: Object.fromEntries(ORIENTATION_AXES.map((axis) => [axis, 0])),
      sensorsVisible: true,
      autoRotate: false,
      activeSign: null,
    };
    this.listeners = new Set();
  }

  getState() {
    return this.state;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    this.listeners.forEach((listener) => listener(this.state));
  }

  setFinger(name, value, { silent = false } = {}) {
    if (!(name in this.state.fingers)) {
      return;
    }
    this.state.fingers[name] = Math.min(100, Math.max(0, Number(value) || 0));
    if (!silent) this.emit();
  }

  setFingers(values) {
    Object.entries(values).forEach(([name, value]) => this.setFinger(name, value, { silent: true }));
    this.emit();
  }

  setOrientation(axis, value, { silent = false } = {}) {
    if (!(axis in this.state.orientation)) {
      return;
    }
    const numeric = Number(value) || 0;
    this.state.orientation[axis] = Math.min(ORIENTATION_LIMIT, Math.max(-ORIENTATION_LIMIT, numeric));
    if (!silent) this.emit();
  }

  setOrientations(values) {
    Object.entries(values).forEach(([axis, value]) => this.setOrientation(axis, value, { silent: true }));
    this.emit();
  }

  set(patch) {
    Object.assign(this.state, patch);
    this.emit();
  }
}
