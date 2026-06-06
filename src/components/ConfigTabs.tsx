"use client";

import { Form } from "@/components/ui/form";
import EnvVarSheet from "@/components/EnvVarSheet";
import type { DeployConfig } from "@/app/types";
import { ConfigTabsBranchSection } from "@/components/config-tabs/ConfigTabsBranchSection";
import { ConfigTabsCustomDomainSection } from "@/components/config-tabs/ConfigTabsCustomDomainSection";
import { ConfigTabsEc2Section } from "@/components/config-tabs/ConfigTabsEc2Section";
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
		<Form key={`${deployment.repoName}:${deployment.serviceName}`} {...tabs.form}>
			<div className="flex flex-col gap-10 max-w-2xl mx-auto">
				<ConfigTabsProjectSourceSection deployment={deployment} repoFullName={repoFullName} />

				<ConfigTabsBranchSection
					form={tabs.form}
					deployment={deployment}
					branchSelectOptions={tabs.branchSelectOptions}
					onConfigChange={onConfigChange}
				/>

				<ConfigTabsEc2Section
					deploymentEc2={tabs.deploymentEc2}
					ec2InstanceValue={tabs.ec2InstanceValue}
					ec2InstanceOptions={tabs.ec2InstanceOptions}
					onConfigChange={onConfigChange}
				/>

				<ConfigTabsCustomDomainSection
					form={tabs.form}
					customUrlVerifying={tabs.customUrlVerifying}
					customUrlStatus={tabs.customUrlStatus}
					setCustomUrlStatus={tabs.setCustomUrlStatus}
					isCustomUrlDirty={tabs.isCustomUrlDirty}
					customUrlSaving={tabs.customUrlSaving}
					onSave={tabs.handleSaveCustomUrl}
					onCancel={tabs.handleCancelCustomUrl}
				/>

				<ConfigTabsEnvVarsSection
					envEntryCount={tabs.envEntries.length}
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
