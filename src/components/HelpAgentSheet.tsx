"use client";

import * as React from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BookOpenText, Check, Copy, Loader2, MessageCircleQuestion, Send, ThumbsDown, ThumbsUp } from "lucide-react";
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
import {
	docCitationsForDisplay,
	sourceToHref,
	sourceToLabel,
	STARTER_PROMPTS,
} from "@/components/help-agent-sheet/helpAgentSheetUtils";
import { useHelpAgentSheet } from "@/components/help-agent-sheet/useHelpAgentSheet";

type HelpAgentSheetProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

export default function HelpAgentSheet({ open, onOpenChange }: HelpAgentSheetProps) {
	const { state, endRef, dispatch, copyAssistantMessage, setFeedback, askHelpAgent, submitInput } =
		useHelpAgentSheet();
	const { input, pending, copiedMessageId, feedbackByMessageId, messages } = state;

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
										"group max-w-[92%] rounded-lg border px-3 py-2 text-sm shadow-xs",
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
											{docCitationsForDisplay(message.citations).map((citation) => (
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
									{message.role === "assistant" ? (
										<div className="mt-3 flex items-center justify-between gap-3">
											<div className="flex items-center gap-1">
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
												<Button
													type="button"
													variant="ghost"
													size="icon"
													className={cn(
														"h-7 w-7 text-muted-foreground hover:text-foreground",
														feedbackByMessageId[message.id] === "helpful" && "text-emerald-500 hover:text-emerald-500",
													)}
													onClick={() => setFeedback(message.id, "helpful")}
													aria-label="Mark response helpful"
												>
													<ThumbsUp className="size-3.5" />
												</Button>
												<Button
													type="button"
													variant="ghost"
													size="icon"
													className={cn(
														"h-7 w-7 text-muted-foreground hover:text-foreground",
														feedbackByMessageId[message.id] === "unhelpful" && "text-rose-500 hover:text-rose-500",
													)}
													onClick={() => setFeedback(message.id, "unhelpful")}
													aria-label="Mark response unhelpful"
												>
													<ThumbsDown className="size-3.5" />
												</Button>
											</div>
											{message.model || typeof message.responseTimeMs === "number" || typeof message.mossRetrievalMs === "number" ? (
												<div className="text-right text-[11px] text-muted-foreground/75 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
													{message.model ? <div>Model: {message.model}</div> : null}
													{typeof message.responseTimeMs === "number" || typeof message.mossRetrievalMs === "number" ? (
														<div>
															{typeof message.responseTimeMs === "number" ? `Response: ${message.responseTimeMs} ms` : ""}
															{typeof message.mossRetrievalMs === "number"
																? `${typeof message.responseTimeMs === "number" ? " · " : ""}Moss: ${message.mossRetrievalMs} ms`
																: ""}
														</div>
													) : null}
												</div>
											) : null}
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
						<div className="space-y-2">
							<Textarea
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
								placeholder="Describe what you're stuck on..."
								className="max-h-36 min-h-20 resize-y"
								disabled={pending}
							/>
							<div className="flex items-center justify-between">
								<Link href="/docs" className="text-xs text-muted-foreground hover:text-foreground">
									Browse docs
								</Link>
								<Button type="button" size="sm" disabled={pending || input.trim().length === 0} onClick={submitInput}>
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
