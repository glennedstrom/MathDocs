export function parseEquationCsv(source: string): string[] {
  const rows: string[] = [];
  let field = "";
  let inQuotes = false;
  let firstField = true;

  for (let index = 0; index <= source.length; index += 1) {
    const character = source[index] ?? "\n";
    const next = source[index + 1];
    if (character === '"' && inQuotes && next === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      inQuotes = !inQuotes;
    } else if (character === "," && !inQuotes) {
      if (firstField) rows.push(field.trim());
      field = "";
      firstField = false;
    } else if ((character === "\n" || character === "\r") && !inQuotes) {
      if (firstField) rows.push(field.trim());
      field = "";
      firstField = true;
      if (character === "\r" && next === "\n") index += 1;
    } else if (firstField) {
      field += character;
    }
  }

  return rows.filter(Boolean);
}

function escapeCsvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function serializeEquationCsv(equations: string[]): string {
  return `${equations.map(escapeCsvField).join("\n")}\n`;
}
