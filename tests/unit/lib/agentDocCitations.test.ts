import { describe, expect, it } from "vitest";
import {
	collectDocCitationsFromSearchDocsToolResults,
	extractAgentDocCitations,
	prepareAgentAssistantMessage,
	stripAgentDocSourcesSuffix,
} from "@/lib/agentDocCitations";

describe("agentDocCitations", () => {
	it("extracts valid public doc paths from agent text", () => {
		const citations = extractAgentDocCitations(
			"See docs/FAQ.md and docs/RAILPACK.md for details. Also mentioned docs/NOT_REAL.md."
		);

		expect(citations).toEqual([
			{
				source: "docs/FAQ.md",
				href: "/docs/faq",
				label: "Faq",
			},
			{
				source: "docs/RAILPACK.md",
				href: "/docs/railpack",
				label: "Railpack",
			},
		]);
	});

	it("extracts relative markdown filenames", () => {
		const citations = extractAgentDocCitations("Read ./BLUEPRINT_AND_PREVIEW.md before deploy.");

		expect(citations).toEqual([
			{
				source: "docs/BLUEPRINT_AND_PREVIEW.md",
				href: "/docs/blueprint-and-preview",
				label: "Blueprint And Preview",
			},
		]);
	});

	it("strips trailing Sources lines from the display content", () => {
		const stripped = stripAgentDocSourcesSuffix(
			"Railpack builds images at deploy time. (Sources: docs/FAQ.md, docs/RAILPACK.md)"
		);

		expect(stripped).toBe("Railpack builds images at deploy time.");
	});

	it("collects citations from search_docs tool results", () => {
		const citations = collectDocCitationsFromSearchDocsToolResults([
			{
				name: "search_docs",
				result: {
					citations: ["docs/FAQ.md", "docs/RAILPACK.md", "docs/NOT_REAL.md"],
				},
			},
		]);

		expect(citations.map((citation) => citation.source)).toEqual(["docs/FAQ.md", "docs/RAILPACK.md"]);
	});

	it("prefers search_docs tool citations over text parsing", () => {
		const prepared = prepareAgentAssistantMessage(
			"Railpack is the default build system.",
			[
				{
					source: "docs/RAILPACK.md",
					href: "/docs/railpack",
					label: "Railpack",
				},
			]
		);

		expect(prepared.docCitations.map((citation) => citation.source)).toEqual(["docs/RAILPACK.md"]);
	});

	it("prepares display content and citation badges together", () => {
		const prepared = prepareAgentAssistantMessage(
			[
				"Railpack is the default build system.",
				"(Sources: docs/FAQ.md, docs/RAILPACK.md, docs/BLUEPRINT_AND_PREVIEW.md)",
			].join(" ")
		);

		expect(prepared.displayContent).toBe("Railpack is the default build system.");
		expect(prepared.docCitations.map((citation) => citation.source)).toEqual([
			"docs/FAQ.md",
			"docs/RAILPACK.md",
			"docs/BLUEPRINT_AND_PREVIEW.md",
		]);
	});
});