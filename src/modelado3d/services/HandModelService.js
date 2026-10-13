import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FINGERS, ORIENTATION_AXES, RIG, MOTION } from '../config/handConfig.js';

const DEG = THREE.MathUtils.DEG2RAD;
const AXES = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

const SENSOR_COLORS = [new THREE.Color(0x5cf2c3), new THREE.Color(0xffc15e), new THREE.Color(0xff6b7a)];

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const smoothstep = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

function emptyPose() {
  return {
    fingers: Object.fromEntries(FINGERS.map((finger) => [finger, 0])),
    orientation: Object.fromEntries(ORIENTATION_AXES.map((axis) => [axis, 0])),
  };
}

/**
 * Carga el modelo GLB, lo prepara para exhibición y lo anima.
 *
 * Toda la pose se aplica como rotaciones relativas al cuaternión de reposo de
 * cada hueso, así que nunca se acumulan errores ni se mezclan ángulos de Euler.
 */
export default class HandModelService {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'hand-root';

    this.mode = 'none';
    this.bones = {};
    this.restQuaternions = new Map();
    this.boneExtents = new Map();
    this.sensors = [];
    this.imu = null;
    this.sensorsVisible = true;
    this.elapsed = 0;

    this.target = emptyPose();
    this.current = emptyPose();

    // Corta el brazo bajo el pedestal para mostrar solo mano y antebrazo.
    this.clippingPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -RIG.display.clipHeight);

    this._quat = new THREE.Quaternion();
    this._step = new THREE.Quaternion();
  }

  async load(onProgress) {
    const loader = new GLTFLoader();

    for (const path of RIG.modelPaths) {
      try {
        const gltf = await loader.loadAsync(path, (event) => {
          if (event.total) {
            onProgress?.(event.loaded / event.total);
          }
        });
        this.setupModel(gltf.scene);
        return true;
      } catch (error) {
        console.warn(`No se pudo cargar el modelo desde ${path}`, error);
      }
    }

    this.buildProceduralHand();
    return false;
  }

  // ---------------------------------------------------------------------------
  // Preparación del modelo
  // ---------------------------------------------------------------------------

  setupModel(scene) {
    scene.traverse((object) => {
      if (object.isBone) {
        this.bones[object.name] = object;
      }
    });

    scene.traverse((object) => {
      if (!object.isMesh) {
        return;
      }

      object.castShadow = true;
      object.receiveShadow = true;
      // Los huesos deforman la malla fuera de su bounding sphere original:
      // sin esto three.js puede descartar la malla al flexionar.
      object.frustumCulled = false;

      if (object.isSkinnedMesh) {
        this.paintRegions(object);
      }
      object.material = this.createShellMaterial({ vertexColors: object.isSkinnedMesh });
    });

    this.mode = 'glb';
    this.mount(scene);

    scene.traverse((object) => {
      if (object.isSkinnedMesh) {
        this.measureBoneExtents(object);
      }
    });

    this.attachSensors();
    this.applyPose(this.current);
  }

  // Coloca el modelo con la mano hacia arriba, la palma mirando a cámara y la
  // muñeca a una altura fija.
  mount(object) {
    const holder = new THREE.Group();
    holder.name = 'hand-display';
    holder.add(object);

    const flip = new THREE.Quaternion().setFromAxisAngle(AXES.z, Math.PI);
    const face = new THREE.Quaternion().setFromAxisAngle(AXES.y, -Math.PI / 2);
    holder.quaternion.multiplyQuaternions(face, flip);
    holder.scale.setScalar(RIG.display.scale);

    this.root.add(holder);
    this.root.updateMatrixWorld(true);

    const wrist = new THREE.Vector3();
    this.bones[RIG.wrist].getWorldPosition(wrist);
    this.root.worldToLocal(wrist);
    holder.position.set(-wrist.x, RIG.display.wristHeight - wrist.y, -wrist.z);
    this.root.updateMatrixWorld(true);

    [RIG.wrist, ...Object.values(RIG.bones).flat()].forEach((name) => {
      const bone = this.bones[name];
      if (bone) {
        this.restQuaternions.set(bone, bone.quaternion.clone());
      } else {
        console.warn(`Hueso no encontrado en el modelo: ${name}`);
      }
    });
  }

  // Asigna colores por vértice mezclando el color de cada hueso según sus pesos.
  paintRegions(mesh) {
    const { geometry, skeleton } = mesh;
    const skinIndex = geometry.attributes.skinIndex;
    const skinWeight = geometry.attributes.skinWeight;
    const colors = new Float32Array(skinIndex.count * 3);
    const boneColors = skeleton.bones.map((bone) => new THREE.Color(this.regionColor(bone.name)));
    const mixed = new THREE.Color();

    for (let i = 0; i < skinIndex.count; i += 1) {
      mixed.setRGB(0, 0, 0);
      for (let k = 0; k < 4; k += 1) {
        const weight = skinWeight.getComponent(i, k);
        if (weight > 0) {
          const color = boneColors[skinIndex.getComponent(i, k)];
          mixed.r += color.r * weight;
          mixed.g += color.g * weight;
          mixed.b += color.b * weight;
        }
      }
      colors[i * 3] = mixed.r;
      colors[i * 3 + 1] = mixed.g;
      colors[i * 3 + 2] = mixed.b;
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  regionColor(boneName) {
    const { regionColors } = RIG;
    if (/^(Thumb|Index|Middle|Ring|Little)_\d$/.test(boneName)) return regionColors.finger;
    if (boneName === 'Hand') return regionColors.hand;
    if (boneName === 'Elbow') return regionColors.joint;
    if (/piston/i.test(boneName)) return regionColors.piston;
    return regionColors.shell;
  }

  createShellMaterial({ vertexColors = false, color = 0xffffff } = {}) {
    return new THREE.MeshPhysicalMaterial({
      color,
      vertexColors,
      roughness: 0.38,
      metalness: 0.06,
      clearcoat: 0.6,
      clearcoatRoughness: 0.28,
      side: THREE.DoubleSide,
      clippingPlanes: [this.clippingPlane],
      clipShadows: true,
    });
  }

  // Calcula, en el espacio local de cada hueso, la caja que ocupan los vértices
  // que ese hueso controla. Sirve para pegar los sensores a la superficie.
  measureBoneExtents(mesh) {
    const { geometry, skeleton } = mesh;
    const skinIndex = geometry.attributes.skinIndex;
    const skinWeight = geometry.attributes.skinWeight;
    const vertex = new THREE.Vector3();

    mesh.updateMatrixWorld(true);
    skeleton.update();

    for (let i = 0; i < skinIndex.count; i += 1) {
      let best = 0;
      let bestWeight = 0;
      for (let k = 0; k < 4; k += 1) {
        const weight = skinWeight.getComponent(i, k);
        if (weight > bestWeight) {
          bestWeight = weight;
          best = skinIndex.getComponent(i, k);
        }
      }

      const bone = skeleton.bones[best];
      if (!this.restQuaternions.has(bone)) {
        continue;
      }

      mesh.getVertexPosition(i, vertex);
      mesh.applyBoneTransform(i, vertex);
      mesh.localToWorld(vertex);
      bone.worldToLocal(vertex);

      const box = this.boneExtents.get(bone) || new THREE.Box3();
      box.expandByPoint(vertex);
      this.boneExtents.set(bone, box);
    }
  }

  // ---------------------------------------------------------------------------
  // Sensores del guante
  // ---------------------------------------------------------------------------

  attachSensors() {
    const stripGeometry = new RoundedBoxGeometry(1, 1, 1, 2, 0.25);

    FINGERS.forEach((finger) => {
      const chain = RIG.bones[finger].map((name) => this.bones[name]).filter(Boolean);
      if (chain.length < 2) {
        return;
      }

      // Dorso del dedo: +X local en las falanges, -X local en el pulgar.
      const side = finger === 'thumb' ? -1 : 1;
      const material = new THREE.MeshStandardMaterial({
        color: 0x10141a,
        emissive: SENSOR_COLORS[0].clone(),
        emissiveIntensity: 0.8,
        roughness: 0.3,
        metalness: 0.2,
      });

      const segments = finger === 'thumb' ? chain : chain.slice(0, 2);
      segments.forEach((bone, index) => {
        const next = chain[index + 1];
        const length = next ? next.position.length() : 0.075;
        const extents = this.boneExtents.get(bone);
        const surface = extents ? (side > 0 ? extents.max.x : -extents.min.x) : 0.02;
        const width = extents ? Math.min(0.02, (extents.max.z - extents.min.z) * 0.5) : 0.016;

        const strip = new THREE.Mesh(stripGeometry, material);
        strip.scale.set(0.007, length * 0.72, width);
        strip.position.set(side * (surface + 0.002), length * 0.5, extents ? extents.getCenter(new THREE.Vector3()).z : 0);
        strip.castShadow = true;
        strip.name = `${finger}-flex-sensor`;
        bone.add(strip);
      });

      this.sensors.push({ finger, material });
    });

    this.attachImu();
    this.setSensorsVisible(this.sensorsVisible);
  }

  attachImu() {
    const hand = this.bones[RIG.wrist];
    if (!hand) {
      return;
    }

    const extents = this.boneExtents.get(hand);
    const back = extents ? extents.max.x : 0.035;

    const module = new THREE.Group();
    module.name = 'imu-mpu6050';

    const board = new THREE.Mesh(
      new RoundedBoxGeometry(0.012, 0.085, 0.07, 2, 0.004),
      new THREE.MeshStandardMaterial({ color: 0x1b2230, roughness: 0.45, metalness: 0.35 })
    );
    board.castShadow = true;
    module.add(board);

    const chip = new THREE.Mesh(
      new THREE.BoxGeometry(0.006, 0.03, 0.03),
      new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.6 })
    );
    chip.position.x = 0.008;
    module.add(chip);

    this.imuLed = new THREE.Mesh(
      new THREE.SphereGeometry(0.0055, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0x7b8cff, emissive: 0x7b8cff, emissiveIntensity: 2 })
    );
    this.imuLed.position.set(0.008, -0.03, 0.024);
    module.add(this.imuLed);

    module.position.set(back + 0.004, 0.26, extents ? extents.getCenter(new THREE.Vector3()).z : 0);
    hand.add(module);
    this.imu = module;
  }

  setSensorsVisible(visible) {
    this.sensorsVisible = Boolean(visible);
    this.root.traverse((object) => {
      if (object.name.endsWith('-flex-sensor')) {
        object.visible = this.sensorsVisible;
      }
    });
    if (this.imu) {
      this.imu.visible = this.sensorsVisible;
    }
  }

  // ---------------------------------------------------------------------------
  // Pose y animación
  // ---------------------------------------------------------------------------

  setFingerTarget(finger, value) {
    if (finger in this.target.fingers) {
      this.target.fingers[finger] = Math.min(100, Math.max(0, Number(value) || 0));
    }
  }

  setOrientationTarget(axis, value) {
    if (axis in this.target.orientation) {
      this.target.orientation[axis] = Number(value) || 0;
    }
  }

  // Salta directamente a la pose objetivo (sin interpolación).
  snapToTarget() {
    Object.assign(this.current.fingers, this.target.fingers);
    Object.assign(this.current.orientation, this.target.orientation);
    this.applyPose(this.current);
  }

  update(delta) {
    const dt = Math.min(delta, 0.05);
    this.elapsed += dt;

    const fingerBlend = 1 - Math.exp(-MOTION.fingerStiffness * dt);
    const wristBlend = 1 - Math.exp(-MOTION.wristStiffness * dt);

    FINGERS.forEach((finger) => {
      this.current.fingers[finger] = this.approach(this.current.fingers[finger], this.target.fingers[finger], fingerBlend);
    });
    ORIENTATION_AXES.forEach((axis) => {
      this.current.orientation[axis] = this.approach(
        this.current.orientation[axis],
        this.target.orientation[axis],
        wristBlend
      );
    });

    this.applyPose(this.current);
    this.updateSensorGlow();
    return this.current;
  }

  approach(current, target, blend) {
    const next = current + (target - current) * blend;
    return Math.abs(target - next) < 0.02 ? target : next;
  }

  applyPose(pose) {
    if (this.mode === 'none') {
      return;
    }

    FINGERS.forEach((finger) => {
      const t = clamp01(pose.fingers[finger] / 100);
      const chain = RIG.bones[finger].map((name) => this.bones[name]);

      if (finger === 'thumb') {
        const { restAdduction, fullAdduction, opposition, distal } = RIG.thumb;
        const adduction = THREE.MathUtils.lerp(restAdduction, fullAdduction, smoothstep(0.12, 1, t));
        const curl = smoothstep(0.18, 1, t);
        this.rotateFromRest(chain[0], [['x', adduction], ['z', opposition * curl]]);
        this.rotateFromRest(chain[1], [['z', distal * curl]]);
        return;
      }

      const [mcp, pip, dip] = RIG.fingerCurl;
      const spread = RIG.fingerSpread[finger] || 0;
      // La articulación MCP arranca un poco antes; PIP y DIP la siguen.
      this.rotateFromRest(chain[0], [['z', mcp * smoothstep(0, 0.85, t)], ['x', spread * (1 - t)]]);
      this.rotateFromRest(chain[1], [['z', pip * smoothstep(0.08, 1, t)]]);
      this.rotateFromRest(chain[2], [['z', dip * smoothstep(0.15, 1, t)]]);
    });

    const { wristAxes } = RIG;
    this.rotateFromRest(this.bones[RIG.wrist], [
      [wristAxes.pitch, pose.orientation.pitch],
      [wristAxes.yaw, pose.orientation.yaw],
      [wristAxes.roll, pose.orientation.roll],
    ]);
  }

  rotateFromRest(bone, rotations) {
    const rest = bone && this.restQuaternions.get(bone);
    if (!rest) {
      return;
    }

    this._quat.copy(rest);
    rotations.forEach(([axis, degrees]) => {
      if (degrees) {
        this._quat.multiply(this._step.setFromAxisAngle(AXES[axis], degrees * DEG));
      }
    });
    bone.quaternion.copy(this._quat);
  }

  updateSensorGlow() {
    this.sensors.forEach(({ finger, material }) => {
      const t = clamp01(this.current.fingers[finger] / 100);
      if (t < 0.5) {
        material.emissive.lerpColors(SENSOR_COLORS[0], SENSOR_COLORS[1], t * 2);
      } else {
        material.emissive.lerpColors(SENSOR_COLORS[1], SENSOR_COLORS[2], (t - 0.5) * 2);
      }
      material.emissiveIntensity = 0.7 + t * 0.9;
    });

    if (this.imuLed) {
      this.imuLed.material.emissiveIntensity = 1.2 + Math.sin(this.elapsed * 4) * 0.8;
    }
  }

  // ---------------------------------------------------------------------------
  // Mano procedural de respaldo (si el GLB no carga)
  // ---------------------------------------------------------------------------

  // Se construye en el mismo sistema de coordenadas que el GLB original
  // (Y local a lo largo de cada dedo, palma hacia -X, flexión sobre +Z), así que
  // reutiliza exactamente la misma lógica de pose y montaje.
  buildProceduralHand() {
    const shell = this.createShellMaterial({ color: RIG.regionColors.hand });
    const graphite = this.createShellMaterial({ color: RIG.regionColors.finger });

    const base = new THREE.Group();
    base.rotation.x = Math.PI;

    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.095, 1.3, 40), shell);
    forearm.position.y = -0.65;
    base.add(forearm);

    const hand = this.createBone('Hand', base, [0, 0, 0]);
    const palm = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.46, 0.25, 4, 0.03), shell);
    palm.position.y = 0.26;
    hand.add(palm);
    this.boneExtents.set(hand, new THREE.Box3(new THREE.Vector3(-0.035, 0, -0.125), new THREE.Vector3(0.035, 0.49, 0.125)));

    const layout = { index: [-0.09, 1], middle: [-0.03, 1.08], ring: [0.03, 1], pinky: [0.09, 0.82] };
    Object.entries(layout).forEach(([finger, [z, scale]]) => {
      const [n1, n2, n3] = RIG.bones[finger];
      const lengths = [0.12, 0.1, 0.085].map((length) => length * scale);
      const b1 = this.createBone(n1, hand, [0, 0.49, z]);
      const b2 = this.createBone(n2, b1, [0, lengths[0], 0]);
      const b3 = this.createBone(n3, b2, [0, lengths[1], 0]);
      [b1, b2, b3].forEach((bone, index) => this.addSegment(bone, lengths[index], 0.019 - index * 0.002, graphite));
    });

    // Base del pulgar: Y local hacia afuera (-Z de la mano), X local hacia la palma.
    const t1 = this.createBone('Thumb_1', hand, [0, 0.16, -0.12]);
    t1.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, -1, 0)
    ));
    const t2 = this.createBone('Thumb_2', t1, [0, 0.12, 0]);
    this.addSegment(t1, 0.12, 0.023, graphite);
    this.addSegment(t2, 0.1, 0.021, graphite);

    this.mode = 'procedural';
    this.mount(base);
    this.attachSensors();
    this.applyPose(this.current);
  }

  createBone(name, parent, position) {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.fromArray(position);
    parent.add(bone);
    this.bones[name] = bone;
    return bone;
  }

  addSegment(bone, length, radius, material) {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(0.001, length - radius * 2), 6, 16), material);
    mesh.position.y = length * 0.5;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    bone.add(mesh);
    this.boneExtents.set(bone, new THREE.Box3(new THREE.Vector3(-radius, 0, -radius), new THREE.Vector3(radius, length, radius)));
  }
}
