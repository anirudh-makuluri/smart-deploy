"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, Check, Copy, Loader2, Send } from "lucide-react";
import { DeploymentAgentDocBadges } from "@/components/deployment-agent-sheet/DeploymentAgentDocBadges";
import { useDeploymentAgentSheet, DEPLOYMENT_AGENT_STARTER_PROMPTS } from "@/components/deployment-agent-sheet/useDeploymentAgentSheet";
import { prepareAgentAssistantMessage } from "@/lib/agentDocCitations";
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

type DeploymentAgentSheetProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

export default function DeploymentAgentSheet({
	open,
	onOpenChange,
}: DeploymentAgentSheetProps) {
	const { state, dispatch, endRef, inputRef, copyAssistantMessage, askDeploymentAgent, submitInput } =
		useDeploymentAgentSheet();
	const { copiedMessageId, input, messages, pending } = state;

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				side="right"
				className="z-[70] flex h-svh w-[min(34rem,100vw)] max-w-[34rem] flex-col gap-0 border-l border-border bg-card p-0"
			>
				<SheetHeader className="border-b border-border/60 px-4 py-4">
					<SheetTitle className="flex items-center gap-2 text-base">
						<Bot className="size-4 text-primary" />
						Deployment Agent
					</SheetTitle>
					<SheetDescription className="text-xs">
						Read-only inspection for deployment status, history, and runtime health.
					</SheetDescription>
				</SheetHeader>

				<div className="flex min-h-0 flex-1 flex-col">
					<ScrollArea className="min-h-0 flex-1 px-4 py-4">
						<div className="space-y-3">
							<div className="flex flex-wrap gap-2">
								{DEPLOYMENT_AGENT_STARTER_PROMPTS.map((prompt) => (
									<Button
										key={prompt}
										type="button"
										size="sm"
										variant="outline"
										className="h-7 rounded-full text-xs"
										onClick={() => askDeploymentAgent(prompt)}
										disabled={pending}
									>
										{prompt}
									</Button>
								))}
							</div>

							{messages.map((message) => {
								const preparedAssistantMessage =
									message.role === "assistant" && !message.pending
										? prepareAgentAssistantMessage(message.content, message.docCitations)
										: null;

								return (
								<div
									key={message.id}
									className={cn(
										"group max-w-[92%] rounded-lg border px-3 py-2 text-sm shadow-xs",
										message.role === "user"
											? "ml-auto border-primary/30 bg-primary/10 text-foreground"
											: "border-border bg-background/70 text-foreground"
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
											{preparedAssistantMessage?.displayContent ?? message.content}
										</ReactMarkdown>
									) : (
										<p className="whitespace-pre-wrap">{message.content}</p>
									)}

									{preparedAssistantMessage ? (
										<DeploymentAgentDocBadges citations={preparedAssistantMessage.docCitations} />
									) : null}

									{message.role === "assistant" ? (
										<div className="mt-3 flex items-center justify-between gap-3">
											<div className="flex items-center gap-2 text-[11px] text-muted-foreground">
												{message.pending ? (
													<span className="inline-flex items-center gap-1">
														<Loader2 className="size-3 animate-spin" />
														Working...
													</span>
												) : null}
											</div>
											<Button
												type="button"
												variant="ghost"
												size="icon"
												className="h-7 w-7 text-muted-foreground hover:text-foreground"
												onClick={() => void copyAssistantMessage(message.id, message.content)}
												aria-label="Copy response"
											>
												{copiedMessageId === message.id ? (
													<Check className="size-3.5" />
												) : (
													<Copy className="size-3.5" />
												)}
											</Button>
										</div>
									) : null}
								</div>
								);
							})}
							<div ref={endRef} />
						</div>
					</ScrollArea>

					<div className="border-t border-border/60 p-4">
						<div className="space-y-2">
							<Textarea
								ref={inputRef}
								value={input}
								onChange={(event) => dispatch({ type: "set_input", value: event.target.value })}
								onKeyDown={(event) => {
									if (event.key === "Enter" && !event.shiftKey) {
										event.preventDefault();
										if (!pending && input.trim().length > 0) {
											submitInput();
										}
									}
								}}
								placeholder="Ask about your deployments..."
								className="max-h-36 min-h-20 resize-y"
								disabled={pending}
							/>
							<div className="flex items-center justify-end">
								<Button
									type="button"
									size="sm"
									disabled={pending || input.trim().length === 0}
									onClick={submitInput}
								>
									<Send className="size-4" />
									Ask agent
								</Button>
							</div>
						</div>
					</div>
				</div>
			</SheetContent>
		</Sheet>
	);
}
