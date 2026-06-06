import { AlertTriangle, CheckCircle2, Globe, RotateCw } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormControl, FormField, FormItem } from "@/components/ui/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConfigTabsSectionLayout } from "@/components/config-tabs/ConfigTabsSectionLayout";
import { DOMAIN_SUFFIX, type FormSchemaType } from "@/components/config-tabs/configTabsUtils";

type CustomUrlStatus = {
	type: "success" | "error" | "owned" | null;
	message?: string;
	alternatives?: string[];
};

type ConfigTabsCustomDomainSectionProps = {
	form: UseFormReturn<FormSchemaType>;
	customUrlVerifying: boolean;
	customUrlStatus: CustomUrlStatus;
	setCustomUrlStatus: (status: CustomUrlStatus) => void;
	isCustomUrlDirty: boolean;
	customUrlSaving: boolean;
	onSave: () => void;
	onCancel: () => void;
};

export function ConfigTabsCustomDomainSection({
	form,
	customUrlVerifying,
	customUrlStatus,
	setCustomUrlStatus,
	isCustomUrlDirty,
	customUrlSaving,
	onSave,
	onCancel,
}: ConfigTabsCustomDomainSectionProps) {
	return (
		<ConfigTabsSectionLayout
			icon={<Globe className="size-3.5" />}
			title="Custom Domain"
			description="Public URL for accessing your application"
		>
			<div className="w-full max-w-sm space-y-3">
				<FormField
					control={form.control}
					name="liveUrl"
					render={({ field }) => (
						<FormItem>
							<FormControl>
								<div className="relative group ">
									<div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/30 font-mono text-[10px] group-focus-within:text-primary/50 transition-colors pointer-events-none">
										https://
									</div>
									<Input
										{...field}
										placeholder="my-cool-app"
										className="pl-14 pr-32 h-11 bg-white/2 border-white/5 rounded-xl focus-visible:ring-primary/20 text-foreground font-medium text-sm placeholder:text-muted-foreground/10 hover:border-white/10 transition-colors"
										onChange={(e) => {
											field.onChange(e.target.value);
											setCustomUrlStatus({ type: null });
										}}
									/>
									<div className="absolute right-3.5 top-1/2 -translate-y-1/2 flex items-center gap-2 pointer-events-none">
										<span className="text-muted-foreground/20 font-mono text-[10px]">.{DOMAIN_SUFFIX}</span>
										{customUrlVerifying && <RotateCw className="size-3 animate-spin text-primary" />}
										{!customUrlVerifying && customUrlStatus.type === "success" && (
											<CheckCircle2 className="size-3 text-emerald-500" />
										)}
										{!customUrlVerifying && customUrlStatus.type === "error" && (
											<AlertTriangle className="size-3 text-destructive" />
										)}
									</div>
								</div>
							</FormControl>
						</FormItem>
					)}
				/>

				{customUrlStatus.type && !customUrlVerifying && (
					<Alert
						className={`py-2 px-3 rounded-lg border-none ${
							customUrlStatus.type === "error"
								? "bg-destructive/10 text-destructive"
								: customUrlStatus.type === "owned"
									? "bg-primary/10 text-primary"
									: "bg-emerald-500/10 text-emerald-500"
						}`}
					>
						<AlertDescription className="text-[10px] font-bold tracking-tight">
							{customUrlStatus.message}
						</AlertDescription>
					</Alert>
				)}
				<div className="flex flex-wrap items-center gap-2 pt-3">
					<Button
						type="button"
						variant="ghost"
						className="text-[11px] h-9 px-3"
						onClick={onCancel}
						disabled={!isCustomUrlDirty || customUrlSaving}
					>
						Cancel
					</Button>
					<Button
						type="button"
						className="text-[11px] h-9 px-4"
						onClick={onSave}
						disabled={!isCustomUrlDirty || customUrlSaving}
					>
						{customUrlSaving ? "Saving…" : "Save"}
					</Button>
					<p className="text-[10px] text-muted-foreground/70">
						Saving reconfigures the ALB + Route 53 DNS without redeploying.
					</p>
				</div>
			</div>
		</ConfigTabsSectionLayout>
	);
}
