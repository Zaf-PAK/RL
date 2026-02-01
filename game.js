// Import Three.js and Cannon-es from CDN
import * as THREE from "https://unpkg.com/three@0.165.0/build/three.module.js";
import * as CANNON from "https://unpkg.com/cannon-es@0.20.0/dist/cannon-es.js";

/*
  Mini Rocket League-Style Game (Advanced Stadium)
  - Player car with jump + boost
  - AI car that chases the ball
  - Physics ball, walls, goals
  - Boost pads with cooldown
  - Match timer + pause menu
  - Car colour customiser
  - Enclosed "stadium" with glowing rims & goal zones
*/

// ------------------- Basic setup -------------------- //
let scene, camera, renderer;
let world;
let lastTime;

// Objects
let pitchBody;
let ballBody, ballMesh;
let playerBody, playerMesh;
let aiBody, aiMesh;

// Constants
const PITCH_LENGTH = 80; // along X
const PITCH_WIDTH = 50;  // along Z
const WALL_HEIGHT = 8;
const GOAL_WIDTH = 20;   // opening width along Z
const GOAL_DEPTH = 5;
const BALL_RADIUS = 2;

const PLAYER_COLOUR_DEFAULT = 0x4caf50;
const AI_COLOUR = 0xf44336;

// Game state
let keys = {};
let playerHeading = 0;
let aiHeading = Math.PI; // roughly face the other way at start

let playerScore = 0;
let aiScore = 0;

// UI elements
const messageElement = document.getElementById("message");
const playerScoreEl = document.getElementById("player-score");
const aiScoreEl = document.getElementById("ai-score");
const boostBarEl = document.getElementById("boost-bar-fill");
const timerEl = document.getElementById("timer");
const pauseOverlay = document.getElementById("pause-overlay");
const pauseBtn = document.getElementById("pause-btn");
const resumeBtn = document.getElementById("resume-btn");
const restartBtn = document.getElementById("restart-btn");

// Boost + jump
let playerBoost = 100;        // 0–100
const BOOST_DRAIN_RATE = 40;  // per second
const BOOST_REGEN_RATE = 20;  // per second
const PLAYER_MAX_SPEED = 40;
const PLAYER_ACCEL = 60;
const PLAYER_BOOST_ACCEL = 140;
const PLAYER_TURN_SPEED = 2.0; // rad/sec

const JUMP_VELOCITY = 22;
const GROUND_EPSILON = 2.5;

// AI params
const AI_MAX_SPEED = 32;
const AI_ACCEL = 50;
const AI_TURN_SPEED = 1.6;

// Goal / reset control
let isResetting = false;
let resetTimer = 0;
const RESET_DELAY = 2.0; // seconds

// Match timer & pause
const MATCH_DURATION = 180; // seconds (3 mins)
let remainingTime = MATCH_DURATION;
let isPaused = false;
let isMatchOver = false;

// Boost pads
let boostPads = [];
const BOOST_PAD_RADIUS = 2.5;
const BOOST_PAD_COOLDOWN = 5; // seconds

// ------------------- Init & loop -------------------- //

init();
animate();

function init() {
  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060a);

  // Camera
  camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    500
  );
  camera.position.set(0, 40, 60);
  camera.lookAt(new THREE.Vector3(0, 0, 0));

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);

  // Lights
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x0a0a0a, 0.6);
  scene.add(hemiLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(0, 50, 20);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  scene.add(dirLight);

  // Physics world
  world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -24, 0),
  });
  world.broadphase = new CANNON.NaiveBroadphase();
  world.solver.iterations = 12;

  createPitch();
  createWallsAndGoals();
  createBall();
  createPlayer();
  createAI();
  createBoostPads();
  createStadiumShell();

  // Input
  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyP" || e.code === "Escape") {
      togglePause();
      return;
    }
    keys[e.code] = true;
  });

  window.addEventListener("keyup", (e) => {
    keys[e.code] = false;
  });

  window.addEventListener("resize", onWindowResize);

  setupUIInteractions();
  updateScoreUI();
  updateTimerUI();
  showMessage("KICK-OFF");
}

function animate(time) {
  requestAnimationFrame(animate);

  const dt = lastTime ? (time - lastTime) / 1000 : 0;
  lastTime = time;

  if (dt > 0) {
    stepGame(dt);
  }

  renderer.render(scene, camera);
}

// ------------------- Scene creation -------------------- //

function createPitch() {
  const pitchGeometry = new THREE.PlaneGeometry(
    PITCH_LENGTH,
    PITCH_WIDTH,
    1,
    1
  );
  const pitchMaterial = new THREE.MeshStandardMaterial({
    color: 0x125912,
    metalness: 0.2,
    roughness: 0.95,
  });
  const pitchMesh = new THREE.Mesh(pitchGeometry, pitchMaterial);
  pitchMesh.receiveShadow = true;
  pitchMesh.rotation.x = -Math.PI / 2;
  scene.add(pitchMesh);

  // Centre line
  const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff });
  const lineGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0.02, -PITCH_WIDTH / 2),
    new THREE.Vector3(0, 0.02, PITCH_WIDTH / 2),
  ]);
  const centreLine = new THREE.Line(lineGeom, lineMat);
  centreLine.rotation.x = -Math.PI / 2;
  pitchMesh.add(centreLine);

  // Outer border lines
  const borderPoints = [
    new THREE.Vector3(-PITCH_LENGTH / 2, 0.02, -PITCH_WIDTH / 2),
    new THREE.Vector3(PITCH_LENGTH / 2, 0.02, -PITCH_WIDTH / 2),
    new THREE.Vector3(PITCH_LENGTH / 2, 0.02, PITCH_WIDTH / 2),
    new THREE.Vector3(-PITCH_LENGTH / 2, 0.02, PITCH_WIDTH / 2),
    new THREE.Vector3(-PITCH_LENGTH / 2, 0.02, -PITCH_WIDTH / 2),
  ];
  const borderGeom = new THREE.BufferGeometry().setFromPoints(borderPoints);
  const borderLine = new THREE.Line(borderGeom, lineMat);
  borderLine.rotation.x = -Math.PI / 2;
  pitchMesh.add(borderLine);

  // Centre circle
  const centerCircleGeom = new THREE.RingGeometry(6.5, 6.9, 64);
  const centerCircleMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
  });
  const centerCircle = new THREE.Mesh(centerCircleGeom, centerCircleMat);
  centerCircle.rotation.x = -Math.PI / 2;
  centerCircle.position.y = 0.03;
  pitchMesh.add(centerCircle);

  // Coloured goal zones (Rocket League style)
  const goalZoneDepth = 16;

  const orangeMat = new THREE.MeshBasicMaterial({
    color: 0xff6f00,
    transparent: true,
    opacity: 0.25,
    side: THREE.DoubleSide,
  });
  const blueMat = new THREE.MeshBasicMaterial({
    color: 0x1976d2,
    transparent: true,
    opacity: 0.25,
    side: THREE.DoubleSide,
  });

  const orangeZoneGeom = new THREE.PlaneGeometry(goalZoneDepth, PITCH_WIDTH);
  const blueZoneGeom = new THREE.PlaneGeometry(goalZoneDepth, PITCH_WIDTH);

  const orangeZone = new THREE.Mesh(orangeZoneGeom, orangeMat);
  orangeZone.rotation.x = -Math.PI / 2;
  orangeZone.position.set(-PITCH_LENGTH / 2 + goalZoneDepth / 2, 0.021, 0);
  pitchMesh.add(orangeZone);

  const blueZone = new THREE.Mesh(blueZoneGeom, blueMat);
  blueZone.rotation.x = -Math.PI / 2;
  blueZone.position.set(PITCH_LENGTH / 2 - goalZoneDepth / 2, 0.021, 0);
  pitchMesh.add(blueZone);

  // Physics plane
  const groundShape = new CANNON.Plane();
  pitchBody = new CANNON.Body({
    mass: 0,
    shape: groundShape,
    material: new CANNON.Material("ground"),
  });
  pitchBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(pitchBody);
}

function createWallsAndGoals() {
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: 0x1b2236,
    metalness: 0.7,
    roughness: 0.45,
  });

  const wallThickness = 2;

  // Helper to create a wall
  function createWall(pos, size) {
    const geom = new THREE.BoxGeometry(size.x, size.y, size.z);
    const mesh = new THREE.Mesh(geom, wallMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.copy(pos);
    scene.add(mesh);

    const shape = new CANNON.Box(
      new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2)
    );
    const body = new CANNON.Body({
      mass: 0,
      shape,
    });
    body.position.set(pos.x, pos.y, pos.z);
    world.addBody(body);
  }

  // Side walls (along length)
  createWall(
    new THREE.Vector3(0, WALL_HEIGHT / 2, -PITCH_WIDTH / 2),
    new THREE.Vector3(PITCH_LENGTH, WALL_HEIGHT, wallThickness)
  );
  createWall(
    new THREE.Vector3(0, WALL_HEIGHT / 2, PITCH_WIDTH / 2),
    new THREE.Vector3(PITCH_LENGTH, WALL_HEIGHT, wallThickness)
  );

  // End walls, but leave a gap where goals are
  const halfGoal = GOAL_WIDTH / 2;
  const segmentWidth = (PITCH_WIDTH - GOAL_WIDTH) / 2;

  // Left end walls (player side)
  createWall(
    new THREE.Vector3(
      -PITCH_LENGTH / 2,
      WALL_HEIGHT / 2,
      -PITCH_WIDTH / 2 + segmentWidth / 2
    ),
    new THREE.Vector3(wallThickness, WALL_HEIGHT, segmentWidth)
  );
  createWall(
    new THREE.Vector3(
      -PITCH_LENGTH / 2,
      WALL_HEIGHT / 2,
      PITCH_WIDTH / 2 - segmentWidth / 2
    ),
    new THREE.Vector3(wallThickness, WALL_HEIGHT, segmentWidth)
  );

  // Right end walls (AI side)
  createWall(
    new THREE.Vector3(
      PITCH_LENGTH / 2,
      WALL_HEIGHT / 2,
      -PITCH_WIDTH / 2 + segmentWidth / 2
    ),
    new THREE.Vector3(wallThickness, WALL_HEIGHT, segmentWidth)
  );
  createWall(
    new THREE.Vector3(
      PITCH_LENGTH / 2,
      WALL_HEIGHT / 2,
      PITCH_WIDTH / 2 - segmentWidth / 2
    ),
    new THREE.Vector3(wallThickness, WALL_HEIGHT, segmentWidth)
  );

  // Neon strips along wall tops (visual)
  const stripMatSide = new THREE.MeshStandardMaterial({
    color: 0x00e5ff,
    emissive: 0x00e5ff,
    emissiveIntensity: 0.8,
    metalness: 1,
    roughness: 0.15,
  });
  const stripMatEnd = new THREE.MeshStandardMaterial({
    color: 0xffc107,
    emissive: 0xffc107,
    emissiveIntensity: 0.8,
    metalness: 1,
    roughness: 0.15,
  });

  const stripHeight = WALL_HEIGHT + 0.1;

  // Side strips
  const sideStripGeom = new THREE.BoxGeometry(PITCH_LENGTH, 0.25, 0.25);
  const sideStrip1 = new THREE.Mesh(sideStripGeom, stripMatSide);
  sideStrip1.position.set(0, stripHeight, -PITCH_WIDTH / 2 - 0.6);
  scene.add(sideStrip1);

  const sideStrip2 = new THREE.Mesh(sideStripGeom, stripMatSide);
  sideStrip2.position.set(0, stripHeight, PITCH_WIDTH / 2 + 0.6);
  scene.add(sideStrip2);

  // End strips
  const endStripGeom = new THREE.BoxGeometry(0.25, 0.25, PITCH_WIDTH);
  const endStrip1 = new THREE.Mesh(endStripGeom, stripMatEnd);
  endStrip1.position.set(-PITCH_LENGTH / 2 - 0.6, stripHeight, 0);
  scene.add(endStrip1);

  const endStrip2 = new THREE.Mesh(endStripGeom, stripMatEnd);
  endStrip2.position.set(PITCH_LENGTH / 2 + 0.6, stripHeight, 0);
  scene.add(endStrip2);

  // Goal frames (visual only, no physics)
  const goalMatPlayer = new THREE.MeshStandardMaterial({
    color: 0xff9800,
    metalness: 0.9,
    roughness: 0.25,
    emissive: 0xff6f00,
    emissiveIntensity: 0.6,
  });
  const goalMatAI = new THREE.MeshStandardMaterial({
    color: 0x2196f3,
    metalness: 0.9,
    roughness: 0.25,
    emissive: 0x1976d2,
    emissiveIntensity: 0.6,
  });

  function createGoalFrame(x, colourMat) {
    const postRadius = 0.6;
    const postGeom = new THREE.CylinderGeometry(
      postRadius,
      postRadius,
      6,
      16
    );
    const barGeom = new THREE.CylinderGeometry(
      postRadius,
      postRadius,
      GOAL_WIDTH,
      16
    );

    // Left post
    const leftPost = new THREE.Mesh(postGeom, colourMat);
    leftPost.position.set(x, 3, -halfGoal);
    leftPost.castShadow = true;
    scene.add(leftPost);

    // Right post
    const rightPost = new THREE.Mesh(postGeom, colourMat);
    rightPost.position.set(x, 3, halfGoal);
    rightPost.castShadow = true;
    scene.add(rightPost);

    // Crossbar
    const bar = new THREE.Mesh(barGeom, colourMat);
    bar.position.set(x, 6, 0);
    bar.rotation.z = Math.PI / 2;
    bar.castShadow = true;
    scene.add(bar);
  }

  createGoalFrame(-PITCH_LENGTH / 2 - GOAL_DEPTH / 2, goalMatPlayer);
  createGoalFrame(PITCH_LENGTH / 2 + GOAL_DEPTH / 2, goalMatAI);
}

function createBall() {
  const ballGeom = new THREE.SphereGeometry(BALL_RADIUS, 32, 32);
  const ballMat = new THREE.MeshStandardMaterial({
    color: 0xfffef5,
    metalness: 0.3,
    roughness: 0.4,
  });
  ballMesh = new THREE.Mesh(ballGeom, ballMat);
  ballMesh.castShadow = true;
  ballMesh.receiveShadow = true;
  scene.add(ballMesh);

  const ballShape = new CANNON.Sphere(BALL_RADIUS);
  ballBody = new CANNON.Body({
    mass: 5,
    shape: ballShape,
    material: new CANNON.Material("ball"),
  });
  ballBody.position.set(0, BALL_RADIUS + 0.5, 0);
  ballBody.linearDamping = 0.2;
  ballBody.angularDamping = 0.1;
  ballBody.velocity.set(0, 0, 0);
  world.addBody(ballBody);
}

function createPlayer() {
  const bodyLength = 7;
  const bodyWidth = 4;
  const bodyHeight = 2;

  const geom = new THREE.BoxGeometry(bodyLength, bodyHeight, bodyWidth);
  const mat = new THREE.MeshStandardMaterial({
    color: PLAYER_COLOUR_DEFAULT,
    metalness: 0.4,
    roughness: 0.4,
  });
  playerMesh = new THREE.Mesh(geom, mat);
  playerMesh.castShadow = true;
  playerMesh.receiveShadow = true;

  // Cockpit
  const cabGeom = new THREE.BoxGeometry(3, 1.6, 3);
  const cabMat = new THREE.MeshStandardMaterial({
    color: 0x9ccc65,
    metalness: 0.3,
    roughness: 0.5,
  });
  const cab = new THREE.Mesh(cabGeom, cabMat);
  cab.position.set(0, 1.8, 0);
  playerMesh.add(cab);

  scene.add(playerMesh);

  const shape = new CANNON.Box(
    new CANNON.Vec3(bodyLength / 2, bodyHeight / 2, bodyWidth / 2)
  );
  playerBody = new CANNON.Body({
    mass: 40,
    shape,
    material: new CANNON.Material("car"),
  });
  resetPlayerPosition();
  playerBody.angularDamping = 0.7;
  playerBody.linearDamping = 0.2;
  world.addBody(playerBody);
}

function createAI() {
  const bodyLength = 7;
  const bodyWidth = 4;
  const bodyHeight = 2;

  const geom = new THREE.BoxGeometry(bodyLength, bodyHeight, bodyWidth);
  const mat = new THREE.MeshStandardMaterial({
    color: AI_COLOUR,
    metalness: 0.4,
    roughness: 0.4,
  });
  aiMesh = new THREE.Mesh(geom, mat);
  aiMesh.castShadow = true;
  aiMesh.receiveShadow = true;

  const cabGeom = new THREE.BoxGeometry(3, 1.6, 3);
  const cabMat = new THREE.MeshStandardMaterial({
    color: 0xef9a9a,
    metalness: 0.3,
    roughness: 0.5,
  });
  const cab = new THREE.Mesh(cabGeom, cabMat);
  cab.position.set(0, 1.8, 0);
  aiMesh.add(cab);

  scene.add(aiMesh);

  const shape = new CANNON.Box(
    new CANNON.Vec3(bodyLength / 2, bodyHeight / 2, bodyWidth / 2)
  );
  aiBody = new CANNON.Body({
    mass: 40,
    shape,
    material: new CANNON.Material("car"),
  });
  resetAIPosition();
  aiBody.angularDamping = 0.7;
  aiBody.linearDamping = 0.2;
  world.addBody(aiBody);
}

function createBoostPads() {
  // Four pads, near the corners in neutral positions
  const positions = [
    new THREE.Vector3(-PITCH_LENGTH / 4, 0.2, -PITCH_WIDTH / 3),
    new THREE.Vector3(-PITCH_LENGTH / 4, 0.2, PITCH_WIDTH / 3),
    new THREE.Vector3(PITCH_LENGTH / 4, 0.2, -PITCH_WIDTH / 3),
    new THREE.Vector3(PITCH_LENGTH / 4, 0.2, PITCH_WIDTH / 3),
  ];

  const geom = new THREE.CylinderGeometry(
    BOOST_PAD_RADIUS,
    BOOST_PAD_RADIUS,
    0.6,
    24
  );

  positions.forEach((pos) => {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffc107,
      emissive: 0xff9800,
      emissiveIntensity: 0.8,
      metalness: 0.9,
      roughness: 0.3,
      transparent: true,
      opacity: 0.95,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.copy(pos);
    mesh.castShadow = true;
    scene.add(mesh);

    boostPads.push({
      mesh,
      position: pos.clone(),
      active: true,
      cooldown: 0,
    });
  });
}

function createStadiumShell() {
  const radius = 70;
  const height = 50;

  const shellGeom = new THREE.CylinderGeometry(
    radius,
    radius,
    height,
    40,
    1,
    true
  );
  const shellMat = new THREE.MeshStandardMaterial({
    color: 0x080a15,
    metalness: 0.3,
    roughness: 0.9,
    side: THREE.BackSide,
  });
  const shell = new THREE.Mesh(shellGeom, shellMat);
  shell.position.y = height / 2 - 5;
  scene.add(shell);

  // Upper glowing rim
  const rimGeom = new THREE.TorusGeometry(radius - 1, 0.6, 16, 64);
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0x00bcd4,
    emissive: 0x00bcd4,
    emissiveIntensity: 0.7,
    metalness: 1,
    roughness: 0.2,
  });
  const rim = new THREE.Mesh(rimGeom, rimMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = shell.position.y + height / 4;
  scene.add(rim);

  // Floodlights at four corners
  const corners = [
    [PITCH_LENGTH / 2, PITCH_WIDTH / 2],
    [-PITCH_LENGTH / 2, PITCH_WIDTH / 2],
    [PITCH_LENGTH / 2, -PITCH_WIDTH / 2],
    [-PITCH_LENGTH / 2, -PITCH_WIDTH / 2],
  ];

  corners.forEach(([x, z]) => {
    const spot = new THREE.SpotLight(0xffffff, 0.8, 220, Math.PI / 4, 0.4, 1);
    spot.position.set(x * 1.1, 45, z * 1.1);
    spot.castShadow = true;
    const target = new THREE.Object3D();
    target.position.set(0, 0, 0);
    scene.add(target);
    spot.target = target;
    scene.add(spot);
  });
}

// ------------------- Helpers -------------------- //

function resetPlayerPosition() {
  playerHeading = 0;
  playerBody.position.set(-PITCH_LENGTH / 2 + 12, 3, 0);
  playerBody.velocity.set(0, 0, 0);
  playerBody.angularVelocity.set(0, 0, 0);
  setBodyHeading(playerBody, playerHeading);
}

function resetAIPosition() {
  aiHeading = Math.PI;
  aiBody.position.set(PITCH_LENGTH / 2 - 12, 3, 0);
  aiBody.velocity.set(0, 0, 0);
  aiBody.angularVelocity.set(0, 0, 0);
  setBodyHeading(aiBody, aiHeading);
}

function resetBall() {
  ballBody.position.set(0, BALL_RADIUS + 0.5, 0);
  ballBody.velocity.set(0, 0, 0);
  ballBody.angularVelocity.set(0, 0, 0);
}

function resetBoostPads() {
  boostPads.forEach((pad) => {
    pad.active = true;
    pad.cooldown = 0;
    pad.mesh.material.opacity = 0.95;
  });
}

function showMessage(text) {
  messageElement.textContent = text;
  messageElement.style.opacity = 1;
  setTimeout(() => {
    messageElement.style.opacity = 0;
  }, 1500);
}

function updateScoreUI() {
  playerScoreEl.textContent = playerScore.toString();
  aiScoreEl.textContent = aiScore.toString();
}

function setBodyHeading(body, heading) {
  const q = new CANNON.Quaternion();
  q.setFromEuler(0, heading, 0, "YZX");
  body.quaternion.copy(q);
}

function isOnGround(body) {
  return body.position.y <= GROUND_EPSILON;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function updateTimer(dt) {
  if (isMatchOver) return;

  remainingTime -= dt;
  if (remainingTime <= 0) {
    remainingTime = 0;
    isMatchOver = true;
    showMessage("FULL TIME");
  }
  updateTimerUI();
}

function updateTimerUI() {
  const totalSeconds = Math.max(0, Math.floor(remainingTime));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  timerEl.textContent =
    minutes.toString().padStart(2, "0") +
    ":" +
    seconds.toString().padStart(2, "0");
}

// ------------------- Game loop -------------------- //

function stepGame(dt) {
  if (isPaused) return;

  updateTimer(dt);
  handleInput(dt);
  handleAI(dt);
  handleGoalCheck(dt);
  updateBoostPads(dt);
  handleBoostPickups();

  world.step(1 / 60, dt, 3);

  syncVisuals();
  updateCamera(dt);
}

function syncVisuals() {
  ballMesh.position.copy(ballBody.position);
  ballMesh.quaternion.copy(ballBody.quaternion);

  playerMesh.position.copy(playerBody.position);
  // Player tilt applied in handleInput for visual only

  aiMesh.position.copy(aiBody.position);
  aiMesh.quaternion.copy(aiBody.quaternion);
}

function updateCamera(dt) {
  const offsetDistance = 22;
  const height = 12;

  const forward = new THREE.Vector3(
    Math.cos(playerHeading),
    0,
    Math.sin(playerHeading)
  );

  const targetPos = new THREE.Vector3(
    playerBody.position.x,
    playerBody.position.y,
    playerBody.position.z
  );

  const cameraPos = targetPos
    .clone()
    .add(forward.clone().multiplyScalar(-offsetDistance));
  cameraPos.y += height;

  camera.position.lerp(cameraPos, 4 * dt);
  camera.lookAt(
    targetPos.clone().add(new THREE.Vector3(0, 3, 0))
  );
}

// ------------------- Controls -------------------- //

function handleInput(dt) {
  // Reset ball (debug)
  if (keys["KeyR"]) {
    resetBall();
  }

  if (isResetting) {
    resetTimer += dt;
    if (resetTimer >= RESET_DELAY) {
      isResetting = false;
    } else {
      return;
    }
  }

  // Steering
  if (keys["KeyA"]) {
    playerHeading += PLAYER_TURN_SPEED * dt;
  }
  if (keys["KeyD"]) {
    playerHeading -= PLAYER_TURN_SPEED * dt;
  }

  setBodyHeading(playerBody, playerHeading);

  // Forward vector in XZ plane
  const forward = new CANNON.Vec3(
    Math.cos(playerHeading),
    0,
    Math.sin(playerHeading)
  );

  const vel = playerBody.velocity.clone();
  vel.y = 0;
  const speed = vel.length();

  let targetAccel = 0;

  if (keys["KeyW"]) {
    targetAccel += PLAYER_ACCEL;
  }
  if (keys["KeyS"]) {
    targetAccel -= PLAYER_ACCEL * 0.7;
  }

  let isBoosting = false;
  if (keys["ShiftLeft"] || keys["ShiftRight"]) {
    if (playerBoost > 0 && targetAccel > 0) {
      isBoosting = true;
      targetAccel += PLAYER_BOOST_ACCEL;
      playerBoost -= BOOST_DRAIN_RATE * dt;
    }
  }
  playerBoost = clamp(playerBoost, 0, 100);

  if (!isBoosting) {
    playerBoost += BOOST_REGEN_RATE * dt;
    playerBoost = clamp(playerBoost, 0, 100);
  }

  boostBarEl.style.transform = `scaleX(${playerBoost / 100})`;

  if (targetAccel !== 0) {
    const maxSpeed = isBoosting ? PLAYER_MAX_SPEED * 1.6 : PLAYER_MAX_SPEED;
    if (speed < maxSpeed || targetAccel < 0) {
      const driveForce = forward.scale(targetAccel * playerBody.mass);
      playerBody.applyForce(driveForce, playerBody.position);
    }
  }

  if (!keys["KeyW"] && !keys["KeyS"]) {
    playerBody.velocity.x *= 1 - 1.8 * dt;
    playerBody.velocity.z *= 1 - 1.8 * dt;
  }

  // Jump
  if (keys["Space"] && isOnGround(playerBody)) {
    playerBody.velocity.y = JUMP_VELOCITY;
  }

  // Visual tilt
  const tiltAmount = clamp(speed / PLAYER_MAX_SPEED, 0, 1) * 0.25;
  const roll = (keys["KeyA"] ? 1 : 0) - (keys["KeyD"] ? 1 : 0);
  const pitch = (keys["KeyW"] ? 1 : 0) - (keys["KeyS"] ? 1 : 0);

  const carQuat = new THREE.Quaternion();
  carQuat.setFromEuler(
    pitch * tiltAmount,
    -playerHeading,
    roll * tiltAmount,
    "XYZ"
  );
  playerMesh.quaternion.copy(carQuat);
  playerMesh.position.copy(playerBody.position);
}

// ------------------- AI -------------------- //

function handleAI(dt) {
  const aiPos = aiBody.position;
  const ballPos = ballBody.position;

  const toBall = new CANNON.Vec3(
    ballPos.x - aiPos.x,
    0,
    ballPos.z - aiPos.z
  );
  const distToBall = toBall.length();

  if (distToBall > 0.1) {
    toBall.scale(1 / distToBall, toBall);
  }

  const desiredHeading = Math.atan2(toBall.z, toBall.x);

  let diff = desiredHeading - aiHeading;
  diff = ((diff + Math.PI) % (2 * Math.PI)) - Math.PI;

  const maxTurn = AI_TURN_SPEED * dt;
  diff = clamp(diff, -maxTurn, maxTurn);
  aiHeading += diff;
  setBodyHeading(aiBody, aiHeading);

  const vel = aiBody.velocity.clone();
  vel.y = 0;
  const speed = vel.length();

  let accel = 0;
  const ballOnAiSide = ballPos.x > 0;

  if (!ballOnAiSide) {
    accel = distToBall > 15 ? AI_ACCEL : AI_ACCEL * 0.4;
  } else {
    accel = AI_ACCEL;
  }

  if (speed < AI_MAX_SPEED) {
    const forward = new CANNON.Vec3(
      Math.cos(aiHeading),
      0,
      Math.sin(aiHeading)
    );
    const driveForce = forward.scale(accel * aiBody.mass);
    aiBody.applyForce(driveForce, aiBody.position);
  }

  if (
    distToBall < 7 &&
    isOnGround(aiBody) &&
    Math.random() < 0.4 * dt
  ) {
    aiBody.velocity.y = JUMP_VELOCITY * 0.9;
  }

  if (distToBall > 30) {
    aiBody.velocity.x *= 1 - 1.5 * dt;
    aiBody.velocity.z *= 1 - 1.5 * dt;
  }
}

// ------------------- Goals & reset -------------------- //

function handleGoalCheck(dt) {
  const x = ballBody.position.x;
  const z = ballBody.position.z;

  const goalXPlayer = -PITCH_LENGTH / 2 - 1;
  const goalXAI = PITCH_LENGTH / 2 + 1;

  const withinWidth = Math.abs(z) < GOAL_WIDTH / 2;

  if (!isResetting && withinWidth) {
    if (x < goalXPlayer) {
      aiScore += 1;
      updateScoreUI();
      onGoalScored("AI SCORED!");
    } else if (x > goalXAI) {
      playerScore += 1;
      updateScoreUI();
      onGoalScored("GOAL!");
    }
  }

  if (isResetting) {
    resetTimer += dt;
    if (resetTimer >= RESET_DELAY) {
      isResetting = false;
    }
  }
}

function onGoalScored(msg) {
  showMessage(msg);
  isResetting = true;
  resetTimer = 0;

  resetBall();
  resetPlayerPosition();
  resetAIPosition();
  resetBoostPads();
}

// ------------------- Boost pads logic -------------------- //

function updateBoostPads(dt) {
  boostPads.forEach((pad) => {
    if (!pad.active) {
      pad.cooldown -= dt;
      if (pad.cooldown <= 0) {
        pad.active = true;
        pad.cooldown = 0;
        pad.mesh.material.opacity = 0.95;
      }
    }
  });
}

function handleBoostPickups() {
  boostPads.forEach((pad) => {
    if (!pad.active) return;

    const dx = playerBody.position.x - pad.position.x;
    const dz = playerBody.position.z - pad.position.z;
    const distSq = dx * dx + dz * dz;

    if (distSq <= BOOST_PAD_RADIUS * BOOST_PAD_RADIUS) {
      // Refill boost
      playerBoost = 100;
      pad.active = false;
      pad.cooldown = BOOST_PAD_COOLDOWN;
      pad.mesh.material.opacity = 0.2;
    }
  });
}

// ------------------- UI & pause -------------------- //

function setupUIInteractions() {
  pauseBtn.addEventListener("click", () => {
    togglePause();
  });

  resumeBtn.addEventListener("click", () => {
    if (isPaused) togglePause();
  });

  restartBtn.addEventListener("click", () => {
    restartMatch();
  });

  // Car colour selector
  const swatches = document.querySelectorAll(".car-swatch");
  swatches.forEach((btn) => {
    btn.addEventListener("click", () => {
      const hex = btn.getAttribute("data-colour");
      setPlayerCarColour(hex);
    });
  });
}

function togglePause() {
  isPaused = !isPaused;
  pauseOverlay.style.display = isPaused ? "flex" : "none";
}

function restartMatch() {
  playerScore = 0;
  aiScore = 0;
  updateScoreUI();

  remainingTime = MATCH_DURATION;
  isMatchOver = false;
  updateTimerUI();

  playerBoost = 100;
  boostBarEl.style.transform = "scaleX(1)";

  resetBall();
  resetPlayerPosition();
  resetAIPosition();
  resetBoostPads();

  isPaused = false;
  pauseOverlay.style.display = "none";
  showMessage("KICK-OFF");
}

function setPlayerCarColour(hex) {
  if (!playerMesh || !playerMesh.material) return;
  playerMesh.material.color.set(hex);
}

// ------------------- Resize -------------------- //

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
