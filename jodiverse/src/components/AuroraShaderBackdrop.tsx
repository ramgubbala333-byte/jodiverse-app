import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
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

export default function AuroraShaderBackdrop() {
  const [failed, setFailed] = useState(false);
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

            const start = Date.now();
            const frame = () => {
              const t = (Date.now() - start) / 1000;
              gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
              gl.uniform1f(timeLoc, t);
              gl.drawArrays(gl.TRIANGLES, 0, 6);
              gl.endFrameEXP();
              requestAnimationFrame(frame);
            };
            frame();
          } catch {
            setFailed(true);
          }
        }}
      />
    </View>
  );
}
