"use client";

import { ScrollArea } from "./ui/scroll-area";
import { ServiceLogsDetailDialog } from "@/components/service-logs/ServiceLogsDetailDialog";
import { ServiceLogsEmptyState } from "@/components/service-logs/ServiceLogsEmptyState";
import { ServiceLogsList } from "@/components/service-logs/ServiceLogsList";
import { ServiceLogsLoadingIndicator } from "@/components/service-logs/ServiceLogsLoadingIndicator";
import { ServiceLogsScrollButton } from "@/components/service-logs/ServiceLogsScrollButton";
import { ServiceLogsToolbar } from "@/components/service-logs/ServiceLogsToolbar";
import type { ServiceLogsProps } from "@/components/service-logs/types";
import { useServiceLogs } from "@/components/service-logs/useServiceLogs";

export default function ServiceLogs({
	logs,
	serviceName,
	repoName,
	deployStatus,
	displayLimit,
	scrollable = true,
}: ServiceLogsProps) {
	const {
		containerRef,
		state,
		dispatch,
		combinedLogs,
		limitedLogs,
		filteredLogs,
		firstErrorIndex,
		canLoadMorePages,
		addKeywordRule,
		removeKeywordRule,
		clearKeywordRules,
		handleExportLogs,
		jumpToFirstError,
		handleScrollToBottom,
		handleLoadNextPage,
	} = useServiceLogs({ logs, serviceName, repoName, displayLimit });

	return (
		<>
			<div
				ref={containerRef}
				className={`relative ${scrollable ? "flex h-full min-h-0 flex-1 flex-col overflow-hidden" : ""}`}
			>
				<ServiceLogsLoadingIndicator visible={state.isLoadingOlderLogs} />

				<ServiceLogsToolbar
					displayLimit={displayLimit}
					canLoadMorePages={canLoadMorePages}
					isLoadingOlderLogs={state.isLoadingOlderLogs}
					onLoadNextPage={() => void handleLoadNextPage()}
					logFilter={state.logFilter}
					firstErrorIndex={firstErrorIndex}
					onLogFilterChange={(filter) => dispatch({ type: "set_log_filter", value: filter })}
					filteredLogsCount={filteredLogs.length}
					onExportLogs={handleExportLogs}
					onJumpToFirstError={jumpToFirstError}
					showFilterInput={state.showFilterInput}
					keywordRules={state.keywordRules}
					onToggleFilterInput={() => dispatch({ type: "toggle_show_filter_input" })}
					ruleMode={state.ruleMode}
					onRuleModeChange={(mode) => dispatch({ type: "set_rule_mode", value: mode })}
					ruleInput={state.ruleInput}
					onRuleInputChange={(value) => dispatch({ type: "set_rule_input", value })}
					onAddKeywordRule={addKeywordRule}
					onRemoveKeywordRule={removeKeywordRule}
					onClearKeywordRules={clearKeywordRules}
				/>

				<ScrollArea
					className={`${scrollable ? "overflow-y-auto h-[500px]" : "h-auto"} w-full rounded-md border border-border bg-card`}
					data-logs-scroll
				>
					<div className="min-w-full font-mono text-sm text-muted-foreground">
						{filteredLogs.length === 0 ? (
							<ServiceLogsEmptyState combinedLogsCount={combinedLogs.length} deployStatus={deployStatus} />
						) : (
							<ServiceLogsList
								logs={filteredLogs}
								onSelectLog={(log) => dispatch({ type: "set_selected_log", value: log })}
							/>
						)}
					</div>
				</ScrollArea>

				{scrollable && state.showScrollToBottom && limitedLogs.length > 0 && (
					<ServiceLogsScrollButton onScrollToBottom={handleScrollToBottom} />
				)}
			</div>

			<ServiceLogsDetailDialog
				selectedLog={state.selectedLog}
				onClose={() => dispatch({ type: "set_selected_log", value: null })}
			/>
		</>
	);
}
