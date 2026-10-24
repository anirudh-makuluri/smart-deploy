import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPSTREAM = process.env.POSTHOG_UPSTREAM_HOST || "https://us.i.posthog.com";
const ANALYTICS_HEADERS = ["accept", "accept-language", "content-type", "content-encoding", "user-agent"];
const HOP_BY_HOP_HEADERS = ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"];

function connectionHeaders(headers: Headers): string[] {
	return (headers.get("connection") ?? "").split(",").map((name) => name.trim().toLowerCase()).filter(Boolean);
}

function withCors(res: NextResponse) {
	res.headers.set("Access-Control-Allow-Origin", "*");
	res.headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
	res.headers.set(
		"Access-Control-Allow-Headers",
		"content-type, content-encoding, accept, accept-language"
	);
	res.headers.delete("Access-Control-Allow-Credentials");
	res.headers.set("Access-Control-Max-Age", "86400");
	return res;
}

async function proxy(req: NextRequest, params: { path?: string[] }) {
	const url = new URL(req.url);
	const path = (params.path ?? []).join("/");
	const upstreamUrl = new URL(`${UPSTREAM.replace(/\/$/, "")}/${path}`);
	upstreamUrl.search = url.search;

	// Ingestion uses the project token in the payload. Platform credentials and
	// arbitrary private headers must never be sent to the analytics provider.
	const headers = new Headers();
	const connectionOnly = new Set(connectionHeaders(req.headers));
	for (const name of ANALYTICS_HEADERS) {
		const value = req.headers.get(name);
		if (value !== null && !connectionOnly.has(name)) headers.set(name, value);
	}

	const upstreamRes = await fetch(upstreamUrl, {
		method: req.method,
		headers,
		body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
		cache: "no-store",
		credentials: "omit",
	});

	const resHeaders = new Headers(upstreamRes.headers);
	for (const name of [...connectionHeaders(resHeaders), ...HOP_BY_HOP_HEADERS,
		"content-encoding", "content-length", "set-cookie", "set-cookie2", "clear-site-data", "www-authenticate"]) {
		resHeaders.delete(name);
	}
	// Ensure the browser treats it as non-cacheable in dev/prod.
	resHeaders.set("Cache-Control", "no-store");

	const isNoBodyStatus = upstreamRes.status === 204 || upstreamRes.status === 205 || upstreamRes.status === 304;
	const responseBody = isNoBodyStatus ? null : await upstreamRes.arrayBuffer();
	const res = new NextResponse(responseBody, {
		status: upstreamRes.status,
		headers: resHeaders,
	});

	return withCors(res);
}

export async function OPTIONS() {
	return withCors(new NextResponse(null, { status: 204 }));
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
	return proxy(req, await ctx.params);
}
export async function POST(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
	return proxy(req, await ctx.params);
}
export async function PUT(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
	return proxy(req, await ctx.params);
}
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
	return proxy(req, await ctx.params);
}
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
	return proxy(req, await ctx.params);
}
