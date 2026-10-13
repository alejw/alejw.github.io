import SceneService from '../services/SceneService.js';
import StateService from '../services/StateService.js';
import HandModelService from '../services/HandModelService.js';
import AnimationService from '../services/AnimationService.js';
import SensorSimulationService from '../services/SensorSimulationService.js';
import SignRecognitionService from '../services/SignRecognitionService.js';
import HandController from '../controllers/HandController.js';
import ControlPanelView from '../views/ControlPanelView.js';
import { FINGERS, ORIENTATION_AXES } from '../config/handConfig.js';
import { PRESET_POSES, findSign } from '../data/signs.js';

const RECOGNITION_INTERVAL = 0.08;
const NEUTRAL_ORIENTATION = { pitch: 0, yaw: 0, roll: 0 };

export default class App {
  constructor(container) {
    this.sceneService = new SceneService(container);
    this.state = new StateService();
    this.hand = new HandModelService();
    this.animation = new AnimationService();
    this.sensors = new SensorSimulationService();
    this.recognition = new SignRecognitionService();
    this.controller = new HandController(this.hand, this.state);
    this.view = new ControlPanelView(this);

    this.sceneService.add(this.hand.root);
    this.animationId = null;
    this.recognitionTimer = 0;
    this.fps = { frames: 0, time: 0 };
    this.lastDetection = null;

    this.state.setFingers(PRESET_POSES.relaxed);
    this.hand.snapToTarget();

    this.loadModel();
    this.start();
  }

  async loadModel() {
    this.view.setLoading(0);
    const ok = await this.hand.load((progress) => this.view.setLoading(progress));
    this.hand.snapToTarget();
    this.view.setModelStatus(ok ? 'ready' : 'fallback');
  }

  // ---------------------------------------------------------------------------
  // Acciones (invocadas desde la vista)
  // ---------------------------------------------------------------------------

  setFinger(finger, value) {
    this.stopSequence();
    this.state.set({ activeSign: null });
    this.state.setFinger(finger, value);
  }

  setOrientation(axis, value) {
    this.state.setOrientation(axis, value);
  }

  playSign(id) {
    this.stopSequence();
    this.showSign(id);
  }

  showSign(id) {
    const sign = findSign(id);
    if (!sign) {
      return;
    }
    this.state.set({ activeSign: sign.id });
    this.state.setFingers(sign.pose);
  }

  spell(word) {
    const letters = [...String(word).toUpperCase()].filter((char) => char.trim());
    const steps = [];

    letters.forEach((letter, index) => {
      if (!findSign(letter)) {
        return;
      }
      // Entre dos letras iguales se relaja la mano para que se note la repetición.
      if (steps.length && steps[steps.length - 1].letter === letter) {
        steps.push({ letter: null, duration: 380 });
      }
      steps.push({ letter, index });
    });

    if (!steps.length) {
      this.view.setSpellProgress(letters, -1, false);
      return;
    }

    this.view.setSpellProgress(letters, -1, true);
    this.animation.playSequence(steps, {
      interval: this.view.getSpellInterval(),
      onStep: (step) => {
        if (step.letter) {
          this.showSign(step.letter);
          this.view.setSpellProgress(letters, step.index, true);
        } else {
          this.state.setFingers(PRESET_POSES.relaxed);
        }
      },
      onDone: () => this.view.setSpellProgress(letters, letters.length, false),
    });
  }

  stopSequence() {
    if (this.animation.playing) {
      this.animation.stop();
      this.view.setSpellProgress([], -1, false);
    }
  }

  applyPreset(name) {
    const pose = PRESET_POSES[name];
    if (!pose) {
      return;
    }
    this.stopSequence();
    this.state.set({ activeSign: null });
    this.state.setFingers(pose);
  }

  reset() {
    this.stopSequence();
    this.state.set({ activeSign: null });
    this.state.setFingers(PRESET_POSES.relaxed);
    this.state.setOrientations(NEUTRAL_ORIENTATION);
    this.sceneService.setView('angled');
  }

  toggleSensors() {
    this.state.set({ sensorsVisible: !this.state.getState().sensorsVisible });
  }

  toggleAutoRotate() {
    const autoRotate = !this.state.getState().autoRotate;
    this.state.set({ autoRotate });
    this.sceneService.setAutoRotate(autoRotate);
  }

  setView(name) {
    this.sceneService.setView(name);
  }

  // ---------------------------------------------------------------------------
  // Bucle principal
  // ---------------------------------------------------------------------------

  start() {
    const frame = () => {
      this.animationId = requestAnimationFrame(frame);

      const delta = this.sceneService.tick();
      const pose = this.hand.update(delta);

      this.recognitionTimer += delta;
      if (this.recognitionTimer >= RECOGNITION_INTERVAL) {
        this.recognitionTimer = 0;
        this.updateReadouts(pose);
      }

      this.sceneService.render();
      this.trackFps(delta);
    };

    frame();
  }

  // El reconocimiento usa la pose animada, igual que lo haría el guante real
  // leyendo sus sensores mientras la mano se mueve.
  updateReadouts(pose) {
    const readings = Object.fromEntries(FINGERS.map((finger) => [finger, this.sensors.read(pose.fingers[finger])]));
    const liveResult = this.recognition.recognize(pose.fingers, pose.orientation);
    const activeSign = this.state.getState().activeSign;
    const result = activeSign ? (() => {
      const sign = findSign(activeSign);
      return sign ? {
        id: sign.id,
        name: sign.name,
        confidence: 100,
        sign,
        ranking: [{ sign, score: 1 }],
      } : liveResult;
    })() : liveResult;

    if (result.id && result.id !== this.lastDetection) {
      this.view.pushHistory(result);
    }
    this.lastDetection = result.id;

    this.view.updateLive({
      fingers: pose.fingers,
      orientation: Object.fromEntries(ORIENTATION_AXES.map((axis) => [axis, pose.orientation[axis]])),
      readings,
      result,
    });
  }

  trackFps(delta) {
    this.fps.frames += 1;
    this.fps.time += delta;
    if (this.fps.time >= 0.5) {
      this.view.setFps(Math.round(this.fps.frames / this.fps.time));
      this.fps.frames = 0;
      this.fps.time = 0;
    }
  }

  stop() {
    cancelAnimationFrame(this.animationId);
    this.animation.stop();
  }

  dispose() {
    this.stop();
    this.sceneService.dispose();
  }
}
