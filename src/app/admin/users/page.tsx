import { revalidatePath } from "next/cache";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { requireAdminSession } from "@/lib/admin";
import { getSupabaseServer } from "@/lib/supabaseServer";

type WaitingListRow = {
	id: string;
	email: string;
	name: string | null;
	created_at: string | null;
};

const waitingListDateFormatter = new Intl.DateTimeFormat("en", {
	dateStyle: "medium",
	timeStyle: "short",
});

function formatDate(value: string | null) {
	if (!value) return "-";
	return waitingListDateFormatter.format(new Date(value));
}

async function approveWaitingListEntry(formData: FormData) {
	"use server";

	await requireAdminSession();
	const id = String(formData.get("id") ?? "");
	if (!id) return;

	const supabase = getSupabaseServer();
	const { data: row, error: readError } = await supabase
		.from("waiting_list")
		.select("id,email,name")
		.eq("id", id)
		.single();

	if (readError || !row?.email) {
		throw new Error(readError?.message ?? "Waiting list entry not found");
	}

	const email = String(row.email).trim().toLowerCase();
	const name = typeof row.name === "string" ? row.name : null;

	const { error: upsertError } = await supabase
		.from("approved_users")
		.upsert({ email, name }, { onConflict: "email" });
	if (upsertError) throw new Error(upsertError.message);

	const { error: deleteError } = await supabase.from("waiting_list").delete().eq("id", id);
	if (deleteError) throw new Error(deleteError.message);

	revalidatePath("/admin/users");
}

async function rejectWaitingListEntry(formData: FormData) {
	"use server";

	await requireAdminSession();
	const id = String(formData.get("id") ?? "");
	if (!id) return;

	const { error } = await getSupabaseServer().from("waiting_list").delete().eq("id", id);
	if (error) throw new Error(error.message);

	revalidatePath("/admin/users");
}

async function loadWaitingList(): Promise<WaitingListRow[]> {
	const { data, error } = await getSupabaseServer()
		.from("waiting_list")
		.select("id,email,name,created_at")
		.order("created_at", { ascending: false });
	if (error) throw new Error(error.message);
	return (data ?? []) as WaitingListRow[];
}

export default async function AdminUsersPage() {
	await requireAdminSession();
	const rows = await loadWaitingList();

	return (
		<section className="space-y-5">
			<div>
				<h1 className="text-2xl font-semibold tracking-normal">Users</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					Review sign-in attempts and promote approved emails into the allowlist.
				</p>
			</div>

			<Card className="rounded-lg border-white/10 bg-card/80">
				<CardHeader className="border-b border-white/10">
					<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<CardTitle>Waiting list</CardTitle>
							<CardDescription>Rows from `waiting_list` awaiting an access decision.</CardDescription>
						</div>
						<Badge className="w-fit rounded-md border border-sky-400/30 bg-sky-400/10 font-mono text-sky-200">
							{rows.length} pending
						</Badge>
					</div>
				</CardHeader>
				<CardContent className="p-0">
					<Table>
						<TableHeader>
							<TableRow className="border-white/10 hover:bg-transparent">
								<TableHead className="px-4">Email</TableHead>
								<TableHead>Name</TableHead>
								<TableHead>Requested</TableHead>
								<TableHead className="text-right">Decision</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.length === 0 ? (
								<TableRow>
									<TableCell colSpan={4} className="h-28 text-center text-muted-foreground">
										No pending users.
									</TableCell>
								</TableRow>
							) : (
								rows.map((row) => (
									<TableRow key={row.id} className="border-white/10">
										<TableCell className="px-4 font-medium">{row.email}</TableCell>
										<TableCell className="text-muted-foreground">{row.name ?? "-"}</TableCell>
										<TableCell className="font-mono text-xs text-muted-foreground">
											{formatDate(row.created_at)}
										</TableCell>
										<TableCell>
											<div className="flex justify-end gap-2">
												<form action={approveWaitingListEntry}>
													<input type="hidden" name="id" value={row.id} />
													<Button type="submit" size="sm" className="h-8 gap-2">
														<Check className="size-4" />
														Approve
													</Button>
												</form>
												<form action={rejectWaitingListEntry}>
													<input type="hidden" name="id" value={row.id} />
													<Button type="submit" size="sm" variant="secondary" className="h-8 gap-2">
														<X className="size-4" />
														Reject
													</Button>
												</form>
											</div>
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				</CardContent>
			</Card>
		</section>
	);
}
