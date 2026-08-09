/** Simple country-based VAT/GST rates for checkout display (merchant files and remits). */
const COUNTRY_TAX_RATES: Record<string, number> = {
	AT: 0.2,
	AU: 0.1,
	BE: 0.21,
	BG: 0.2,
	CA: 0.05,
	CH: 0.081,
	CY: 0.19,
	CZ: 0.21,
	DE: 0.19,
	DK: 0.25,
	EE: 0.22,
	ES: 0.21,
	FI: 0.24,
	FR: 0.2,
	GB: 0.2,
	GR: 0.24,
	HR: 0.25,
	HU: 0.27,
	IE: 0.23,
	IT: 0.22,
	LT: 0.21,
	LU: 0.17,
	LV: 0.21,
	MT: 0.18,
	NL: 0.21,
	NO: 0.25,
	PL: 0.23,
	PT: 0.23,
	RO: 0.19,
	SE: 0.25,
	SI: 0.22,
	SK: 0.2,
};

export type TopupTaxBreakdown = {
	countryCode: string;
	subtotalCents: number;
	taxRate: number;
	taxAmountCents: number;
	totalCents: number;
};

export function normalizeCountryCode(value: string): string {
	return value.trim().toUpperCase();
}

export function getTaxRateForCountry(countryCode: string): number {
	const normalized = normalizeCountryCode(countryCode);
	return COUNTRY_TAX_RATES[normalized] ?? 0;
}

export function calculateTopupTax(args: {
	countryCode: string;
	subtotalCents: number;
}): TopupTaxBreakdown {
	const countryCode = normalizeCountryCode(args.countryCode);
	const subtotalCents = Math.max(0, Math.round(args.subtotalCents));
	const taxRate = getTaxRateForCountry(countryCode);
	const taxAmountCents = Math.round(subtotalCents * taxRate);
	return {
		countryCode,
		subtotalCents,
		taxRate,
		taxAmountCents,
		totalCents: subtotalCents + taxAmountCents,
	};
}
