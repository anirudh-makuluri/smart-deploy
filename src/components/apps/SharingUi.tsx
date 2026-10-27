"use client";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SharingPanel({ title, children }: { title: string; children: ReactNode }) { return <section aria-label={title} className="rounded-2xl border border-border bg-card/80 p-5 sm:p-6"><h2 className="mb-5 text-lg font-semibold tracking-tight">{title}</h2>{children}</section>; }
export function SharingError({ message, retry }: { message: string; retry: () => void }) { return <div className="space-y-3"><p role="alert" className="text-sm leading-6 text-destructive">{message}</p><Button variant="outline" size="sm" onClick={retry}>Refresh status</Button></div>; }
export function SharingBusy() { return <p role="status" className="text-sm text-muted-foreground">Loading workspace…</p>; }
interface SharingFormInputProps { id: string; label: string; value: string; type: "text" | "email"; maxLength: number; disabled: boolean; onChange: (value: string) => void }
export function SharingFormInput({ id, label, value, type, maxLength, disabled, onChange }: SharingFormInputProps) {
	const { pending } = useFormStatus();
	return <div className="space-y-3"><label htmlFor={id} className="block text-sm font-medium">{label}</label><Input id={id} name={id} type={type} required maxLength={maxLength} value={value} disabled={disabled || pending} onChange={event => onChange(event.target.value)} /></div>;
}
export function SharingSubmit({ label, disabled }: { label: string; disabled: boolean }) { const { pending } = useFormStatus(); return <Button type="submit" disabled={disabled || pending}>{pending ? "Working…" : label}</Button>; }
