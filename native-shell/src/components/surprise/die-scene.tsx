import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import React, { useEffect, useRef } from 'react';
import { useReducedMotion } from 'react-native-reanimated';
// Native Three.js WebGLRenderer adapter for Expo GL
import Renderer from './die-renderer';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const DIE_EDGE = 1.56;
const DIE_HALF = DIE_EDGE / 2;
const DIE_RADIUS = 0.17;
const PIP_RADIUS = 0.102;
const PIP_LIFT = 0.003;
const PIP_OFFSET = 0.35;

const BODY_COLOR = 0xf4d5ae;
const PIP_COLOR = 0x18120f;

const FACE_DEFINITIONS = [
  { normal: new THREE.Vector3(0, 0, 1), value: 1 },
  { normal: new THREE.Vector3(0, 1, 0), value: 2 },
  { normal: new THREE.Vector3(1, 0, 0), value: 3 },
  { normal: new THREE.Vector3(-1, 0, 0), value: 4 },
  { normal: new THREE.Vector3(0, -1, 0), value: 5 },
  { normal: new THREE.Vector3(0, 0, -1), value: 6 },
] as const;

const PIP_LAYOUTS: Record<number, Array<[number, number]>> = {
  1: [[0, 0]],
  2: [
    [-PIP_OFFSET, -PIP_OFFSET],
    [PIP_OFFSET, PIP_OFFSET],
  ],
  3: [
    [-PIP_OFFSET, -PIP_OFFSET],
    [0, 0],
    [PIP_OFFSET, PIP_OFFSET],
  ],
  4: [
    [-PIP_OFFSET, -PIP_OFFSET],
    [-PIP_OFFSET, PIP_OFFSET],
    [PIP_OFFSET, -PIP_OFFSET],
    [PIP_OFFSET, PIP_OFFSET],
  ],
  5: [
    [-PIP_OFFSET, -PIP_OFFSET],
    [-PIP_OFFSET, PIP_OFFSET],
    [0, 0],
    [PIP_OFFSET, -PIP_OFFSET],
    [PIP_OFFSET, PIP_OFFSET],
  ],
  6: [
    [-PIP_OFFSET, -PIP_OFFSET],
    [-PIP_OFFSET, 0],
    [-PIP_OFFSET, PIP_OFFSET],
    [PIP_OFFSET, -PIP_OFFSET],
    [PIP_OFFSET, 0],
    [PIP_OFFSET, PIP_OFFSET],
  ],
};

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

type RollState = {
  mode: 'tumble' | 'settle';
  startedAt: number;
  settleFrom: THREE.Quaternion;
  settleTo: THREE.Quaternion;
  settleAt: number;
  fired: boolean;
};

function faceQuaternion(normal: THREE.Vector3): THREE.Quaternion {
  return new THREE.Quaternion().setFromUnitVectors(normal.clone().normalize(), new THREE.Vector3(0, 0, 1));
}

function faceValueOf(quaternion: THREE.Quaternion): number {
  let bestDot = -2;
  let bestValue = 1;
  for (const face of FACE_DEFINITIONS) {
    const world = face.normal.clone().applyQuaternion(quaternion);
    const dot = world.dot(new THREE.Vector3(0, 0, 1));
    if (dot > bestDot) {
      bestDot = dot;
      bestValue = face.value;
    }
  }
  return bestValue;
}

type DieSceneProps = {
  size?: number;
  settling?: boolean;
  fullMotion?: boolean;
  onRollStart: () => void;
  onRollEnd: (faceValue: number) => void;
};

export function DieScene({ size = 240, settling = false, fullMotion = false, onRollStart, onRollEnd }: DieSceneProps) {
  const onRollEndRef = useRef<((faceValue: number) => void) | null>(onRollEnd);
  onRollEndRef.current = onRollEnd;
  const onRollStartRef = useRef(onRollStart);
  onRollStartRef.current = onRollStart;
  const reducedMotion = useReducedMotion() && !fullMotion;
  const cleanupRef = useRef<(() => void) | null>(null);
  const settleRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (settling) settleRef.current?.();
  }, [settling]);

  useEffect(() => {
    return () => {
      onRollEndRef.current = null;
      cleanupRef.current?.();
      cleanupRef.current = null;
      settleRef.current = null;
    };
  }, []);

  const handleContextCreate = (gl: ExpoWebGLRenderingContext) => {
    cleanupRef.current?.();
    let disposed = false;
    let frame = 0;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (faceValue: number, state: RollState | null) => {
      if (disposed || !state || state.fired) return;
      state.fired = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      // One last painted frame before we stop the loop entirely.
      try {
        renderer.render(scene, camera);
        gl.endFrameEXP();
      } catch {
        // Context may already be gone.
      }
      onRollEndRef.current?.(faceValue);
    };

    // ---- Scene ----------------------------------------------------------
    let renderer: Renderer;
    try {
      // GLView owns the native buffer. A capped device ratio leaves the viewport
      // smaller than that buffer on 3x iPhones, shifting the die off center.
      renderer = new Renderer({
        gl,
        antialias: true,
        alpha: true,
        width: gl.drawingBufferWidth,
        height: gl.drawingBufferHeight,
        pixelRatio: 1,
      });
    } catch (err) {
      console.warn('[DieScene] Failed to create Renderer, falling back:', err);
      fallbackTimer = setTimeout(() => {
        if (disposed) return;
        onRollStartRef.current();
        onRollEndRef.current?.(1 + Math.floor(Math.random() * 6));
      }, 350);
      cleanupRef.current = () => {
        disposed = true;
        if (fallbackTimer) clearTimeout(fallbackTimer);
      };
      return;
    }
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.14;
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      36,
      gl.drawingBufferWidth / gl.drawingBufferHeight,
      0.1,
      30
    );
    camera.position.set(0, 0, 5.8);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.HemisphereLight(0xfff3e0, 0x100b09, 1.65));
    const key = new THREE.DirectionalLight(0xffe4c3, 3.1);
    key.position.set(2.7, 3.6, 3.2);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xd9a47a, 0.85);
    fill.position.set(-3.1, -1.1, 2.2);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 1.35);
    rim.position.set(-1.1, 2.8, -3.4);
    scene.add(rim);
    const warmPoint = new THREE.PointLight(0xffc995, 7.5, 8);
    warmPoint.position.set(0.8, 0.3, 2.4);
    scene.add(warmPoint);

    const die = new THREE.Group();
    die.rotation.set(-0.22, 0.36, -0.1);
    scene.add(die);

    const bodyGeometry = new RoundedBoxGeometry(DIE_EDGE, DIE_EDGE, DIE_EDGE, 4, DIE_RADIUS);
    const bodyMaterial = new THREE.MeshPhysicalMaterial({
      color: BODY_COLOR,
      roughness: 0.27,
      metalness: 0.02,
      clearcoat: 0.62,
      clearcoatRoughness: 0.18,
    });
    die.add(new THREE.Mesh(bodyGeometry, bodyMaterial));

    const pipGeometry = new THREE.SphereGeometry(PIP_RADIUS, 18, 12);
    const pipMaterial = new THREE.MeshPhysicalMaterial({
      color: PIP_COLOR,
      roughness: 0.32,
      metalness: 0.04,
      clearcoat: 0.3,
      clearcoatRoughness: 0.26,
    });
    const worldUp = new THREE.Vector3(0, 1, 0);
    const worldForward = new THREE.Vector3(0, 0, 1);

    for (const face of FACE_DEFINITIONS) {
      const normal = face.normal.clone().normalize();
      let u = new THREE.Vector3().crossVectors(normal, worldUp);
      if (u.lengthSq() < 1e-6) u = new THREE.Vector3().crossVectors(normal, worldForward);
      u.normalize();
      const v = new THREE.Vector3().crossVectors(normal, u).normalize();

      for (const [x, y] of PIP_LAYOUTS[face.value]) {
        const pip = new THREE.Mesh(pipGeometry, pipMaterial);
        pip.position
          .copy(normal)
          .multiplyScalar(DIE_HALF + PIP_LIFT)
          .addScaledVector(u, x)
          .addScaledVector(v, y);
        pip.quaternion.setFromUnitVectors(worldForward, normal);
        pip.scale.z = 0.14;
        die.add(pip);
      }
    }

    // ---- Motion ---------------------------------------------------------
    const state: RollState = {
      mode: 'tumble',
      startedAt: 0,
      settleFrom: new THREE.Quaternion(),
      settleTo: new THREE.Quaternion(),
      settleAt: 0,
      fired: false,
    };

    const beginSettle = () => {
      if (disposed || state.fired || state.mode === 'settle') return;
      if (reducedMotion) {
        finish(faceValueOf(die.quaternion), state);
        return;
      }
      state.mode = 'settle';
      state.settleAt = performance.now();
      state.settleFrom.copy(die.quaternion);
      // Keep a three-quarter silhouette instead of flattening into a square.
      let bestDot = -2;
      let bestNormal = FACE_DEFINITIONS[0].normal;
      for (const face of FACE_DEFINITIONS) {
        const world = face.normal.clone().applyQuaternion(die.quaternion);
        const dot = world.dot(worldForward);
        if (dot > bestDot) {
          bestDot = dot;
          bestNormal = face.normal;
        }
      }
      const worldNormal = bestNormal.clone().applyQuaternion(die.quaternion).normalize();
      const targetNormal = new THREE.Vector3(0.36, 0.28, 0.89).normalize();
      const delta = new THREE.Quaternion().setFromUnitVectors(worldNormal, targetNormal);
      state.settleTo.copy(die.quaternion).premultiply(delta);
    };

    const delta = new THREE.Quaternion();
    const localTurn = new THREE.Quaternion();
    const initialRotation = die.quaternion.clone();
    const axis = new THREE.Vector3(0.7, 1, Math.random() < 0.5 ? -0.35 : 0.35).normalize();
    const speed = 12 + Math.random() * 2;

    const renderFrame = () => {
      if (disposed || state.fired) return;
      frame = requestAnimationFrame(renderFrame);

      const now = performance.now();
      const elapsed = (now - state.startedAt) / 1000;
      if (state.mode === 'tumble') {
        // A strong initial toss eases into a sustained tumble while matching.
        // Do not freeze the scene just because the request takes >3 seconds.
        const angle = 1.8 * elapsed + (speed - 1.8) * (1 - Math.exp(-1.3 * elapsed)) / 1.3;
        delta.setFromAxisAngle(axis, angle);
        localTurn.setFromAxisAngle(worldForward, angle * 0.28);
        die.quaternion.copy(delta).multiply(initialRotation).multiply(localTurn);
        die.scale.setScalar(0.94 + 0.06 * easeOutCubic(Math.min(1, elapsed / 0.3)));
      } else {
        const p = Math.min(1, (now - state.settleAt) / 450);
        die.quaternion.slerpQuaternions(state.settleFrom, state.settleTo, easeOutCubic(p));
        if (p >= 1) {
          finish(faceValueOf(die.quaternion), state);
          return;
        }
      }

      renderer.render(scene, camera);
      gl.endFrameEXP();
    };

    if (reducedMotion) {
      // The overlay offers an explicit opt-in to the full roll.
      const face = FACE_DEFINITIONS[Math.floor(Math.random() * FACE_DEFINITIONS.length)];
      die.quaternion.copy(faceQuaternion(face.normal));
      die.quaternion.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3, 0.38, -0.08)));
    }

    // onContextCreate's return value is not a React cleanup callback.
    cleanupRef.current = () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      if (fallbackTimer) clearTimeout(fallbackTimer);
      bodyGeometry.dispose();
      pipGeometry.dispose();
      bodyMaterial.dispose();
      pipMaterial.dispose();
      renderer.dispose();
      scene.clear();
    };
    settleRef.current = beginSettle;

    // Shader compilation can block the first render in Expo Go. Start timing
    // after that frame, never while the die is still being prepared.
    renderer.render(scene, camera);
    gl.endFrameEXP();
    state.startedAt = performance.now();
    onRollStartRef.current();
    if (!reducedMotion) frame = requestAnimationFrame(renderFrame);
    if (settling) beginSettle();
  };

  return (
    <GLView
      style={{ width: size, height: size, backgroundColor: 'transparent' }}
      onContextCreate={handleContextCreate}
    />
  );
}
