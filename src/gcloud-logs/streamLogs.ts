import config from '../config';
import { spawn } from 'child_process';

export function streamLogs(serviceName: string, ws: any) {
	const projectId = config.GCP_PROJECT_ID

	const gcloudCmd = [
		'beta',
		'logging',
		'tail',
		`"resource.type=cloud_run_revision AND resource.labels.service_name="${serviceName}"`,
		`--project=${projectId}`,
		'--format=json'
	];

	const tail = spawn("gcloud", gcloudCmd, { shell: true });


	tail.stdout.on('data', (data) => {
		processData(data);
	});

	tail.stderr.on('data', (data) => {
		console.log(data.toString());
		processData(data);
	});

	tail.on('close', (code) => {
		console.log(`gcloud tail process exited with code ${code}`);
	});

	ws.on('close', () => {
		tail.kill();
	});

	function processData(data: any) {
		const lines = data.toString().split('\n').filter(Boolean);
		lines.forEach((line: any) => {
			try {
				const parsed = JSON.parse(line);
				const message = parsed.textPayload || parsed.jsonPayload?.message || JSON.stringify(parsed);
				const object = {
					type: 'stream_logs',
					payload: {
						log: {
							timestamp: parsed.timestamp,
							message,
						}
					}
				}
				ws.send(JSON.stringify(object));
			} catch (err) {
				const timestamp = new Date().toISOString();
				const object = {
					type: 'stream_logs',
					payload: {
						log: {
							timestamp: timestamp,
							message: data.toString(),
						}
					}
				}
				ws.send(JSON.stringify(object));

			}
		});
	}
}
