import { describe, expect, it, vi } from "vitest";
import { createInvitationCaptureStore, invitationLink, parseInvitationFragment } from "@/lib/apps/invitationLink";
const TOKEN = "a".repeat(43);
describe("invitation link capture", () => {
	it("keeps the token in the fragment and rejects foreign paths, schemes and malformed secrets", () => {
		expect(invitationLink("https://platform.example.test", TOKEN)).toBe("https://platform.example.test/apps/invitations#token=" + TOKEN);
		for (const origin of ["http://platform.example.test", "https://platform.example.test/elsewhere", "https://user@platform.example.test"]) expect(() => invitationLink(origin, TOKEN)).toThrow();
		expect(() => invitationLink("https://platform.example.test", TOKEN + "\n")).toThrow();
	});
	it.each(["#token=" + TOKEN + "\n", "#token=" + TOKEN + "&other=x", "#token=" + TOKEN + "&token=" + TOKEN, "#token=%61" + TOKEN.slice(1), "#wrong=" + TOKEN])("rejects ambiguous or malformed fragments", fragment => {
		expect(parseInvitationFragment(fragment)).toEqual({ status: "invalid" });
	});
	it("captures exactly once and preserves the result through subscription replay", () => {
		const capture = vi.fn(() => parseInvitationFragment("#token=" + TOKEN)); const store = createInvitationCaptureStore(capture); const listener = vi.fn();
		expect(store.getServerSnapshot()).toEqual({ status: "loading" }); expect(capture).not.toHaveBeenCalled();
		store.subscribe(listener)(); store.subscribe(listener)();
		expect(capture).toHaveBeenCalledOnce(); expect(store.getSnapshot()).toEqual({ status: "ready", token: TOKEN }); expect(listener).toHaveBeenCalledOnce();
	});
	it("scrubs both fragment and query from the address on mount without browser storage", () => {
		window.history.replaceState(null, "", "/apps/invitations?untrusted=1#token=" + TOKEN);
		const store = createInvitationCaptureStore(); store.subscribe(() => {})();
		expect(window.location.hash).toBe(""); expect(window.location.search).toBe(""); expect(store.getSnapshot()).toEqual({ status: "ready", token: TOKEN });
	});
});
