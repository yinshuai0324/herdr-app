export function quoteShell(value) {
  return "'" + value.replaceAll("'", "'\"'\"'") + "'"
}
