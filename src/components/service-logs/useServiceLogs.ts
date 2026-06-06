"use client";

import React from "react";
import {
	buildLogExportLines,
	combineLogs,
	filterLogs,
	findFirstErrorIndex,
	getLogMessage,
	limitLogs,
	logKey,
	PAGE_SIZE,
	persistKeywordRules,
} from "@/components/service-logs/serviceLogsUtils";
import {
	createInitialServiceLogsState,
	serviceLogsReducer,
	type ServiceLogsState,
} from "@/components/service-logs/serviceLogsState";
import type { LogEntry } from "@/components/service-logs/types";

type UseServiceLogsParams = {
	logs: LogEntry[];
	serviceName?: string;
	repoName?: string;
	displayLimit?: number;
};

export function useServiceLogs({ logs, serviceName, repoName, displayLimit }: UseServiceLogsParams) {
	const logScopeKey = `${repoName ?? ""}:${serviceName ?? ""}`;

	const [state, dispatch] = React.useReducer(
		serviceLogsReducer,
		logScopeKey,
		createInitialServiceLogsState
	);

	const containerRef = React.useRef<HTMLDivElement>(null);
	const prevLogsLengthRef = React.useRef(0);
	const shouldAutoScrollRef = React.useRef(true);
	const extraHistoryRef = React.useRef<LogEntry[]>([]);
	const logsRef = React.useRef<LogEntry[]>(logs);
	const hasMoreHistoryRef = React.useRef(true);
	const isLoadingHistoryRef = React.useRef(false);

	const extraHistory = React.useMemo(
		() => (state.logListState.scopeKey === logScopeKey ? state.logListState.extraHistory : []),
		[state.logListState, logScopeKey]
	);
	const hasMoreHistory = state.logListState.scopeKey === logScopeKey ? state.logListState.hasMoreHistory : true;
	const visiblePages = state.logListState.scopeKey === logScopeKey ? state.logListState.visiblePages : 1;

	const updateLogListState = React.useCallback(
		(updater: (current: ServiceLogsState["logListState"]) => ServiceLogsState["logListState"]) => {
			dispatch({ type: "update_log_list_state", updater, scopeKey: logScopeKey });
		},
		[logScopeKey]
	);

	React.useLayoutEffect(() => {
		logsRef.current = logs;
		extraHistoryRef.current = extraHistory;
		hasMoreHistoryRef.current = hasMoreHistory;
	}, [logs, extraHistory, hasMoreHistory]);

	const combinedLogs = React.useMemo(() => combineLogs(extraHistory, logs), [extraHistory, logs]);

	const limitedLogs = React.useMemo(
		() => limitLogs(combinedLogs, displayLimit, visiblePages),
		[combinedLogs, displayLimit, visiblePages]
	);

	const filteredLogs = React.useMemo(
		() => filterLogs(limitedLogs, state.logFilter, state.keywordRules),
		[limitedLogs, state.logFilter, state.keywordRules]
	);

	const firstErrorIndex = React.useMemo(() => findFirstErrorIndex(filteredLogs), [filteredLogs]);

	const canLoadMorePages = React.useMemo(() => {
		if (!displayLimit || displayLimit <= 0) return false;
		const visibleCount = displayLimit * visiblePages;
		return combinedLogs.length > visibleCount || hasMoreHistory;
	}, [combinedLogs.length, displayLimit, hasMoreHistory, visiblePages]);

	const addKeywordRule = React.useCallback(() => {
		const trimmed = state.ruleInput.trim();
		if (!trimmed) return;
		if (
			state.keywordRules.some(
				(r) => r.keyword.toLowerCase() === trimmed.toLowerCase() && r.mode === state.ruleMode
			)
		) {
			return;
		}
		const next = [...state.keywordRules, { mode: state.ruleMode, keyword: trimmed }];
		persistKeywordRules(next);
		dispatch({ type: "set_keyword_rules", value: next });
		dispatch({ type: "set_rule_input", value: "" });
	}, [state.keywordRules, state.ruleInput, state.ruleMode]);

	const removeKeywordRule = React.useCallback(
		(index: number) => {
			const next = state.keywordRules.filter((_, i) => i !== index);
			persistKeywordRules(next);
			dispatch({ type: "set_keyword_rules", value: next });
		},
		[state.keywordRules]
	);

	const clearKeywordRules = React.useCallback(() => {
		persistKeywordRules([]);
		dispatch({ type: "set_keyword_rules", value: [] });
	}, []);

	const handleExportLogs = React.useCallback(() => {
		if (logs.length === 0) return;
		const exportedAt = new Date();
		const contextLabel = serviceName || repoName || "deployment";
		const safeContext = contextLabel.replace(/[^a-zA-Z0-9-_]+/g, "-");
		const fileName = `smartdeploy-logs-${safeContext}-${exportedAt.toISOString().replace(/[:.]/g, "-")}.txt`;

		const lines = buildLogExportLines(logs);

		const header = [
			`SmartDeploy Logs Export`,
			`Context: ${contextLabel}`,
			`Exported at: ${exportedAt.toISOString()}`,
			`Filter: ${state.logFilter}`,
			`Total lines: ${logs.length}`,
			"",
		];

		const blob = new Blob([header.join("\n") + lines.join("\n")], { type: "text/plain;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = fileName;
		document.body.appendChild(link);
		link.click();
		link.remove();
		URL.revokeObjectURL(url);
	}, [logs, repoName, serviceName, state.logFilter]);

	const jumpToFirstError = React.useCallback(() => {
		if (firstErrorIndex < 0) return;
		const viewport = containerRef.current?.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]');
		if (!viewport) return;
		const rows = viewport.querySelectorAll("[data-log-row]");
		const row = rows[firstErrorIndex] as HTMLElement | undefined;
		if (row) {
			row.scrollIntoView({ behavior: "smooth", block: "center" });
			row.classList.add("ring-1", "ring-destructive/50");
			setTimeout(() => row.classList.remove("ring-1", "ring-destructive/50"), 2000);
		}
	}, [firstErrorIndex]);

	const handleScrollToBottom = React.useCallback(() => {
		const viewport = containerRef.current?.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]');
		if (!viewport) return;

		viewport.scrollTop = viewport.scrollHeight;
		shouldAutoScrollRef.current = true;
		dispatch({ type: "set_show_scroll_to_bottom", value: false });
	}, []);

	const loadMoreOlderLogs = React.useCallback(async () => {
		if (!serviceName) return;
		if (!hasMoreHistoryRef.current) return;
		if (isLoadingHistoryRef.current) return;

		const viewport = containerRef.current?.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]');
		if (!viewport) return;

		isLoadingHistoryRef.current = true;
		dispatch({ type: "set_is_loading_older_logs", value: true });

		const prevScrollTop = viewport.scrollTop;
		const prevScrollHeight = viewport.scrollHeight;

		const loadedTotal = logsRef.current.length + extraHistoryRef.current.length;
		const desiredLimit = Math.min(loadedTotal + PAGE_SIZE, 5000);

		try {
			const res = await fetch(
				`/api/service-logs-history?repoName=${encodeURIComponent(repoName ?? "")}&serviceName=${encodeURIComponent(
					serviceName
				)}&limit=${encodeURIComponent(String(desiredLimit))}`
			);
			if (!res.ok) return;

			const data = await res.json();
			const fetchedLogs: LogEntry[] = Array.isArray(data?.logs) ? data.logs : [];

			const existingCombinedLogs = [...extraHistoryRef.current, ...logsRef.current];
			const existingKeys = new Set(existingCombinedLogs.map(logKey));

			const newOlderLogs = fetchedLogs.filter((l) => !existingKeys.has(logKey(l)));

			if (newOlderLogs.length > 0) {
				updateLogListState((current) => ({
					...current,
					extraHistory: [...newOlderLogs, ...current.extraHistory],
				}));
			}

			if (fetchedLogs.length < desiredLimit) {
				updateLogListState((current) => ({ ...current, hasMoreHistory: false }));
			} else if (desiredLimit >= 5000 && newOlderLogs.length === 0) {
				updateLogListState((current) => ({ ...current, hasMoreHistory: false }));
			}

			requestAnimationFrame(() => {
				const v = containerRef.current?.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]');
				if (!v) return;
				const delta = v.scrollHeight - prevScrollHeight;
				v.scrollTop = prevScrollTop + delta;

				const thresholdPx = 40;
				const distanceFromBottom = v.scrollHeight - v.scrollTop - v.clientHeight;
				shouldAutoScrollRef.current = distanceFromBottom <= thresholdPx;
				dispatch({ type: "set_show_scroll_to_bottom", value: distanceFromBottom > thresholdPx });
			});
		} catch {
			// ignore pagination errors; live logs should still work
		} finally {
			isLoadingHistoryRef.current = false;
			dispatch({ type: "set_is_loading_older_logs", value: false });
		}
	}, [repoName, serviceName, updateLogListState]);

	const handleLoadNextPage = React.useCallback(async () => {
		if (!displayLimit || displayLimit <= 0) return;

		const nextPages = visiblePages + 1;
		const nextVisibleCount = nextPages * displayLimit;
		updateLogListState((current) => ({ ...current, visiblePages: nextPages }));

		if (combinedLogs.length >= nextVisibleCount) return;
		if (!serviceName) return;
		if (!hasMoreHistoryRef.current) return;
		await loadMoreOlderLogs();
	}, [combinedLogs.length, displayLimit, loadMoreOlderLogs, serviceName, updateLogListState, visiblePages]);

	React.useEffect(() => {
		const container = containerRef.current;
		const viewport = container?.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]');
		if (!viewport) return;

		const updateAutoScrollState = () => {
			const thresholdPx = 40;
			const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
			shouldAutoScrollRef.current = distanceFromBottom <= thresholdPx;
			dispatch({ type: "set_show_scroll_to_bottom", value: distanceFromBottom > thresholdPx });
		};

		updateAutoScrollState();
		viewport.addEventListener("scroll", updateAutoScrollState, { passive: true });
		return () => viewport.removeEventListener("scroll", updateAutoScrollState);
	}, []);

	React.useEffect(() => {
		const previousLength = prevLogsLengthRef.current;
		const currentLength = logs.length;

		if (currentLength > previousLength && shouldAutoScrollRef.current) {
			const viewport = containerRef.current?.querySelector<HTMLDivElement>(
				'[data-slot="scroll-area-viewport"]'
			);

			if (viewport) {
				viewport.scrollTop = viewport.scrollHeight;
			}
		}

		prevLogsLengthRef.current = currentLength;
	}, [logs.length]);

	React.useEffect(() => {
		const viewport = containerRef.current?.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]');
		if (!viewport) return;
		if (!serviceName) return;
		if (displayLimit && displayLimit > 0) return;

		const onScroll = () => {
			if (viewport.scrollTop <= 20) {
				void loadMoreOlderLogs();
			}
		};

		viewport.addEventListener("scroll", onScroll, { passive: true });
		return () => viewport.removeEventListener("scroll", onScroll);
	}, [displayLimit, loadMoreOlderLogs, serviceName]);

	return {
		containerRef,
		state,
		dispatch,
		combinedLogs,
		limitedLogs,
		filteredLogs,
		firstErrorIndex,
		canLoadMorePages,
		displayLimit,
		addKeywordRule,
		removeKeywordRule,
		clearKeywordRules,
		handleExportLogs,
		jumpToFirstError,
		handleScrollToBottom,
		handleLoadNextPage,
	};
}
