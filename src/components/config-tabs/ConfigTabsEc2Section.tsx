import { Cpu } from "lucide-react";
import type { DeployConfig } from "@/app/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatApproxEc2PriceCompact } from "@/lib/aws/ec2InstanceTypes";
import { ConfigTabsSectionLayout } from "@/components/config-tabs/ConfigTabsSectionLayout";

type ConfigTabsEc2SectionProps = {
	deploymentEc2: DeployConfig["ec2"];
	ec2InstanceValue: string;
	ec2InstanceOptions: string[];
	onConfigChange: (partial: Partial<DeployConfig>) => void;
};

export function ConfigTabsEc2Section({
	deploymentEc2,
	ec2InstanceValue,
	ec2InstanceOptions,
	onConfigChange,
}: ConfigTabsEc2SectionProps) {
	return (
		<ConfigTabsSectionLayout
			icon={<Cpu className="size-3.5" />}
			title="EC2 instance type"
			description={
				<>
					Size for new EC2 instances. Redeploying to an existing instance does not resize it. Change type in AWS or
					replace the instance.
					<span className="block text-[10px] text-muted-foreground/30 leading-relaxed mt-1">
						Prices are approximate on-demand Linux in{" "}
						<span className="text-muted-foreground/50">us-west-2</span> (EBS &amp; transfer extra; other regions
						differ).
					</span>
				</>
			}
		>
			<div className="w-full max-w-sm space-y-2">
				<Select
					value={ec2InstanceValue}
					onValueChange={(value) =>
						onConfigChange({
							ec2: {
								success: deploymentEc2?.success ?? false,
								baseUrl: deploymentEc2?.baseUrl ?? "",
								instanceId: deploymentEc2?.instanceId ?? "",
								publicIp: deploymentEc2?.publicIp ?? "",
								vpcId: deploymentEc2?.vpcId ?? "",
								subnetId: deploymentEc2?.subnetId ?? "",
								securityGroupId: deploymentEc2?.securityGroupId ?? "",
								amiId: deploymentEc2?.amiId ?? "",
								sharedAlbDns: deploymentEc2?.sharedAlbDns ?? "",
								instanceType: value,
							},
						})
					}
				>
					<SelectTrigger className="w-full h-auto min-h-11 py-2 bg-white/[0.02] border-white/5 text-foreground rounded-xl focus:ring-primary/20 hover:border-white/10 transition-colors px-4 whitespace-normal *:data-[slot=select-value]:line-clamp-none *:data-[slot=select-value]:items-start *:data-[slot=select-value]:text-left [&_[data-slot=select-value]]:w-full">
						<div className="flex items-start gap-2.5 w-full min-w-0 text-left">
							<Cpu className="size-3.5 text-muted-foreground/40 shrink-0 mt-0.5" />
							<SelectValue placeholder="Instance type" />
						</div>
					</SelectTrigger>
					<SelectContent className="bg-[#0A0A0F] border-white/10 max-h-80">
						{ec2InstanceOptions.map((t) => {
							const priceLine = formatApproxEc2PriceCompact(t);
							return (
								<SelectItem key={t} value={t} className="py-2">
									<div className="flex flex-col gap-0.5 text-left">
										<span className="font-medium">{t}</span>
										{priceLine ? (
											<span className="text-[10px] text-muted-foreground/80 font-normal">{priceLine}</span>
										) : (
											<span className="text-[10px] text-muted-foreground/50 font-normal">
												Estimate unavailable. See AWS pricing
											</span>
										)}
									</div>
								</SelectItem>
							);
						})}
					</SelectContent>
				</Select>
			</div>
		</ConfigTabsSectionLayout>
	);
}
