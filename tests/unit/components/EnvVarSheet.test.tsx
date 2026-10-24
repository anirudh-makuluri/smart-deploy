import React, { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EnvVarSheet from "@/components/EnvVarSheet";

interface Entry { name: string; value: string }

function Editor({ initialEntries }: { initialEntries: Entry[] }) {
	const [entries, setEntries] = useState(initialEntries);
	return <EnvVarSheet open onOpenChange={() => {}} entries={entries} onEntriesChange={setEntries} />;
}

describe("environment variable editor identity", () => {
	afterEach(() => vi.restoreAllMocks());
	it("edits without mutating the caller's entry objects", () => {
		const entries = [{ name: "TOKEN", value: "original" }, { name: "REGION", value: "west" }];
		const changed = vi.fn();
		render(<EnvVarSheet open onOpenChange={() => {}} entries={entries} onEntriesChange={changed} />);
		fireEvent.change(screen.getAllByPlaceholderText("VALUE")[0], { target: { value: "replacement" } });
		expect(entries[0].value).toBe("original");
		expect(changed.mock.calls[0][0][0]).toEqual({ name: "TOKEN", value: "replacement" });
		expect(changed.mock.calls[0][0][1]).toBe(entries[1]);
	});
	it("retains an appended input across another add and deletion before it", () => {
		render(<Editor initialEntries={[{ name: "FIRST", value: "one" }]} />);
		fireEvent.click(screen.getByRole("button", { name: "Add Variable" }));
		const appended = screen.getAllByPlaceholderText("VALUE")[1];
		fireEvent.change(appended, { target: { value: "second" } });
		fireEvent.click(screen.getByRole("button", { name: "Add Variable" }));
		expect(screen.getAllByPlaceholderText("VALUE")[1]).toBe(appended);
		fireEvent.click(screen.getByRole("button", { name: "Remove variable 1" }));
		expect(screen.getAllByPlaceholderText("VALUE")[0]).toBe(appended);
	});
	it("does not reveal the next secret when the focused row is removed", () => {
		render(<Editor initialEntries={[{ name: "FIRST", value: "one" }, { name: "SECOND", value: "two" }, { name: "THIRD", value: "three" }]} />);
		const values = screen.getAllByPlaceholderText("VALUE");
		fireEvent.focus(values[1]);
		expect(values[1]).toHaveAttribute("type", "text");
		fireEvent.click(screen.getByRole("button", { name: "Remove variable 2" }));
		expect(screen.getAllByPlaceholderText("VALUE")[1]).toHaveAttribute("type", "password");
	});
	it("follows externally reordered entries with their existing DOM and reveal state", () => {
		const first = { name: "FIRST", value: "one" };
		const second = { name: "SECOND", value: "two" };
		const view = render(<EnvVarSheet open onOpenChange={() => {}} entries={[first, second]} onEntriesChange={() => {}} />, { wrapper: React.StrictMode });
		const firstInput = screen.getAllByPlaceholderText("VALUE")[0];
		const secondInput = screen.getAllByPlaceholderText("VALUE")[1];
		fireEvent.focus(secondInput);
		view.rerender(<EnvVarSheet open onOpenChange={() => {}} entries={[second, first]} onEntriesChange={() => {}} />);
		expect(screen.getAllByPlaceholderText("VALUE")[0]).toBe(secondInput);
		expect(screen.getAllByPlaceholderText("VALUE")[1]).toBe(firstInput);
		expect(secondInput).toHaveAttribute("type", "text");
		expect(firstInput).toHaveAttribute("type", "password");
	});
	it("names all row controls without putting secret values in accessible labels", () => {
		render(<Editor initialEntries={[{ name: "TOKEN", value: "test-secret-value" }]} />);
		expect(screen.getByLabelText("Variable 1 name")).toHaveValue("TOKEN");
		expect(screen.getByLabelText("Variable 1 value")).toHaveValue("test-secret-value");
		expect(screen.getByRole("button", { name: "Remove variable 1" })).toBeEnabled();
		for (const button of screen.getAllByRole("button")) expect(button).toHaveAccessibleName();
		expect(screen.queryByLabelText(/test-secret-value/)).toBeNull();
	});
	it("keeps duplicate and blank rows distinct while editing their names", () => {
		render(<Editor initialEntries={[{ name: "DUPLICATE", value: "one" }, { name: "DUPLICATE", value: "two" }, { name: "", value: "" }]} />);
		const second = screen.getByLabelText("Variable 2 value");
		const blank = screen.getByLabelText("Variable 3 name");
		fireEvent.click(screen.getByRole("button", { name: "Remove variable 1" }));
		expect(screen.getByLabelText("Variable 1 value")).toBe(second);
		fireEvent.change(blank, { target: { value: "new-name" } });
		expect(screen.getByLabelText("Variable 2 name")).toBe(blank);
		expect(blank).toHaveValue("NEWNAME");
	});
	it("keeps existing named inputs when pasting duplicate .env keys with last-value precedence", () => {
		render(<Editor initialEntries={[{ name: "TOKEN", value: "old" }]} />);
		const token = screen.getByLabelText("Variable 1 value");
		fireEvent.paste(screen.getByLabelText("Variable 1 name"), { clipboardData: { getData: () => "TOKEN=first\nREGION=west\nTOKEN=last" } });
		expect(screen.getByLabelText("Variable 1 value")).toBe(token);
		expect(token).toHaveValue("last");
		expect(screen.getByLabelText("Variable 2 name")).toHaveValue("REGION");
	});
	it("merges a delayed file read into current edits without reusing new row identities", () => {
		const readers: FileReader[] = [];
		vi.spyOn(FileReader.prototype, "readAsText").mockImplementation(function (this: FileReader) { readers.push(this); });
		render(<Editor initialEntries={[{ name: "TOKEN", value: "old" }]} />);
		fireEvent.change(screen.getByLabelText("Upload .env file"), { target: { files: [new File(["REGION=west"], ".env")] } });
		fireEvent.change(screen.getByLabelText("Variable 1 value"), { target: { value: "edited-while-reading" } });
		fireEvent.click(screen.getByRole("button", { name: "Add Variable" }));
		fireEvent.change(screen.getByLabelText("Variable 2 name"), { target: { value: "ADDED" } });
		const added = screen.getByLabelText("Variable 2 value");
		fireEvent.change(added, { target: { value: "retained" } });
		Object.defineProperty(readers[0], "result", { value: "REGION=west" });
		act(() => readers[0].dispatchEvent(new ProgressEvent("load")));
		expect(screen.getByLabelText("Variable 1 value")).toHaveValue("edited-while-reading");
		expect(screen.getByLabelText("Variable 2 value")).toBe(added);
		expect(added).toHaveValue("retained");
		expect(screen.getByLabelText("Variable 3 name")).toHaveValue("REGION");
	});
	it("imports through the browser FileReader API and keeps last-value precedence", async () => {
		render(<Editor initialEntries={[{ name: "TOKEN", value: "old" }]} />);
		fireEvent.change(screen.getByLabelText("Upload .env file"), { target: { files: [new File(["TOKEN=first\nREGION=west\nTOKEN=last"], ".env")] } });
		await waitFor(() => expect(screen.getByLabelText("Variable 2 name")).toHaveValue("REGION"));
		expect(screen.getByLabelText("Variable 1 value")).toHaveValue("last");
	});
	it("ignores superseded and unmounted file reads", () => {
		const readers: FileReader[] = [];
		vi.spyOn(FileReader.prototype, "readAsText").mockImplementation(function (this: FileReader) { readers.push(this); });
		const changed = vi.fn();
		const view = render(<EnvVarSheet open onOpenChange={() => {}} entries={[{ name: "TOKEN", value: "old" }]} onEntriesChange={changed} />);
		for (const value of ["old-file", "new-file"]) {
			fireEvent.change(screen.getByLabelText("Upload .env file"), { target: { files: [new File([`TOKEN=${value}`], ".env")] } });
		}
		Object.defineProperty(readers[0], "result", { value: "TOKEN=old-file" });
		act(() => readers[0].dispatchEvent(new ProgressEvent("load")));
		expect(changed).not.toHaveBeenCalled();
		view.unmount();
		Object.defineProperty(readers[1], "result", { value: "TOKEN=new-file" });
		act(() => readers[1].dispatchEvent(new ProgressEvent("load")));
		expect(changed).not.toHaveBeenCalled();
	});
});
