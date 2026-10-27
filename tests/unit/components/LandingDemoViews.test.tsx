import React from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { domAnimation, LazyMotion } from "framer-motion";
import { CompleteMock, DeployProgressMock, ScanResultsMock } from "@/components/landing/DemoWorkspaceMocks";
import { buildDemoStoryContext, DEMO_REPOS } from "@/lib/landing/demoRepos";
import { SCAN_LOG_COUNT } from "@/lib/landing/scanTimeline";

const context = buildDemoStoryContext(DEMO_REPOS[0]);

describe("landing demonstration states", () => {
	afterEach(() => vi.useRealTimers());

	it.each([true, false])("shows running and completed scan and deploy states (compact=%s)", (compact) => {
		const view = render(
			<LazyMotion features={domAnimation}>
				<ScanResultsMock context={context} compact={compact} visibleLineCount={0} />
			</LazyMotion>,
		);
		expect(screen.getByText("Running Smart Analysis…")).toBeInTheDocument();
		view.rerender(
			<LazyMotion features={domAnimation}>
				<ScanResultsMock context={context} compact={compact} visibleLineCount={SCAN_LOG_COUNT} />
			</LazyMotion>,
		);
		expect(screen.getByText("Smart Analysis complete")).toBeInTheDocument();
		view.rerender(
			<LazyMotion features={domAnimation}>
				<DeployProgressMock compact={compact} visibleLineCount={0} progress={0} />
			</LazyMotion>,
		);
		expect(screen.getByText("Deploy in progress")).toBeInTheDocument();
		view.rerender(
			<LazyMotion features={domAnimation}>
				<DeployProgressMock compact={compact} visibleLineCount={2} progress={100} />
			</LazyMotion>,
		);
		expect(screen.getByText("Deployment live")).toBeInTheDocument();
		expect(screen.getByText("Health checks passed")).toBeInTheDocument();
	});

	it("keeps browser metadata and paints app content after its loading delay", async () => {
		vi.useFakeTimers();
		render(
			<LazyMotion features={domAnimation}>
				<CompleteMock context={context} compact={false} />
			</LazyMotion>,
		);
		expect(screen.getByText(`https://${context.customDomain}`)).toBeInTheDocument();
		expect(screen.getByText(context.region)).toBeInTheDocument();
		expect(screen.queryByText(`${context.serviceLabel} · live on your AWS`)).not.toBeInTheDocument();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1000);
		});
		expect(screen.getByText(`${context.serviceLabel} · live on your AWS`)).toBeInTheDocument();
	});
});
