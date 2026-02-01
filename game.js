// Import Three.js and Cannon-es from CDN
import * as THREE from "https://unpkg.com/three@0.165.0/build/three.module.js";
import * as CANNON from "https://unpkg.com/cannon-es@0.20.0/dist/cannon-es.js";

/*
  Mini Rocket League-Style Game
  - Player car with jump + boost
  - AI car that chases the ball
  - Physics ball, walls, goals
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

const PLAYER_COLOUR = 0x4caf50;
const AI_COLOUR = 0xf44336;

// Game state
let keys = {};
let playerHeading = 0;
let aiHeading = Math.PI; // roughly face the other way at start

let playerScore = 0;
let aiScore = 0;

let messageElement = document.getElementById("message");
let playerScoreEl = document.getElementById("player-score");
let aiScoreEl = document.getElementById("ai-score");
let boostBarEl = document.getElementById("boost-bar-fill");

// Boost + jump
let playerBoost = 100;      // 0–100
const BOOST_DRAIN_RATE = 40; // per second
const BOOST_REGEN_RATE = 20; // per second
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

// ------------------- Init functions -------------------- //

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

  // Input
  window.addEventListener("keydown", (e) => {
    keys[e.code] = true;
  });
  window.addEventListener("keyup", (e) => {
    keys[e.code] = false;
  });

  window.addEventListener("resize", onWindowResize);

  showMessage("KICK-OFF");
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
    color: 0x136a13,
    metalness: 0.2,
    roughness: 0.9,
  });
  const pitchMesh = new THREE.Mesh(pitchGeometry, pitchMaterial);
  pitchMesh.receiveShadow = true;
  pitchMesh.rotation.x = -Math.PI / 2;
  scene.add(pitchMesh);

  // Simple "centre line" & circle
  const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff });
  const lineGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0.02, -PITCH_WIDTH / 2),
    new THREE.Vector3(0, 0.02, PITCH_WIDTH / 2),
  ]);
  const centreLine = new THREE.Line(lineGeom, lineMat);
  centreLine.rotation.x = -Math.PI / 2;
  pitchMesh.add(centreLine);

  const centerCircleGeom = new THREE.RingGeometry(6.5, 6.9, 64);
  const centerCircleMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
  });
  const centerCircle = new THREE.Mesh(centerCircleGeom, centerCircleMat);
  centerCircle.rotation.x = -Math.PI / 2;
  centerCircle.position.y = 0.03;
  pitchMesh.add(centerCircle);

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
    color: 0x222a3b,
    metalness: 0.6,
    roughness: 0.4,
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

  // Goal frames (visual only, no physics – ball can pass through)
  const goalMatPlayer = new THREE.MeshStandardMaterial({
    color: 0x4caf50,
    metalness: 0.8,
    roughness: 0.3,
  });
  const goalMatAI = new THREE.MeshStandardMaterial({
    color: 0xf44336,
    metalness: 0.8,
    roughness: 0.3,
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
    metalness: 0.2,
    roughness: 0.5,
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
    color: PLAYER_COLOUR,
    metalness: 0.4,
    roughness: 0.4,
  });
  playerMesh = new THREE.Mesh(geom, mat);
  playerMesh.castShadow = true;
  playerMesh.receiveShadow = true;

  // Slight "cockpit" cube on top
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
  // Only yaw; keep roll/pitch zeroed for sanity
  const q = new CANNON.Quaternion();
  q.setFromEuler(0, heading, 0, "YZX");
  body.quaternion.copy(q);
}

// Ground contact for jump
function isOnGround(body) {
  return body.position.y <= GROUND_EPSILON;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// ------------------- Game loop -------------------- //

function animate(time) {
  requestAnimationFrame(animate);

  const dt = lastTime ? (time - lastTime) / 1000 : 0;
  lastTime = time;

  if (dt > 0) {
    stepGame(dt);
  }

  renderer.render(scene, camera);
}

function stepGame(dt) {
  handleInput(dt);
  handleAI(dt);
  handleGoalCheck(dt);

  // Physics step
  world.step(1 / 60, dt, 3);

  // Sync meshes with bodies
  syncVisuals();

  // Update camera follow
  updateCamera(dt);
}

function syncVisuals() {
  ballMesh.position.copy(ballBody.position);
  ballMesh.quaternion.copy(ballBody.quaternion);

  playerMesh.position.copy(playerBody.position);
  playerMesh.quaternion.copy(playerBody.quaternion);

  aiMesh.position.copy(aiBody.position);
  aiMesh.quaternion.copy(aiBody.quaternion);
}

function updateCamera(dt) {
  // Third-person camera behind player
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

  // Smooth interpolate
  camera.position.lerp(cameraPos, 4 * dt);
  camera.lookAt(
    targetPos.clone().add(new THREE.Vector3(0, 3, 0)) // look slightly above the car
  );
}

// ------------------- Controls -------------------- //

function handleInput(dt) {
  // Reset ball
  if (keys["KeyR"]) {
    resetBall();
  }

  if (isResetting) {
    resetTimer += dt;
    if (resetTimer >= RESET_DELAY) {
      isResetting = false;
    } else {
      // Don't allow control during reset freeze
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

  // Current velocity in XZ
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

  // Regenerate boost slowly when not boosting
  if (!isBoosting) {
    playerBoost += BOOST_REGEN_RATE * dt;
    playerBoost = clamp(playerBoost, 0, 100);
  }

  // Update boost bar UI
  boostBarEl.style.transform = `scaleX(${playerBoost / 100})`;

  // Apply drive force if under max speed or decelerating
  if (targetAccel !== 0) {
    const maxSpeed = isBoosting ? PLAYER_MAX_SPEED * 1.6 : PLAYER_MAX_SPEED;
    if (speed < maxSpeed || targetAccel < 0) {
      const driveForce = forward.scale(targetAccel * playerBody.mass);
      playerBody.applyForce(driveForce, playerBody.position);
    }
  }

  // Small extra damping when no input
  if (!keys["KeyW"] && !keys["KeyS"]) {
    playerBody.velocity.x *= 1 - 1.8 * dt;
    playerBody.velocity.z *= 1 - 1.8 * dt;
  }

  // Jump
  if (keys["Space"] && isOnGround(playerBody)) {
    playerBody.velocity.y = JUMP_VELOCITY;
  }

  // Slight tilt for visual effect based on steering and acceleration
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
  // Apply to mesh only for visuals; physics stays with bodyHeading
  playerMesh.quaternion.copy(carQuat);
  playerMesh.position.copy(playerBody.position);
}

// ------------------- AI -------------------- //

function handleAI(dt) {
  // AI chases the ball and tries to push it towards the player's goal
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

  // Turn towards desired heading
  let diff = desiredHeading - aiHeading;
  // Wrap to [-PI, PI]
  diff = ((diff + Math.PI) % (2 * Math.PI)) - Math.PI;

  const maxTurn = AI_TURN_SPEED * dt;
  diff = clamp(diff, -maxTurn, maxTurn);
  aiHeading += diff;
  setBodyHeading(aiBody, aiHeading);

  // Velocity
  const vel = aiBody.velocity.clone();
  vel.y = 0;
  const speed = vel.length();

  // Decide acceleration
  let accel = 0;

  // If behind ball from AI's side, drive forward hard, else adjust
  const aiOnOwnSide = aiPos.x > 0; // AI goal is on +X side
  const ballOnAiSide = ballPos.x > 0;

  if (!ballOnAiSide) {
    // Ball on player's side – AI hangs back a bit
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

  // Occasional jump when close to ball
  if (
    distToBall < 7 &&
    isOnGround(aiBody) &&
    Math.random() < 0.4 * dt
  ) {
    aiBody.velocity.y = JUMP_VELOCITY * 0.9;
  }

  // Extra damping when not really driving
  if (distToBall > 30) {
    aiBody.velocity.x *= 1 - 1.5 * dt;
    aiBody.velocity.z *= 1 - 1.5 * dt;
  }
}

// ------------------- Goals & reset -------------------- //

function handleGoalCheck(dt) {
  const x = ballBody.position.x;
  const z = ballBody.position.z;

  const goalXPlayer = -PITCH_LENGTH / 2 - 1; // player's goal line
  const goalXAI = PITCH_LENGTH / 2 + 1;      // AI's goal line

  const withinWidth = Math.abs(z) < GOAL_WIDTH / 2;

  if (!isResetting && withinWidth) {
    if (x < goalXPlayer) {
      // AI scored
      aiScore += 1;
      updateScoreUI();
      onGoalScored("AI SCORED!");
    } else if (x > goalXAI) {
      // Player scored
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

  // Reset positions
  resetBall();
  resetPlayerPosition();
  resetAIPosition();
}

// ------------------- Resize -------------------- //

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
