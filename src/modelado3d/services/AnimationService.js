/**
 * Reproduce secuencias de pasos con un intervalo fijo (p. ej. deletrear una
 * palabra seña por seña). La interpolación entre poses la hace HandModelService.
 */
export default class AnimationService {
  constructor() {
    this.timer = null;
    this.playing = false;
  }

  playSequence(steps, { interval = 1100, onStep, onDone } = {}) {
    this.stop();
    this.playing = true;
    let index = 0;

    const next = () => {
      if (index >= steps.length) {
        this.playing = false;
        this.timer = null;
        onDone?.();
        return;
      }

      const step = steps[index];
      onStep?.(step, index);
      index += 1;
      this.timer = setTimeout(next, step.duration ?? interval);
    };

    next();
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
    this.playing = false;
  }
}
