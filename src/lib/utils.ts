import { AIGenProjectMetadata } from "@/app/types";
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs))
}


export function formatTimestamp(isoString: string | undefined): string {
	if (!isoString) {
		isoString = new Date().toISOString();
	}

	const date = new Date(isoString);
	const now = new Date();

	// Convert to local time
	const localDate = new Date(date.getTime() + now.getTimezoneOffset() * 60000);
	const localNow = new Date(now.getTime() + now.getTimezoneOffset() * 60000);

	const isSameDay = localDate.toDateString() === localNow.toDateString();

	const yesterday = new Date(localNow);
	yesterday.setDate(localNow.getDate() - 1);
	const isYesterday = localDate.toDateString() === yesterday.toDateString();

	const timeFormatter = new Intl.DateTimeFormat(undefined, {
		hour: 'numeric',
		minute: '2-digit',
		hour12: true,
	});

	if (isSameDay) {
		return timeFormatter.format(localDate);
	} else if (isYesterday) {
		return `Yesterday at ${timeFormatter.format(localDate)}`;
	} else {
		const dateFormatter = new Intl.DateTimeFormat(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
		});
		return dateFormatter.format(localDate);
	}
}


export function parseEnvVarsToDisplay(envVarsString: string = "") {
	return envVarsString
		.split(",")
		.map(pair => pair.trim())
		.filter(pair => pair.includes("="))
		.map(pair => {
			const [key, ...rest] = pair.split("=")
			return { name: key, value: rest.join("=") }
		})
}

export function parseEnvVarsToStore(envString: string): string {
	return envString
		.split("\n")
		.map(line => line.trim())
		.filter(line => line && !line.startsWith("#"))
		.join(",");
}


export function readDockerfile(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();

		reader.onload = () => {
			resolve(reader.result as string);
		};

		reader.onerror = () => {
			reject(reader.error);
		};

		reader.readAsText(file); // 👈 Reads as plain UTF-8 text
	});
}


export function formatLogTimestamp(isoTimestamp: string) {
	const date = new Date(isoTimestamp);

	// Format: DD MMM YYYY, hh:mm AM/PM
	return date.toLocaleString('en-IN', {
		day: '2-digit',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hour12: true,
	});
}


export function extractDeployConfigFromAI(responseObj: { response: string }): AIGenProjectMetadata | null {
	try {
		const cleaned = responseObj.response.replace(/\/\/.*$/gm, "").trim();

		// Parse the cleaned string
		const config = JSON.parse(cleaned);

		return config;
	} catch (error) {
		console.error("Failed to parse AI response:", error);
		return null;
	}
}

export function sanitizeAndParseAIResponse(raw: any): AIGenProjectMetadata | null {
	try {
		let jsonStr = "";

		// Step 1: If the AI returned { response: "..." }, extract it
		if (typeof raw === "object" && typeof raw.response === "string") {
			jsonStr = raw.response;
		} else if (typeof raw === "string") {
			jsonStr = raw;
		} else {
			jsonStr = JSON.stringify(raw);
		}

		// Step 2: Remove comments (// ...)
		jsonStr = jsonStr.replace(/\/\/.*$/gm, "");

		// Step 3: Remove trailing commas before closing brackets/braces
		jsonStr = jsonStr.replace(/,\s*([}\]])/g, "$1");

		// Step 4: Trim non-JSON content (attempt to isolate the first valid object)
		const firstBrace = jsonStr.indexOf("{");
		const lastBrace = jsonStr.lastIndexOf("}");
		if (firstBrace === -1 || lastBrace === -1) throw new Error("No JSON object found");

		const possibleJson = jsonStr.slice(firstBrace, lastBrace + 1);

		// Step 5: Parse
		return JSON.parse(possibleJson);

	} catch (err) {
		console.error("❌ Failed to sanitize/parse AI response:", err);
		return null;
	}
}

