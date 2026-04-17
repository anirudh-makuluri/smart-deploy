"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type UserReportSheetProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	pagePath: string;
	repoOwner?: string;
	repoName?: string;
	serviceName?: string | null;
};

type ReportCategory = "bug" | "feature" | "general" | "other";

const CATEGORIES: Array<{ value: ReportCategory; label: string }> = [
	{ value: "bug", label: "Bug report" },
	{ value: "feature", label: "Feature request" },
	{ value: "general", label: "General feedback" },
	{ value: "other", label: "Other" },
];

export default function UserReportSheet({
	open,
	onOpenChange,
	pagePath,
	repoOwner,
	repoName,
	serviceName,
}: UserReportSheetProps) {
	const [category, setCategory] = React.useState<ReportCategory>("bug");
	const [message, setMessage] = React.useState("");
	const [isSubmitting, setIsSubmitting] = React.useState(false);

	const messageLength = message.trim().length;
	const canSubmit = messageLength >= 5 && !isSubmitting;

	async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!canSubmit) return;

		setIsSubmitting(true);
		try {
			const response = await fetch("/api/user-reports", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					category,
					message,
					pagePath,
					repoOwner,
					repoName,
					serviceName,
				}),
			});

			const result = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(result?.error || "Failed to submit report");
			}

			toast.success("Thanks! Your report was submitted.");
			setMessage("");
			setCategory("bug");
			onOpenChange(false);
		} catch (error) {
			const fallback = "Failed to submit report";
			toast.error(error instanceof Error ? error.message : fallback);
		} finally {
			setIsSubmitting(false);
		}
	}

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="w-full sm:max-w-lg bg-[#0a0a0f] border-white/5 p-0">
				<form onSubmit={handleSubmit} className="flex h-full flex-col">
					<div className="border-b border-white/5 p-6">
						<SheetHeader>
							<SheetTitle className="text-xl font-bold">Report issue</SheetTitle>
							<SheetDescription>
								Send a bug report, feature request, or general feedback to the team.
							</SheetDescription>
						</SheetHeader>
					</div>

					<div className="flex-1 space-y-5 p-6">
						<div className="space-y-2">
							<Label htmlFor="report-category">Type</Label>
							<Select value={category} onValueChange={(value) => setCategory(value as ReportCategory)}>
								<SelectTrigger id="report-category" className="h-10 bg-white/[0.03] border-white/10">
									<SelectValue />
								</SelectTrigger>
								<SelectContent className="bg-[#0A0A0F] border-white/10">
									{CATEGORIES.map((item) => (
										<SelectItem key={item.value} value={item.value}>
											{item.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<div className="space-y-2">
							<Label htmlFor="report-message">Details</Label>
							<Textarea
								id="report-message"
								value={message}
								onChange={(event) => setMessage(event.target.value)}
								placeholder="What happened? What did you expect to happen?"
								className="min-h-40 resize-y bg-white/[0.03] border-white/10"
								maxLength={5000}
							/>
							<p className="text-xs text-muted-foreground">{messageLength}/5000 characters</p>
						</div>
					</div>

					<div className="flex items-center justify-end gap-2 border-t border-white/5 bg-white/[0.01] p-6">
						<Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
							Cancel
						</Button>
						<Button type="submit" disabled={!canSubmit}>
							{isSubmitting ? "Submitting..." : "Submit report"}
						</Button>
					</div>
				</form>
			</SheetContent>
		</Sheet>
	);
}
