"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { WorkerWebSocketProvider } from "@/components/WorkerWebSocketProvider";
import { PosthogGate } from "@/components/analytics/PosthogGate";
import { SessionFailureLogoutGuard } from "@/components/auth/SessionFailureLogoutGuard";
import { isPublicOrAuthRoute } from "@/lib/publicRoutes";

export default function Providers({ children }: { children: React.ReactNode }) {
	const pathname = usePathname() ?? "/";
	const disableAuthBoundProviders = isPublicOrAuthRoute(pathname);
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
			<QueryClientProvider client={queryClient}>
				{disableAuthBoundProviders ? (
					children
				) : (
					<>
						<SessionFailureLogoutGuard />
						<WorkerWebSocketProvider>{children}</WorkerWebSocketProvider>
					</>
				)}
			</QueryClientProvider>
		</PosthogGate>
	);
}
