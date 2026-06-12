"use client";

import * as React from "react";
import { ArrowDownAZ, ArrowUpAZ, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type AdminScalar = string | number | boolean | null;

export type AdminTableColumn = {
	key: string;
	label: string;
	tone?: "default" | "status" | "mono" | "long";
};

type AdminDataTableProps = {
	columns: AdminTableColumn[];
	rows: Record<string, AdminScalar>[];
	emptyMessage: string;
	initialSort?: string;
};

function valueText(value: AdminScalar): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "boolean") return value ? "true" : "false";
	return String(value);
}

function compareValues(a: AdminScalar, b: AdminScalar) {
	if (typeof a === "number" && typeof b === "number") return a - b;
	const dateA = Date.parse(valueText(a));
	const dateB = Date.parse(valueText(b));
	if (Number.isFinite(dateA) && Number.isFinite(dateB)) return dateA - dateB;
	return valueText(a).localeCompare(valueText(b), undefined, { numeric: true, sensitivity: "base" });
}

function StatusValue({ value }: { value: AdminScalar }) {
	const text = valueText(value) || "empty";
	const normalized = text.toLowerCase();
	const className =
		normalized.includes("success") || normalized.includes("healthy") || normalized === "running"
			? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
			: normalized.includes("fail") || normalized.includes("unavailable") || normalized.includes("error")
				? "border-red-400/30 bg-red-400/10 text-red-200"
				: normalized.includes("new") || normalized.includes("pending")
					? "border-sky-400/30 bg-sky-400/10 text-sky-200"
					: "border-white/10 bg-white/5 text-muted-foreground";
	return <Badge className={cn("rounded-md border font-mono text-[11px]", className)}>{text}</Badge>;
}

function CellValue({ column, value }: { column: AdminTableColumn; value: AdminScalar }) {
	if (column.tone === "status") return <StatusValue value={value} />;
	const text = valueText(value);
	if (!text) return <span className="text-muted-foreground/50">-</span>;
	if (column.tone === "long") {
		return <span className="block max-w-[28rem] truncate whitespace-nowrap text-muted-foreground">{text}</span>;
	}
	return (
		<span className={cn(column.tone === "mono" && "font-mono text-xs text-muted-foreground")}>
			{text}
		</span>
	);
}

export function AdminDataTable({ columns, rows, emptyMessage, initialSort }: AdminDataTableProps) {
	const [query, setQuery] = React.useState("");
	const [filterColumn, setFilterColumn] = React.useState("all");
	const [sortColumn, setSortColumn] = React.useState(initialSort ?? columns[0]?.key ?? "");
	const [sortDirection, setSortDirection] = React.useState<"asc" | "desc">("desc");

	const visibleRows = React.useMemo(() => {
		const normalizedQuery = query.trim().toLowerCase();
		const filtered = normalizedQuery
			? rows.filter((row) => {
					const keys = filterColumn === "all" ? columns.map((column) => column.key) : [filterColumn];
					return keys.some((key) => valueText(row[key]).toLowerCase().includes(normalizedQuery));
				})
			: rows;
		return [...filtered].sort((a, b) => {
			const result = compareValues(a[sortColumn], b[sortColumn]);
			return sortDirection === "asc" ? result : -result;
		});
	}, [columns, filterColumn, query, rows, sortColumn, sortDirection]);

	return (
		<div className="space-y-4">
			<div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-black/20 p-3 md:flex-row md:items-center">
				<label className="relative min-w-0 flex-1">
					<Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Filter rows"
						className="pl-9"
					/>
				</label>
				<Select value={filterColumn} onValueChange={setFilterColumn}>
					<SelectTrigger className="w-full md:w-48">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All columns</SelectItem>
						{columns.map((column) => (
							<SelectItem key={column.key} value={column.key}>
								{column.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Select value={sortColumn} onValueChange={setSortColumn}>
					<SelectTrigger className="w-full md:w-52">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{columns.map((column) => (
							<SelectItem key={column.key} value={column.key}>
								Sort: {column.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Button
					type="button"
					variant="secondary"
					className="h-9 gap-2"
					onClick={() => setSortDirection((current) => (current === "asc" ? "desc" : "asc"))}
				>
					{sortDirection === "asc" ? <ArrowUpAZ className="size-4" /> : <ArrowDownAZ className="size-4" />}
					{sortDirection.toUpperCase()}
				</Button>
			</div>

			<div className="overflow-hidden rounded-lg border border-white/10 bg-card/70">
				<Table>
					<TableHeader>
						<TableRow className="border-white/10 hover:bg-transparent">
							{columns.map((column) => (
								<TableHead key={column.key} className="bg-white/[0.03] px-3 text-xs uppercase tracking-normal text-muted-foreground">
									{column.label}
								</TableHead>
							))}
						</TableRow>
					</TableHeader>
					<TableBody>
						{visibleRows.length === 0 ? (
							<TableRow>
								<TableCell colSpan={columns.length} className="h-28 text-center text-muted-foreground">
									{emptyMessage}
								</TableCell>
							</TableRow>
						) : (
							visibleRows.map((row, index) => (
								<TableRow key={String(row.id ?? index)} className="border-white/10">
									{columns.map((column) => (
										<TableCell key={column.key} className="px-3">
											<CellValue column={column} value={row[column.key]} />
										</TableCell>
									))}
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>
			<p className="text-xs text-muted-foreground">
				Showing {visibleRows.length} of {rows.length} rows.
			</p>
		</div>
	);
}
