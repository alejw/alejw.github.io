import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RIG } from '../config/handConfig.js';

const FOCUS = new THREE.Vector3(0, 1.62, 0);

export const CAMERA_VIEWS = {
  front: { label: 'Palma', position: [0, 1.75, 4.3] },
  angled: { label: '3/4', position: [2.7, 2.15, 3.3] },
  side: { label: 'Lateral', position: [4.3, 1.75, 0.2] },
  back: { label: 'Dorso', position: [-0.6, 1.9, -4.2] },
};

export default class SceneService {
  constructor(container) {
    this.container = container;
    this.clock = new THREE.Clock();
    this.cameraTween = null;

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.05, 60);
    this.camera.position.fromArray(CAMERA_VIEWS.angled.position);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.localClippingEnabled = true;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(FOCUS);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 2.2;
    this.controls.maxDistance = 7.5;
    this.controls.maxPolarAngle = Math.PI * 0.58;
    this.controls.autoRotateSpeed = 1.4;
    this.controls.addEventListener('start', () => {
      this.cameraTween = null;
    });

    this.createEnvironment();
    this.createLights();
    this.createStage();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
  }

  createEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(this.renderer), 0.04).texture;
    pmrem.dispose();
  }

  createLights() {
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x0b0e14, 0.6));

    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(3, 6, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 16;
    key.shadow.camera.left = -2;
    key.shadow.camera.right = 2;
    key.shadow.camera.top = 3.5;
    key.shadow.camera.bottom = -1;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.target.position.copy(FOCUS);
    this.scene.add(key, key.target);

    const rim = new THREE.DirectionalLight(0x5cf2c3, 1.6);
    rim.position.set(-4, 3, -3);
    this.scene.add(rim);

    const fill = new THREE.PointLight(0x7b8cff, 6, 12, 2);
    fill.position.set(-2.5, 1.4, 2.5);
    this.scene.add(fill);
  }

  // Pedestal donde se apoya el antebrazo cortado, con anillos luminosos.
  createStage() {
    const stage = new THREE.Group();
    stage.name = 'stage';
    const top = RIG.display.clipHeight + 0.015;

    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.62, 0.72, 0.34, 96),
      new THREE.MeshPhysicalMaterial({ color: 0x141922, roughness: 0.35, metalness: 0.7, clearcoat: 0.4 })
    );
    pedestal.position.y = top - 0.17;
    pedestal.receiveShadow = true;
    pedestal.castShadow = true;
    stage.add(pedestal);

    const cap = new THREE.Mesh(
      new THREE.CircleGeometry(0.6, 96),
      new THREE.MeshPhysicalMaterial({ color: 0x1b222d, roughness: 0.25, metalness: 0.5, clearcoat: 1 })
    );
    cap.rotation.x = -Math.PI / 2;
    cap.position.y = top + 0.001;
    cap.receiveShadow = true;
    stage.add(cap);

    const glow = (radius, tube, color, y, opacity) => {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(radius, tube, 12, 160),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, toneMapped: false })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      stage.add(ring);
      return ring;
    };

    glow(0.615, 0.006, 0x5cf2c3, top, 0.95);
    glow(0.7, 0.004, 0x7b8cff, top - 0.3, 0.6);

    this.floorRings = new THREE.Group();
    [1.1, 1.6, 2.2, 2.9].forEach((radius, index) => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius, radius + 0.008, 160),
        new THREE.MeshBasicMaterial({
          color: index % 2 ? 0x7b8cff : 0x5cf2c3,
          transparent: true,
          opacity: 0.22 - index * 0.04,
          side: THREE.DoubleSide,
          toneMapped: false,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      this.floorRings.add(ring);
    });
    this.floorRings.position.y = top - 0.335;
    stage.add(this.floorRings);

    const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 64), new THREE.ShadowMaterial({ opacity: 0.35 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = top - 0.34;
    floor.receiveShadow = true;
    stage.add(floor);

    this.scene.add(stage);
  }

  add(object) {
    this.scene.add(object);
  }

  setView(name, animate = true) {
    const view = CAMERA_VIEWS[name];
    if (!view) {
      return;
    }

    const to = new THREE.Vector3().fromArray(view.position);
    if (!animate) {
      this.camera.position.copy(to);
      this.controls.target.copy(FOCUS);
      return;
    }

    this.cameraTween = {
      from: this.camera.position.clone(),
      to,
      fromTarget: this.controls.target.clone(),
      elapsed: 0,
      duration: 0.9,
    };
  }

  setAutoRotate(enabled) {
    this.controls.autoRotate = Boolean(enabled);
  }

  updateCameraTween(delta) {
    const tween = this.cameraTween;
    if (!tween) {
      return;
    }

    tween.elapsed += delta;
    const t = Math.min(1, tween.elapsed / tween.duration);
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    // Interpola en coordenadas esféricas para orbitar en vez de atravesar el modelo.
    const from = new THREE.Spherical().setFromVector3(tween.from.clone().sub(FOCUS));
    const to = new THREE.Spherical().setFromVector3(tween.to.clone().sub(FOCUS));
    let dTheta = to.theta - from.theta;
    if (dTheta > Math.PI) dTheta -= Math.PI * 2;
    if (dTheta < -Math.PI) dTheta += Math.PI * 2;

    const current = new THREE.Spherical(
      THREE.MathUtils.lerp(from.radius, to.radius, eased),
      THREE.MathUtils.lerp(from.phi, to.phi, eased),
      from.theta + dTheta * eased
    );
    this.camera.position.setFromSpherical(current).add(FOCUS);
    this.controls.target.lerpVectors(tween.fromTarget, FOCUS, eased);

    if (t >= 1) {
      this.cameraTween = null;
    }
  }

  resize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (!width || !height) {
      return;
    }

    this.camera.aspect = width / height;
    // En pantallas angostas se aleja la cámara para que la mano no se corte.
    this.camera.fov = width / height < 0.85 ? 42 : 32;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  // Devuelve el delta del frame para que el resto de servicios se sincronice.
  tick() {
    const delta = this.clock.getDelta();
    this.updateCameraTween(delta);
    this.controls.update();
    if (this.floorRings) {
      this.floorRings.rotation.y += delta * 0.08;
    }
    return delta;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
