/** Shared fail-closed classification before customer routing or header forwarding. */
export function gatewayPathKind(url: URL): "public" | "reserved" | "invalid" {
	let decoded = url.pathname;
	for (let depth = 0; depth < 4; depth++) {
		if (/[\u0000-\u001f\u007f]/.test(decoded)) return "invalid";
		let canonical: URL;
		try { canonical = new URL(decoded.replaceAll("\\", "/"), url.origin); }
		catch { return "invalid"; }
		if (canonical.origin !== url.origin) return "invalid";
		if (/^\/+__smartdeploy/i.test(canonical.pathname)) return "reserved";
		let next: string;
		try { next = decodeURIComponent(decoded); }
		catch { return "invalid"; }
		if (next === decoded) return "public";
		if (depth === 3) return "invalid";
		decoded = next;
	}
	return "invalid";
}
