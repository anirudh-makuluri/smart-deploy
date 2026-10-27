import { z } from "zod";

const ListenerOutput = z.object({
	Listeners: z.array(z.object({ Port: z.number().int(), ListenerArn: z.string().min(1) })),
});

export function listenerArnFromOutput(raw: string, port: number): string | null {
	try {
		const data: unknown = JSON.parse(raw);
		const parsed = ListenerOutput.safeParse(data);
		return parsed.success
			? (parsed.data.Listeners.find((listener) => listener.Port === port)?.ListenerArn ?? null)
			: null;
	} catch {
		return null;
	}
}
