import { X509Certificate } from "node:crypto";
import { isIPv4 } from "node:net";
import { checkServerIdentity, connect, type ConnectionOptions, type PeerCertificate, type TLSSocket } from "node:tls";
import { z } from "zod";

const Workload = z.strictObject({ bindingId: z.uuid(), environment: z.enum(["published", "preview"]), releaseId: z.uuid() });
const Options = Workload.extend({
	privateIp: z.string(), port: z.number().int().min(1).max(65535),
	certificatePem: z.string().min(1).max(8192), timeoutMs: z.number().int().min(1).max(5000),
	maxConnections: z.number().int().min(1).max(32),
});
export type GatewayWorkload = z.infer<typeof Workload>;
export type GatewayUpstreamOptions = z.infer<typeof Options>;
export type GatewayTlsDial = (options: ConnectionOptions) => TLSSocket;

export class GatewayUpstreamError extends Error {
	constructor(public readonly status: 502 | 503) { super("App connection unavailable."); }
}

export function gatewayWorkloadServerName(workload: GatewayWorkload): string {
	const value = Workload.parse(workload);
	return `${value.bindingId.toLowerCase()}.${value.environment}.${value.releaseId.toLowerCase()}.gateway.invalid`;
}

function privateAddress(value: string): boolean {
	if (!isIPv4(value)) return false;
	const [first, second] = value.split(".").map(Number);
	return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

/** Trusted operator configuration only. Never pass browser-supplied endpoints or certificates. */
export class GatewayUpstreamTls {
	readonly #options: GatewayUpstreamOptions;
	readonly #certificate: X509Certificate;
	readonly #serverName: string;
	readonly #dial: GatewayTlsDial;
	#active = 0;

	constructor(options: GatewayUpstreamOptions, dial: GatewayTlsDial = (configuration) => connect(configuration)) {
		try {
			this.#options = Options.parse(options);
			this.#serverName = gatewayWorkloadServerName({ bindingId: this.#options.bindingId, environment: this.#options.environment, releaseId: this.#options.releaseId });
			if (!privateAddress(this.#options.privateIp)) throw new Error();
			this.#certificate = new X509Certificate(this.#options.certificatePem);
			const pem = this.#certificate.toString();
			if (pem.replace(/\s/g, "") !== this.#options.certificatePem.replace(/\s/g, "")
				|| this.#certificate.subjectAltName !== `DNS:${this.#serverName}`
				|| !this.#certificate.verify(this.#certificate.publicKey)) throw new Error();
			this.#assertCurrent();
			this.#options.certificatePem = pem;
			this.#dial = dial;
		} catch { throw new GatewayUpstreamError(503); }
	}

	#assertCurrent(): void {
		const now = Date.now();
		if (!(Date.parse(this.#certificate.validFrom) <= now && now < Date.parse(this.#certificate.validTo))) throw new GatewayUpstreamError(503);
	}

	#checkPeer = (hostname: string, peer: PeerCertificate): Error | undefined => {
		if (hostname !== this.#serverName || checkServerIdentity(this.#serverName, peer)
			|| !Buffer.isBuffer(peer.raw) || !peer.raw.equals(this.#certificate.raw)) return new GatewayUpstreamError(502);
		return undefined;
	};

	/** Resolves only after TLS verification; no HTTP bytes are accepted by this API.
	 * Caller owns HTTP framing, streaming limits and socket disposal. */
	async connect(signal: AbortSignal): Promise<TLSSocket> {
		this.#assertCurrent();
		if (signal.aborted || this.#active >= this.#options.maxConnections) throw new GatewayUpstreamError(503);
		this.#active++;
		let socket: TLSSocket;
		try {
			socket = this.#dial({ host: this.#options.privateIp, port: this.#options.port,
				servername: this.#serverName, ca: this.#options.certificatePem, rejectUnauthorized: true,
				minVersion: "TLSv1.3", ALPNProtocols: ["http/1.1"], checkServerIdentity: this.#checkPeer });
		} catch { this.#active--; throw new GatewayUpstreamError(502); }
		return new Promise<TLSSocket>((resolve, reject) => {
			const fail = (status: 502 | 503) => { reject(new GatewayUpstreamError(status)); socket.destroy(); };
			const timer = setTimeout(() => fail(503), this.#options.timeoutMs);
			const abort = () => fail(503);
			// Keep an error listener until close, including the interval before the caller resumes.
			const error = () => fail(502);
			socket.on("error", error);
			socket.once("close", () => {
				clearTimeout(timer); signal.removeEventListener("abort", abort);
				socket.removeListener("error", error); this.#active--; reject(new GatewayUpstreamError(502));
			});
			socket.once("secureConnect", () => {
				if (signal.aborted || !socket.authorized || socket.alpnProtocol !== "http/1.1"
					|| this.#checkPeer(this.#serverName, socket.getPeerCertificate())) { fail(502); return; }
				try { this.#assertCurrent(); } catch { fail(503); return; }
				clearTimeout(timer); socket.disableRenegotiation(); resolve(socket);
			});
			signal.addEventListener("abort", abort, { once: true });
			if (signal.aborted) abort();
		});
	}
}
