import { FINGERS, ORIENTATION_AXES } from '../config/handConfig.js';

/**
 * Traduce el estado objetivo (controles de la interfaz) a objetivos de
 * animación del modelo. El modelo interpola hacia ellos en cada frame.
 */
export default class HandController {
  constructor(handModelService, stateService) {
    this.hand = handModelService;
    this.state = stateService;
    this.state.subscribe((state) => this.sync(state));
    this.sync(this.state.getState());
  }

  sync(state) {
    FINGERS.forEach((finger) => this.hand.setFingerTarget(finger, state.fingers[finger]));
    ORIENTATION_AXES.forEach((axis) => this.hand.setOrientationTarget(axis, state.orientation[axis]));
    this.hand.setSensorsVisible(state.sensorsVisible);
  }
}
