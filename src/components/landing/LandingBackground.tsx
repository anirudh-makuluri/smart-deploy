"use client";

import * as React from "react";

type Point = { x: number; y: number };
type Trace = { pts: Point[]; segs: number };
type Pulse = { trace: number; pos: number; speed: number; tone: 0 | 1 };

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
	const raw = hex.replace("#", "").trim();
	const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
	const n = Number.parseInt(full, 16);
	if (Number.isNaN(n) || full.length !== 6) return [59, 130, 246];
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const CELL = 92;
const FRAME_INTERVAL = 1000 / 40;
const PARALLAX = 22;

/**
 * Animated "deployment blueprint" backdrop: a grid-aligned circuit of traces with
 * light pulses traveling along them, drifting aurora, and subtle pointer parallax.
 * Pure 2D canvas — no dependencies, DPR-aware, pauses when hidden, and renders a
 * single static frame when the user prefers reduced motion.
 */
export function LandingBackground() {
	const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

	React.useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);

		const rootStyles = getComputedStyle(document.documentElement);
		const primary = hexToRgb(rootStyles.getPropertyValue("--primary") || "#3b82f6");
		const cyan: RGB = [56, 189, 248];

		let width = 0;
		let height = 0;
		let traces: Trace[] = [];
		let pulses: Pulse[] = [];

		let targetX = 0.5;
		let targetY = 0.42;
		let smoothX = 0.5;
		let smoothY = 0.42;

		const rand = (min: number, max: number) => min + Math.random() * (max - min);

		function spawnPulse(): Pulse {
			const trace = traces.length > 0 ? Math.floor(rand(0, traces.length)) : 0;
			const segs = traces[trace]?.segs ?? 1;
			return {
				trace,
				pos: rand(0, Math.max(1, segs)),
				speed: rand(0.55, 1.5),
				tone: Math.random() < 0.5 ? 0 : 1,
			};
		}

		function buildScene() {
			const cols = Math.ceil(width / CELL) + 2;
			const rows = Math.ceil(height / CELL) + 2;
			traces = [];
			const traceCount = Math.min(48, Math.max(14, Math.floor((cols * rows) / 11)));

			for (let t = 0; t < traceCount; t++) {
				let ci = Math.floor(rand(0, cols));
				let ri = Math.floor(rand(0, rows));
				let dir = Math.floor(rand(0, 4)); // 0:right 1:down 2:left 3:up
				const length = Math.floor(rand(4, 11));
				const pts: Point[] = [{ x: ci * CELL, y: ri * CELL }];

				for (let s = 0; s < length; s++) {
					if (Math.random() < 0.32) dir = (dir + (Math.random() < 0.5 ? 1 : 3)) % 4;
					if (dir === 0) ci++;
					else if (dir === 1) ri++;
					else if (dir === 2) ci--;
					else ri--;
					ci = Math.max(0, Math.min(cols, ci));
					ri = Math.max(0, Math.min(rows, ri));
					const last = pts[pts.length - 1];
					const nx = ci * CELL;
					const ny = ri * CELL;
					if (nx === last.x && ny === last.y) continue;
					pts.push({ x: nx, y: ny });
				}

				if (pts.length >= 3) traces.push({ pts, segs: pts.length - 1 });
			}

			const pulseCount = Math.min(24, Math.max(8, Math.floor(traces.length * 0.55)));
			pulses = Array.from({ length: pulseCount }, spawnPulse);
		}

		function pointAt(trace: Trace, pos: number): Point {
			const clamped = Math.max(0, Math.min(trace.segs - 0.0001, pos));
			const i = Math.floor(clamped);
			const f = clamped - i;
			const a = trace.pts[i];
			const b = trace.pts[i + 1];
			return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
		}

		function resize() {
			width = window.innerWidth;
			height = window.innerHeight;
			canvas.width = Math.floor(width * dpr);
			canvas.height = Math.floor(height * dpr);
			canvas.style.width = `${width}px`;
			canvas.style.height = `${height}px`;
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			buildScene();
		}

		function drawAurora(time: number) {
			const maxDim = Math.max(width, height);
			const blobs = [
				{
					x: width * (0.27 + Math.sin(time * 0.00007) * 0.05),
					y: height * (0.3 + Math.cos(time * 0.00009) * 0.06),
					color: primary,
					radius: maxDim * 0.55,
					alpha: 0.16,
				},
				{
					x: width * (0.76 + Math.cos(time * 0.00006) * 0.05),
					y: height * (0.68 + Math.sin(time * 0.00008) * 0.05),
					color: cyan,
					radius: maxDim * 0.45,
					alpha: 0.1,
				},
			];
			for (const blob of blobs) {
				const gradient = ctx.createRadialGradient(blob.x, blob.y, 0, blob.x, blob.y, blob.radius);
				gradient.addColorStop(0, `rgba(${blob.color[0]},${blob.color[1]},${blob.color[2]},${blob.alpha})`);
				gradient.addColorStop(1, `rgba(${blob.color[0]},${blob.color[1]},${blob.color[2]},0)`);
				ctx.fillStyle = gradient;
				ctx.fillRect(0, 0, width, height);
			}
		}

		function draw(time: number) {
			smoothX += (targetX - smoothX) * 0.04;
			smoothY += (targetY - smoothY) * 0.04;
			const offsetX = (smoothX - 0.5) * -PARALLAX;
			const offsetY = (smoothY - 0.5) * -PARALLAX;

			ctx.clearRect(0, 0, width, height);
			drawAurora(time);

			ctx.save();
			ctx.translate(offsetX, offsetY);

			ctx.lineWidth = 1;
			ctx.strokeStyle = `rgba(${primary[0]},${primary[1]},${primary[2]},0.055)`;
			for (const trace of traces) {
				ctx.beginPath();
				ctx.moveTo(trace.pts[0].x, trace.pts[0].y);
				for (let i = 1; i < trace.pts.length; i++) ctx.lineTo(trace.pts[i].x, trace.pts[i].y);
				ctx.stroke();
			}

			ctx.fillStyle = `rgba(${primary[0]},${primary[1]},${primary[2]},0.1)`;
			for (const trace of traces) {
				for (const p of trace.pts) ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
			}

			for (const pulse of pulses) {
				const trace = traces[pulse.trace];
				if (!trace) {
					Object.assign(pulse, spawnPulse());
					continue;
				}
				if (!prefersReduced) pulse.pos += pulse.speed * 0.03;
				if (pulse.pos >= trace.segs) {
					Object.assign(pulse, spawnPulse());
					continue;
				}

				const color = pulse.tone === 0 ? primary : cyan;
				const trailSteps = 6;
				for (let k = trailSteps; k >= 0; k--) {
					const p = pointAt(trace, pulse.pos - k * 0.16);
					const alpha = (1 - k / (trailSteps + 1)) * 0.85;
					const radius = Math.max(0.5, 2.2 * (1 - k / (trailSteps + 2)));
					ctx.beginPath();
					ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
					ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
					ctx.fill();
				}

				const head = pointAt(trace, pulse.pos);
				const glow = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 15);
				glow.addColorStop(0, `rgba(${color[0]},${color[1]},${color[2]},0.5)`);
				glow.addColorStop(1, `rgba(${color[0]},${color[1]},${color[2]},0)`);
				ctx.fillStyle = glow;
				ctx.beginPath();
				ctx.arc(head.x, head.y, 15, 0, Math.PI * 2);
				ctx.fill();
				ctx.beginPath();
				ctx.fillStyle = "rgba(255,255,255,0.95)";
				ctx.arc(head.x, head.y, 1.6, 0, Math.PI * 2);
				ctx.fill();
			}

			ctx.restore();
		}

		let rafId = 0;
		let lastFrame = 0;
		const loop = (time: number) => {
			rafId = requestAnimationFrame(loop);
			if (time - lastFrame < FRAME_INTERVAL) return;
			lastFrame = time;
			draw(time);
		};

		const onPointerMove = (event: PointerEvent) => {
			targetX = event.clientX / width;
			targetY = event.clientY / height;
		};
		const onVisibility = () => {
			if (document.hidden) {
				cancelAnimationFrame(rafId);
				rafId = 0;
			} else if (!rafId && !prefersReduced) {
				lastFrame = 0;
				rafId = requestAnimationFrame(loop);
			}
		};

		resize();
		if (prefersReduced) {
			draw(0);
		} else {
			rafId = requestAnimationFrame(loop);
		}

		window.addEventListener("resize", resize);
		window.addEventListener("pointermove", onPointerMove, { passive: true });
		document.addEventListener("visibilitychange", onVisibility);

		return () => {
			cancelAnimationFrame(rafId);
			window.removeEventListener("resize", resize);
			window.removeEventListener("pointermove", onPointerMove);
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, []);

	return (
		<div aria-hidden className="pointer-events-none fixed inset-0 z-0">
			<canvas ref={canvasRef} className="h-full w-full" />
		</div>
	);
}
