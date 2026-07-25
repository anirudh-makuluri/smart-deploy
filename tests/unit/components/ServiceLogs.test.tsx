import { fireEvent, render, screen } from "@testing-library/react";
import type { HTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import ServiceLogs from "@/components/ServiceLogs";

type ScrollAreaMockProps = HTMLAttributes<HTMLDivElement> & { children: ReactNode };

vi.mock("@/components/ui/scroll-area", () => ({
	ScrollArea: ({ children, ...props }: ScrollAreaMockProps) => (
		<div {...props}>
			<div data-slot="scroll-area-viewport">{children}</div>
		</div>
	),
}));

type ViewportMetrics = {
	getScrollTop: () => number;
	setScrollHeight: (value: number) => void;
	setScrollTop: (value: number) => void;
};

function setViewportMetrics(viewport: HTMLDivElement): ViewportMetrics {
	let scrollHeight = 400;
	let scrollTop = 0;

	Object.defineProperties(viewport, {
		clientHeight: { configurable: true, value: 100 },
		scrollHeight: { configurable: true, get: () => scrollHeight },
		scrollTop: {
			configurable: true,
			get: () => scrollTop,
			set: (value: number) => {
				scrollTop = value;
			},
		},
	});

	return {
		getScrollTop: () => scrollTop,
		setScrollHeight: (value) => {
			scrollHeight = value;
		},
		setScrollTop: (value) => {
			scrollTop = value;
		},
	};
}

const initialLogs = [{ timestamp: "2026-07-12T05:55:23.000Z", message: "Starting deployment" }];
const nextLog = { timestamp: "2026-07-12T05:55:24.000Z", message: "Building image" };

function renderLogs(logs = initialLogs) {
	return render(<ServiceLogs logs={logs} deployStatus="running" scrollable />);
}

describe("ServiceLogs deployment auto-scroll", () => {
	it("keeps the reader's position when a new log arrives after they scroll up", () => {
		const view = renderLogs();
		const viewport = view.container.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]');
		expect(viewport).not.toBeNull();
		const metrics = setViewportMetrics(viewport!);

		metrics.setScrollTop(120);
		fireEvent.scroll(viewport!);
		metrics.setScrollHeight(500);
		view.rerender(<ServiceLogs logs={[...initialLogs, nextLog]} deployStatus="running" scrollable />);

		expect(metrics.getScrollTop()).toBe(120);
		expect(screen.getByRole("button", { name: "Scroll to bottom" })).toBeVisible();
	});

	it("follows a new log when the reader is already at the bottom", () => {
		const view = renderLogs();
		const viewport = view.container.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]');
		expect(viewport).not.toBeNull();
		const metrics = setViewportMetrics(viewport!);

		metrics.setScrollTop(300);
		fireEvent.scroll(viewport!);
		metrics.setScrollHeight(500);
		view.rerender(<ServiceLogs logs={[...initialLogs, nextLog]} deployStatus="running" scrollable />);

		expect(metrics.getScrollTop()).toBe(500);
	});
});
