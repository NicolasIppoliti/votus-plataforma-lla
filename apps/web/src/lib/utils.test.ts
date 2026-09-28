import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
	it("merges conflicting utility classes", () => {
		expect(cn("px-2", "px-4")).toBe("px-4");
	});

	it("combines conditional arrays and objects while ignoring empty values", () => {
		expect(cn("base", [false, null, undefined, "active"], { visible: true, hidden: false }, "")).toBe(
			"base active visible",
		);
	});

	it("resolves asymmetric spacing conflicts in input order", () => {
		expect(cn("px-2", "pl-4")).toBe("px-2 pl-4");
		expect(cn("pl-4", "px-2")).toBe("px-2");
	});

	it("preserves variant and arbitrary value conflict handling", () => {
		expect(cn("hover:bg-red-500", "hover:bg-blue-500", "w-[10px]", "w-[20px]")).toBe(
			"hover:bg-blue-500 w-[20px]",
		);
	});
});
