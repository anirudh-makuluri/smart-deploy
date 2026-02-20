"use client";

import { useSearchParams } from "next/navigation";
import DeployWorkspace from "@/components/DeployWorkspace";
import { useAppDataQuery } from "@/hooks/useAppDataQuery";

export default function Page({ service_name }: { service_name: string }) {
	useAppDataQuery(); // Ensure app data is loaded when opening a service
	const searchParams = useSearchParams();
	const deploymentId = searchParams.get("deploymentId") ?? searchParams.get("id") ?? undefined;

	return (
		<DeployWorkspace serviceName={service_name} deploymentId={deploymentId ?? undefined} />
	);
}
