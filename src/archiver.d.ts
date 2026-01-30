declare module "archiver" {
	interface EntryData {
		name: string;
	}
	interface Archiver {
		pipe(stream: NodeJS.WritableStream): void;
		directory(
			dirpath: string,
			destpath: false | string,
			data?: (entry: EntryData) => EntryData | false
		): void;
		on(event: "error", callback: (err: Error) => void): void;
		finalize(): void;
	}
	function archiver(format: string, options?: { zlib?: { level?: number } }): Archiver;
	export = archiver;
}
