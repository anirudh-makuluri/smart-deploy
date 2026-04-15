import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { PublicPageFooterContent } from "@/components/public/PublicPageFooterContent";

export async function PublicPageFooter() {
	const session = await auth.api.getSession({ headers: await headers() });
	const primaryHref = session ? "/home" : "/auth";

	return <PublicPageFooterContent primaryHref={primaryHref} />;
}
