export type DeployResult = {
	success: boolean;
	baseUrl: string;
	serviceUrls: Map<string, string>;
	instanceId: string;
	vpcId?: string;
	subnetId?: string;
	securityGroupId?: string;
	sharedAlbDns?: string;
	/** Set by ECS Fargate deploys so post-deploy DNS can sync ALB host-header rules. */
	albListenerArn?: string;
	targetGroupArn?: string;
	taskDefinitionArn?: string;
};
