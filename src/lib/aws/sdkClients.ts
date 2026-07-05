import config from "../../config";

export type AwsClientConfig = {
	region: string;
	credentials?: { accessKeyId: string; secretAccessKey: string };
};

function isManagedAwsRuntime(): boolean {
	return Boolean(
		process.env.AWS_LAMBDA_FUNCTION_NAME ||
		process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
		process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI
	);
}

export function getAwsClientConfig(region?: string): AwsClientConfig {
	const conf: AwsClientConfig = { region: region || config.AWS_REGION };
	if (isManagedAwsRuntime()) {
		return conf;
	}
	if (config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY) {
		conf.credentials = {
			accessKeyId: config.AWS_ACCESS_KEY_ID,
			secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
		};
	}
	return conf;
}
