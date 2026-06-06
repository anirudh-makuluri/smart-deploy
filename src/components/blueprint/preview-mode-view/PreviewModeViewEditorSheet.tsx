import type { DeployConfig } from "@/app/types";
import type { SDDeployUnit } from "@/app/types";
import type { PreviewModel } from "@/components/blueprint/preview-model";
import { PreviewModeViewEditorPanels } from "@/components/blueprint/preview-mode-view/PreviewModeViewEditorPanels";
import type { CustomUrlStatus, Editor } from "@/components/blueprint/preview-mode-view/types";
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
	subdomainDraft: string;
	customUrlStatus: CustomUrlStatus;
	customUrlVerifying: boolean;
	customUrlSaving: boolean;
	isCustomUrlDirty: boolean;
	onUpdateSubdomainDraft: (draft: string, status?: CustomUrlStatus) => void;
	onSaveCustomUrl: () => void;
	onCancelCustomUrl: () => void;
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
	subdomainDraft,
	customUrlStatus,
	customUrlVerifying,
	customUrlSaving,
	isCustomUrlDirty,
	onUpdateSubdomainDraft,
	onSaveCustomUrl,
	onCancelCustomUrl,
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
					subdomainDraft={subdomainDraft}
					customUrlStatus={customUrlStatus}
					customUrlVerifying={customUrlVerifying}
					customUrlSaving={customUrlSaving}
					isCustomUrlDirty={isCustomUrlDirty}
					onUpdateSubdomainDraft={onUpdateSubdomainDraft}
					onSaveCustomUrl={onSaveCustomUrl}
					onCancelCustomUrl={onCancelCustomUrl}
				/>
			</SheetContent>
		</Sheet>
	);
}
