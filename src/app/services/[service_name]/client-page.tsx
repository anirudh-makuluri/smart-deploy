"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import DeployWorkspace from "@/components/DeployWorkspace";
import { AppDataLoader } from "@/components/AppDataLoader";

export default function Page({ service_name }: { service_name: string }) {
	const searchParams = useSearchParams();
	const deploymentId = searchParams.get("deploymentId") ?? searchParams.get("id") ?? undefined;

	return (
		<AppDataLoader>
			<DeployWorkspace serviceName={service_name} deploymentId={deploymentId ?? undefined} />
		</AppDataLoader>
	);
}
