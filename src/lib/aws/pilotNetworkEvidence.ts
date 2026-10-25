import type { NetworkInterface, SecurityGroup, Subnet } from "@aws-sdk/client-ec2";
import { requirePilotEvidence, requirePilotTags, type ExpectedPilotRuntime, type PilotRuntimeScope } from "./pilotRuntimeSchema";
import type { PilotTaskAddress } from "./pilotTaskEvidence";

export function verifyPilotNetwork(eni: NetworkInterface, subnet: Subnet, groups: SecurityGroup[], gatewayInterfaces: NetworkInterface[],
	scope: PilotRuntimeScope, input: ExpectedPilotRuntime, address: PilotTaskAddress): void {
	requirePilotEvidence(eni.NetworkInterfaceId === address.networkInterfaceId && eni.NetworkInterfaceId !== scope.gatewayEniId
		&& eni.OwnerId === scope.accountId && eni.VpcId === scope.vpcId && eni.SubnetId === address.subnetId
		&& eni.PrivateIpAddress === address.privateIp && eni.Status === "in-use" && eni.RequesterManaged === true
		&& eni.InterfaceType === "interface" && !eni.Attachment?.InstanceId && !eni.Ipv6Addresses?.length
		&& eni.Groups?.length === 1 && eni.Groups[0].GroupId === input.appGroupId);
	requirePilotEvidence(subnet.SubnetId === address.subnetId && subnet.VpcId === scope.vpcId
		&& subnet.OwnerId === scope.accountId && subnet.State === "available");
	requirePilotEvidence(groups.length === 2 && new Set(groups.map((group) => group.GroupId)).size === 2
		&& groups.every((group) => group.OwnerId === scope.accountId && group.VpcId === scope.vpcId));
	const appGroup = groups.find((group) => group.GroupId === input.appGroupId);
	const gatewayGroup = groups.find((group) => group.GroupId === scope.gatewayGroupId);
	requirePilotEvidence(appGroup && gatewayGroup);
	requirePilotTags((appGroup.Tags ?? []).map((tag) => ({ key: tag.Key, value: tag.Value })), {
		"smartdeploy:app-id": input.appId, "smartdeploy:binding-id": input.bindingId, "smartdeploy:environment": input.environment,
	});
	const ingress = appGroup.IpPermissions ?? []; const rule = ingress[0];
	requirePilotEvidence(ingress.length === 1 && rule.IpProtocol === "tcp" && rule.FromPort === input.originPort
		&& rule.ToPort === input.originPort && !rule.IpRanges?.length && !rule.Ipv6Ranges?.length && !rule.PrefixListIds?.length
		&& rule.UserIdGroupPairs?.length === 1);
	const source = rule.UserIdGroupPairs[0];
	requirePilotEvidence(source.GroupId === scope.gatewayGroupId && source.UserId === scope.accountId
		&& (!source.VpcId || source.VpcId === scope.vpcId) && !source.VpcPeeringConnectionId && !source.PeeringStatus);
	// A gateway-group attachment on an untrusted task would defeat source-group isolation.
	requirePilotEvidence(gatewayInterfaces.length === 1);
	const gateway = gatewayInterfaces[0];
	requirePilotEvidence(gateway.NetworkInterfaceId === scope.gatewayEniId && gateway.OwnerId === scope.accountId
		&& gateway.VpcId === scope.vpcId && gateway.Status === "in-use" && gateway.Attachment?.Status === "attached"
		&& gateway.Attachment.InstanceId === scope.gatewayInstanceId && gateway.Attachment.DeviceIndex === 0
		&& gateway.Groups?.some((group) => group.GroupId === scope.gatewayGroupId));
}
