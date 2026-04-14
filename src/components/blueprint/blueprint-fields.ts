import type { BlueprintNodeKind } from "@/components/blueprint/blueprint-types";
import { EC2_INSTANCE_TYPE_PRESETS } from "@/lib/aws/ec2InstanceTypes";

export type BlueprintFieldOption = {
	value: string;
	label: string;
};

export type BlueprintFieldDefinition = {
	key: string;
	label: string;
	type?: "text" | "number" | "textarea" | "select";
	editable?: boolean;
	placeholder?: string;
	options?: BlueprintFieldOption[];
};

export const AWS_REGION_OPTIONS: BlueprintFieldOption[] = [
	{ value: "us-east-1", label: "US East (N. Virginia)" },
	{ value: "us-east-2", label: "US East (Ohio)" },
	{ value: "us-west-1", label: "US West (N. California)" },
	{ value: "us-west-2", label: "US West (Oregon)" },
	{ value: "ca-central-1", label: "Canada (Central)" },
	{ value: "eu-west-1", label: "Europe (Ireland)" },
	{ value: "eu-west-2", label: "Europe (London)" },
	{ value: "eu-central-1", label: "Europe (Frankfurt)" },
	{ value: "ap-south-1", label: "Asia Pacific (Mumbai)" },
	{ value: "ap-southeast-1", label: "Asia Pacific (Singapore)" },
	{ value: "ap-southeast-2", label: "Asia Pacific (Sydney)" },
	{ value: "ap-northeast-1", label: "Asia Pacific (Tokyo)" },
];

export const EC2_INSTANCE_OPTIONS: BlueprintFieldOption[] = EC2_INSTANCE_TYPE_PRESETS.map((value) => ({
	value,
	label: value,
}));

export const BLUEPRINT_NODE_FIELDS: Record<BlueprintNodeKind, BlueprintFieldDefinition[]> = {
	deployConfig: [],
	service: [
		{ key: "repo", label: "Repository" },
		{ key: "service", label: "Service" },
		{ key: "framework", label: "Framework" },
		{ key: "language", label: "Language" },
		{ key: "port", label: "Runtime Port", type: "number", editable: true, placeholder: "3000" },
		{ key: "buildContext", label: "Build Context", type: "text", editable: true, placeholder: "." },
		{ key: "dockerfilePath", label: "Dockerfile Path", type: "text", editable: true, placeholder: "Dockerfile" },
	],
	branch: [
		{ key: "branch", label: "Branch", type: "select", editable: true, placeholder: "Select branch" },
		{ key: "commit", label: "Commit" },
	],
	envVars: [
		{ key: "value", label: "Environment Variables", type: "textarea", editable: true, placeholder: "KEY=value" },
		{ key: "count", label: "Variable Count" },
	],
	dockerfile: [
		{ key: "fileName", label: "File Name", type: "text", editable: true, placeholder: "Dockerfile" },
		{ key: "buildContext", label: "Build Context", type: "text", editable: true, placeholder: "." },
		{ key: "content", label: "Dockerfile Content", type: "textarea", editable: true, placeholder: "FROM node:20-alpine" },
	],
	compose: [
		{ key: "services", label: "Detected Services" },
		{ key: "included", label: "Included In Config" },
		{ key: "content", label: "Compose Content", type: "textarea", editable: true, placeholder: "services:\n  app:\n    build: ." },
	],
	nginx: [
		{ key: "content", label: "Nginx Config", type: "textarea", editable: true, placeholder: "server { ... }" },
	],
	customDomain: [
		{ key: "url", label: "Live URL", type: "text", editable: true, placeholder: "https://example.com" },
	],
	infrastructure: [
		{
			key: "provider",
			label: "Cloud Provider",
			type: "select",
			editable: true,
			options: [
				{ value: "aws", label: "AWS" },
				{ value: "gcp", label: "GCP" },
			],
		},
		{
			key: "target",
			label: "Deployment Target",
			type: "select",
			editable: true,
			options: [
				{ value: "ec2", label: "EC2" },
				{ value: "cloud_run", label: "Cloud Run" },
			],
		},
		{ key: "region", label: "Region", type: "select", editable: true, placeholder: "Select region", options: AWS_REGION_OPTIONS },
		{ key: "instanceType", label: "Instance Type", type: "select", editable: true, placeholder: "Select instance type", options: EC2_INSTANCE_OPTIONS },
	],
};
