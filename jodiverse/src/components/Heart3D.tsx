import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { GLView } from "expo-gl";
import { Renderer } from "expo-three";
import * as THREE from "three";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../theme";

// Small rotating 3D heart accent — a 1:1 port of the Stitch-generated
// three.js decoration (two sphere "lobes" + a cone, gently rotating and
// pulsing). Falls back to a flat gradient heart icon if the GL context or
// three.js render loop fails for any reason.
export default function Heart3D({ size = 96 }: { size?: number }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <View style={[s.fallback, { width: size, height: size }]}>
        <Ionicons name="heart" size={size * 0.5} color={theme.gold} />
      </View>
    );
  }

  return (
    <View style={{ width: size, height: size }}>
      <GLView
        style={{ width: size, height: size }}
        onContextCreate={async (gl) => {
          try {
            const renderer = new Renderer({ gl });
            renderer.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight);
            renderer.setClearColor(0x000000, 0); // transparent background

            const scene = new THREE.Scene();
            const camera = new THREE.PerspectiveCamera(
              75, gl.drawingBufferWidth / gl.drawingBufferHeight, 0.1, 1000);
            camera.position.z = 3;

            const heartGroup = new THREE.Group();
            const material = new THREE.MeshPhongMaterial({
              color: 0xff5e3a, shininess: 100, specular: 0x444444,
            });
            const sphereGeom = new THREE.SphereGeometry(0.5, 24, 24);
            const leftLobe = new THREE.Mesh(sphereGeom, material);
            leftLobe.position.set(-0.35, 0.3, 0);
            heartGroup.add(leftLobe);
            const rightLobe = new THREE.Mesh(sphereGeom, material);
            rightLobe.position.set(0.35, 0.3, 0);
            heartGroup.add(rightLobe);
            const coneGeom = new THREE.ConeGeometry(0.72, 1.2, 24);
            const bottom = new THREE.Mesh(coneGeom, material);
            bottom.rotation.x = Math.PI;
            bottom.position.y = -0.2;
            heartGroup.add(bottom);
            scene.add(heartGroup);

            const light = new THREE.PointLight(0xffffff, 1, 100);
            light.position.set(5, 5, 5);
            scene.add(light);
            scene.add(new THREE.AmbientLight(0x404040));

            const render = () => {
              requestAnimationFrame(render);
              heartGroup.rotation.y += 0.02;
              heartGroup.rotation.x = Math.sin(Date.now() * 0.002) * 0.1;
              const scale = 1 + Math.sin(Date.now() * 0.005) * 0.05;
              heartGroup.scale.set(scale, scale, scale);
              renderer.render(scene, camera);
              gl.endFrameEXP();
            };
            render();
          } catch {
            setFailed(true);
          }
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  fallback: { alignItems: "center", justifyContent: "center" },
});
