import type { CustomUrlStatus } from "@/components/blueprint/preview-mode-view/types";
import { DOMAIN_SUFFIX, getCustomUrlFromSubdomain } from "@/components/blueprint/preview-mode-view/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Globe, RotateCw } from "lucide-react";

type PreviewModeViewCustomDomainEditorProps = {
	subdomainDraft: string;
	customUrlStatus: CustomUrlStatus;
	customUrlVerifying: boolean;
	customUrlSaving: boolean;
	isCustomUrlDirty: boolean;
	onUpdateSubdomainDraft: (draft: string, status?: CustomUrlStatus) => void;
	onSaveCustomUrl: () => void;
	onCancelCustomUrl: () => void;
};

export function PreviewModeViewCustomDomainEditor({
	subdomainDraft,
	customUrlStatus,
	customUrlVerifying,
	customUrlSaving,
	isCustomUrlDirty,
	onUpdateSubdomainDraft,
	onSaveCustomUrl,
	onCancelCustomUrl,
}: PreviewModeViewCustomDomainEditorProps) {
	return (
		<div className="min-w-0 space-y-5 rounded-2xl border border-white/8 bg-white/[0.03] p-5">
			<div className="space-y-1.5">
				<div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					<Globe className="size-4 shrink-0 text-muted-foreground/70" />
					Live URL
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
							value={subdomainDraft}
							placeholder="my-app"
							aria-label="Subdomain"
							className="h-11 min-w-0 flex-1 border-0 bg-transparent px-3 text-sm font-medium text-foreground shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
							onChange={(e) => {
								onUpdateSubdomainDraft(e.target.value);
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
								{customUrlVerifying ? (
									<RotateCw className="size-3.5 shrink-0 animate-spin text-primary" />
								) : null}
								{!customUrlVerifying && customUrlStatus.type === "success" ? (
									<CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
								) : null}
								{!customUrlVerifying && customUrlStatus.type === "error" ? (
									<AlertTriangle className="size-3.5 shrink-0 text-destructive" />
								) : null}
							</span>
						</div>
					</div>
				</div>
				<p className="break-words font-mono text-[11px] text-muted-foreground/55">
					Preview:{" "}
					<span className="text-foreground/80">
						{getCustomUrlFromSubdomain(subdomainDraft) || "—"}
					</span>
				</p>
			</div>

			{customUrlStatus.type && !customUrlVerifying ? (
				<Alert
					className={cn(
						"border-none py-2.5 px-3",
						customUrlStatus.type === "error"
							? "bg-destructive/10 text-destructive"
							: "bg-emerald-500/10 text-emerald-500"
					)}
				>
					<AlertDescription className="text-xs font-medium leading-snug">
						{customUrlStatus.message}
					</AlertDescription>
				</Alert>
			) : null}

			<div className="flex flex-col gap-4 pt-1">
				<div className="flex flex-wrap items-center gap-2">
					<Button
						type="button"
						variant="ghost"
						className="h-10 px-4 text-sm"
						onClick={onCancelCustomUrl}
						disabled={!isCustomUrlDirty || customUrlSaving}
					>
						Cancel
					</Button>
					<Button
						type="button"
						className="h-10 min-w-[5.5rem] px-5 text-sm"
						onClick={() => void onSaveCustomUrl()}
						disabled={!isCustomUrlDirty || customUrlSaving}
					>
						{customUrlSaving ? "Saving…" : "Save"}
					</Button>
				</div>
				<p className="w-full min-w-0 text-[11px] leading-relaxed text-muted-foreground/75">
					Saving updates load balancer routing and Route 53 DNS. You don’t need to redeploy.
				</p>
			</div>
		</div>
	);
}
