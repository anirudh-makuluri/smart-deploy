import { NextResponse } from "next/server";
import { listDocMarkdownFiles } from "@/lib/public-docs";

type JsonRpcRequest = {
	jsonrpc?: string;
	id?: string | number | null;
	method?: string;
	params?: Record<string, unknown>;
};

const MCP_SERVER_INFO = {
	name: "smart-deploy-docs",
	version: "1.0.0",
};

function jsonRpc(id: JsonRpcRequest["id"], result: unknown) {
	return NextResponse.json({
		jsonrpc: "2.0",
		id: id ?? null,
		result,
	});
}

function jsonRpcError(id: JsonRpcRequest["id"], code: number, message: string) {
	return NextResponse.json({
		jsonrpc: "2.0",
		id: id ?? null,
		error: {
			code,
			message,
		},
	});
}

async function getToolList() {
	const docs = await listDocMarkdownFiles();
	return [
		{
			name: "search_docs",
			description: "Searches Smart Deploy docs by keyword and returns matching page URLs.",
			inputSchema: {
				type: "object",
				properties: {
					query: { type: "string", description: "Keyword to match against docs filenames and titles." },
				},
				required: ["query"],
				additionalProperties: false,
			},
			annotations: {
				totalDocs: docs.length,
			},
		},
	];
}

export async function GET() {
	return NextResponse.json({
		name: MCP_SERVER_INFO.name,
		version: MCP_SERVER_INFO.version,
		protocol: "mcp",
		transport: "streamable-http",
		tools: await getToolList(),
	});
}

export async function OPTIONS() {
	return new NextResponse(null, {
		status: 204,
		headers: {
			Allow: "GET,POST,OPTIONS",
		},
	});
}

export async function POST(req: Request) {
	let body: JsonRpcRequest;
	try {
		body = (await req.json()) as JsonRpcRequest;
	} catch {
		return jsonRpcError(null, -32700, "Invalid JSON");
	}

	const id = body.id ?? null;
	const method = body.method;

	if (!method) return jsonRpcError(id, -32600, "Missing method");

	if (method === "initialize") {
		return jsonRpc(id, {
			protocolVersion: "2025-03-26",
			capabilities: {
				tools: { listChanged: false },
			},
			serverInfo: MCP_SERVER_INFO,
		});
	}

	if (method === "tools/list") {
		return jsonRpc(id, { tools: await getToolList() });
	}

	if (method === "tools/call") {
		const toolName = typeof body.params?.name === "string" ? body.params.name : "";
		if (toolName !== "search_docs") {
			return jsonRpcError(id, -32601, `Unknown tool: ${toolName || "(empty)"}`);
		}

		const args = (body.params?.arguments ?? {}) as { query?: unknown };
		const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
		if (!query) {
			return jsonRpcError(id, -32602, "Tool argument `query` is required");
		}

		const docs = await listDocMarkdownFiles();
		const matches = docs
			.filter((doc) => doc.slug.includes(query) || doc.title.toLowerCase().includes(query) || doc.filename.toLowerCase().includes(query))
			.slice(0, 10)
			.map((doc) => ({
				title: doc.title,
				url: `https://smart-deploy.xyz/docs/${doc.slug}`,
			}));

		return jsonRpc(id, {
			content: [
				{
					type: "text",
					text: JSON.stringify(matches, null, 2),
				},
			],
			isError: false,
		});
	}

	return jsonRpcError(id, -32601, `Method not found: ${method}`);
}
