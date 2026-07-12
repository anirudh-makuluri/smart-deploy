import { ChevronUp, Download, Minus, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LogFilter, KeywordRule } from "@/components/service-logs/types";

type ServiceLogsToolbarProps = {
	displayLimit?: number;
	canLoadMorePages: boolean;
	isLoadingOlderLogs: boolean;
	onLoadNextPage: () => void;
	logFilter: LogFilter;
	firstErrorIndex: number;
	onLogFilterChange: (filter: LogFilter) => void;
	filteredLogsCount: number;
	onExportLogs: () => void;
	onJumpToFirstError: () => void;
	showFilterInput: boolean;
	keywordRules: KeywordRule[];
	onToggleFilterInput: () => void;
	ruleMode: "include" | "exclude";
	onRuleModeChange: (mode: "include" | "exclude") => void;
	ruleInput: string;
	onRuleInputChange: (value: string) => void;
	onAddKeywordRule: () => void;
	onRemoveKeywordRule: (index: number) => void;
	onClearKeywordRules: () => void;
};

const LOG_FILTERS: LogFilter[] = ["ALL", "ERROR", "WARN", "BUILD", "DEPLOY"];

export function ServiceLogsToolbar({
	displayLimit,
	canLoadMorePages,
	isLoadingOlderLogs,
	onLoadNextPage,
	logFilter,
	firstErrorIndex,
	onLogFilterChange,
	filteredLogsCount,
	onExportLogs,
	onJumpToFirstError,
	showFilterInput,
	keywordRules,
	onToggleFilterInput,
	ruleMode,
	onRuleModeChange,
	ruleInput,
	onRuleInputChange,
	onAddKeywordRule,
	onRemoveKeywordRule,
	onClearKeywordRules,
}: ServiceLogsToolbarProps) {
	return (
		<div className="flex min-w-0 flex-col border-b border-border/40 bg-card/80">
			<div className="flex flex-wrap items-center gap-2 px-3 py-2">
				{displayLimit && displayLimit > 0 && (
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="h-7 gap-1.5 text-xs"
						onClick={() => void onLoadNextPage()}
						disabled={!canLoadMorePages || isLoadingOlderLogs}
						title={canLoadMorePages ? "Load next logs page" : "No more logs"}
					>
						<ChevronUp className="size-3.5" />
						Next logs
					</Button>
				)}
				{LOG_FILTERS.map((f) => (
					<button
						key={f}
						type="button"
						className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
							logFilter === f
								? "bg-primary/15 text-primary border border-primary/30"
								: "text-muted-foreground hover:bg-muted/40 border border-transparent"
						}`}
						onClick={() => onLogFilterChange(f)}
					>
						{f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()}
						{f === "ERROR" && firstErrorIndex >= 0 && <span className="ml-1 text-destructive">!</span>}
					</button>
				))}

				<div className="flex flex-wrap items-center gap-2 sm:ml-auto">
					<button
						type="button"
						className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
							filteredLogsCount > 0
								? "text-muted-foreground hover:bg-muted/40 border border-transparent"
								: "text-muted-foreground/50 border border-transparent cursor-not-allowed"
						}`}
						onClick={onExportLogs}
						disabled={filteredLogsCount === 0}
						title={filteredLogsCount === 0 ? "No logs to export" : "Export logs"}
					>
						<Download className="size-3" />
						Export
					</button>
					{firstErrorIndex >= 0 && (
						<button
							type="button"
							className="px-2.5 py-1 rounded-md text-xs font-medium text-destructive hover:bg-destructive/10 border border-destructive/30 transition-colors"
							onClick={onJumpToFirstError}
						>
							Jump to error
						</button>
					)}
					<button
						type="button"
						className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
							showFilterInput || keywordRules.length > 0
								? "bg-primary/15 text-primary border border-primary/30"
								: "text-muted-foreground hover:bg-muted/40 border border-transparent"
						}`}
						onClick={onToggleFilterInput}
					>
						<Search className="size-3" />
						Filter
						{keywordRules.length > 0 && (
							<span className="ml-1 px-1.5 py-0.5 rounded-full bg-primary/20 text-[10px] font-bold">
								{keywordRules.length}
							</span>
						)}
					</button>
				</div>
			</div>

			{showFilterInput && (
				<div className="space-y-2 px-3 pb-2">
					<div className="flex flex-wrap items-center gap-2">
						<button
							type="button"
							className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
								ruleMode === "exclude"
									? "bg-destructive/15 text-destructive border border-destructive/30"
									: "text-muted-foreground hover:bg-muted/40 border border-transparent"
							}`}
							onClick={() => onRuleModeChange("exclude")}
						>
							<Minus className="size-3" />
							Exclude
						</button>
						<button
							type="button"
							className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
								ruleMode === "include"
									? "bg-emerald-500/15 text-emerald-500 border border-emerald-500/30"
									: "text-muted-foreground hover:bg-muted/40 border border-transparent"
							}`}
							onClick={() => onRuleModeChange("include")}
						>
							<Plus className="size-3" />
							Include
						</button>
						<input
							type="text"
							className="min-w-0 flex-1 basis-40 bg-background/60 border border-border/50 rounded-md px-2.5 py-1 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
							placeholder={ruleMode === "exclude" ? "Keyword to hide..." : "Keyword to show..."}
							value={ruleInput}
							onChange={(e) => onRuleInputChange(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") onAddKeywordRule();
							}}
							aria-label={ruleMode === "exclude" ? "Keyword to hide from logs" : "Keyword to include in logs"}
						/>
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="h-7 px-2.5 text-xs"
							onClick={onAddKeywordRule}
							disabled={!ruleInput.trim()}
						>
							Add
						</Button>
					</div>
					{keywordRules.length > 0 && (
						<div className="flex flex-wrap gap-1.5">
							{keywordRules.map((rule, i) => (
								<span
									key={`${rule.mode}-${rule.keyword}`}
									className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
										rule.mode === "exclude"
											? "bg-destructive/10 text-destructive border border-destructive/20"
											: "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
									}`}
								>
									{rule.mode === "exclude" ? "−" : "+"} {rule.keyword}
									<button
										type="button"
										aria-label={`Remove keyword filter ${rule.keyword}`}
										className="hover:opacity-70"
										onClick={() => onRemoveKeywordRule(i)}
									>
										<X className="size-3" />
									</button>
								</span>
							))}
							<button
								type="button"
								className="text-[11px] text-muted-foreground hover:text-foreground transition-colors px-1"
								onClick={onClearKeywordRules}
							>
								Clear all
							</button>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
