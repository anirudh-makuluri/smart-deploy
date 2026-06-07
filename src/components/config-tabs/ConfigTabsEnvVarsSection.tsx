import { Layers, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfigTabsSectionLayout } from "@/components/config-tabs/ConfigTabsSectionLayout";

type ConfigTabsEnvVarsSectionProps = {
	envEntryCount: number;
	onEdit: () => void;
};

export function ConfigTabsEnvVarsSection({ envEntryCount, onEdit }: ConfigTabsEnvVarsSectionProps) {
	return (
		<ConfigTabsSectionLayout
			icon={<Layers className="size-3.5" />}
			title="Environment Variables"
			description="Secure credentials and runtime configuration"
		>
			<div className="w-full max-w-sm">
				<div className="p-4 rounded-xl border border-white/5 bg-white/[0.02] flex items-center justify-between gap-4 group hover:border-white/10 transition-colors">
					<div className="flex flex-col gap-0.5">
						<span className="text-sm font-bold text-foreground flex items-center gap-2">
							{envEntryCount || 0} Secret Keys
							<span className="px-1.5 py-0.5 rounded-md bg-white/5 text-[10px] text-muted-foreground/60">
								Configured
							</span>
						</span>
						<span className="text-[10px] text-muted-foreground/40 font-medium">API keys & credentials</span>
					</div>
					<Button
						type="button"
						variant="outline"
						className="bg-primary/10 border-primary/20 hover:bg-primary/20 text-primary h-9 px-4 rounded-lg font-bold flex items-center gap-2 transition-all active:scale-95 text-[10px]"
						onClick={onEdit}
					>
						<Settings2 className="size-3.5" />
						Edit
					</Button>
				</div>
			</div>
		</ConfigTabsSectionLayout>
	);
}
