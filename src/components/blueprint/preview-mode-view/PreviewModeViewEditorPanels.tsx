import type { DeployConfig } from "@/app/types";
import type { SDDeployUnit } from "@/app/types";
import type { PreviewModel } from "@/components/blueprint/preview-model";
import type { Editor, HostedSubdomainStatus } from "@/components/blueprint/preview-mode-view/types";
import { PreviewModeViewCustomDomainEditor } from "@/components/blueprint/preview-mode-view/PreviewModeViewCustomDomainEditor";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { defaultRegionForDeploy } from "@/lib/deployInfraDefaults";

type PreviewModeViewEditorPanelsProps = {
	editor: Editor;
	deployment: DeployConfig;
	model: PreviewModel;
	branchOptions: string[];
	deployUnits: SDDeployUnit[];
	selectedUnit: SDDeployUnit | undefined;
	railpackPlanJson: string;
	regionSelectOptions: Array<{ value: string; label: string }>;
	onUpdateDeployment: (partial: Partial<DeployConfig>) => Promise<void> | void;
	onSetEditor: (editor: Editor) => void;
	hostedSubdomainDraft: string;
	hostedSubdomainStatus: HostedSubdomainStatus;
	hostedSubdomainVerifying: boolean;
	hostedSubdomainSaving: boolean;
	isHostedSubdomainDirty: boolean;
	onUpdateHostedSubdomainDraft: (draft: string, status?: HostedSubdomainStatus) => void;
	onSaveHostedSubdomain: () => void;
	onCancelHostedSubdomain: () => void;
};

export function PreviewModeViewEditorPanels({
	editor,
	deployment,
	model,
	branchOptions,
	deployUnits,
	selectedUnit,
	railpackPlanJson,
	regionSelectOptions,
	onUpdateDeployment,
	onSetEditor,
	hostedSubdomainDraft,
	hostedSubdomainStatus,
	hostedSubdomainVerifying,
	hostedSubdomainSaving,
	isHostedSubdomainDirty,
	onUpdateHostedSubdomainDraft,
	onSaveHostedSubdomain,
	onCancelHostedSubdomain,
}: PreviewModeViewEditorPanelsProps) {
	return (
		<div className="mt-6 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 stealth-scrollbar">
			{editor?.kind === "branch" ? (
				<div className="rounded-2xl border border-white/8 bg-white/3 p-4">
					<div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Deployment branch</div>
					<Select
						value={deployment.branch || ""}
						onValueChange={(next) => void onUpdateDeployment({ branch: next.trim() || "main" })}
					>
						<SelectTrigger className="h-11 rounded-xl border-white/10 bg-white/2 text-sm text-foreground">
							<SelectValue placeholder="Select branch" />
						</SelectTrigger>
						<SelectContent>
							{branchOptions.map((b) => (
								<SelectItem key={b} value={b}>
									{b}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			) : null}

			{editor?.kind === "envVars" ? (
				<div className="rounded-2xl border border-white/8 bg-white/3 p-4">
					<div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Runtime env vars</div>
					<Textarea
						value={deployment.envVars ?? ""}
						onChange={(e) => void onUpdateDeployment({ envVars: e.target.value })}
						placeholder="KEY=value"
						className="min-h-44 rounded-xl border-white/10 bg-white/2 text-sm text-foreground font-mono"
					/>
				</div>
			) : null}

			{editor?.kind === "compose" ? (
				<div className="rounded-2xl border border-white/8 bg-white/3 p-4">
					<div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Deploy units</div>
					<Textarea
						readOnly
						value={JSON.stringify(deployUnits, null, 2)}
						className="min-h-44 rounded-xl border-white/10 bg-white/2 text-sm text-foreground font-mono"
					/>
				</div>
			) : null}

			{editor?.kind === "dockerfile" ? (
				<div className="rounded-2xl border border-white/8 bg-white/3 p-4">
					<div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Railpack plan</div>
					<div className="mb-2 text-xs text-muted-foreground">
						Unit: <span className="font-mono">{selectedUnit?.name ?? "—"}</span>
						{selectedUnit?.root ? (
							<>
								{" · "}
								<span className="font-mono">{selectedUnit.root}</span>
							</>
						) : null}
					</div>
					<Textarea
						readOnly
						value={railpackPlanJson}
						placeholder="No Railpack plan for this unit."
						className="min-h-64 rounded-xl border-white/10 bg-white/2 text-sm text-foreground font-mono"
					/>
					{deployUnits.length > 1 ? (
						<div className="mt-3">
							<div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Switch unit</div>
							<div className="grid gap-2">
								{deployUnits.map((unit) => (
									<Button
										key={unit.name}
										type="button"
										variant="outline"
										className="h-9 justify-start border-white/10 bg-white/2 px-3 font-mono text-xs"
										onClick={() => onSetEditor({ kind: "dockerfile", unitName: unit.name })}
									>
										{unit.name}
									</Button>
								))}
							</div>
						</div>
					) : null}
				</div>
			) : null}

			{editor?.kind === "nginx" ? (
				<div className="rounded-2xl border border-white/8 bg-white/3 p-4 text-sm text-muted-foreground">
					Railpack analyze deploys use ALB/ingress routing at deploy time; nginx.conf is not part of the analyze response.
				</div>
			) : null}

			{editor?.kind === "infra" ? (
				<div className="rounded-2xl border border-white/8 bg-white/3 p-4 space-y-4">
					<div>
						<div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Region</div>
						<Select
							value={(deployment.region || "").trim() || defaultRegionForDeploy()}
							onValueChange={(next) => void onUpdateDeployment({ region: next })}
						>
							<SelectTrigger className="h-11 rounded-xl border-white/10 bg-white/2 text-sm text-foreground">
								<SelectValue placeholder="Select region" />
							</SelectTrigger>
							<SelectContent className="max-h-72 border-white/10 bg-[#0A0A0F]">
								{regionSelectOptions.map((opt) => (
									<SelectItem key={opt.value} value={opt.value} className="py-2">
										<div className="flex flex-col gap-0.5 text-left">
											<span className="text-sm text-foreground">{opt.label}</span>
											<span className="font-mono text-[10px] text-muted-foreground">{opt.value}</span>
										</div>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					{model.deployRoute === "ecs" ? (
						<div>
							<div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Instance type</div>
							<p className="text-sm text-muted-foreground">
								Container deploys use ECS Fargate (configured via server env: cluster, subnets, execution role).
							</p>
						</div>
					) : (
						<div>
							<div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Static hosting</div>
							<p className="text-sm text-muted-foreground">
								Static sites publish to S3 and are served through CloudFront (STATIC_SITE_* env vars on the server).
							</p>
						</div>
					)}
				</div>
			) : null}

			{editor?.kind === "customDomain" ? (
				<PreviewModeViewCustomDomainEditor
					hostedSubdomainDraft={hostedSubdomainDraft}
					hostedSubdomainStatus={hostedSubdomainStatus}
					hostedSubdomainVerifying={hostedSubdomainVerifying}
					hostedSubdomainSaving={hostedSubdomainSaving}
					isHostedSubdomainDirty={isHostedSubdomainDirty}
					onUpdateHostedSubdomainDraft={onUpdateHostedSubdomainDraft}
					onSaveHostedSubdomain={onSaveHostedSubdomain}
					onCancelHostedSubdomain={onCancelHostedSubdomain}
				/>
			) : null}
		</div>
	);
}
