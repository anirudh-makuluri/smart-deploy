"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Coins, Loader2 } from "lucide-react";

import type { CreditLedgerEntry, TopupPackage } from "@/app/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { calculateTopupTax } from "@/lib/billing/tax";
import { cn } from "@/lib/utils";

type BillingBalanceResponse = {
	balance: number;
	ledger: CreditLedgerEntry[];
};

type CustomerCreditScenario = {
	id: string;
	label: string;
	totalCredits: number;
	description: string;
};

type PricingResponse = {
	creditUsdValue: number;
	hostingCreditsBillingEnabled: boolean;
	customer: {
		billingModel: string;
		hostingIncluded: boolean;
		hobbyMonthCredits: number;
		hobbyMonthUsd: number;
		competitorAnchorsUsd: { renderStarter: number; railwayHobby: number };
		rates: {
			containerDeploy: number;
			cachedRedeploy: number;
			staticDeploy: number;
			scan: number;
			agentMessage: number;
			uptimePerHour: number;
		};
		scenarios: CustomerCreditScenario[];
	};
};

const COUNTRY_OPTIONS = [
	{ code: "US", label: "United States" },
	{ code: "CA", label: "Canada" },
	{ code: "GB", label: "United Kingdom" },
	{ code: "DE", label: "Germany" },
	{ code: "FR", label: "France" },
	{ code: "AU", label: "Australia" },
	{ code: "NL", label: "Netherlands" },
	{ code: "IE", label: "Ireland" },
	{ code: "SE", label: "Sweden" },
	{ code: "SG", label: "Singapore" },
	{ code: "IN", label: "India" },
	{ code: "JP", label: "Japan" },
];

const usdFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const integerFormatter = new Intl.NumberFormat("en-US");
const ledgerDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
	timeZone: "UTC",
	year: "numeric",
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
	hour12: true,
});

function formatUsd(cents: number): string {
	return usdFormatter.format(cents / 100);
}

function formatInteger(value: number): string {
	return integerFormatter.format(value);
}

function formatLedgerTimestamp(isoTimestamp: string): string {
	return ledgerDateTimeFormatter.format(new Date(isoTimestamp));
}

function formatLedgerType(type: CreditLedgerEntry["type"]): string {
	if (type === "topup") return "Top-up";
	if (type === "usage") return "Usage";
	if (type === "refund") return "Refund";
	return "Adjustment";
}

type DashboardCreditsViewProps = {
	billingNotice: string | null;
};

export default function DashboardCreditsView({ billingNotice }: DashboardCreditsViewProps) {
	const [countryCode, setCountryCode] = React.useState("US");
	const [checkoutPackageId, setCheckoutPackageId] = React.useState<string | null>(null);
	const [checkoutError, setCheckoutError] = React.useState<string | null>(null);

	const packagesQuery = useQuery({
		queryKey: ["billing", "packages"],
		queryFn: async (): Promise<TopupPackage[]> => {
			const response = await fetch("/api/billing/packages");
			if (!response.ok) {
				throw new Error("Could not load credit packages");
			}
			const data = (await response.json()) as { packages: TopupPackage[] };
			return data.packages;
		},
	});

	const balanceQuery = useQuery({
		queryKey: ["billing", "balance"],
		queryFn: async (): Promise<BillingBalanceResponse> => {
			const response = await fetch("/api/billing/balance");
			if (!response.ok) {
				throw new Error("Could not load credit balance");
			}
			return (await response.json()) as BillingBalanceResponse;
		},
	});

	const pricingQuery = useQuery({
		queryKey: ["billing", "pricing"],
		queryFn: async (): Promise<PricingResponse> => {
			const response = await fetch("/api/billing/pricing");
			if (!response.ok) {
				throw new Error("Could not load credit pricing");
			}
			return (await response.json()) as PricingResponse;
		},
	});

	const handleBuyPackage = async (packageId: string) => {
		setCheckoutError(null);
		setCheckoutPackageId(packageId);
		try {
			const response = await fetch("/api/billing/checkout", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ packageId, countryCode }),
			});
			if (!response.ok) {
				let message = "Could not start checkout";
				try {
					const errorData = (await response.json()) as { error?: string };
					if (errorData.error) {
						message = errorData.error;
					}
				} catch {
					// Ignore JSON parse errors on failed responses.
				}
				throw new Error(message);
			}
			const data = (await response.json()) as { checkoutUrl?: string };
			if (!data.checkoutUrl) {
				throw new Error("Could not start checkout");
			}
			window.location.assign(data.checkoutUrl);
		} catch (error) {
			setCheckoutError(error instanceof Error ? error.message : "Checkout failed");
			setCheckoutPackageId(null);
		}
	};

	const isLoading = packagesQuery.isLoading || balanceQuery.isLoading;
	const loadError = packagesQuery.error || balanceQuery.error;

	return (
		<div className="space-y-6">
			{billingNotice ? (
				<div className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-foreground">
					{billingNotice}
				</div>
			) : null}

			<Card className="border-border bg-card/80">
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-lg">
						<Coins className="size-5 text-primary" />
						Credit balance
					</CardTitle>
					<CardDescription>
						Credits pay for deploys, scans, agent usage, and live ECS uptime (
						{pricingQuery.data?.customer.rates.uptimePerHour ?? 4} credits/hr per running service).
					</CardDescription>
				</CardHeader>
				<CardContent>
					<p className="text-3xl font-semibold tracking-tight text-foreground">
						{isLoading ? "…" : formatInteger(balanceQuery.data?.balance ?? 0)}
						<span className="ml-2 text-sm font-medium text-muted-foreground">credits</span>
					</p>
				</CardContent>
			</Card>

			<div className="space-y-3">
				<div className="flex flex-wrap items-end justify-between gap-4">
					<div>
						<p className="text-sm font-medium text-foreground">Billing country</p>
						{/* <p className="text-xs text-muted-foreground">Used to estimate tax at checkout. You file and remit tax.</p> */}
					</div>
					<Select value={countryCode} onValueChange={setCountryCode}>
						<SelectTrigger className="w-[min(100%,16rem)]">
							<SelectValue placeholder="Select country" />
						</SelectTrigger>
						<SelectContent>
							{COUNTRY_OPTIONS.map((country) => (
								<SelectItem key={country.code} value={country.code}>
									{country.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				{loadError ? (
					<div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
						{loadError instanceof Error ? loadError.message : "Could not load billing data"}
					</div>
				) : null}

				{checkoutError ? (
					<div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
						{checkoutError}
					</div>
				) : null}

				<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
					{(packagesQuery.data ?? []).map((pkg) => {
						const tax = calculateTopupTax({ countryCode, subtotalCents: pkg.priceCents });
						const isCheckingOut = checkoutPackageId === pkg.id;
						return (
							<Card key={pkg.id} className="border-border bg-card/70">
								<CardHeader className="pb-3">
									<CardTitle className="text-base">{formatInteger(pkg.credits)} credits</CardTitle>
									<CardDescription>
										{formatUsd(tax.subtotalCents)}
										{tax.taxAmountCents > 0
											? ` + ${formatUsd(tax.taxAmountCents)} est. tax`
											: " · no estimated tax"}
									</CardDescription>
								</CardHeader>
								<CardContent className="space-y-3">
									<p className="text-sm text-muted-foreground">
										Total at checkout: <span className="font-medium text-foreground">{formatUsd(tax.totalCents)}</span>
									</p>
									<Button
										type="button"
										className="w-full"
										disabled={isLoading || isCheckingOut}
										onClick={() => void handleBuyPackage(pkg.id)}
									>
										{isCheckingOut ? (
											<>
												<Loader2 className="size-4 animate-spin" />
												Redirecting…
											</>
										) : (
											"Buy credits"
										)}
									</Button>
								</CardContent>
							</Card>
						);
					})}
				</div>
			</div>

			<Card className="border-border bg-card/60">
				<CardHeader>
					<CardTitle className="text-base">What credits buy</CardTitle>
					<CardDescription>
						Flat per-action rates plus hourly uptime while an ECS service is live. A typical always-on month
						(~{pricingQuery.data ? formatInteger(pricingQuery.data.customer.hobbyMonthCredits) : "3,000"} credits, ≈$
						{(pricingQuery.data?.customer.hobbyMonthUsd ?? 30).toFixed(2)}) covers deploys, scans, and 730
						uptime hours at {pricingQuery.data?.customer.rates.uptimePerHour ?? 4} credits/hr.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{pricingQuery.isLoading ? (
						<p className="text-sm text-muted-foreground">Loading rates…</p>
					) : pricingQuery.data ? (
						<div className="space-y-4">
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
								{pricingQuery.data.customer.scenarios.map((scenario) => (
									<div
										key={scenario.id}
										className="rounded-lg border border-border/70 bg-background/60 p-3"
									>
										<p className="text-xs uppercase tracking-wider text-muted-foreground">{scenario.label}</p>
										<p className="mt-1 text-2xl font-semibold text-foreground">
											{scenario.totalCredits} credits
											{scenario.id === "uptime_hour" ? <span className="text-base font-medium text-muted-foreground">/hr</span> : null}
										</p>
										<p className="mt-1 text-xs text-muted-foreground">{scenario.description}</p>
									</div>
								))}
							</div>

							<div className="rounded-lg border border-border/70 bg-background/60 p-4 text-sm text-muted-foreground">
								<p className="font-medium text-foreground">Uptime billing</p>
								<p className="mt-2">
									Each live ECS deployment is debited once per UTC hour while status is running.
									Static sites are not metered hourly. Insufficient balance skips the debit until you top up.
								</p>
							</div>

							<p className="text-xs text-muted-foreground">
								Uptime debits run hourly from the WebSocket worker. Deploy/scan debits are not enabled yet.
							</p>
						</div>
					) : (
						<p className="text-sm text-muted-foreground">Pricing unavailable.</p>
					)}
				</CardContent>
			</Card>

			<Card className="border-border bg-card/60">
				<CardHeader>
					<CardTitle className="text-base">Recent activity</CardTitle>
				</CardHeader>
				<CardContent>
					{(balanceQuery.data?.ledger.length ?? 0) === 0 ? (
						<p className="text-sm text-muted-foreground">No credit activity yet.</p>
					) : (
						<ul className="space-y-2">
							{balanceQuery.data?.ledger.map((entry) => (
								<li
									key={entry.id}
									className="flex items-center justify-between gap-3 rounded-md border border-border/70 bg-background/60 px-3 py-2 text-sm"
								>
									<div>
										<p className="font-medium text-foreground">{formatLedgerType(entry.type)}</p>
										<p className="text-xs text-muted-foreground">
											{formatLedgerTimestamp(entry.createdAt)}
										</p>
									</div>
									<span
										className={cn(
											"font-semibold tabular-nums",
											entry.amount > 0 ? "text-emerald-400" : "text-foreground",
										)}
									>
										{entry.amount > 0 ? "+" : ""}
										{formatInteger(entry.amount)}
									</span>
								</li>
							))}
						</ul>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
