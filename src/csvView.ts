// This is the custom view
import {
	debounce,
	MarkdownRenderer,
	Notice,
	Setting,
	TextFileView,
	TFile,
	ToggleComponent,
	WorkspaceLeaf
} from "obsidian";

import * as Papa from "papaparse";
import {ParseError, ParseResult} from "papaparse";
import Handsontable from "handsontable";

export class CsvView extends TextFileView {
	// autoSaveToggle: ToggleComponent;
	// saveButton: ButtonComponent;
	autoSaveValue: boolean;
	parseResult: ParseResult<string[]>;
	headerToggle: ToggleComponent;
	// headers: string[] = null;
	fileOptionsEl: HTMLElement;
	hot: Handsontable;
	hotSettings: Handsontable.GridSettings;
	hotExport: Handsontable.plugins.ExportFile;
	hotState: Handsontable.plugins.PersistentState;
	hotFilters: Handsontable.plugins.Filters;
	loadingBar: HTMLElement;

	// this.contentEl is not exposed, so cheat a bit.
	public get extContentEl(): HTMLElement {
		return this.contentEl;
	}

	// constructor
	constructor(leaf: WorkspaceLeaf) {
		//Calling the parent constructor
		super(leaf);
		this.autoSaveValue = true;
		this.onResize = () => {
			// this.hot.view.wt.wtOverlays.updateMainScrollableElements();
			this.hot.render();
		};
		this.loadingBar = document.createElement("div");
		this.loadingBar.addClass("progress-bar");
		this.loadingBar.innerHTML = "<div class=\"progress-bar-message u-center-text\">Loading CSV...</div><div class=\"progress-bar-indicator\"><div class=\"progress-bar-line\"></div><div class=\"progress-bar-subline\" style=\"display: none;\"></div><div class=\"progress-bar-subline mod-increase\"></div><div class=\"progress-bar-subline mod-decrease\"></div></div>";
		this.extContentEl.appendChild(this.loadingBar);

		this.fileOptionsEl = document.createElement("div");
		this.fileOptionsEl.classList.add("csv-controls");
		this.extContentEl.appendChild(this.fileOptionsEl);

		//Creating a toggle to set the header
		new Setting(this.fileOptionsEl)
			.setName("File Includes Headers")
			.addToggle(toggle => {
				this.headerToggle = toggle;
				toggle.setValue(false).onChange(this.toggleHeaders);
			});

		const tableContainer = document.createElement("div");
		tableContainer.classList.add("csv-table-wrapper");
		this.extContentEl.appendChild(tableContainer);

		const hotContainer = document.createElement("div");
		tableContainer.appendChild(hotContainer);


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

	requestAutoSave = (): void => {
		if (this.autoSaveValue) {
			this.requestSave();
		}
	};

	requestManualSave = (): void => {
		if (!this.autoSaveValue) {
			this.requestSave();
		}
	};

	hotChange = (changes: Handsontable.CellChange[], source: Handsontable.ChangeSource): void => {
		if (source === "loadData") {
			return; //don't save this change
		}

		if (this.requestAutoSave) {
			this.requestAutoSave();
		} else {
			console.error("Couldn't auto save...");
		}
	};

	// get the new file contents
	override getViewData(): string {
		if (this.hot && !this.hot.isDestroyed) {
			// get the *source* data (i.e. unfiltered)
			const data = this.hot.getSourceDataArray();
			if (this.hotSettings.colHeaders !== true) {
				data.unshift(this.hot.getColHeader());
			}

			return Papa.unparse(data);
		} else {
			return this.data;
		}
	}

	// Setting the view from the previously set data
	override setViewData(data: string, clear: boolean): void {
		this.data = data;
		this.loadingBar.show();
		debounce(() => this.loadDataAsync(data)
			.then(() => {
				console.log("Loading data correctly.");
				this.loadingBar.hide();
			})
			.catch((e: any) => {
				const ErrorTimeout = 5000;
				this.loadingBar.hide();
				if (Array.isArray(e)) {
					console.error(`Catch ${e.length > 1 ? "multiple errors" : "an error"} during the loading of the data from "${this.file.name}".`);
					for (const error of e) {
						if (error.hasOwnProperty("message")) {
							console.error(error["message"], error);
							new Notice(error["message"], ErrorTimeout);
						} else {
							console.error(JSON.stringify(error), error);
							new Notice(JSON.stringify(error), ErrorTimeout);
						}
					}
				} else {
					new Notice(JSON.stringify(e), ErrorTimeout);
					console.error(`Catch error during the loading of the data from ${this.file.name}\n`, e);
				}
				this.hot?.destroy();
				this.hot = undefined;
				// Close the window
				this.app.workspace.getLeaf().detach();
			}), 50, true,).apply(this);
		return;
	}

	loadDataAsync(data: string): Promise<void> {
		return new Promise<void>((resolve: (value: (PromiseLike<void> | void)) => void, reject: ParseError[] | any) => {
			// for the sake of persistent settings we need to set the root element id
			this.hot.rootElement.id = this.file.path;
			this.hotSettings.colHeaders = true;

			// strip Byte Order Mark if necessary (damn you, Excel)
			if (data.charCodeAt(0) === 0xFEFF) data = data.slice(1);

			// parse the incoming data string
			Papa.parse<string[]>(data, {
				header: false,
				complete: (results: ParseResult<string[]>) => {
					//Handle the errors
					if (results.errors !== undefined && results.errors.length !== 0) {
						reject(results.errors);
						return;
					}

					this.parseResult = results;

					// load the data into the table
					this.hot.loadData(this.parseResult.data);
					// we also need to update the settings so that the persistence will work
					this.hot.updateSettings(this.hotSettings);

					// load the persistent setting for headings
					const hasHeadings = {value: false};
					this.hotState.loadValue("hasHeadings", hasHeadings);
					this.headerToggle.setValue(hasHeadings.value);

					// toggle the headers on or off based on the loaded value
					this.toggleHeaders(hasHeadings.value);
					resolve();
				}
			});
		});
	}

	override clear() {
		// clear the view content
		this.hot?.clear();
		this.hot?.clearUndo();
	}

	//Unloading the data
	override async onUnloadFile(file: TFile): Promise<void> {
		await super.onUnloadFile(file);
		return;
	}

	override async save(clear?: boolean): Promise<void> {
		const SaveNoticeTimeout = 1000;
		try {
			await super.save(clear);
			new Notice(`"${this.file.name}" was saved.`, SaveNoticeTimeout);
		} catch (e) {
			new Notice(`"${this.file.name}" couldn't be saved.`, SaveNoticeTimeout);
			throw e;
		}
	}

	// Arrow function because "this" can bug
	toggleHeaders = (value: boolean) => {
		value = value || false; // just in case it's undefined
		// turning headers on
		if (value) {
			// we haven't specified headers yet
			if (this.hotSettings.colHeaders === true) {
				// get the data
				const data = this.hot.getSourceDataArray();
				// take the first row off the data to use as headers
				this.hotSettings.colHeaders = data.shift();
				// reload the data without this first row
				this.hot.loadData(data);
				// update the settings
				this.hot.updateSettings(this.hotSettings);
			}
		} else { // turning headers off
			// we have headers
			if (this.hotSettings.colHeaders !== true) {
				// get the data
				const data = this.hot.getSourceDataArray();
				// put the headings back in as a row
				data.unshift(this.hot.getColHeader());
				// specify true to just display alphabetical headers
				this.hotSettings.colHeaders = true;
				// reload the data with this new first row
				this.hot.loadData(data);
				// update the settings
				this.hot.updateSettings(this.hotSettings);
			}
		}

		// set this value to the state
		this.hotState.saveValue("hasHeadings", value);
	};

	// DO NOT TRANSFORM THIS INTO A REAL FUNCTION
	markdownCellRenderer = async (instance: Handsontable, TD: HTMLTableCellElement, row: number, col: number, prop: string | number, value: Handsontable.CellValue, cellProperties: Handsontable.CellProperties): Promise<HTMLTableCellElement | void> => {
		TD.innerHTML = "";
		if (cellProperties.className) {
			const htmlClass: string[] = Array.isArray(cellProperties.className) ? cellProperties.className : cellProperties.className.split(" ");
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
		await MarkdownRenderer.render(this.app, value, TD, this.file?.path || "", this || null);
		return TD;
	};

	// gets the title of the document
	getDisplayText() {
		if (this.file) return this.file.basename;
		else return "csv (no file)";
	}

	// confirms this view can accept csv extension
	canAcceptExtension(extension: string) {
		return extension == "csv";
	}

	// the view type name
	getViewType() {
		return "csv";
	}

	// icon for the view
	getIcon() {
		return "document-csv";
	}
}
