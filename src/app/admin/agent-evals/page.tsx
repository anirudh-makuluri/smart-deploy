import Link from "next/link";
import { revalidatePath } from "next/cache";
import { Bot, ClipboardCheck, Gauge, Sparkles, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { requireAdminSession } from "@/lib/admin";
import { getDbPool } from "@/lib/dbPool";
import {
	buildDeploymentAgentEvalRun,
	DEPLOYMENT_AGENT_EVAL_FAILURE_MODES,
	DEPLOYMENT_AGENT_EVAL_HELPFULNESS,
	DEPLOYMENT_AGENT_EVAL_INTENTS,
	isEvalFailureMode,
	isEvalHelpfulness,
	isEvalIntent,
	type DeploymentAgentEvalReview,
	type DeploymentAgentEvalRun,
} from "@/lib/deploymentAgentEval";
import { judgeDeploymentAgentRun } from "@/lib/deploymentAgentJudge";
import { getSupabaseServer } from "@/lib/supabaseServer";

const PAGE_SIZE = 12;
const REVIEW_FILTER_VALUES = ["all", "pending", "reviewed"] as const;
const AGENT_EVAL_DATE_FORMATTER = new Intl.DateTimeFormat("en", {
	dateStyle: "medium",
	timeStyle: "short",
});

type ReviewFilter = (typeof REVIEW_FILTER_VALUES)[number];

type AgentEvalsPageProps = {
	searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type AgentMessageRow = {
	id: string;
	user_id: string;
	conversation_id: string;
	run_id: string;
	role: "user" | "assistant";
	content: string;
	metadata: unknown;
	created_at: string;
};

type EvalReviewRow = {
	run_id: string;
	assistant_message_id: string;
	user_id: string;
	conversation_id: string;
	judge_intent: string | null;
	judge_helpfulness: string | null;
	judge_primary_failure_mode: string | null;
	judge_expected_tool_path: string | null;
	judge_notes: string | null;
	judge_scores: Record<string, unknown> | null;
	judge_model: string | null;
	judge_provider: string | null;
	judged_at: string | null;
	intent: string | null;
	helpfulness: string | null;
	primary_failure_mode: string | null;
	expected_tool_path: string | null;
	notes: string | null;
	reviewed_at: string | null;
	reviewed_by_email: string | null;
};

type EvalListingRow = {
	id: string;
	user_id: string;
	conversation_id: string;
	run_id: string;
	content: string;
	metadata: unknown;
	created_at: string;
	user_message: string | null;
	total_count: string | number;
	review_run_id: string | null;
	assistant_message_id: string | null;
	judge_intent: string | null;
	judge_helpfulness: string | null;
	judge_primary_failure_mode: string | null;
	judge_expected_tool_path: string | null;
	judge_notes: string | null;
	judge_scores: Record<string, unknown> | null;
	judge_model: string | null;
	judge_provider: string | null;
	judged_at: string | null;
	intent: string | null;
	helpfulness: string | null;
	primary_failure_mode: string | null;
	expected_tool_path: string | null;
	notes: string | null;
	reviewed_at: string | null;
	reviewed_by_email: string | null;
};

type EvalRunsPageData = {
	runs: DeploymentAgentEvalRun[];
	reviewsByRunId: Map<string, DeploymentAgentEvalReview>;
	totalCount: number;
	page: number;
	pageCount: number;
	reviewFilter: ReviewFilter;
};

function formatDateTime(value: string): string {
	return AGENT_EVAL_DATE_FORMATTER.format(new Date(value));
}

function formatDurationMs(value: number | null): string {
	if (value === null) return "-";
	if (value < 1000) return `${value} ms`;
	return `${(value / 1000).toFixed(1)} s`;
}

function formatTokenTotal(value: number | null): string {
	return value === null ? "-" : value.toLocaleString();
}

function badgeClassName(value: string | null): string {
	const normalized = (value ?? "").toLowerCase();
	if (normalized.includes("helpful") || normalized === "complete") {
		return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
	}
	if (
		normalized.includes("not_helpful") ||
		normalized.includes("wrong") ||
		normalized.includes("missing") ||
		normalized === "error"
	) {
		return "border-red-400/30 bg-red-400/10 text-red-200";
	}
	if (
		normalized.includes("partial") ||
		normalized.includes("tool_limit") ||
		normalized.includes("shallow") ||
		normalized.includes("clarification")
	) {
		return "border-amber-400/30 bg-amber-400/10 text-amber-200";
	}
	return "border-white/10 bg-white/5 text-muted-foreground";
}

function countWhere<T>(items: T[], predicate: (item: T) => boolean): number {
	return items.reduce((count, item) => count + (predicate(item) ? 1 : 0), 0);
}

function parsePositiveInt(value: string | string[] | undefined, fallback: number): number {
	const raw = Array.isArray(value) ? value[0] : value;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < 1) return fallback;
	return Math.floor(parsed);
}

function parseReviewFilter(value: string | string[] | undefined): ReviewFilter {
	const raw = Array.isArray(value) ? value[0] : value;
	return REVIEW_FILTER_VALUES.includes((raw ?? "") as ReviewFilter)
		? ((raw ?? "all") as ReviewFilter)
		: "all";
}

function normalizeJudgeScores(value: Record<string, unknown> | null): Record<string, number> {
	if (!value) return {};
	const out: Record<string, number> = {};
	for (const [key, item] of Object.entries(value)) {
		if (typeof item === "number" && Number.isFinite(item)) {
			out[key] = item;
		}
	}
	return out;
}

function toReview(row: EvalReviewRow): DeploymentAgentEvalReview {
	return {
		runId: row.run_id,
		assistantMessageId: row.assistant_message_id,
		userId: row.user_id,
		conversationId: row.conversation_id,
		judgeIntent: isEvalIntent(row.judge_intent) ? row.judge_intent : null,
		judgeHelpfulness: isEvalHelpfulness(row.judge_helpfulness) ? row.judge_helpfulness : null,
		judgePrimaryFailureMode: isEvalFailureMode(row.judge_primary_failure_mode) ? row.judge_primary_failure_mode : null,
		judgeExpectedToolPath: row.judge_expected_tool_path,
		judgeNotes: row.judge_notes,
		judgeScores: normalizeJudgeScores(row.judge_scores),
		judgeModel: row.judge_model,
		judgeProvider: row.judge_provider,
		judgedAt: row.judged_at,
		intent: isEvalIntent(row.intent) ? row.intent : null,
		helpfulness: isEvalHelpfulness(row.helpfulness) ? row.helpfulness : null,
		primaryFailureMode: isEvalFailureMode(row.primary_failure_mode) ? row.primary_failure_mode : null,
		expectedToolPath: row.expected_tool_path,
		notes: row.notes,
		reviewedAt: row.reviewed_at,
		reviewedByEmail: row.reviewed_by_email,
	};
}

function displayHelpfulness(review: DeploymentAgentEvalReview | null): string | null {
	return review?.helpfulness ?? review?.judgeHelpfulness ?? null;
}

function displayIntent(review: DeploymentAgentEvalReview | null, run: DeploymentAgentEvalRun): string {
	return review?.intent ?? review?.judgeIntent ?? run.autoIntent;
}

function displayFailureMode(review: DeploymentAgentEvalReview | null, run: DeploymentAgentEvalRun): string | null {
	return review?.primaryFailureMode ?? review?.judgePrimaryFailureMode ?? run.suggestedFailureMode;
}

function displayExpectedToolPath(review: DeploymentAgentEvalReview | null, run: DeploymentAgentEvalRun): string {
	return review?.expectedToolPath ?? review?.judgeExpectedToolPath ?? run.expectedToolPath;
}

function pageHref(page: number, reviewFilter: ReviewFilter): string {
	const params = new URLSearchParams();
	params.set("page", String(page));
	if (reviewFilter !== "all") {
		params.set("review", reviewFilter);
	}
	return `/admin/agent-evals?${params.toString()}`;
}

function toReviewCount(value: string | number | null | undefined): number {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
	return 0;
}

function reviewFilterClause(reviewFilter: ReviewFilter): string {
	switch (reviewFilter) {
		case "pending":
			return "and review.reviewed_at is null and review.judged_at is null";
		case "reviewed":
			return "and (review.reviewed_at is not null or review.judged_at is not null)";
		default:
			return "";
	}
}

async function loadEvalRunById(runId: string): Promise<DeploymentAgentEvalRun | null> {
	const supabase = getSupabaseServer();
	const { data: assistantRow, error: assistantError } = await supabase
		.from("deployment_agent_messages")
		.select("id,user_id,conversation_id,run_id,role,content,metadata,created_at")
		.eq("run_id", runId)
		.eq("role", "assistant")
		.maybeSingle();
	if (assistantError) {
		throw new Error(assistantError.message);
	}
	if (!assistantRow) {
		return null;
	}

	const { data: userRows, error: userError } = await supabase
		.from("deployment_agent_messages")
		.select("id,user_id,conversation_id,run_id,role,content,metadata,created_at")
		.eq("run_id", runId)
		.eq("role", "user")
		.order("created_at", { ascending: true })
		.limit(1);
	if (userError) {
		throw new Error(userError.message);
	}

	return buildDeploymentAgentEvalRun({
		assistantMessage: assistantRow as AgentMessageRow,
		userMessage: ((userRows ?? []) as AgentMessageRow[])[0]?.content ?? "",
	});
}

async function loadEvalRuns(page: number, reviewFilter: ReviewFilter): Promise<EvalRunsPageData> {
	const from = (page - 1) * PAGE_SIZE;
	const pool = getDbPool();
	const sql = `
		with assistant_runs as (
			select
				assistant.id,
				assistant.user_id,
				assistant.conversation_id,
				assistant.run_id,
				assistant.content,
				assistant.metadata,
				assistant.created_at,
				user_msg.content as user_message,
				review.run_id as review_run_id,
				review.assistant_message_id,
				review.judge_intent,
				review.judge_helpfulness,
				review.judge_primary_failure_mode,
				review.judge_expected_tool_path,
				review.judge_notes,
				review.judge_scores,
				review.judge_model,
				review.judge_provider,
				review.judged_at,
				review.intent,
				review.helpfulness,
				review.primary_failure_mode,
				review.expected_tool_path,
				review.notes,
				review.reviewed_at,
				review.reviewed_by_email,
				count(*) over() as total_count
			from public.deployment_agent_messages assistant
			left join lateral (
				select msg.content
				from public.deployment_agent_messages msg
				where msg.run_id = assistant.run_id
				  and msg.role = 'user'
				order by msg.created_at asc
				limit 1
			) user_msg on true
			left join public.deployment_agent_eval_reviews review
				on review.run_id = assistant.run_id
			where assistant.role = 'assistant'
			${reviewFilterClause(reviewFilter)}
			order by assistant.created_at desc
			limit $1
			offset $2
		)
		select *
		from assistant_runs
		order by created_at desc
	`;
	const result = await pool.query<EvalListingRow>(sql, [PAGE_SIZE, from]);
	const assistants = result.rows;
	const totalCount = assistants.length > 0 ? toReviewCount(assistants[0]?.total_count) : 0;
	const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

	if (assistants.length === 0 && totalCount > 0 && page > pageCount) {
		return loadEvalRuns(pageCount, reviewFilter);
	}

	const reviewsByRunId = new Map<string, DeploymentAgentEvalReview>();
	for (const row of assistants) {
		if (!row.review_run_id) {
			continue;
		}
		reviewsByRunId.set(
			row.run_id,
			toReview({
				run_id: row.run_id,
				assistant_message_id: row.assistant_message_id ?? row.id,
				user_id: row.user_id,
				conversation_id: row.conversation_id,
				judge_intent: row.judge_intent,
				judge_helpfulness: row.judge_helpfulness,
				judge_primary_failure_mode: row.judge_primary_failure_mode,
				judge_expected_tool_path: row.judge_expected_tool_path,
				judge_notes: row.judge_notes,
				judge_scores: row.judge_scores,
				judge_model: row.judge_model,
				judge_provider: row.judge_provider,
				judged_at: row.judged_at,
				intent: row.intent,
				helpfulness: row.helpfulness,
				primary_failure_mode: row.primary_failure_mode,
				expected_tool_path: row.expected_tool_path,
				notes: row.notes,
				reviewed_at: row.reviewed_at,
				reviewed_by_email: row.reviewed_by_email,
			})
		);
	}

	const runs: DeploymentAgentEvalRun[] = [];
	for (const assistant of assistants) {
		runs.push(
			buildDeploymentAgentEvalRun({
				assistantMessage: {
					id: assistant.id,
					user_id: assistant.user_id,
					conversation_id: assistant.conversation_id,
					run_id: assistant.run_id,
					content: assistant.content,
					metadata: assistant.metadata,
					created_at: assistant.created_at,
				},
				userMessage: assistant.user_message ?? "",
			})
		);
	}

	return {
		runs,
		reviewsByRunId,
		totalCount,
		page,
		pageCount,
		reviewFilter,
	};
}

async function saveEvalReview(formData: FormData) {
	"use server";

	const adminUser = await requireAdminSession();
	const runId = String(formData.get("run_id") ?? "").trim();
	const assistantMessageId = String(formData.get("assistant_message_id") ?? "").trim();
	const userId = String(formData.get("user_id") ?? "").trim();
	const conversationId = String(formData.get("conversation_id") ?? "").trim();
	if (!runId || !assistantMessageId || !userId || !conversationId) {
		return;
	}

	const intentValue = String(formData.get("intent") ?? "").trim();
	const helpfulnessValue = String(formData.get("helpfulness") ?? "").trim();
	const primaryFailureModeValue = String(formData.get("primary_failure_mode") ?? "").trim();
	const expectedToolPath = String(formData.get("expected_tool_path") ?? "").trim() || null;
	const notes = String(formData.get("notes") ?? "").trim() || null;

	const intent = isEvalIntent(intentValue) ? intentValue : null;
	const helpfulness = isEvalHelpfulness(helpfulnessValue) ? helpfulnessValue : null;
	const primaryFailureMode = isEvalFailureMode(primaryFailureModeValue) ? primaryFailureModeValue : null;

	const { error } = await getSupabaseServer()
		.from("deployment_agent_eval_reviews")
		.upsert(
			{
				run_id: runId,
				assistant_message_id: assistantMessageId,
				user_id: userId,
				conversation_id: conversationId,
				intent,
				helpfulness,
				primary_failure_mode: primaryFailureMode,
				expected_tool_path: expectedToolPath,
				notes,
				reviewed_at: new Date().toISOString(),
				reviewed_by_user_id: adminUser.id,
				reviewed_by_email: adminUser.email ?? null,
				updated_at: new Date().toISOString(),
			},
			{ onConflict: "run_id" }
		);

	if (error) {
		throw new Error(error.message);
	}

	revalidatePath("/admin/agent-evals");
}

async function autoJudgeEvalRun(formData: FormData) {
	"use server";

	await requireAdminSession();
	const runId = String(formData.get("run_id") ?? "").trim();
	const assistantMessageId = String(formData.get("assistant_message_id") ?? "").trim();
	const userId = String(formData.get("user_id") ?? "").trim();
	const conversationId = String(formData.get("conversation_id") ?? "").trim();
	if (!runId || !assistantMessageId || !userId || !conversationId) {
		return;
	}

	const run = await loadEvalRunById(runId);
	if (!run) {
		throw new Error("Agent run not found");
	}

	const judged = await judgeDeploymentAgentRun({ run });
	const now = new Date().toISOString();
	const { error } = await getSupabaseServer()
		.from("deployment_agent_eval_reviews")
		.upsert(
			{
				run_id: runId,
				assistant_message_id: assistantMessageId,
				user_id: userId,
				conversation_id: conversationId,
				judge_intent: judged.intent,
				judge_helpfulness: judged.helpfulness,
				judge_primary_failure_mode: judged.primaryFailureMode,
				judge_expected_tool_path: judged.expectedToolPath,
				judge_notes: judged.notes,
				judge_scores: {
					correctness: judged.scores.correctness,
					completeness: judged.scores.completeness,
					actionability: judged.scores.actionability,
					toolChoice: judged.scores.toolChoice,
					grounding: judged.scores.grounding,
				},
				judge_model: judged.model,
				judge_provider: judged.provider,
				judged_at: now,
				updated_at: now,
			},
			{ onConflict: "run_id" }
		);

	if (error) {
		throw new Error(error.message);
	}

	revalidatePath("/admin/agent-evals");
}

function SummaryCard({
	title,
	value,
	description,
	icon: Icon,
}: {
	title: string;
	value: string;
	description: string;
	icon: React.ComponentType<{ className?: string }>;
}) {
	return (
		<Card className="rounded-lg border-white/10 bg-card/80">
			<CardContent className="flex items-center gap-4 p-5">
				<span className="flex size-10 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
					<Icon className="size-5" />
				</span>
				<div className="min-w-0">
					<p className="text-xs text-muted-foreground">{title}</p>
					<p className="text-2xl font-semibold">{value}</p>
					<p className="truncate text-xs text-muted-foreground">{description}</p>
				</div>
			</CardContent>
		</Card>
	);
}

function ReviewBadge({ label }: { label: string | null }) {
	return (
		<Badge className={`rounded-md border font-mono text-[11px] ${badgeClassName(label)}`}>
			{label ?? "pending"}
		</Badge>
	);
}

function ScoreStrip({ scores }: { scores: Record<string, number> }) {
	const entries = Object.entries(scores);
	if (entries.length === 0) {
		return null;
	}

	return (
		<div className="flex flex-wrap gap-2">
			{entries.map(([key, value]) => (
				<Badge key={key} className="rounded-md border border-white/10 bg-white/5 font-mono text-[11px] text-muted-foreground">
					{key}:{value}
				</Badge>
			))}
		</div>
	);
}

function AgentEvalsHeader({
	page,
	pageCount,
	reviewFilter,
	totalCount,
}: {
	page: number;
	pageCount: number;
	reviewFilter: ReviewFilter;
	totalCount: number;
}) {
	return (
		<div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
			<div>
				<h1 className="text-2xl font-semibold tracking-normal">Agent Evals</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					Page through deployment-agent runs, auto-judge them with an LLM, and keep manual override available when needed.
				</p>
			</div>
			<Badge className="w-fit rounded-md border border-white/10 bg-white/5 font-mono text-muted-foreground">
				{reviewFilter} | Page {page} of {pageCount} | {totalCount} total runs
			</Badge>
		</div>
	);
}

function AgentEvalsSummary({
	runs,
	reviewedRuns,
	reviewsByRunId,
}: {
	runs: DeploymentAgentEvalRun[];
	reviewedRuns: DeploymentAgentEvalRun[];
	reviewsByRunId: Map<string, DeploymentAgentEvalReview>;
}) {
	const helpfulCount = countWhere(
		reviewedRuns,
		(run) => displayHelpfulness(reviewsByRunId.get(run.runId) ?? null) === "helpful"
	);
	const partialCount = countWhere(
		reviewedRuns,
		(run) => displayHelpfulness(reviewsByRunId.get(run.runId) ?? null) === "partially_helpful"
	);
	const notHelpfulCount = countWhere(
		reviewedRuns,
		(run) => displayHelpfulness(reviewsByRunId.get(run.runId) ?? null) === "not_helpful"
	);
	const judgedCount = countWhere(
		reviewedRuns,
		(run) => Boolean(reviewsByRunId.get(run.runId)?.judgedAt)
	);
	const missingToolSuggestions = countWhere(
		runs,
		(run) => run.suggestedFailureMode === "missing_tool"
	);
	const toolLimitSuggestions = countWhere(
		runs,
		(run) => run.suggestedFailureMode === "tool_limit"
	);

	return (
		<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
			<SummaryCard
				title="Current page"
				value={String(runs.length)}
				description={`Showing ${PAGE_SIZE} per page`}
				icon={Bot}
			/>
			<SummaryCard
				title="Reviewed or judged"
				value={String(reviewedRuns.length)}
				description={`${runs.length - reviewedRuns.length} untouched on this page`}
				icon={ClipboardCheck}
			/>
			<SummaryCard
				title="Helpful"
				value={String(helpfulCount)}
				description={`${partialCount} partial, ${notHelpfulCount} not helpful`}
				icon={Gauge}
			/>
			<SummaryCard
				title="LLM judged"
				value={String(judgedCount)}
				description="Judge results on this page"
				icon={Sparkles}
			/>
			<SummaryCard
				title="Auto tool gaps"
				value={String(missingToolSuggestions)}
				description={`${toolLimitSuggestions} tool-limit suggestions`}
				icon={Wrench}
			/>
		</div>
	);
}

function AgentEvalsToolbar({
	page,
	pageCount,
	reviewFilter,
}: {
	page: number;
	pageCount: number;
	reviewFilter: ReviewFilter;
}) {
	return (
		<div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-card/70 px-4 py-3 text-sm text-muted-foreground lg:flex-row lg:items-center lg:justify-between">
			<div className="flex flex-wrap items-center gap-2">
				<span>Filter:</span>
				{REVIEW_FILTER_VALUES.map((value) =>
					value === reviewFilter ? (
						<Badge key={value} className="rounded-md border border-primary/20 bg-primary/10 font-mono text-primary">
							{value}
						</Badge>
					) : (
						<Button key={value} asChild variant="secondary" size="sm">
							<Link href={pageHref(1, value)}>{value}</Link>
						</Button>
					)
				)}
			</div>
			<div className="flex items-center gap-3 lg:justify-end">
				<span>Use pagination to keep the page responsive. Run auto-judge per row when you want an LLM label.</span>
				<div className="flex items-center gap-2">
					{page <= 1 ? (
						<Button variant="secondary" size="sm" disabled>
							Previous
						</Button>
					) : (
						<Button asChild variant="secondary" size="sm">
							<Link href={pageHref(page - 1, reviewFilter)}>Previous</Link>
						</Button>
					)}
					{page >= pageCount ? (
						<Button variant="secondary" size="sm" disabled>
							Next
						</Button>
					) : (
						<Button asChild variant="secondary" size="sm">
							<Link href={pageHref(page + 1, reviewFilter)}>Next</Link>
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}

function AgentEvalRunCard({
	review,
	run,
}: {
	review: DeploymentAgentEvalReview | null;
	run: DeploymentAgentEvalRun;
}) {
	return (
		<Card className="rounded-lg border-white/10 bg-card/80">
			<CardHeader className="border-b border-white/10">
				<div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
					<div className="space-y-2">
						<div className="flex flex-wrap items-center gap-2">
							<ReviewBadge label={displayHelpfulness(review)} />
							<ReviewBadge label={displayIntent(review, run)} />
							<ReviewBadge label={displayFailureMode(review, run)} />
							<ReviewBadge label={run.outcome} />
						</div>
						<CardTitle className="text-base">
							{run.userMessage || "User message missing from persisted run"}
						</CardTitle>
						<CardDescription>
							{formatDateTime(run.createdAt)} | {run.model ?? "unknown model"} | {run.provider ?? "unknown provider"}
						</CardDescription>
					</div>
					<div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2 lg:min-w-[22rem]">
						<div>
							<div className="text-[11px] uppercase tracking-wide text-muted-foreground">Repo / service</div>
							<div className="font-mono text-xs text-foreground">
								{run.resolvedRepoName ?? "?"} / {run.resolvedServiceName ?? "?"}
							</div>
						</div>
						<div>
							<div className="text-[11px] uppercase tracking-wide text-muted-foreground">Tool path</div>
							<div className="font-mono text-xs text-foreground">{run.actualToolPath || "direct answer"}</div>
						</div>
						<div>
							<div className="text-[11px] uppercase tracking-wide text-muted-foreground">Duration</div>
							<div className="font-mono text-xs text-foreground">{formatDurationMs(run.durationMs)}</div>
						</div>
						<div>
							<div className="text-[11px] uppercase tracking-wide text-muted-foreground">Tokens</div>
							<div className="font-mono text-xs text-foreground">{formatTokenTotal(run.tokenTotal)}</div>
						</div>
					</div>
				</div>
			</CardHeader>
			<CardContent className="space-y-5 pt-6">
				<div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(20rem,1fr)]">
					<div className="space-y-4">
						<div className="rounded-lg border border-white/10 bg-black/20 p-4">
							<div className="text-[11px] uppercase tracking-wide text-muted-foreground">Assistant answer</div>
							<p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{run.assistantMessage}</p>
						</div>
						<div className="grid gap-3 sm:grid-cols-2">
							<div className="rounded-lg border border-white/10 bg-black/20 p-4">
								<div className="text-[11px] uppercase tracking-wide text-muted-foreground">Expected tool path</div>
								<div className="mt-2 font-mono text-xs text-foreground">
									{displayExpectedToolPath(review, run)}
								</div>
							</div>
							<div className="rounded-lg border border-white/10 bg-black/20 p-4">
								<div className="text-[11px] uppercase tracking-wide text-muted-foreground">Prompt turns / tool calls</div>
								<div className="mt-2 font-mono text-xs text-foreground">
									{run.promptTurnCount ?? "-"} / {run.toolCallsUsed}
								</div>
							</div>
						</div>
						{review?.judgedAt ? (
							<div className="rounded-lg border border-sky-400/20 bg-sky-400/5 p-4">
								<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
									<div className="text-[11px] uppercase tracking-wide text-muted-foreground">LLM judge</div>
									<div className="text-xs text-muted-foreground">
										{formatDateTime(review.judgedAt)} | {review.judgeModel ?? "unknown model"} | {review.judgeProvider ?? "unknown provider"}
									</div>
								</div>
								<p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
									{review.judgeNotes ?? "Judge completed with no notes."}
								</p>
								<div className="mt-3">
									<ScoreStrip scores={review.judgeScores} />
								</div>
							</div>
						) : null}
						<details className="rounded-lg border border-white/10 bg-black/20 p-4">
							<summary className="cursor-pointer text-sm font-medium text-foreground">
								Tool result payloads
							</summary>
							<pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-md bg-black/30 p-3 text-xs text-muted-foreground">
								{JSON.stringify(run.toolResults, null, 2)}
							</pre>
						</details>
					</div>

					<div className="space-y-4">
						<form action={autoJudgeEvalRun} className="rounded-lg border border-sky-400/20 bg-sky-400/5 p-4">
							<input type="hidden" name="run_id" value={run.runId} />
							<input type="hidden" name="assistant_message_id" value={run.assistantMessageId} />
							<input type="hidden" name="user_id" value={run.userId} />
							<input type="hidden" name="conversation_id" value={run.conversationId} />
							<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
								<div>
									<div className="text-sm font-medium text-foreground">LLM as judge</div>
									<p className="text-xs text-muted-foreground">
										Run an automated eval for this response and store structured judge output.
									</p>
								</div>
								<Button type="submit" size="sm" className="gap-2">
									<Sparkles className="size-4" />
									Auto-judge
								</Button>
							</div>
						</form>

						<form action={saveEvalReview} className="space-y-4 rounded-lg border border-white/10 bg-black/20 p-4">
							<input type="hidden" name="run_id" value={run.runId} />
							<input type="hidden" name="assistant_message_id" value={run.assistantMessageId} />
							<input type="hidden" name="user_id" value={run.userId} />
							<input type="hidden" name="conversation_id" value={run.conversationId} />

							<div className="space-y-1">
								<div className="text-[11px] uppercase tracking-wide text-muted-foreground">Intent</div>
								<select
									name="intent"
									defaultValue={review?.intent ?? review?.judgeIntent ?? run.autoIntent}
									className="border-input bg-background/70 flex h-10 w-full rounded-md border px-3 text-sm text-foreground"
								>
									{DEPLOYMENT_AGENT_EVAL_INTENTS.map((intent) => (
										<option key={intent} value={intent}>
											{intent}
										</option>
									))}
								</select>
							</div>

							<div className="space-y-1">
								<div className="text-[11px] uppercase tracking-wide text-muted-foreground">Helpfulness</div>
								<select
									name="helpfulness"
									defaultValue={review?.helpfulness ?? review?.judgeHelpfulness ?? ""}
									className="border-input bg-background/70 flex h-10 w-full rounded-md border px-3 text-sm text-foreground"
								>
									<option value="">Unreviewed</option>
									{DEPLOYMENT_AGENT_EVAL_HELPFULNESS.map((value) => (
										<option key={value} value={value}>
											{value}
										</option>
									))}
								</select>
							</div>

							<div className="space-y-1">
								<div className="text-[11px] uppercase tracking-wide text-muted-foreground">Primary failure mode</div>
								<select
									name="primary_failure_mode"
									defaultValue={review?.primaryFailureMode ?? review?.judgePrimaryFailureMode ?? run.suggestedFailureMode ?? ""}
									className="border-input bg-background/70 flex h-10 w-full rounded-md border px-3 text-sm text-foreground"
								>
									<option value="">None</option>
									{DEPLOYMENT_AGENT_EVAL_FAILURE_MODES.map((value) => (
										<option key={value} value={value}>
											{value}
										</option>
									))}
								</select>
							</div>

							<div className="space-y-1">
								<div className="text-[11px] uppercase tracking-wide text-muted-foreground">Expected tool path</div>
								<Input
									name="expected_tool_path"
									defaultValue={displayExpectedToolPath(review, run)}
									className="bg-background/70"
								/>
							</div>

							<div className="space-y-1">
								<div className="text-[11px] uppercase tracking-wide text-muted-foreground">Notes</div>
								<Textarea
									name="notes"
									defaultValue={review?.notes ?? review?.judgeNotes ?? ""}
									className="min-h-28 bg-background/70"
									placeholder="Optional manual override notes"
								/>
							</div>

							<div className="flex items-center justify-between gap-3">
								<div className="text-xs text-muted-foreground">
									{review?.reviewedAt
										? `Manual review ${formatDateTime(review.reviewedAt)}${review.reviewedByEmail ? ` by ${review.reviewedByEmail}` : ""}`
										: "No manual override yet"}
								</div>
								<Button type="submit" size="sm">
									Save manual override
								</Button>
							</div>
						</form>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}

function AgentEvalsContent({
	runs,
	reviewsByRunId,
}: {
	runs: DeploymentAgentEvalRun[];
	reviewsByRunId: Map<string, DeploymentAgentEvalReview>;
}) {
	if (runs.length === 0) {
		return (
			<Card className="rounded-lg border-white/10 bg-card/80">
				<CardContent className="p-8 text-sm text-muted-foreground">
					No deployment-agent assistant runs found yet.
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="grid gap-5">
			{runs.map((run) => (
				<AgentEvalRunCard
					key={run.runId}
					review={reviewsByRunId.get(run.runId) ?? null}
					run={run}
				/>
			))}
		</div>
	);
}

export default async function AdminAgentEvalsPage({ searchParams }: AgentEvalsPageProps) {
	await requireAdminSession();
	const params = searchParams ? await searchParams : {};
	const requestedPage = parsePositiveInt(params.page, 1);
	const reviewFilter = parseReviewFilter(params.review);
	const { runs, reviewsByRunId, totalCount, pageCount, page } = await loadEvalRuns(requestedPage, reviewFilter);
	const reviewedRuns = runs.filter((run) => reviewsByRunId.has(run.runId));

	return (
		<section className="space-y-5">
			<AgentEvalsHeader
				page={page}
				pageCount={pageCount}
				reviewFilter={reviewFilter}
				totalCount={totalCount}
			/>
			<AgentEvalsSummary
				runs={runs}
				reviewedRuns={reviewedRuns}
				reviewsByRunId={reviewsByRunId}
			/>
			<AgentEvalsToolbar
				page={page}
				pageCount={pageCount}
				reviewFilter={reviewFilter}
			/>
			<AgentEvalsContent
				runs={runs}
				reviewsByRunId={reviewsByRunId}
			/>
		</section>
	);
}
