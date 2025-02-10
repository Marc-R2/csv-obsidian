import {
	debounce,
	MarkdownRenderer,
	Notice,
	Setting,
	TextFileView,
	ToggleComponent,
	WorkspaceLeaf
} from "obsidian";

import { parseCsvData } from "./csvParser";
import Handsontable from "handsontable";
import {unparse} from "papaparse";

export class CsvView extends TextFileView {
	autoSaveValue: boolean;
	headerToggle: ToggleComponent;
	fileOptionsEl: HTMLElement;
	hot: Handsontable;
	hotSettings: Handsontable.GridSettings;
	hotExport: Handsontable.plugins.ExportFile;
	hotState: Handsontable.plugins.PersistentState;
	hotFilters: Handsontable.plugins.Filters;
	loadingBar: HTMLElement;

	// A shortcut for accessing the underlying content element.
	public get extContentEl(): HTMLElement {
		return this.contentEl;
	}

	// Constructor: initializes the view and sets up the Handsontable instance.
	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
		this.autoSaveValue = true;
		this.onResize = () => {
			this.hot.render();
		};

		// Create a loading bar element
		this.loadingBar = document.createElement("div");
		this.loadingBar.addClass("progress-bar");
		this.loadingBar.innerHTML = `<div class="progress-bar-message u-center-text">
            Loading CSV...
         </div>
         <div class="progress-bar-indicator">
            <div class="progress-bar-line"></div>
         </div>`;
		this.extContentEl.appendChild(this.loadingBar);

		// Create file options container and a toggle for CSV headers.
		this.fileOptionsEl = document.createElement("div");
		this.fileOptionsEl.classList.add("csv-controls");
		this.extContentEl.appendChild(this.fileOptionsEl);
		new Setting(this.fileOptionsEl)
			.setName("File Includes Headers")
			.addToggle(toggle => {
				this.headerToggle = toggle;
				toggle.setValue(false).onChange(this.toggleHeaders);
			});

		// Set up the Handsontable container and initial settings.
		const tableContainer = document.createElement("div");
		tableContainer.classList.add("csv-table-wrapper");
		this.extContentEl.appendChild(tableContainer);

		const hotContainer = document.createElement("div");
		tableContainer.appendChild(hotContainer);

		// Register a custom markdown renderer for Handsontable cells.
		Handsontable.renderers.registerRenderer("markdown", this.markdownCellRenderer);
		this.hotSettings = {
			afterChange: this.hotChange,
			afterColumnSort: this.requestAutoSave,
			afterColumnMove: this.requestAutoSave,
			afterRowMove: this.requestAutoSave,
			afterCreateCol: this.requestAutoSave,
			afterCreateRow: this.requestAutoSave,
			afterRemoveCol: this.requestAutoSave,
			afterRemoveRow: this.requestAutoSave,
			licenseKey: "non-commercial-and-evaluation",
			colHeaders: true,
			rowHeaders: true,
			autoColumnSize: true,
			autoRowSize: true,
			renderer: "markdown",
			className: "csv-table",
			contextMenu: true,
			currentRowClassName: "active-row",
			currentColClassName: "active-col",
			columnSorting: true,
			dropdownMenu: true,
			filters: true,
			manualColumnFreeze: true,
			manualColumnMove: false,  // moving columns causes too many headaches for now
			manualColumnResize: true,
			manualRowMove: false,  // moving rows causes too many headaches for now
			manualRowResize: true,
			persistentState: true,
			// preventOverflow: true,
			search: true, // TODO:290 Hijack the search ui from markdown views,
			height: "100%",
			width: "100%",
			// stretchH: 'last'
		};

		this.hot = new Handsontable(hotContainer, this.hotSettings);
		this.hotExport = this.hot.getPlugin("exportFile");
		this.hotState = this.hot.getPlugin("persistentState");
		this.hotFilters = this.hot.getPlugin("filters");
	}

	// Trigger auto-save if enabled.
	requestAutoSave = (): void => {
		if (this.autoSaveValue) {
			this.requestSave();
		}
	};

	// Trigger manual save if auto-save is disabled.
	requestManualSave = (): void => {
		if (!this.autoSaveValue) {
			this.requestSave();
		}
	};

	// Handler for any changes made within the table.
	hotChange = (changes: Handsontable.CellChange[], source: Handsontable.ChangeSource): void => {
		if (source === "loadData") {
			return; // Skip saving changes triggered by data loading.
		}
		this.requestAutoSave();
	};

	// Generates the CSV content from the current Handsontable data.
	override getViewData(): string {
		if (this.hot && !this.hot.isDestroyed) {
			// Get the unfiltered source data.
			const data = this.hot.getSourceDataArray();
			// If headers are custom, add them back.
			if (this.hotSettings.colHeaders !== true) {
				data.unshift(this.hot.getColHeader());
			}
			return unparse(data);
		}
		return this.data;
	}

	// Loads view data into the Handsontable.
	override setViewData(data: string, clear: boolean): void {
		this.data = data;
		this.loadingBar.show();

		// Use debounce to avoid repeated quick calls.
		debounce(async () => {
			try {
				await this.loadDataAsync(data);
				console.log("Data loaded successfully.");
			} catch (e: any) {
				this.handleLoadError(e);
			} finally {
				this.loadingBar.hide();
			}
		}, 50, true).apply(this);
	}

	// Asynchronously parses the CSV data and loads it into Handsontable.
	async loadDataAsync(data: string): Promise<void> {
		// Set a unique ID for persistent settings.
		this.hot.rootElement.id = this.file.path;
		this.hotSettings.colHeaders = true;

		// Parse CSV data using the helper function.
		const result = await parseCsvData(data);
		this.hot.loadData(result.data);
		this.hot.updateSettings(this.hotSettings);

		// Load persistent header setting.
		const hasHeadings = { value: false };
		this.hotState.loadValue("hasHeadings", hasHeadings);
		this.headerToggle.setValue(hasHeadings.value);
		this.toggleHeaders(hasHeadings.value);
	}

	// Centralized error handling during CSV data loading.
	handleLoadError(e: any): void {
		const errorTimeout = 5000;
		new Notice(`Error loading CSV: ${JSON.stringify(e)}`, errorTimeout);
		console.error(`Error loading data from ${this.file.name}`, e);
		this.hot?.destroy();
		this.hot = undefined;
		this.app.workspace.getLeaf().detach();
	}

	// Clears the table and its undo history.
	override clear() {
		this.hot?.clear();
		this.hot?.clearUndo();
	}

	// Saves the CSV file with a user-friendly notice.
	override async save(clear?: boolean): Promise<void> {
		const saveNoticeTimeout = 1000;
		try {
			await super.save(clear);
			new Notice(`"${this.file.name}" was saved.`, saveNoticeTimeout);
		} catch (e) {
			new Notice(`"${this.file.name}" couldn't be saved.`, saveNoticeTimeout);
			throw e;
		}
	}

	// Toggles between using the first row as headers versus default numbered headers.
	toggleHeaders = (value: boolean) => {
		value = value || false;
		if (value) {
			// Conditionally extract headers from the first row.
			if (this.hotSettings.colHeaders === true) {
				const data = this.hot.getSourceDataArray();
				this.hotSettings.colHeaders = data.shift();
				this.hot.loadData(data);
				this.hot.updateSettings(this.hotSettings);
			}
		} else {
			// Revert back to the default header display.
			if (this.hotSettings.colHeaders !== true) {
				const data = this.hot.getSourceDataArray();
				data.unshift(this.hot.getColHeader());
				this.hotSettings.colHeaders = true;
				this.hot.loadData(data);
				this.hot.updateSettings(this.hotSettings);
			}
		}
		// Save header preference persistently.
		this.hotState.saveValue("hasHeadings", value);
	};

	// Custom markdown cell renderer that applies cell alignments and renders markdown.
	markdownCellRenderer = async (
		instance: Handsontable,
		TD: HTMLTableCellElement,
		row: number,
		col: number,
		prop: string | number,
		value: Handsontable.CellValue,
		cellProperties: Handsontable.CellProperties
	): Promise<HTMLTableCellElement> => {
		TD.innerHTML = "";
		if (cellProperties.className) {
			const htmlClass: string[] = Array.isArray(cellProperties.className)
				? cellProperties.className
				: cellProperties.className.split(" ");
			TD.style.textAlign = "";
			for (const c of htmlClass) {
				switch (c) {
				case "htLeft":
					TD.style.textAlign = "left";
					break;
				case "htCenter":
					TD.style.textAlign = "center";
					break;
				case "htRight":
					TD.style.textAlign = "right";
					break;
				case "htJustify":
					TD.style.textAlign = "justify";
					break;
				case "htTop":
					TD.style.verticalAlign = "top";
					break;
				case "htMiddle":
					TD.style.verticalAlign = "middle";
					break;
				case "htBottom":
					TD.style.verticalAlign = "bottom";
					break;
				default:
					break;
				}
			}
		}
		await MarkdownRenderer.render(
			this.app,
			value,
			TD,
			this.file?.path || "",
			this || null
		);
		return TD;
	};

	// Returns the document title.
	getDisplayText(): string {
		return this.file ? this.file.basename : "csv (no file)";
	}

	// Validates that this view only handles CSV files.
	canAcceptExtension(extension: string): boolean {
		return extension === "csv";
	}

	// Specifies the view type.
	getViewType(): string {
		return "csv";
	}

	// Specifies the icon for this view.
	getIcon(): string {
		return "document-csv";
	}
}
