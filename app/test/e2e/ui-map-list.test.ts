import { waitForReady, closeMap, deleteMap, withApi } from "./helpers";

describe("UI: Map list", () => {
	const createdIds: string[] = [];

	before(async () => {
		await waitForReady();
		// Ensure we're on the map list (no map open)
		await closeMap();
	});

	after(async () => {
		await closeMap();
		for (const id of createdIds) await deleteMap(id);
	});

	it("shows map list when no map is open", async () => {
		const visible = await browser.$(".page-map-list").isDisplayed();
		expect(visible).toBe(true);
	});

	it("has 'Your Maps' heading", async () => {
		const heading = await browser.$(".page-map-list h2");
		const text = await heading.getText();
		expect(text).toContain("Your Maps");
	});

	it("create a map via UI form", async () => {
		// Click new map button to enter creation mode
		const buttons = await browser.$$(".page-map-list .button");
		let newMapBtn: WebdriverIO.Element | null = null;
		for (const btn of buttons) {
			const text = await btn.getText();
			if (text.match(/new map/i)) {
				newMapBtn = btn;
				break;
			}
		}
		if (!newMapBtn) {
			// might be in "new map" icon button form
			const iconBtns = await browser.$$(".page-map-list .icon-button");
			for (const btn of iconBtns) {
				const label = await btn.getAttribute("aria-label");
				if (label?.match(/new map|add map|create/i)) {
					newMapBtn = btn;
					break;
				}
			}
		}
		// If button found, click it
		if (newMapBtn) await newMapBtn.click();

		// Type map name
		const nameInput = await browser.$('.page-map-list input[name="name"]');
		await nameInput.waitForDisplayed({ timeout: 3000 });
		await nameInput.setValue("UI Test Map");

		// Submit
		const createBtn = await browser.$(".page-map-list .button--primary");
		await createBtn.click();

		// Verify map appears in list
		await browser.pause(500);

		// Store ID for cleanup
		const id = await withApi(async (api) => {
			const maps = await api.listMaps();
			const m = maps.find((m: any) => m.name === "UI Test Map");
			return m?.id ?? "NOT_FOUND";
		});
		expect(id).not.toBe("NOT_FOUND");
		createdIds.push(id);
	});

	it("map entry shows in the list", async () => {
		const links = await browser.$$(".map-link");
		let found = false;
		for (const link of links) {
			const text = await link.getText();
			if (text === "UI Test Map") {
				found = true;
				break;
			}
		}
		expect(found).toBe(true);
	});

	it("click map entry opens the map", async () => {
		const links = await browser.$$(".map-link");
		for (const link of links) {
			const text = await link.getText();
			if (text === "UI Test Map") {
				await link.click();
				break;
			}
		}

		// Wait for editor to appear
		await browser.$(".page-map-editor").waitForDisplayed({ timeout: 5000 });

		const mapOpen = await withApi(async (api) => api.getCurrentMap() !== null);
		expect(mapOpen).toBe(true);
	});

	it("map list is hidden when map is open", async () => {
		const listVisible = await browser
			.$(".page-map-list")
			.isDisplayed()
			.catch(() => false);
		expect(listVisible).toBe(false);
	});
});

describe("UI: Map list - rename and delete", () => {
	let mapId: string;

	before(async () => {
		await waitForReady();
		await closeMap();

		mapId = await withApi(async (api) => {
			const map = await api.createMap("Rename Me");
			return map.meta.id;
		});
	});

	after(async () => {
		await closeMap();
		await deleteMap(mapId);
	});

	it("rename button opens rename dialog", async () => {
		// Find the map entry and its rename button
		const entries = await browser.$$(".map-list__entry");
		for (const entry of entries) {
			const link = await entry.$(".map-link");
			const text = await link.getText();
			if (text === "Rename Me") {
				const renameBtn = await entry.$('[aria-label="Rename map"]');
				await renameBtn.click();
				break;
			}
		}

		// Dialog should appear
		const dialog = await browser.$(".edit-map-modal");
		await dialog.waitForDisplayed({ timeout: 3000 });
	});

	it("can rename map via dialog", async () => {
		const input = await browser.$('.edit-map-modal input[name="name"]');
		await input.clearValue();
		await input.setValue("Renamed Via UI");

		const saveBtn = await browser.$(".edit-map-modal .button--primary");
		await saveBtn.click();

		// Dialog should close
		await browser.pause(500);

		// Verify in list
		const links = await browser.$$(".map-link");
		let found = false;
		for (const link of links) {
			if ((await link.getText()) === "Renamed Via UI") {
				found = true;
				break;
			}
		}
		expect(found).toBe(true);
	});

	it("delete button removes map from list", async () => {
		const entries = await browser.$$(".map-list__entry");
		for (const entry of entries) {
			const link = await entry.$(".map-link");
			const text = await link.getText();
			if (text === "Renamed Via UI") {
				const deleteBtn = await entry.$('[aria-label="Delete map"]');
				await deleteBtn.click();
				break;
			}
		}

		await browser.pause(500);

		const links = await browser.$$(".map-link");
		let found = false;
		for (const link of links) {
			if ((await link.getText()) === "Renamed Via UI") {
				found = true;
				break;
			}
		}
		expect(found).toBe(false);
	});
});
