import "handsontable/dist/handsontable.full.min.css";
import "./styles.scss";
import {addIcon, Notice, Plugin, TFile, TFolder, WorkspaceLeaf} from "obsidian";
import {CreateEmptyCSV} from "./createEmptyCSV";
import {CsvView} from "./csvView";

export default class CsvPlugin extends Plugin {
	async onload() {
		//Create menu button to create a CSV
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (file instanceof TFolder) {
					const folder = file as TFolder;
					menu.addItem((item) => {
						item
							.setTitle("New CSV file")
							.setIcon("document")
							.onClick(async () => {
								//Searching if there is not already csv files named "Untitled".
								let index = 0;
								for (const child of folder.children) {
									if (child instanceof TFile) {
										const file = child as TFile;
										if (file.extension === "csv" && file.basename.contains("Untitled")) {
											const split = file.basename.split(" ");
											if (split.length > 1 && !isNaN(parseInt(split[1]))) {
												const i = parseInt(split[1]);
												index = i >= index ? i + 1 : index;
											} else {
												index = index > 0 ? index : 1;
											}
										}
									}
								}
								//Creating the file.
								const fileName = `Untitled${index > 0 ? ` ${index}` : ""}`;
								await this.app.vault.create(folder.path + `/${fileName}.csv`, CreateEmptyCSV(4, 4));
								new Notice(`The file "${fileName}" has been created in the folder "${folder.path}".`);

								// We're not opening the file as it cause error.
								// await this.app.workspace.activeLeaf.openFile(file);
							});
					});
				}
			})
		);

		// register a custom icon
		this.addDocumentIcon("csv");

		// register the view and extensions
		this.registerView("csv", this.csvViewCreator);
		this.registerExtensions(["csv"], "csv");
	}

	// function to create the view
	csvViewCreator = (leaf: WorkspaceLeaf) => {
		return new CsvView(leaf);
	};

	// this function used the regular 'document' svg,
	// but adds the supplied extension into the icon as well
	addDocumentIcon = (extension: string) => {
		addIcon(`document-${extension}`, `
  <path fill="currentColor" stroke="currentColor" d="M14,4v92h72V29.2l-0.6-0.6l-24-24L60.8,4L14,4z M18,8h40v24h24v60H18L18,8z M62,10.9L79.1,28H62V10.9z"></path>
  <text font-family="sans-serif" font-weight="bold" font-size="30" fill="currentColor" x="50%" y="60%" dominant-baseline="middle" text-anchor="middle">
    ${extension}
  </text>
    `);
	};
}
