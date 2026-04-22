"use client";

import * as React from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BookOpenText, Loader2, MessageCircleQuestion, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type HelpAgentSheetProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

type ChatMessage = {
	id: string;
	role: "user" | "assistant";
	content: string;
	citations?: string[];
	model?: string;
	responseTimeMs?: number;
};

const STARTER_PROMPTS = [
	"Why is my deploy failing?",
	"How do I set up Supabase correctly?",
	"Why is WebSocket not connecting?",
];

function slugFromDocFilename(filename: string): string {
	return filename.replace(/\.md$/i, "").replace(/_/g, "-").toLowerCase();
}

function sourceToHref(source: string): string {
	if (source === "README.md") return "/docs";
	const docMatch = /^docs\/(.+\.md)$/i.exec(source);
	if (!docMatch) return "/docs";
	return `/docs/${slugFromDocFilename(docMatch[1])}`;
}

function sourceToLabel(source: string): string {
	if (source === "README.md") return "README";
	return source.replace(/^docs\//, "").replace(/\.md$/i, "");
}

export default function HelpAgentSheet({ open, onOpenChange }: HelpAgentSheetProps) {
	const [input, setInput] = React.useState("");
	const [pending, setPending] = React.useState(false);
	const [messages, setMessages] = React.useState<ChatMessage[]>([
		{
			id: "welcome",
			role: "assistant",
			content:
				"I can help you troubleshoot Smart Deploy using the project docs. Ask what you're stuck on and include exact errors when possible.",
			citations: ["docs/TROUBLESHOOTING.md", "docs/FAQ.md"],
		},
	]);
	const endRef = React.useRef<HTMLDivElement | null>(null);

	React.useEffect(() => {
		endRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages, pending]);

	const askHelpAgent = React.useCallback(async (question: string) => {
		const cleaned = question.trim();
		if (!cleaned || pending) return;

		const nextUserMessage: ChatMessage = {
			id: `${Date.now()}-user`,
			role: "user",
			content: cleaned,
		};

		setMessages((prev) => [...prev, nextUserMessage]);
		setInput("");
		setPending(true);

		try {
			const history = [...messages, nextUserMessage].slice(-8).map((message) => ({
				role: message.role,
				content: message.content,
			}));

			const response = await fetch("/api/help-agent", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					question: cleaned,
					history,
				}),
			});

			const data = (await response.json()) as {
				answer?: string;
				citations?: string[];
				model?: string;
				responseTimeMs?: number;
				error?: string;
			};

			if (!response.ok) {
				throw new Error(data.error || "Help agent request failed");
			}

			setMessages((prev) => [
				...prev,
				{
					id: `${Date.now()}-assistant`,
					role: "assistant",
					content: data.answer || "I couldn't generate a response right now.",
					citations: Array.isArray(data.citations) ? data.citations : [],
					model: typeof data.model === "string" ? data.model : undefined,
					responseTimeMs: typeof data.responseTimeMs === "number" ? data.responseTimeMs : undefined,
				},
			]);
		} catch (error) {
			setMessages((prev) => [
				...prev,
				{
					id: `${Date.now()}-error`,
					role: "assistant",
					content:
						error instanceof Error
							? `I hit an issue while responding: ${error.message}`
							: "I hit an issue while responding. Please retry.",
					citations: ["docs/TROUBLESHOOTING.md"],
				},
			]);
		} finally {
			setPending(false);
		}
	}, [messages, pending]);

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				side="right"
				className="z-[70] flex h-svh w-[min(34rem,100vw)] max-w-[34rem] flex-col gap-0 border-l border-border bg-card p-0"
			>
				<SheetHeader className="border-b border-border/60 px-4 py-4">
					<SheetTitle className="flex items-center gap-2 text-base">
						<MessageCircleQuestion className="size-4 text-primary" />
						Help Agent
					</SheetTitle>
					<SheetDescription className="text-xs">
						Docs-grounded support for setup, deploy, and troubleshooting questions.
					</SheetDescription>
				</SheetHeader>

				<div className="flex min-h-0 flex-1 flex-col">
					<ScrollArea className="min-h-0 flex-1 px-4 py-4">
						<div className="space-y-3">
							<div className="flex flex-wrap gap-2">
								{STARTER_PROMPTS.map((prompt) => (
									<Button
										key={prompt}
										type="button"
										size="sm"
										variant="outline"
										className="h-7 rounded-full text-xs"
										onClick={() => void askHelpAgent(prompt)}
										disabled={pending}
									>
										{prompt}
									</Button>
								))}
							</div>

							{messages.map((message) => (
								<div
									key={message.id}
									className={cn(
										"max-w-[92%] rounded-lg border px-3 py-2 text-sm shadow-xs",
										message.role === "user"
											? "ml-auto border-primary/30 bg-primary/10 text-foreground"
											: "border-border bg-background/70 text-foreground",
									)}
								>
									{message.role === "assistant" ? (
										<ReactMarkdown
											remarkPlugins={[remarkGfm]}
											components={{
												p: ({ children }) => <p className="whitespace-pre-wrap leading-relaxed">{children}</p>,
												ul: ({ children }) => <ul className="mt-2 list-disc space-y-1 pl-5">{children}</ul>,
												ol: ({ children }) => <ol className="mt-2 list-decimal space-y-1 pl-5">{children}</ol>,
												li: ({ children }) => <li>{children}</li>,
												strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
												code: ({ children }) => (
													<code className="rounded bg-secondary/60 px-1 py-0.5 text-[0.9em]">{children}</code>
												),
											}}
										>
											{message.content}
										</ReactMarkdown>
									) : (
										<p className="whitespace-pre-wrap">{message.content}</p>
									)}
									{message.citations && message.citations.length > 0 ? (
										<div className="mt-2 flex flex-wrap gap-2">
											{message.citations.filter((citation) => citation !== "README.md").map((citation) => (
												<Link
													key={`${message.id}-${citation}`}
													href={sourceToHref(citation)}
													className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-secondary/40 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
												>
													<BookOpenText className="size-3" />
													{sourceToLabel(citation)}
												</Link>
											))}
										</div>
									) : null}
									{message.role === "assistant" && message.model ? (
										<div className="mt-2 text-[11px] text-muted-foreground/90">
											Model: {message.model}
										</div>
									) : null}
									{message.role === "assistant" && typeof message.responseTimeMs === "number" ? (
										<div className="mt-1 text-[11px] text-muted-foreground/70">
											Response time: {message.responseTimeMs} ms
										</div>
									) : null}
								</div>
							))}

							{pending ? (
								<div className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
									<Loader2 className="size-4 animate-spin" />
									Thinking...
								</div>
							) : null}
							<div ref={endRef} />
						</div>
					</ScrollArea>

					<div className="border-t border-border/60 p-4">
						<form
							className="space-y-2"
							onSubmit={(event) => {
								event.preventDefault();
								void askHelpAgent(input);
							}}
						>
							<Textarea
								value={input}
								onChange={(event) => setInput(event.target.value)}
								placeholder="Describe what you're stuck on..."
								className="max-h-36 min-h-20 resize-y"
								disabled={pending}
							/>
							<div className="flex items-center justify-between">
								<Link href="/docs" className="text-xs text-muted-foreground hover:text-foreground">
									Browse docs
								</Link>
								<Button type="submit" size="sm" disabled={pending || input.trim().length === 0}>
									<Send className="size-4" />
									Ask agent
								</Button>
							</div>
						</form>
					</div>
				</div>
			</SheetContent>
		</Sheet>
	);
}
