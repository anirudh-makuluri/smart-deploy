import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ServiceLogsList } from "@/components/service-logs/ServiceLogsList";

describe("ServiceLogsList", () => {
	it("keeps the timestamp and full message available in the mobile row layout", () => {
		const onSelectLog = vi.fn();
		render(
			<ServiceLogsList
				logs={[{ timestamp: "2026-07-11T12:34:56.000Z", message: "A deployment log message" }]}
				onSelectLog={onSelectLog}
			/>
		);

		const row = screen.getByRole("button", { name: /A deployment log message/i });
		expect(row).toHaveClass("grid-cols-[5.5rem_minmax(0,1fr)]");
		expect(screen.getAllByText(/^\d{2}:\d{2}:\d{2}$/)).toHaveLength(2);

		fireEvent.click(row);
		expect(onSelectLog).toHaveBeenCalledWith({
			timestamp: "2026-07-11T12:34:56.000Z",
			message: "A deployment log message",
		});
	});
});
