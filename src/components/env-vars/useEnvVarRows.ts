"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";

export interface EnvVarEntry { name: string; value: string }
interface EnvVarRow { id: string; entry: EnvVarEntry }
interface RowState { entries: EnvVarEntry[]; rows: EnvVarRow[]; nextId: number }

function uniqueNames(rows: EnvVarRow[]): Map<string, EnvVarRow | null> {
	const names = new Map<string, EnvVarRow | null>();
	for (const row of rows) {
		if (row.entry.name) names.set(row.entry.name, names.has(row.entry.name) ? null : row);
	}
	return names;
}

function reconcileRows(previous: RowState, entries: EnvVarEntry[], prefix: string): RowState {
	const byEntry = new Map(previous.rows.map((row) => [row.entry, row]));
	const byName = uniqueNames(previous.rows);
	const counts = new Map<string, number>();
	for (const entry of entries) counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1);
	const assigned = new Set<string>();
	let nextId = previous.nextId;
	const rows = entries.map((entry) => {
		const matched = byEntry.get(entry) ?? (counts.get(entry.name) === 1 ? byName.get(entry.name) : null);
		const id = matched && !assigned.has(matched.id) ? matched.id : `${prefix}-env-${nextId++}`;
		assigned.add(id);
		return { id, entry };
	});
	return { entries, rows, nextId };
}

export function useEnvVarRows(entries: EnvVarEntry[], onEntriesChange: (entries: EnvVarEntry[]) => void) {
	const prefix = useId();
	const [state, setState] = useState<RowState>(() => reconcileRows({ entries: [], rows: [], nextId: 0 }, entries, prefix));
	const current = state.entries === entries ? state : reconcileRows(state, entries, prefix);
	// Reconcile externally loaded/reordered entries before committing DOM. An
	// Effect would first commit stale identities and move focus/reveal state.
	if (current !== state) setState(current);
	const latest = useRef(current);
	// FileReader completes outside React; its callback must merge into the
	// committed editor state, including edits made while the file was reading.
	useLayoutEffect(() => { latest.current = current; }, [current]);

	function commit(rows: EnvVarRow[], nextId = current.nextId) {
		const nextEntries = rows.map((row) => row.entry);
		const next = { entries: nextEntries, rows, nextId };
		latest.current = next;
		setState(next);
		onEntriesChange(nextEntries);
	}
	function addRow() {
		commit([...current.rows, { id: `${prefix}-env-${current.nextId}`, entry: { name: "", value: "" } }], current.nextId + 1);
	}
	function removeRow(id: string) {
		commit(current.rows.filter((row) => row.id !== id));
	}
	function updateRow(id: string, field: keyof EnvVarEntry, value: string) {
		const normalized = field === "name" ? value.toUpperCase().replace(/[^A-Z0-9_]/g, "") : value;
		commit(current.rows.map((row) => row.id === id ? { ...row, entry: { ...row.entry, [field]: normalized } } : row));
	}
	function replaceEntries(nextEntries: EnvVarEntry[]) {
		const next = reconcileRows(current, nextEntries, prefix);
		commit(next.rows, next.nextId);
	}
	function mergeEntries(imported: EnvVarEntry[]) {
		const snapshot = latest.current;
		const byName = new Map<string, string>();
		for (const entry of [...snapshot.entries, ...imported]) {
			if (entry.name) byName.set(entry.name, entry.value);
		}
		const entries = Array.from(byName, ([name, value]) => ({ name, value }));
		const next = reconcileRows(snapshot, entries, prefix);
		commit(next.rows, next.nextId);
	}
	return { rows: current.rows, addRow, removeRow, updateRow, replaceEntries, mergeEntries };
}
