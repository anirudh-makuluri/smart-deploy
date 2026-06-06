import { GitBranch } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";
import type { DeployConfig } from "@/app/types";
import { FormControl, FormField, FormItem } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfigTabsSectionLayout } from "@/components/config-tabs/ConfigTabsSectionLayout";
import type { FormSchemaType } from "@/components/config-tabs/configTabsUtils";

type ConfigTabsBranchSectionProps = {
	form: UseFormReturn<FormSchemaType>;
	deployment: DeployConfig;
	branchSelectOptions: string[];
	onConfigChange: (partial: Partial<DeployConfig>) => void;
};

export function ConfigTabsBranchSection({
	form,
	deployment,
	branchSelectOptions,
	onConfigChange,
}: ConfigTabsBranchSectionProps) {
	return (
		<ConfigTabsSectionLayout
			icon={<GitBranch className="size-3.5" />}
			title="Deployment Branch"
			description="The branch to use for automatic builds"
		>
			<div className="w-full max-w-sm">
				<FormField
					control={form.control}
					name="branch"
					render={({ field }) => (
						<FormItem>
							<FormControl>
								{branchSelectOptions.length === 0 ? (
									<p className="text-sm text-muted-foreground py-2.5 px-1">Loading branches…</p>
								) : (
									<Select
										value={field.value}
										onValueChange={(value) => {
											field.onChange(value);
											if (value !== deployment.branch) {
												onConfigChange({ branch: value });
											}
										}}
									>
										<SelectTrigger className="w-full h-11 bg-white/[0.02] border-white/5 text-foreground rounded-xl focus:ring-primary/20 hover:border-white/10 transition-colors px-4">
											<div className="flex items-center gap-2.5 w-full">
												<GitBranch className="size-3.5 text-muted-foreground/40 shrink-0" />
												<div className="text-sm font-medium">
													<SelectValue placeholder="Select a branch" />
												</div>
											</div>
										</SelectTrigger>
										<SelectContent className="bg-[#0A0A0F] border-white/10">
											{branchSelectOptions.map((branchName) => (
												<SelectItem key={branchName} value={branchName}>
													{branchName}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								)}
							</FormControl>
						</FormItem>
					)}
				/>
			</div>
		</ConfigTabsSectionLayout>
	);
}
