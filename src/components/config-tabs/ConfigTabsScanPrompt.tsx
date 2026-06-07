import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

type ConfigTabsScanPromptProps = {
	onStartScan?: () => void;
};

export function ConfigTabsScanPrompt({ onStartScan }: ConfigTabsScanPromptProps) {
	return (
		<div className="p-8 rounded-3xl border border-dashed border-white/10 bg-gradient-to-br from-primary/5 via-transparent to-transparent flex flex-col items-center text-center gap-6">
			<div className="size-16 rounded-2xl bg-primary/20 flex items-center justify-center">
				<Sparkles className="size-8 text-primary" />
			</div>
			<div className="space-y-2">
				<h3 className="text-xl font-bold text-foreground">Awaiting Blueprint</h3>
				<p className="text-sm text-muted-foreground max-w-sm mx-auto">
					Run a Smart Scan to automatically detect your tech stack, generate optimized Dockerfiles, and audit
					infrastructure requirements.
				</p>
			</div>
			<Button
				type="button"
				onClick={onStartScan}
				className="h-12 px-10 rounded-2xl font-bold bg-primary hover:bg-primary/90 text-primary-foreground shadow-2xl shadow-primary/20 flex items-center gap-2 group"
			>
				<Sparkles className="size-5 group-hover:animate-spin" />
				Blueprint Application
			</Button>
		</div>
	);
}
