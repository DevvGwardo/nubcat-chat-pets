import * as THREE from "three";

// Transparent-background three.js stage: perspective camera in a fixed
// 3/4 view, soft lights, an invisible ground plane, and helpers to know
// where the ground is visible on screen.

export function createScene(container) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0); // fully transparent for OBS compositing
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    42,
    window.innerWidth / window.innerHeight,
    0.1,
    200
  );
  camera.position.set(0, 9.5, 13);
  camera.lookAt(0, 0.6, 0);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x99a3b8, 0.85);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xfff4e0, 1.15);
  dir.position.set(6, 12, 7);
  scene.add(dir);

  // Invisible plane used for ground raycasts (spawn points / bounds).
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const raycaster = new THREE.Raycaster();

  // Screen-space corners -> world-space points on the y=0 plane.
  function screenToGround(nx, ny) {
    raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
    const hits = raycaster.intersectObject(ground);
    return hits.length ? hits[0].point : null;
  }

  // Rectangle of ground visible on screen, inset by marginPx from each edge.
  function groundBounds(marginPx = 90) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const mx = marginPx / w;
    const my = marginPx / h;
    const nearLeft = screenToGround(-1 + mx, -0.35);
    const nearRight = screenToGround(1 - mx, -0.35);
    const farLeft = screenToGround(-1 + mx * 1.5, 0.05);
    const farRight = screenToGround(1 - mx * 1.5, 0.05);
    if (!nearLeft || !nearRight || !farLeft || !farRight) {
      return { minX: -8, maxX: 8, minZ: -3, maxZ: 4 };
    }
    return {
      minX: Math.min(farLeft.x, nearLeft.x),
      maxX: Math.max(farRight.x, nearRight.x),
      minZ: Math.min(farLeft.z, farRight.z),
      maxZ: Math.max(nearLeft.z, nearRight.z),
    };
  }

  function projectToScreen(v3) {
    const v = v3.clone().project(camera);
    return {
      x: (v.x * 0.5 + 0.5) * window.innerWidth,
      y: (-v.y * 0.5 + 0.5) * window.innerHeight,
      behind: v.z > 1,
    };
  }

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  window.addEventListener("resize", resize);

  return { renderer, scene, camera, groundBounds, projectToScreen };
}
