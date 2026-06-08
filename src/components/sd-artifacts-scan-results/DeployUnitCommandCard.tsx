import type { SDDeployUnit } from "@/app/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	railpackCommandOverridesDirty,
	type RailpackCommandOverrides,
} from "@/lib/railpackCommandOverrides";

type DeployUnitCommandCardProps = {
	unit: SDDeployUnit;
	draft: RailpackCommandOverrides;
	baseline: RailpackCommandOverrides;
	workloadLabel: string;
	disabled?: boolean;
	onChange: (next: RailpackCommandOverrides) => void;
};

export function DeployUnitCommandCard({
	unit,
	draft,
	baseline,
	workloadLabel,
	disabled,
	onChange,
}: DeployUnitCommandCardProps) {
	const hasPlan = Boolean(unit.artifacts.railpack_plan);
	const unitDirty = railpackCommandOverridesDirty(baseline, draft);

	return (
		<li className="rounded-lg border border-border/60 bg-muted/20 px-4 py-4 text-sm space-y-4">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<span className="font-semibold text-foreground">{unit.name}</span>
				<div className="flex items-center gap-2">
					{unitDirty ? (
						<span className="text-[10px] uppercase tracking-wide text-amber-600">Unsaved changes</span>
					) : null}
					<span className="text-[10px] uppercase tracking-wide text-primary">{workloadLabel}</span>
				</div>
			</div>
			<p className="font-mono text-xs text-muted-foreground">
				{unit.root === "." ? "root" : unit.root} | {unit.provider}
				{unit.framework ? ` | ${unit.framework}` : ""} | port {unit.port}
			</p>

			{hasPlan ? (
				<div className="grid gap-4">
					<div className="flex flex-row items-center justify-start gap-2">
						<Label
							htmlFor={`${unit.name}-install`}
							className="w-48 text-xs whitespace-nowrap uppercase tracking-wide text-muted-foreground"
						>
							Install command
						</Label>
						<Input
							id={`${unit.name}-install`}
							value={draft.installCmd}
							onChange={(e) => onChange({ ...draft, installCmd: e.target.value })}
							disabled={disabled}
							placeholder="e.g. npm ci, pip install -r requirements.txt (clear to remove the install shell step)"
							className="font-mono text-xs"
						/>
					</div>
					<div className="flex flex-row items-center justify-start gap-2">
						<Label
							htmlFor={`${unit.name}-build`}
							className="w-48 text-xs whitespace-nowrap uppercase tracking-wide text-muted-foreground"
						>
							Build command
						</Label>
						<Input
							id={`${unit.name}-build`}
							value={draft.buildCmd}
							onChange={(e) => onChange({ ...draft, buildCmd: e.target.value })}
							disabled={disabled}
							placeholder="e.g. npm run build (leave empty if no separate build step)"
							className="font-mono text-xs"
						/>
					</div>
					<div className="flex flex-row items-center justify-start gap-2">
						<Label
							htmlFor={`${unit.name}-start`}
							className="w-48 text-xs whitespace-nowrap uppercase tracking-wide text-muted-foreground"
						>
							Start command
						</Label>
						<Input
							id={`${unit.name}-start`}
							value={draft.startCmd}
							onChange={(e) => onChange({ ...draft, startCmd: e.target.value })}
							disabled={disabled}
							placeholder="e.g. npm run start, python app.py"
							className="font-mono text-xs"
						/>
					</div>
				</div>
			) : (
				<p className="text-xs text-muted-foreground">
					No Railpack plan for this unit — use an existing Dockerfile or re-run analysis.
				</p>
			)}
		</li>
	);
}
