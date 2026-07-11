"use client";

import * as React from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { DemoPhase } from "@/lib/landing/interactiveDemo";
import { getBackgroundPhase } from "@/lib/landing/interactiveDemo";

type BackgroundPhase = ReturnType<typeof getBackgroundPhase>;

type LandingHeroCanvasProps = {
	phase: DemoPhase;
	animate: boolean;
};

function readPrimaryColor(): string {
	if (typeof window === "undefined") return "#3b82f6";
	return getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || "#3b82f6";
}

const vertexShader = /* glsl */ `
	varying vec2 vUv;
	void main() {
		vUv = uv;
		gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
	}
`;

const fragmentShader = /* glsl */ `
	precision highp float;
	varying vec2 vUv;
	uniform float uTime;
	uniform float uScan;
	uniform float uBlueprint;
	uniform float uDeploy;
	uniform float uComplete;
	uniform vec3 uColor;

	float gridLayer(vec2 uv, float scale) {
		vec2 c = uv * scale;
		vec2 g = abs(fract(c - 0.5) - 0.5) / fwidth(c);
		float line = min(g.x, g.y);
		return 1.0 - min(line, 1.0);
	}

	void main() {
		vec2 uv = vUv;
		vec2 p = uv - 0.5;
		float dist = length(p);

		float grid = gridLayer(uv, 30.0) + gridLayer(uv, 7.0) * 0.6;

		float base = 0.34 + uBlueprint * 0.3 + uScan * 0.12 + uDeploy * 0.16;
		float intensity = grid * base;

		// Radar sweep during scan.
		float sweep = fract(uTime * 0.32);
		float ring = smoothstep(0.025, 0.0, abs(dist - sweep * 0.72));
		intensity += ring * uScan * 1.1;

		// Racing pulses along lanes during deploy.
		float speed = 0.25 + uDeploy * 1.4;
		float move = fract(uv.x - uTime * speed);
		float pulse = smoothstep(0.0, 0.02, move) * smoothstep(0.08, 0.02, move);
		intensity += pulse * grid * (0.25 + uDeploy * 1.3) * 0.5;

		// One-shot expanding ripple on complete.
		float ripple = smoothstep(0.05, 0.0, abs(dist - uComplete * 0.85)) * (1.0 - uComplete);
		intensity += ripple * 1.4;

		float fade = smoothstep(0.8, 0.08, dist);
		intensity *= fade;

		vec3 col = uColor * intensity;
		gl_FragColor = vec4(col, intensity);
	}
`;

function damp(current: number, target: number, lambda: number, dt: number): number {
	return THREE.MathUtils.damp(current, target, lambda, dt);
}

function GridPlane({ phase, animate }: { phase: BackgroundPhase; animate: boolean }) {
	const materialRef = React.useRef<THREE.ShaderMaterial>(null);
	const primaryColor = React.useMemo(() => new THREE.Color(readPrimaryColor()), []);
	const uniforms = React.useMemo(
		() => ({
			uTime: { value: 0 },
			uScan: { value: 0 },
			uBlueprint: { value: 0 },
			uDeploy: { value: 0 },
			uComplete: { value: 0 },
			uColor: { value: primaryColor },
		}),
		[primaryColor]
	);

	useFrame((_, delta) => {
		const material = materialRef.current;
		if (!material) return;
		const dt = Math.min(delta, 0.05);
		const u = material.uniforms;

		if (animate && (typeof document === "undefined" || !document.hidden)) {
			u.uTime.value += dt;
		}

		const scanTarget = phase === "scan" ? 1 : 0;
		const blueprintTarget = phase === "blueprint" ? 1 : 0;
		const deployTarget = phase === "deploy" ? 1 : 0;
		const completeTarget = phase === "complete" ? 1 : 0;

		if (animate) {
			u.uScan.value = damp(u.uScan.value, scanTarget, 4, dt);
			u.uBlueprint.value = damp(u.uBlueprint.value, blueprintTarget, 4, dt);
			u.uDeploy.value = damp(u.uDeploy.value, deployTarget, 4, dt);
			u.uComplete.value = damp(u.uComplete.value, completeTarget, 2.2, dt);
		} else {
			u.uScan.value = scanTarget;
			u.uBlueprint.value = blueprintTarget;
			u.uDeploy.value = deployTarget;
			u.uComplete.value = completeTarget;
		}
	});

	return (
		<mesh rotation={[-Math.PI / 2.15, 0, 0]} position={[0, -1.4, 0]}>
			<planeGeometry args={[46, 46, 1, 1]} />
			<shaderMaterial
				ref={materialRef}
				vertexShader={vertexShader}
				fragmentShader={fragmentShader}
				uniforms={uniforms}
				transparent
				depthWrite={false}
				blending={THREE.AdditiveBlending}
			/>
		</mesh>
	);
}

export function LandingHeroCanvas({ phase, animate }: LandingHeroCanvasProps) {
	const backgroundPhase = getBackgroundPhase(phase);
	return (
		<Canvas
			className="h-full w-full"
			camera={{ position: [0, 4.2, 8], fov: 50 }}
			dpr={typeof window !== "undefined" ? Math.min(window.devicePixelRatio, 2) : 1}
			gl={{ antialias: true, alpha: true }}
			frameloop={animate ? "always" : "demand"}
		>
			<GridPlane phase={backgroundPhase} animate={animate} />
		</Canvas>
	);
}
