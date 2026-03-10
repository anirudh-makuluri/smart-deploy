"use client";

import * as React from "react";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Trash2, Upload, FileText, X } from "lucide-react";
import { parseEnvLinesToEntries } from "@/lib/utils";
import { toast } from "sonner";

type EnvVarEntry = {
	name: string;
	value: string;
}

type EnvVarSheetProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	entries: EnvVarEntry[];
	onEntriesChange: (entries: EnvVarEntry[]) => void;
}

export default function EnvVarSheet({
	open,
	onOpenChange,
	entries,
	onEntriesChange,
}: EnvVarSheetProps) {
	const fileInputRef = React.useRef<HTMLInputElement>(null);
	const [focusedIndex, setFocusedIndex] = React.useState<number | null>(null);


	const handleAddVariable = () => {
		onEntriesChange([...entries, { name: "", value: "" }]);
	};

	const handleRemoveVariable = (index: number) => {
		const newEntries = entries.filter((_, i) => i !== index);
		onEntriesChange(newEntries);
	};

	const handleUpdateVariable = (
		index: number,
		field: keyof EnvVarEntry,
		value: string
	) => {
		const newEntries = [...entries];
		if (field === "name") {
			newEntries[index].name = value.toUpperCase().replace(/[^A-Z0-9_]/g, "");
		} else {
			newEntries[index].value = value;
		}
		onEntriesChange(newEntries);
	};

	const handlePaste = (index: number, e: React.ClipboardEvent<HTMLInputElement>) => {
		// Only autofill if pasting into the first empty key or if it looks like a multi-line .env content
		const pastedText = e.clipboardData.getData("text");
		if (pastedText.includes("=") || pastedText.includes("\n")) {
			e.preventDefault();
			const parsed = parseEnvLinesToEntries(pastedText);
			if (parsed.length > 0) {
				// If we are at index and it's the only one or we want to append/replace
				// For simplicity, let's replace empty entries or append
				const baseEntries = entries.filter(e => e.name || e.value);
				// If the current entry being pasted into is empty, we can replace it
				const currentEntry = entries[index];
				let newEntries: EnvVarEntry[] = [];

				if (!currentEntry.name && !currentEntry.value) {
					// Replace the empty one at index
					const before = entries.slice(0, index);
					const after = entries.slice(index + 1);
					newEntries = [...before, ...parsed, ...after];
				} else {
					// Append
					newEntries = [...entries, ...parsed];
				}

				// Remove duplicates (keep last)
				const uniqueEntriesMap = new Map<string, string>();
				newEntries.forEach(e => {
					if (e.name) uniqueEntriesMap.set(e.name, e.value);
				});

				const finalEntries = Array.from(uniqueEntriesMap.entries()).map(([name, value]) => ({ name, value }));
				onEntriesChange(finalEntries.length > 0 ? finalEntries : [{ name: "", value: "" }]);
				toast.success(`Imported ${parsed.length} environment variables`);
			}
		}
	};

	const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;

		const reader = new FileReader();
		reader.onload = (event) => {
			const content = event.target?.result as string;
			const parsed = parseEnvLinesToEntries(content);
			if (parsed.length > 0) {
				// Merge with existing, priority to new
				const entryMap = new Map<string, string>();
				entries.forEach(e => { if (e.name) entryMap.set(e.name, e.value) });
				parsed.forEach(e => { if (e.name) entryMap.set(e.name, e.value) });

				const merged = Array.from(entryMap.entries()).map(([name, value]) => ({ name, value }));
				onEntriesChange(merged);
				toast.success(`Imported ${parsed.length} variables from ${file.name}`);
			} else {
				toast.error("No valid environment variables found in file");
			}
		};
		reader.readAsText(file);
		// Reset input
		if (fileInputRef.current) fileInputRef.current.value = "";
	};

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="w-full sm:max-w-xl bg-[#0a0a0f] border-white/5 p-0 flex flex-col">
				<div className="p-6 border-b border-white/5">
					<SheetHeader>
						<SheetTitle className="text-xl font-bold bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
							Environment Variables
						</SheetTitle>
						<SheetDescription className="text-muted-foreground/60">
							Manage your application's environment variables. You can add them manually, upload a .env file, or paste content into the key field.
						</SheetDescription>
					</SheetHeader>

					<div className="flex items-center gap-3 mt-6">
						<Button
							onClick={() => fileInputRef.current?.click()}
							variant="outline"
							size="sm"
							className="bg-white/5 border-white/10 hover:bg-white/10 text-xs h-9"
						>
							<Upload className="size-3.5 mr-2" />
							Upload .env
						</Button>
						<input
							type="file"
							ref={fileInputRef}
							onChange={handleFileUpload}
							className="hidden"
							accept=".env,text/plain"
						/>
						<div className="h-4 w-px bg-white/10 mx-1" />
						<Button
							onClick={handleAddVariable}
							variant="default"
							size="sm"
							className="bg-primary hover:bg-primary/90 text-xs h-9"
						>
							<Plus className="size-3.5 mr-2" />
							Add Variable
						</Button>
					</div>
				</div>

				<div className="flex-1 overflow-hidden">
					<ScrollArea className="h-full">
						<div className="px-6 py-4 space-y-4">
							{entries.length === 0 ? (
								<div className="flex flex-col items-center justify-center py-12 px-4 border border-dashed border-white/10 rounded-xl bg-white/[0.02]">
									<FileText className="size-10 text-muted-foreground/20 mb-3" />
									<p className="text-sm text-muted-foreground/60 text-center">
										No environment variables added yet.<br />
										Add one or upload a .env file.
									</p>
								</div>
							) : (
								<div className="space-y-2">
									<div className="flex flex-row gap-4 px-1 mb-2">
										<span className="text-[10px] w-1/2 font-bold text-muted-foreground/40 uppercase tracking-wider">Key</span>
										<span className="text-[10px] w-1/2 font-bold text-muted-foreground/40 uppercase tracking-wider">Value</span>
									</div>
									<div className="space-y-2">
										{entries.map((entry, index) => (
											<div key={index} className="flex flex-row gap-2 items-center animate-in fade-in slide-in-from-right-2 duration-200">
												<Input
													value={entry.name}
													onPaste={(e) => handlePaste(index, e)}
													onChange={(e) => handleUpdateVariable(index, "name", e.target.value)}
													placeholder="NAME"
													className="bg-white/[0.03] border-white/5 h-9 text-xs font-mono focus-visible:ring-primary/20"
												/>
												<Input
													value={entry.value}
													onChange={(e) => handleUpdateVariable(index, "value", e.target.value)}
													onFocus={() => setFocusedIndex(index)}
													onBlur={() => setFocusedIndex(null)}
													placeholder="VALUE"
													type={focusedIndex === index ? "text" : "password"}
													className="bg-white/[0.03] border-white/5 h-9 text-xs font-mono focus-visible:ring-primary/20"
												/>
												<Button
													variant="ghost"
													size="icon"
													onClick={() => handleRemoveVariable(index)}
													className="h-9 w-9 text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 shrink-0"
												>
													<Trash2 className="size-3.5" />
												</Button>
											</div>
										))}
									</div>
								</div>
							)}
						</div>
					</ScrollArea>
				</div>

				<div className="p-6 border-t border-white/5 bg-white/[0.01]">
					<Button
						className="w-full h-11 bg-primary hover:bg-primary/90 text-sm font-bold shadow-lg shadow-primary/10"
						onClick={() => onOpenChange(false)}
					>
						Done
					</Button>
				</div>
			</SheetContent>
		</Sheet>
	);
}
