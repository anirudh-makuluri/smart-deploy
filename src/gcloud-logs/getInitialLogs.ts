import config from '../config';
import { Logging } from '@google-cloud/logging';
import fs from 'fs'

export async function getInitialLogs(serviceName: string, limit: number = 50) {
	const keyObject = JSON.parse(config.GCP_SERVICE_ACCOUNT_KEY);
	const keyPath = "/tmp/smartdeploy-key.json";
	fs.writeFileSync(keyPath, JSON.stringify(keyObject, null, 2));
	process.env.GOOGLE_APPLICATION_CREDENTIALS = keyPath;

	const logging = new Logging({
		projectId: config.GCP_PROJECT_ID,
		keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
	});

	const logFilter = `
    resource.type="cloud_run_revision"
    resource.labels.service_name="${serviceName}"
  `;

	const [entries] = await logging.getEntries({
		filter: logFilter,
		orderBy: 'timestamp desc',
		pageSize: limit,
	});

	return entries.reverse().map(entry => ({
		timestamp: entry.metadata.timestamp,
		message: entry.data,
	}));
}
