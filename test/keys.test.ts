import { describe, expect, it } from "bun:test";

import { bindingLabel, keyHint } from "../src/ui/keys.ts";

describe("selection key labels", () => {
	it("uses compact labels for the host's default selection keys", () => {
		expect(bindingLabel("tui.select.cancel")).toBe("esc");
		expect(bindingLabel("tui.select.pageUp")).toBe("PgUp");
		expect(bindingLabel("tui.select.pageDown")).toBe("PgDn");
		expect(keyHint("tui.select.confirm", "use this")).toBe("enter use this");
	});
});
