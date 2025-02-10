import { ParseResult, parse } from "papaparse";

/**
 * Parses a CSV data string and returns a Promise of the parsing result.
 * This utility removes any Byte Order Mark before parsing.
 *
 * @param data - The CSV data as a string.
 * @returns A Promise that resolves with the parse result or rejects with parsing errors.
 */
export function parseCsvData(data: string): Promise<ParseResult<string[]>> {
	// Remove Byte Order Mark if exists (common with Excel export)
	if (data.charCodeAt(0) === 0xFEFF) {
		data = data.slice(1);
	}
	return new Promise((resolve, reject) => {
		parse<string[]>(data, {
			header: false,
			complete: (results: ParseResult<string[]>) => {
				if (results.errors && results.errors.length > 0) {
					reject(results.errors);
				} else {
					resolve(results);
				}
			}
		});
	});
}
