import { CircleDot, Folder, Globe } from "lucide-react";
import type { DeployConfig } from "@/app/types";
import { ConfigTabsSectionLayout } from "@/components/config-tabs/ConfigTabsSectionLayout";

type ConfigTabsProjectSourceSectionProps = {
	deployment: DeployConfig;
	repoFullName: string;
};

export function ConfigTabsProjectSourceSection({ deployment, repoFullName }: ConfigTabsProjectSourceSectionProps) {
	return (
		<ConfigTabsSectionLayout
			showTopBorder={false}
			icon={<Folder className="size-3.5" />}
			title="Project Source"
			description="Repository and service identifiers"
		>
			<div className="flex flex-col gap-4 w-full">
				<div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6 flex items-center gap-4 group hover:border-white/10 transition-colors">
					<div className="bg-primary/10 p-3 rounded-xl shrink-0 group-hover:scale-110 transition-transform">
						<CircleDot className="size-6 text-primary" />
					</div>
					<div className="flex flex-col overflow-hidden">
						<span className="font-bold text-foreground text-sm truncate">
							{deployment.serviceName != "." ? deployment.serviceName + "@" : ""}
							{deployment.repoName}
						</span>
						<a
							href={`https://github.com/${repoFullName}`}
							target="_blank"
							rel="noopener noreferrer"
							className="text-[10px] text-muted-foreground/40 font-mono truncate hover:text-primary transition-colors flex items-center gap-1"
						>
							https://github.com/{repoFullName}
							<Globe className="size-2.5" />
						</a>
					</div>
				</div>
			</div>
		</ConfigTabsSectionLayout>
	);
}
