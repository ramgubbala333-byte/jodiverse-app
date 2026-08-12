import React, { useEffect, useRef, useState } from "react";
import { AppState, StyleSheet, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { GLView } from "expo-gl";
import GlowBackdrop from "./GlowBackdrop";

// Real animated WebGL aurora background — a 1:1 port of the Stitch-generated
// fragment shader (slow flowing noise-gradient across the brand colours).
// Falls back to the cheap static GlowBackdrop if GL context creation fails
// for any reason (some emulators / very old devices) so a shader hiccup
// never takes the screen down with it.
const VERTEX_SRC = `
attribute vec2 position;
varying vec2 v_texCoord;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
  v_texCoord = position * 0.5 + 0.5;
}`;

const FRAGMENT_SRC = `
precision highp float;
varying vec2 v_texCoord;
uniform float u_time;

void main() {
  vec2 uv = v_texCoord;

  // Slow, flowing dark aurora effect using layered sine/cosine noise
  float noise = sin(uv.x * 3.0 + u_time * 0.5) * cos(uv.y * 2.0 - u_time * 0.3);
  noise += sin(uv.y * 4.0 + u_time * 0.2) * cos(uv.x * 5.0 + u_time * 0.4);

  // Base dark blue undertone: #0B0D14
  vec3 baseColor = vec3(0.043, 0.051, 0.078);

  // Signature gradient: orange #FF9F1C, coral #FF5E3A, red-pink #FF2D55
  vec3 color1 = vec3(1.0, 0.624, 0.11);
  vec3 color2 = vec3(1.0, 0.369, 0.227);
  vec3 color3 = vec3(1.0, 0.176, 0.333);

  vec3 gradient = mix(color1, color2, sin(u_time * 0.2) * 0.5 + 0.5);
  gradient = mix(gradient, color3, cos(u_time * 0.3) * 0.5 + 0.5);

  vec3 finalColor = mix(baseColor, gradient, noise * 0.15 + 0.05);
  gl_FragColor = vec4(finalColor, 1.0);
}`;

// The effect is a slow ambient drift — 30fps is indistinguishable from 60 here
// and halves the GPU work on the phones most likely to struggle with it.
const FRAME_MS = 1000 / 30;

export default function AuroraShaderBackdrop() {
  const [failed, setFailed] = useState(false);

  // The render loop MUST be stoppable from outside onContextCreate. Without
  // this, every mount left a full-screen 60fps shader running forever — six
  // screens use this component, tabs keep several alive at once, and the loops
  // accumulated for as long as the app stayed open.
  const running = useRef(false);
  const rafId = useRef<number | null>(null);
  const drawRef = useRef<(() => void) | null>(null);

  // Only the visible screen animates. A backdrop nobody is looking at has no
  // business holding the GPU — this is most of the win on a mid-range phone.
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === "active");

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) =>
      setActive(s === "active"));
    return () => sub.remove();
  }, []);

  const shouldRun = focused && active && !failed;

  useEffect(() => {
    if (shouldRun) {
      running.current = true;
      drawRef.current?.();
    } else {
      running.current = false;
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    return () => {
      running.current = false;
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
      rafId.current = null;
    };
  }, [shouldRun]);

  if (failed) return <GlowBackdrop />;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <GLView
        style={StyleSheet.absoluteFill}
        onContextCreate={(gl) => {
          try {
            const vs = gl.createShader(gl.VERTEX_SHADER)!;
            gl.shaderSource(vs, VERTEX_SRC);
            gl.compileShader(vs);

            const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
            gl.shaderSource(fs, FRAGMENT_SRC);
            gl.compileShader(fs);

            const program = gl.createProgram()!;
            gl.attachShader(program, vs);
            gl.attachShader(program, fs);
            gl.linkProgram(program);
            gl.useProgram(program);

            const buf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferData(gl.ARRAY_BUFFER,
              new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
              gl.STATIC_DRAW);
            const posLoc = gl.getAttribLocation(program, "position");
            gl.enableVertexAttribArray(posLoc);
            gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
            const timeLoc = gl.getUniformLocation(program, "u_time");

            // Accumulate only the time we actually rendered, so pausing and
            // resuming resumes the drift instead of jumping forward by however
            // long the screen sat in the background.
            let elapsed = 0;
            let last = Date.now();

            const frame = () => {
              if (!running.current) { rafId.current = null; return; }
              const now = Date.now();
              const dt = now - last;
              if (dt >= FRAME_MS) {
                last = now;
                elapsed += dt / 1000;
                gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
                gl.uniform1f(timeLoc, elapsed);
                gl.drawArrays(gl.TRIANGLES, 0, 6);
                gl.endFrameEXP();
              }
              rafId.current = requestAnimationFrame(frame);
            };

            drawRef.current = () => {
              if (rafId.current === null) {
                last = Date.now();
                rafId.current = requestAnimationFrame(frame);
              }
            };
            if (shouldRun) { running.current = true; drawRef.current(); }
          } catch {
            setFailed(true);
          }
        }}
      />
    </View>
  );
}
