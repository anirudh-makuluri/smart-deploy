export function isPublicOrAuthRoute(pathname: string): boolean {
	if (pathname === "/") return true;
	if (pathname === "/auth" || pathname.startsWith("/auth/")) return true;
	if (pathname === "/docs" || pathname.startsWith("/docs/")) return true;
	if (pathname === "/changelog") return true;
	if (pathname === "/waiting-list") return true;
	return false;
}
