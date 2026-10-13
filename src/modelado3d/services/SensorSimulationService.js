import { FLEX_SENSOR } from '../config/handConfig.js';

/**
 * Simula la lectura eléctrica de un sensor flex conectado en divisor de
 * tensión (sensor arriba, resistencia fija a tierra) leído por un ADC.
 */
export default class SensorSimulationService {
  read(flexPercent) {
    const { flatResistance, bentResistance, pullDown, vcc, adcMax } = FLEX_SENSOR;
    const t = Math.min(100, Math.max(0, Number(flexPercent) || 0)) / 100;

    const resistance = flatResistance + (bentResistance - flatResistance) * t;
    const voltage = (vcc * pullDown) / (resistance + pullDown);
    const adc = Math.round((voltage / vcc) * adcMax);

    return { resistance, voltage, adc };
  }
}
