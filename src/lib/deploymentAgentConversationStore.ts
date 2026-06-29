export type DeploymentAgentConversationTurn = {
	role: "user" | "assistant";
	content: string;
	timestamp: string;
};

const MAX_STORED_TURNS = 24;

const conversationStore = new Map<string, DeploymentAgentConversationTurn[]>();

function buildConversationKey(userID: string, conversationId: string): string {
	return `${userID}::${conversationId}`;
}

export async function getDeploymentAgentConversationTurns(args: {
	userID: string;
	conversationId: string;
	limit: number;
}): Promise<DeploymentAgentConversationTurn[]> {
	const key = buildConversationKey(args.userID, args.conversationId);
	const turns = conversationStore.get(key) ?? [];
	if (args.limit <= 0) return [];
	return turns.slice(-args.limit);
}

export async function appendDeploymentAgentConversationTurn(args: {
	userID: string;
	conversationId: string;
	turn: DeploymentAgentConversationTurn;
	maxStoredTurns?: number;
}): Promise<void> {
	const key = buildConversationKey(args.userID, args.conversationId);
	const existingTurns = conversationStore.get(key) ?? [];
	const maxStoredTurns = args.maxStoredTurns ?? MAX_STORED_TURNS;
	const nextTurns = [...existingTurns, args.turn].slice(-Math.max(1, maxStoredTurns));
	conversationStore.set(key, nextTurns);
}

export const __testing = {
	reset() {
		conversationStore.clear();
	},
};
