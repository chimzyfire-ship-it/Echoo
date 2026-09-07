import * as THREE from 'three';
import type { ExpoWebGLRenderingContext } from 'expo-gl';

export type DieRendererOptions = {
  gl: ExpoWebGLRenderingContext;
  canvas?: any;
  pixelRatio?: number;
  width?: number;
  height?: number;
  clearColor?: THREE.ColorRepresentation;
  antialias?: boolean;
  alpha?: boolean;
  [key: string]: any;
};

/**
 * SDK 57 makes WebGL2 inherit from WebGL1. Three r185 rejects any context
 * that is instanceof WebGLRenderingContext, including Expo's valid WebGL2.
 * A renderer-local facade avoids that browser-specific brand check while
 * forwarding every property and binding native calls to the real context.
 * Never change Expo's prototypes or the global WebGL constructors.
 */
export function createThreeContext(gl: ExpoWebGLRenderingContext): ExpoWebGLRenderingContext {
  const methods = new Map<PropertyKey, { original: Function; bound: Function }>();
  return new Proxy(Object.create(null), {
    get(_target, key) {
      const value = Reflect.get(gl, key, gl);
      if (typeof value !== 'function') return value;
      const cached = methods.get(key);
      if (cached && cached.original === value) return cached.bound;
      const bound = value.bind(gl);
      methods.set(key, { original: value, bound });
      return bound;
    },
    set(_target, key, value) { return Reflect.set(gl, key, value, gl); },
    has(_target, key) { return key in gl; },
  }) as ExpoWebGLRenderingContext;
}

/**
 * Robust Three.js WebGLRenderer adapter for Expo GL (SDK 57+).
 * Replaces unmaintained expo-three/build/Renderer with full support for modern Three.js (r163+ / r185).
 */
export class DieRenderer extends THREE.WebGLRenderer {
  constructor({
    gl,
    canvas,
    pixelRatio = 1,
    width,
    height,
    clearColor,
    ...props
  }: DieRendererOptions) {
    // 1. Three.js r163+ unconditionally invokes context.getContextAttributes().
    // Expo GL contexts in React Native do not always implement this method on the JS bridge.
    if (!gl.getContextAttributes || typeof gl.getContextAttributes !== 'function') {
      gl.getContextAttributes = () => ({
        alpha: true,
        antialias: true,
        depth: true,
        stencil: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
      });
    }

    // 2. Three.js expects a canvas-like object with dimensions and event listeners.
    const inputCanvas = canvas || {
      width: gl.drawingBufferWidth,
      height: gl.drawingBufferHeight,
      clientWidth: gl.drawingBufferWidth,
      clientHeight: gl.drawingBufferHeight,
      style: {},
      addEventListener: () => {},
      removeEventListener: () => {},
      getContext: () => gl,
    };

    super({
      canvas: inputCanvas,
      context: createThreeContext(gl),
      ...props,
    });

    this.setPixelRatio(pixelRatio);
    if (width && height) {
      this.setSize(width, height, false);
    }
    if (clearColor !== undefined) {
      this.setClearColor(clearColor);
    }
  }
}

export default DieRenderer;
