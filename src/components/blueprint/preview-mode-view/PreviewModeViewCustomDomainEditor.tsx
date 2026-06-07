import type { HostedSubdomainStatus } from "@/components/blueprint/preview-mode-view/types";
import { DOMAIN_SUFFIX, getHostedUrlFromSubdomain } from "@/components/blueprint/preview-mode-view/utils";
import { Alert } from "@/components/ui/alert";
import { AlertDescription } from "@/components/ui/alert-parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Globe, RotateCw } from "lucide-react";

type PreviewModeViewCustomDomainEditorProps = {
	hostedSubdomainDraft: string;
	hostedSubdomainStatus: HostedSubdomainStatus;
	hostedSubdomainVerifying: boolean;
	hostedSubdomainSaving: boolean;
	isHostedSubdomainDirty: boolean;
	onUpdateHostedSubdomainDraft: (draft: string, status?: HostedSubdomainStatus) => void;
	onSaveHostedSubdomain: () => void;
	onCancelHostedSubdomain: () => void;
};

export function PreviewModeViewCustomDomainEditor({
	hostedSubdomainDraft,
	hostedSubdomainStatus,
	hostedSubdomainVerifying,
	hostedSubdomainSaving,
	isHostedSubdomainDirty,
	onUpdateHostedSubdomainDraft,
	onSaveHostedSubdomain,
	onCancelHostedSubdomain,
}: PreviewModeViewCustomDomainEditorProps) {
	return (
		<div className="min-w-0 space-y-5 rounded-2xl border border-white/8 bg-white/[0.03] p-5">
			<div className="space-y-1.5">
				<div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					<Globe className="size-4 shrink-0 text-muted-foreground/70" />
					Hosted subdomain
				</div>
				<p className="text-[13px] leading-relaxed text-muted-foreground">
					This becomes the public URL for your app. Only the subdomain is editable; the rest is fixed.
				</p>
			</div>

			<div className="min-w-0 space-y-2">
				<div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
					<div className="flex min-h-11 min-w-0 items-stretch divide-x divide-white/10">
						<div className="flex shrink-0 items-center bg-white/[0.03] px-3">
							<span className="whitespace-nowrap font-mono text-[11px] text-muted-foreground/60">https://</span>
						</div>
						<Input
							value={hostedSubdomainDraft}
							placeholder="my-app"
							aria-label="Hosted subdomain"
							className="h-11 min-w-0 flex-1 border-0 bg-transparent px-3 text-sm font-medium text-foreground shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
							onChange={(e) => {
								onUpdateHostedSubdomainDraft(e.target.value);
							}}
						/>
						<div className="flex max-w-[55%] shrink-0 items-center gap-2 bg-white/[0.03] px-3">
							<span
								className="truncate font-mono text-[11px] text-muted-foreground/45"
								title={`.${DOMAIN_SUFFIX}`}
							>
								.{DOMAIN_SUFFIX}
							</span>
							<span className="flex shrink-0 items-center gap-1">
								{hostedSubdomainVerifying ? (
									<RotateCw className="size-3.5 shrink-0 animate-spin text-primary" />
								) : null}
								{!hostedSubdomainVerifying && hostedSubdomainStatus.type === "success" ? (
									<CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
								) : null}
								{!hostedSubdomainVerifying && hostedSubdomainStatus.type === "error" ? (
									<AlertTriangle className="size-3.5 shrink-0 text-destructive" />
								) : null}
							</span>
						</div>
					</div>
				</div>
				<p className="break-words font-mono text-[11px] text-muted-foreground/55">
					Preview:{" "}
					<span className="text-foreground/80">
						{getHostedUrlFromSubdomain(hostedSubdomainDraft) || "—"}
					</span>
				</p>
			</div>

			{hostedSubdomainStatus.type && !hostedSubdomainVerifying ? (
				<Alert
					className={cn(
						"border-none py-2.5 px-3",
						hostedSubdomainStatus.type === "error"
							? "bg-destructive/10 text-destructive"
							: "bg-emerald-500/10 text-emerald-500"
					)}
				>
					<AlertDescription className="text-xs font-medium leading-snug">
						{hostedSubdomainStatus.message}
					</AlertDescription>
				</Alert>
			) : null}

			<div className="flex flex-col gap-4 pt-1">
				<div className="flex flex-wrap items-center gap-2">
					<Button
						type="button"
						variant="ghost"
						className="h-10 px-4 text-sm"
						onClick={onCancelHostedSubdomain}
						disabled={!isHostedSubdomainDirty || hostedSubdomainSaving}
					>
						Cancel
					</Button>
					<Button
						type="button"
						className="h-10 min-w-[5.5rem] px-5 text-sm"
						onClick={() => void onSaveHostedSubdomain()}
						disabled={!isHostedSubdomainDirty || hostedSubdomainSaving}
					>
						{hostedSubdomainSaving ? "Saving…" : "Save"}
					</Button>
				</div>
				<p className="w-full min-w-0 text-[11px] leading-relaxed text-muted-foreground/75">
					Saving updates load balancer routing and Route 53 DNS. You don’t need to redeploy.
				</p>
			</div>
		</div>
	);
}
