"use client";
import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";

const LIME = "#B7F34A", EMERALD = "#35C98A", BODY = "#1d241e", EDGE = "#2c362d";

function Rack({ position }: { position: [number, number, number] }) {
  const boxes = useMemo(() => [0.35, 1.05, 1.75].flatMap((y, row) => [-0.7, 0, 0.7].map((x, col) => ({ x, y, key: `${row}${col}`, lit: (row * 3 + col) % 4 === 0 }))), []);
  return (
    <group position={position}>
      {[-1, 1].flatMap((sx) => [-0.4, 0.4].map((sz) => <mesh key={`${sx}${sz}`} position={[sx * 1.1, 1.05, sz]}><boxGeometry args={[0.07, 2.2, 0.07]} /><meshStandardMaterial color={EDGE} /></mesh>))}
      {[0, 0.7, 1.4, 2.1].map((y) => <mesh key={y} position={[0, y, 0]}><boxGeometry args={[2.3, 0.05, 0.9]} /><meshStandardMaterial color={EDGE} /></mesh>)}
      {boxes.map((b) => <mesh key={b.key} position={[b.x, b.y + 0.08, 0]}><boxGeometry args={[0.55, 0.45, 0.6]} /><meshStandardMaterial color={b.lit ? LIME : BODY} emissive={b.lit ? LIME : "#000"} emissiveIntensity={b.lit ? 0.45 : 0} roughness={0.6} /></mesh>)}
    </group>
  );
}
function Floating({ base, phase, animate }: { base: [number, number, number]; phase: number; animate: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => { if (animate && ref.current) { ref.current.position.y = base[1] + Math.sin(clock.elapsedTime * 1.2 + phase) * 0.18; ref.current.rotation.y = clock.elapsedTime * 0.4 + phase; } });
  return <mesh ref={ref} position={base}><boxGeometry args={[0.5, 0.5, 0.5]} /><meshStandardMaterial color={LIME} emissive={LIME} emissiveIntensity={0.5} roughness={0.4} /></mesh>;
}
function SupplierNode({ position, animate }: { position: [number, number, number]; animate: boolean }) {
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => { if (animate && ring.current) ring.current.scale.setScalar(1 + ((clock.elapsedTime * 0.6) % 1) * 0.9); });
  return (<group position={position}><mesh><sphereGeometry args={[0.28, 24, 24]} /><meshStandardMaterial color={EMERALD} emissive={EMERALD} emissiveIntensity={0.7} /></mesh>
    <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.4, 0.43, 40]} /><meshBasicMaterial color={EMERALD} transparent opacity={0.5} /></mesh></group>);
}
function Scene({ animate }: { animate: boolean }) {
  const group = useRef<THREE.Group>(null);
  useFrame(({ pointer }) => { // restrained, mouse-responsive parallax
    if (!animate || !group.current) return;
    group.current.rotation.y = THREE.MathUtils.lerp(group.current.rotation.y, pointer.x * 0.18, 0.04);
    group.current.position.y = THREE.MathUtils.lerp(group.current.position.y, pointer.y * 0.15, 0.04);
  });
  const nodes: [number, number, number][] = [[-5, 0.3, 3.2], [5.2, 0.3, 2.4], [0, 0.3, -5]];
  return (
    <group ref={group}>
      <ambientLight intensity={0.55} /><directionalLight position={[6, 9, 4]} intensity={1.1} /><pointLight position={[0, 3, 0]} intensity={14} color={LIME} distance={9} />
      <gridHelper args={[16, 16, "#3a4a31", "#1f2620"]} position={[0, 0, 0]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}><planeGeometry args={[16, 16]} /><meshStandardMaterial color="#0f1310" /></mesh>
      <Rack position={[-2.2, 0, -1.6]} /><Rack position={[2.2, 0, -1.6]} /><Rack position={[-2.2, 0, 1.2]} /><Rack position={[2.2, 0, 1.2]} />
      <Floating base={[0, 1.6, 0]} phase={0} animate={animate} /><Floating base={[-1, 2.3, 2.2]} phase={2} animate={animate} /><Floating base={[1.4, 2.0, -3]} phase={4} animate={animate} />
      {nodes.map((n, i) => <group key={i}><SupplierNode position={n} animate={animate} /><Line points={[n, [0, 0.3, 0]]} color={EMERALD} lineWidth={1.4} dashed dashSize={0.25} gapSize={0.2} transparent opacity={0.7} /></group>)}
    </group>
  );
}
export default function WarehouseScene({ animate }: { animate: boolean }) {
  return (
    <Canvas orthographic camera={{ position: [9, 8, 9], zoom: 38, near: 0.1, far: 100 }} dpr={[1, 1.75]} gl={{ antialias: true, alpha: true }} frameloop={animate ? "always" : "demand"} aria-label="Isometric warehouse with connected suppliers">
      <Scene animate={animate} />
    </Canvas>
  );
}
