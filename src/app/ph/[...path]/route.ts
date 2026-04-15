import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPSTREAM = process.env.POSTHOG_UPSTREAM_HOST || "https://us.i.posthog.com";

function withCors(res: NextResponse) {
	res.headers.set("Access-Control-Allow-Origin", "*");
	res.headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
	res.headers.set(
		"Access-Control-Allow-Headers",
		"content-type, authorization, x-requested-with, accept, origin, user-agent"
	);
	res.headers.set("Access-Control-Max-Age", "86400");
	return res;
}

async function proxy(req: NextRequest, params: { path?: string[] }) {
	const url = new URL(req.url);
	const path = (params.path ?? []).join("/");
	const upstreamUrl = new URL(`${UPSTREAM.replace(/\/$/, "")}/${path}`);
	upstreamUrl.search = url.search;

	// Clone headers; drop hop-by-hop / problematic headers.
	const headers = new Headers(req.headers);
	headers.delete("host");
	headers.delete("connection");
	headers.delete("content-length");

	const init: RequestInit = {
		method: req.method,
		headers,
		// Only include a body for methods that can have one.
		body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
		// Prevent Next from caching proxy responses.
		cache: "no-store",
	};

	const upstreamRes = await fetch(upstreamUrl, init);

	const resHeaders = new Headers(upstreamRes.headers);
	resHeaders.delete("content-encoding");
	resHeaders.delete("content-length");
	resHeaders.delete("transfer-encoding");
	resHeaders.delete("connection");
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
