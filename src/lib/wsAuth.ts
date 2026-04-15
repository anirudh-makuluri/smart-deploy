import crypto from "crypto";

const WS_TOKEN_TTL_MS = 5 * 60 * 1000;

type WsAuthPayload = {
	userID: string;
	exp: number;
};

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
	return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

export function createWebSocketAuthToken(userID: string): string {
	if (!userID?.trim()) {
		throw new Error("userID is required to create a websocket token");
	}

	const payload: WsAuthPayload = {
		userID: userID.trim(),
		exp: Date.now() + WS_TOKEN_TTL_MS,
	};
	const encodedPayload = base64UrlEncode(JSON.stringify(payload));
	const signature = signValue(encodedPayload, getSecret());
	return `${encodedPayload}.${signature}`;
}

export function verifyWebSocketAuthToken(token: string): WsAuthPayload | null {
	if (!token) return null;

	const [encodedPayload, signature] = token.split(".");
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
		const payload = JSON.parse(base64UrlDecode(encodedPayload)) as WsAuthPayload;
		if (!payload.userID || !payload.exp || payload.exp < Date.now()) {
			return null;
		}
		return payload;
	} catch {
		return null;
	}
}
