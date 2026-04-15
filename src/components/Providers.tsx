"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { WorkerWebSocketProvider } from "@/components/WorkerWebSocketProvider";
import { PosthogGate } from "@/components/analytics/PosthogGate";
import { SessionFailureLogoutGuard } from "@/components/auth/SessionFailureLogoutGuard";

export default function Providers({ children }: { children: React.ReactNode }) {
	const [queryClient] = useState(
		() =>
			new QueryClient({
				defaultOptions: {
					queries: {
						staleTime: 60 * 1000, // 1 min – avoid refetch on every mount
					},
				},
			})
	);

	return (
		<PosthogGate>
			<SessionFailureLogoutGuard />
			<QueryClientProvider client={queryClient}>
				<WorkerWebSocketProvider>{children}</WorkerWebSocketProvider>
			</QueryClientProvider>
		</PosthogGate>
	);
}
