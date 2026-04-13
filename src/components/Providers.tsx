"use client";

import { SessionProvider } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import ActiveDeploymentProvider from "@/components/ActiveDeploymentProvider";
import { PosthogGate } from "@/components/analytics/PosthogGate";

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
		<SessionProvider>
			<PosthogGate>
				<QueryClientProvider client={queryClient}>
					<ActiveDeploymentProvider>{children}</ActiveDeploymentProvider>
				</QueryClientProvider>
			</PosthogGate>
		</SessionProvider>
	);
}
