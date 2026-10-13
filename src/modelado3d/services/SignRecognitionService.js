import { SIGN_CATALOG } from '../data/signs.js';

const FINGER_WEIGHT = 0.9;
const ORIENTATION_WEIGHT = 0.1;
// Puntos de flexión fuera del rango a partir de los cuales el puntaje cae a 0.
const TOLERANCE = 16;
// Un dedo claramente fuera de rango invalida la seña aunque el resto coincida.
const VETO_SCORE = 0.6;
const THRESHOLD = 0.86;

export default class SignRecognitionService {
  constructor(catalog = SIGN_CATALOG) {
    this.catalog = catalog;
  }

  recognize(fingers, orientation) {
    const ranking = this.catalog
      .map((sign) => ({ sign, score: this.scoreSign(sign, fingers, orientation) }))
      .sort((a, b) => b.score - a.score);

    const best = ranking[0];
    if (!best || best.score < THRESHOLD) {
      return { id: null, name: 'Sin coincidencia', confidence: 0, sign: null, ranking };
    }

    return {
      id: best.sign.id,
      name: best.sign.name,
      confidence: Math.round(best.score * 100),
      sign: best.sign,
      ranking,
    };
  }

  scoreSign(sign, fingers, orientation) {
    const fingerScores = Object.entries(sign.fingers).map(([name, range]) =>
      this.rangeScore(fingers[name] ?? 0, range)
    );
    const orientationScores = Object.entries(sign.orientation).map(([axis, range]) =>
      this.rangeScore(orientation[axis] ?? 0, range)
    );

    const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 1);
    const exactMatches = fingerScores.filter((value) => value >= 0.9).length;
    const strongPattern = (exactMatches / fingerScores.length) * 0.3;

    let score = average(fingerScores) * FINGER_WEIGHT + average(orientationScores) * ORIENTATION_WEIGHT + strongPattern;

    if (fingerScores.some((value) => value < VETO_SCORE)) {
      score *= 0.55;
    }

    return Math.min(1, score);
  }

  rangeScore(value, { min, max }) {
    if (value >= min && value <= max) {
      return 1;
    }
    const distance = value < min ? min - value : value - max;
    return Math.max(0, 1 - distance / TOLERANCE);
  }
}
