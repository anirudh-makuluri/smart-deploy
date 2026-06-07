import type { DeployConfig } from "@/app/types";
import type { SDDeployUnit } from "@/app/types";
import type { PreviewModel } from "@/components/blueprint/preview-model";
import { PreviewModeViewEditorPanels } from "@/components/blueprint/preview-mode-view/PreviewModeViewEditorPanels";
import type { Editor, HostedSubdomainStatus } from "@/components/blueprint/preview-mode-view/types";
import { getEditorDescription, getEditorTitle } from "@/components/blueprint/preview-mode-view/utils";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type PreviewModeViewEditorSheetProps = {
	editor: Editor;
	onEditorChange: (editor: Editor) => void;
	deployment: DeployConfig;
	model: PreviewModel;
	branchOptions: string[];
	deployUnits: SDDeployUnit[];
	selectedUnit: SDDeployUnit | undefined;
	railpackPlanJson: string;
	regionSelectOptions: Array<{ value: string; label: string }>;
	onUpdateDeployment: (partial: Partial<DeployConfig>) => Promise<void> | void;
	hostedSubdomainDraft: string;
	hostedSubdomainStatus: HostedSubdomainStatus;
	hostedSubdomainVerifying: boolean;
	hostedSubdomainSaving: boolean;
	isHostedSubdomainDirty: boolean;
	onUpdateHostedSubdomainDraft: (draft: string, status?: HostedSubdomainStatus) => void;
	onSaveHostedSubdomain: () => void;
	onCancelHostedSubdomain: () => void;
};

export function PreviewModeViewEditorSheet({
	editor,
	onEditorChange,
	deployment,
	model,
	branchOptions,
	deployUnits,
	selectedUnit,
	railpackPlanJson,
	regionSelectOptions,
	onUpdateDeployment,
	hostedSubdomainDraft,
	hostedSubdomainStatus,
	hostedSubdomainVerifying,
	hostedSubdomainSaving,
	isHostedSubdomainDirty,
	onUpdateHostedSubdomainDraft,
	onSaveHostedSubdomain,
	onCancelHostedSubdomain,
}: PreviewModeViewEditorSheetProps) {
	return (
		<Sheet open={editor !== null} onOpenChange={(open) => onEditorChange(open ? editor : null)}>
			<SheetContent
				side="right"
				className={cn(
					"flex flex-col overflow-hidden border-white/10 bg-[#0b0d12]/96 text-foreground backdrop-blur-xl",
					editor?.kind === "customDomain"
						? "w-[min(100vw,32rem)] sm:max-w-[32rem]"
						: "w-[460px] sm:max-w-[460px]"
				)}
			>
				<SheetHeader className="pr-8">
					<SheetTitle className="text-2xl">{getEditorTitle(editor)}</SheetTitle>
					<SheetDescription className="text-sm text-muted-foreground">
						{getEditorDescription(editor)}
					</SheetDescription>
				</SheetHeader>

				<PreviewModeViewEditorPanels
					editor={editor}
					deployment={deployment}
					model={model}
					branchOptions={branchOptions}
					deployUnits={deployUnits}
					selectedUnit={selectedUnit}
					railpackPlanJson={railpackPlanJson}
					regionSelectOptions={regionSelectOptions}
					onUpdateDeployment={onUpdateDeployment}
					onSetEditor={onEditorChange}
					hostedSubdomainDraft={hostedSubdomainDraft}
					hostedSubdomainStatus={hostedSubdomainStatus}
					hostedSubdomainVerifying={hostedSubdomainVerifying}
					hostedSubdomainSaving={hostedSubdomainSaving}
					isHostedSubdomainDirty={isHostedSubdomainDirty}
					onUpdateHostedSubdomainDraft={onUpdateHostedSubdomainDraft}
					onSaveHostedSubdomain={onSaveHostedSubdomain}
					onCancelHostedSubdomain={onCancelHostedSubdomain}
				/>
			</SheetContent>
		</Sheet>
	);
}
