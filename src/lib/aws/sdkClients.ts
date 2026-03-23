import config from "../../config";

export type AwsClientConfig = {
	region: string;
	credentials?: { accessKeyId: string; secretAccessKey: string };
};

export function getAwsClientConfig(region?: string): AwsClientConfig {
	const conf: AwsClientConfig = { region: region || config.AWS_REGION };
	if (config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY) {
		conf.credentials = {
			accessKeyId: config.AWS_ACCESS_KEY_ID,
			secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
		};
	}
	return conf;
}
