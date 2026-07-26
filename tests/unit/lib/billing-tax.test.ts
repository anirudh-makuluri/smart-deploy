import { describe, expect, it } from "vitest";

import { calculateTopupTax, getTaxRateForCountry, normalizeCountryCode } from "@/lib/billing/tax";

describe("billing tax", () => {
	it("normalizes country codes", () => {
		expect(normalizeCountryCode(" us ")).toBe("US");
	});

	it("returns zero tax for unknown countries", () => {
		expect(getTaxRateForCountry("US")).toBe(0);
		expect(getTaxRateForCountry("SG")).toBe(0);
	});

	it("applies VAT for EU countries", () => {
		expect(getTaxRateForCountry("DE")).toBe(0.19);
		expect(getTaxRateForCountry("FR")).toBe(0.2);
	});

	it("calculates subtotal, tax, and total in cents", () => {
		const result = calculateTopupTax({ countryCode: "DE", subtotalCents: 1000 });
		expect(result.subtotalCents).toBe(1000);
		expect(result.taxRate).toBe(0.19);
		expect(result.taxAmountCents).toBe(190);
		expect(result.totalCents).toBe(1190);
	});
});
