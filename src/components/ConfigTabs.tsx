"use client";

import { Form } from "@/components/ui/form";
import EnvVarSheet from "@/components/EnvVarSheet";
import type { DeployConfig } from "@/app/types";
import { ConfigTabsBranchSection } from "@/components/config-tabs/ConfigTabsBranchSection";
import { ConfigTabsCustomDomainSection } from "@/components/config-tabs/ConfigTabsCustomDomainSection";
import { ConfigTabsEnvVarsSection } from "@/components/config-tabs/ConfigTabsEnvVarsSection";
import { ConfigTabsProjectSourceSection } from "@/components/config-tabs/ConfigTabsProjectSourceSection";
import { ConfigTabsScanPrompt } from "@/components/config-tabs/ConfigTabsScanPrompt";
import { useConfigTabs } from "@/components/config-tabs/useConfigTabs";

type ConfigTabsProps = {
	onConfigChange: (partial: Partial<DeployConfig>) => void;
	deployment: DeployConfig;
	branches?: string[];
	repoFullName: string;
	onStartScan?: () => void;
};

export default function ConfigTabs({
	onConfigChange,
	deployment,
	branches,
	repoFullName,
	onStartScan,
}: ConfigTabsProps) {
	const tabs = useConfigTabs({ onConfigChange, deployment, branches });

	return (
		<Form {...tabs.form}>
			<div className="flex flex-col gap-10 max-w-2xl mx-auto">
				<ConfigTabsProjectSourceSection deployment={deployment} repoFullName={repoFullName} />

				<ConfigTabsBranchSection
					form={tabs.form}
					deployment={deployment}
					branchSelectOptions={tabs.branchSelectOptions}
					onConfigChange={onConfigChange}
				/>

				<ConfigTabsCustomDomainSection
					form={tabs.form}
					hostedSubdomainVerifying={tabs.hostedSubdomainVerifying}
					hostedSubdomainStatus={tabs.hostedSubdomainStatus}
					setHostedSubdomainStatus={tabs.setHostedSubdomainStatus}
					isHostedSubdomainDirty={tabs.isHostedSubdomainDirty}
					hostedSubdomainSaving={tabs.hostedSubdomainSaving}
					onSave={tabs.handleSaveHostedSubdomain}
					onCancel={tabs.handleCancelHostedSubdomain}
				/>

				<ConfigTabsEnvVarsSection
					envEntryCount={tabs.envEntryCount}
					onEdit={() => tabs.setIsEnvSheetOpen(true)}
				/>

				<EnvVarSheet
					open={tabs.isEnvSheetOpen}
					onOpenChange={tabs.setIsEnvSheetOpen}
					entries={tabs.envEntries}
					onEntriesChange={tabs.handleEnvEntriesChange}
				/>

				{!tabs.hasScanResults && <ConfigTabsScanPrompt onStartScan={onStartScan} />}
			</div>
		</Form>
	);
}
