"use client";

import * as React from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

interface ConfirmDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
	title: string;
	description: string;
	confirmText?: string;
	cancelText?: string;
	variant?: "default" | "destructive";
}

export function ConfirmDialog({
	open,
	onOpenChange,
	onConfirm,
	title,
	description,
	confirmText = "Confirm",
	cancelText = "Cancel",
	variant = "default",
}: ConfirmDialogProps) {
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent className="bg-[#0a0a0f] border-white/5 max-w-md shadow-2xl backdrop-blur-xl">
				<AlertDialogHeader>
					<div className="flex items-center gap-4 mb-2">
						<div
							className={cn(
								"p-3 rounded-xl border flex items-center justify-center shrink-0",
								variant === "destructive"
									? "bg-destructive/10 border-destructive/20 text-destructive"
									: "bg-primary/10 border-primary/20 text-primary"
							)}
						>
							{variant === "destructive" ? (
								<AlertTriangle className="size-5" />
							) : (
								<Info className="size-5" />
							)}
						</div>
						<AlertDialogTitle className="text-xl font-bold text-white tracking-tight">
							{title}
						</AlertDialogTitle>
					</div>
					<AlertDialogDescription className="text-muted-foreground/60 text-sm leading-relaxed text-left pl-[60px]">
						{description}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter className="mt-6 gap-3 flex flex-row items-center justify-end">
					<AlertDialogCancel className="bg-white/5 border-white/10 hover:bg-white/10 text-white hover:text-white transition-all h-10 px-4 rounded-lg font-medium border-0 m-0">
						{cancelText}
					</AlertDialogCancel>
					<AlertDialogAction
						onClick={(e) => {
							e.stopPropagation();
							onConfirm();
						}}
						className={cn(
							"h-10 px-6 rounded-lg font-bold shadow-lg transition-all m-0",
							variant === "destructive"
								? "bg-destructive hover:bg-destructive/90 text-destructive-foreground shadow-destructive/10"
								: "bg-primary hover:bg-primary/90 text-primary-foreground shadow-primary/10"
						)}
					>
						{confirmText}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
