"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, Check, Copy, Loader2, Send, SquarePen } from "lucide-react";
import { AgentActivityTimeline } from "@/components/deployment-agent-sheet/AgentActivityTimeline";
import { AgentStructuredDataBlocks } from "@/components/deployment-agent-sheet/AgentStructuredDataBlocks";
import { DeploymentAgentDocBadges } from "@/components/deployment-agent-sheet/DeploymentAgentDocBadges";
import { DeploymentAgentEmptyState } from "@/components/deployment-agent-sheet/DeploymentAgentEmptyState";
import { DeploymentAgentScrollRegion } from "@/components/deployment-agent-sheet/DeploymentAgentScrollRegion";
import { useDeploymentAgentSheet } from "@/components/deployment-agent-sheet/useDeploymentAgentSheet";
import { useDesktopBreakpoint } from "@/components/deployment-agent-sheet/useDesktopBreakpoint";
import type { DeploymentAgentMessage } from "@/components/deployment-agent-sheet/types";
import { prepareAgentAssistantMessage } from "@/lib/agentDocCitations";
import { Button } from "@/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type DeploymentAgentSheetProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

type ConnectionMeta = {
	label: string;
	dotClassName: string;
};

function connectionMeta(status: string): ConnectionMeta {
	if (status === "open") {
		return { label: "Connected", dotClassName: "bg-emerald-500" };
	}
	if (status === "connecting") {
		return { label: "Connecting", dotClassName: "bg-amber-500 animate-pulse" };
	}
	return { label: "Offline", dotClassName: "bg-destructive" };
}

function formatTimestamp(createdAt: number): string {
	return new Date(createdAt).toLocaleTimeString("en-US", {
		hour: "2-digit",
		minute: "2-digit",
		timeZone: "UTC",
	});
}

const markdownComponents = {
	p: ({ children }: { children?: React.ReactNode }) => (
		<p className="break-words whitespace-pre-wrap leading-relaxed">{children}</p>
	),
	ul: ({ children }: { children?: React.ReactNode }) => (
		<ul className="mt-2 list-disc space-y-1 break-words pl-5">{children}</ul>
	),
	ol: ({ children }: { children?: React.ReactNode }) => (
		<ol className="mt-2 list-decimal space-y-1 break-words pl-5">{children}</ol>
	),
	li: ({ children }: { children?: React.ReactNode }) => <li className="break-words">{children}</li>,
	strong: ({ children }: { children?: React.ReactNode }) => (
		<strong className="font-semibold">{children}</strong>
	),
	a: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
		<a
			href={href}
			target="_blank"
			rel="noreferrer"
			className="break-all font-medium text-primary underline underline-offset-2 hover:opacity-80"
		>
			{children}
		</a>
	),
	code: ({ children }: { children?: React.ReactNode }) => (
		<code className="break-all rounded bg-secondary/60 px-1 py-0.5 text-[0.9em]">{children}</code>
	),
	pre: ({ children }: { children?: React.ReactNode }) => (
		<pre className="max-w-full overflow-x-auto rounded-md bg-secondary/40 p-2 text-xs">{children}</pre>
	),
	table: ({ children }: { children?: React.ReactNode }) => (
		<div className="max-w-full overflow-x-auto">
			<table className="w-full min-w-0 text-left text-xs">{children}</table>
		</div>
	),
};

function AssistantMessage({
	message,
	copiedMessageId,
	onCopy,
}: {
	message: DeploymentAgentMessage;
	copiedMessageId: string | null;
	onCopy: (id: string, content: string) => void;
}) {
	const prepared = !message.pending
		? prepareAgentAssistantMessage(message.content, message.docCitations)
		: null;
	const showContent = !message.pending && message.content.trim().length > 0;
	const showStructuredData =
		!message.pending && message.structuredData.blocks.length > 0;

	return (
		<div className="flex min-w-0 max-w-4/5 items-start gap-2.5">
			<span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-primary">
				<Bot className="size-4" />
			</span>
			<div className="group flex min-w-0 flex-1 flex-col gap-2">
				<div className="min-w-0 overflow-hidden rounded-2xl rounded-tl-sm border border-border bg-background/70 px-4 py-3 text-sm text-foreground shadow-xs">
					{message.pending ? (
						<AgentActivityTimeline steps={message.activity} pending />
					) : (
						<>
							{showContent ? (
								<ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
									{prepared?.displayContent ?? message.content}
								</ReactMarkdown>
							) : null}

							{showStructuredData ? (
								<div className={cn(showContent && "mt-3")}>
									<AgentStructuredDataBlocks data={message.structuredData} />
								</div>
							) : null}

							{message.activity.length > 0 ? (
								<div className={cn(showContent && "mt-3")}>
									<AgentActivityTimeline steps={message.activity} pending={false} />
								</div>
							) : null}

							{prepared ? <DeploymentAgentDocBadges citations={prepared.docCitations} /> : null}
						</>
					)}
				</div>

				<div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
					<span>{formatTimestamp(message.createdAt)}</span>
					{!message.pending && message.content.trim().length > 0 ? (
						<button
							type="button"
							onClick={() => onCopy(message.id, message.content)}
							className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors hover:bg-accent hover:text-foreground"
							aria-label="Copy response"
						>
							{copiedMessageId === message.id ? (
								<>
									<Check className="size-3" /> Copied
								</>
							) : (
								<>
									<Copy className="size-3" /> Copy
								</>
							)}
						</button>
					) : null}
				</div>
			</div>
		</div>
	);
}

function UserMessage({ message }: { message: DeploymentAgentMessage }) {
	return (
		<div className="flex min-w-0 w-full flex-col items-end gap-1">
			<div className="max-w-full rounded-2xl rounded-tr-sm border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-foreground shadow-xs sm:max-w-[85%]">
				<p className="break-words whitespace-pre-wrap leading-relaxed">{message.content}</p>
			</div>
			<span className="px-1 text-[11px] text-muted-foreground">{formatTimestamp(message.createdAt)}</span>
		</div>
	);
}

export default function DeploymentAgentSheet({ open, onOpenChange }: DeploymentAgentSheetProps) {
	const {
		state,
		dispatch,
		endRef,
		inputRef,
		socketStatus,
		hasConversation,
		copyAssistantMessage,
		askDeploymentAgent,
		submitInput,
		resetConversation,
	} = useDeploymentAgentSheet();
	const { copiedMessageId, input, messages, pending } = state;

	const connection = connectionMeta(socketStatus);
	const welcomeContent = messages[0]?.role === "assistant" ? messages[0].content : "";
	const canSubmit = !pending && input.trim().length > 0;
	const useCustomScrollbar = useDesktopBreakpoint();
	const newChatTooltip = pending
		? "Wait for the agent to finish"
		: !hasConversation
			? "Start a conversation first"
			: "New conversation";

	React.useEffect(() => {
		const element = inputRef.current;
		if (!element) return;
		element.style.height = "auto";
		element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
	}, [input, inputRef]);

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				side="right"
				className="z-70 flex h-dvh max-h-dvh w-full max-w-full flex-col gap-0 overflow-hidden border-l border-border bg-card p-0 sm:h-svh sm:max-h-svh sm:w-160 sm:max-w-160"
			>
				<SheetHeader className="shrink-0 flex-row items-center gap-3 space-y-0 border-b border-border/60 px-5 pb-4 pt-[max(1rem,env(safe-area-inset-top))] pr-14 text-left">
					<span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary shadow-xs">
						<Bot className="size-5" />
					</span>
					<div className="min-w-0 flex-1">
						<SheetTitle className="flex items-center gap-2 text-sm">
							Deployment Agent
							<span className="inline-flex items-center gap-1 text-[11px] font-normal text-muted-foreground">
								<span className={cn("size-1.5 rounded-full", connection.dotClassName)} />
								{connection.label}
							</span>
						</SheetTitle>
						<SheetDescription className="text-xs">
							Read-only inspection for status, history, and runtime health.
						</SheetDescription>
					</div>
					<TooltipProvider delayDuration={300}>
						<Tooltip>
							<TooltipTrigger asChild>
								<span className="inline-flex shrink-0">
									<Button
										type="button"
										variant="ghost"
										size="icon"
										className="size-8 text-muted-foreground hover:text-foreground"
										onClick={resetConversation}
										disabled={pending || !hasConversation}
										aria-label="New conversation"
									>
										<SquarePen className="size-4" />
									</Button>
								</span>
							</TooltipTrigger>
							<TooltipContent side="bottom">{newChatTooltip}</TooltipContent>
						</Tooltip>
					</TooltipProvider>
				</SheetHeader>

				<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
					<DeploymentAgentScrollRegion useCustomScrollbar={useCustomScrollbar}>
						{hasConversation ? (
							<div className="min-w-0 w-full space-y-5">
								{messages.map((message) =>
									message.role === "assistant" ? (
										<AssistantMessage
											key={message.id}
											message={message}
											copiedMessageId={copiedMessageId}
											onCopy={(id, content) => void copyAssistantMessage(id, content)}
										/>
									) : (
										<UserMessage key={message.id} message={message} />
									)
								)}
								<div ref={endRef} />
							</div>
						) : (
							<DeploymentAgentEmptyState
								welcome={welcomeContent}
								disabled={pending}
								onSelectPrompt={askDeploymentAgent}
							/>
						)}
					</DeploymentAgentScrollRegion>

					<div className="shrink-0 border-t border-border/60 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
						<div
							className={cn(
								"rounded-xl border border-border bg-background/60 p-3 shadow-xs transition-colors",
								"focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20"
							)}
						>
							<Textarea
								ref={inputRef}
								value={input}
								onChange={(event) => dispatch({ type: "set_input", value: event.target.value })}
								onKeyDown={(event) => {
									if (event.key === "Enter" && !event.shiftKey) {
										event.preventDefault();
										if (canSubmit) {
											submitInput();
										}
									}
								}}
								placeholder="Ask about your deployments..."
								className="max-h-40 min-h-11 resize-none border-0 bg-transparent p-2 shadow-none focus-visible:ring-0"
								disabled={pending}
							/>
							<div className="flex items-center justify-between gap-2 pl-1.5">
								<span className="text-[11px] text-muted-foreground">
									{pending ? (
										<span className="inline-flex items-center gap-1.5">
											<Loader2 className="size-3 animate-spin" />
											Agent is working...
										</span>
									) : (
										<span className="hidden sm:inline">
											<kbd className="rounded border border-border bg-muted px-1 font-sans">Enter</kbd> to send
											{" · "}
											<kbd className="rounded border border-border bg-muted px-1 font-sans">Shift+Enter</kbd> for new line
										</span>
									)}
								</span>
								<Button
									type="button"
									size="icon"
									className="size-8 rounded-lg mt-2"
									disabled={!canSubmit}
									onClick={submitInput}
									aria-label="Ask agent"
								>
									<Send className="size-4" />
								</Button>
							</div>
						</div>
					</div>
				</div>
			</SheetContent>
		</Sheet>
	);
}
