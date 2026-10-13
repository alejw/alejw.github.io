// Configuración del rig del modelo GLB (hand-prosthesis.glb).
//
// Ejes determinados inspeccionando el esqueleto:
//  - El brazo cuelga en -Y en el archivo original y la palma mira hacia -X.
//  - Para las falanges, la flexión real es una rotación sobre el eje local +Z.
//    (El eje local X es lateral: rotar sobre él cruza los dedos entre sí y los
//    hunde dentro de la palma, que era el bug de "el dedo desaparece").
//  - El pulgar se opone con rotaciones negativas en Z y se aduce con -X.

export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];

export const FINGER_LABELS = {
  thumb: 'Pulgar',
  index: 'Índice',
  middle: 'Medio',
  ring: 'Anular',
  pinky: 'Meñique',
};

export const ORIENTATION_AXES = ['pitch', 'yaw', 'roll'];
export const ORIENTATION_LIMIT = 30;

export const RIG = {
  modelPaths: ['/models/hand-prosthesis.glb', '/public/models/hand-prosthesis.glb'],

  wrist: 'Hand',

  // Nombres tal como los deja GLTFLoader (los espacios se convierten en "_").
  bones: {
    thumb: ['Thumb_1', 'Thumb_2'],
    index: ['Index_1', 'Index_2', 'Index_3'],
    middle: ['Middle_1', 'Middle_2', 'Middle_3'],
    ring: ['Ring_1', 'Ring_2', 'Ring_3'],
    pinky: ['Little_1', 'Little_2', 'Little_3'],
  },

  // Ángulo máximo (grados) por falange al 100 % de flexión: MCP, PIP, DIP.
  fingerCurl: [82, 98, 68],

  // Leve abducción natural cuando la mano está abierta (grados sobre X local).
  fingerSpread: { index: 4, middle: 0, ring: -3, pinky: -7 },

  // Rangos del pulgar (grados). t = flexión normalizada 0..1.
  thumb: {
    restAdduction: -28,
    fullAdduction: -78,
    opposition: -48,
    distal: -62,
  },

  // Orientación de la muñeca (IMU) sobre ejes locales del hueso Hand.
  wristAxes: { pitch: 'z', yaw: 'x', roll: 'y' },

  // Transformación de exhibición: mano hacia arriba con la palma a cámara.
  display: {
    scale: 1.65,
    wristHeight: 1.05,
    clipHeight: 0.12,
  },

  // Colores por región (se mezclan con los pesos del skinning).
  regionColors: {
    shell: 0xeae7e1,
    hand: 0xf2f0ec,
    finger: 0x2b313b,
    joint: 0x1d2128,
    piston: 0x9aa3ad,
  },
};

// Suavizado del movimiento (mayor = respuesta más rápida).
export const MOTION = {
  fingerStiffness: 11,
  wristStiffness: 7,
};

// Simulación eléctrica del sensor flex (divisor de tensión, ADC 10 bits).
export const FLEX_SENSOR = {
  flatResistance: 25,
  bentResistance: 100,
  pullDown: 47,
  vcc: 5,
  adcMax: 1023,
};
