import crypto from "crypto";
import { isJsonObject } from "./httpResponse";

const WS_TOKEN_TTL_MS = 5 * 60 * 1000;

export interface WebSocketAuthPayload {
	audience: "smartdeploy-worker";
	version: 2;
	userID: string;
	sessionID: string;
	exp: number;
}

function getSecret(): string {
	const secret = (process.env.BETTER_AUTH_SECRET || "").trim();
	if (!secret) {
		throw new Error("BETTER_AUTH_SECRET is required for websocket authentication");
	}
	return secret;
}

function base64UrlEncode(value: string): string {
	return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
	return Buffer.from(value, "base64url").toString("utf8");
}

function signValue(value: string, secret: string): string {
	const key = crypto.createHmac("sha256", secret).update("smartdeploy-worker:v2").digest();
	return crypto.createHmac("sha256", key).update(value).digest("base64url");
}

export function createWebSocketAuthToken(userID: string, sessionID: string): string {
	if (!userID?.trim()) {
		throw new Error("userID is required to create a websocket token");
	}
	if (!sessionID.trim()) throw new Error("sessionID is required to create a websocket token");

	const payload: WebSocketAuthPayload = {
		audience: "smartdeploy-worker",
		version: 2,
		userID: userID.trim(),
		sessionID: sessionID.trim(),
		exp: Date.now() + WS_TOKEN_TTL_MS,
	};
	const encodedPayload = base64UrlEncode(JSON.stringify(payload));
	const signature = signValue(encodedPayload, getSecret());
	return `${encodedPayload}.${signature}`;
}

export function verifyWebSocketAuthToken(token: string): WebSocketAuthPayload | null {
	if (!token || token.length > 2048) return null;

	const parts = token.split(".");
	if (parts.length !== 2) return null;
	const [encodedPayload, signature] = parts;
	if (!encodedPayload || !signature) return null;

	const expectedSignature = signValue(encodedPayload, getSecret());
	const signatureBuffer = Buffer.from(signature);
	const expectedBuffer = Buffer.from(expectedSignature);
	if (signatureBuffer.length !== expectedBuffer.length) {
		return null;
	}
	if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
		return null;
	}

	try {
		const payload: unknown = JSON.parse(base64UrlDecode(encodedPayload));
		if (!isJsonObject(payload) || payload.audience !== "smartdeploy-worker" || payload.version !== 2
			|| typeof payload.userID !== "string" || !payload.userID.trim()
			|| typeof payload.sessionID !== "string" || !payload.sessionID.trim()
			|| typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.exp <= Date.now()) {
			return null;
		}
		return { audience: "smartdeploy-worker", version: 2, userID: payload.userID, sessionID: payload.sessionID, exp: payload.exp };
	} catch {
		return null;
	}
}
