export function CreateEmptyCSV(row = 1, col = 1): string {
	let csv = "";
	for (let x = 0; x < col; x++) {
		for (let y = 0; y < row; y++) {
			csv += "\"\"";
			if (y < row - 1) csv += ",";
		}
		csv += "\n";
	}
	return csv;
}
