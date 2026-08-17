import fs from "node:fs";
import path from "node:path";

const LOG_FILE_PATH = path.resolve(process.cwd(), "webhook-debug.log");

export function appendWebhookDebugLog(entry: string): void {
  try {
    const timestamp = new Date().toISOString();
    const divider = "─".repeat(75);
    const formatted = `\n[${timestamp}]\n${entry}\n${divider}\n`;
    fs.appendFileSync(LOG_FILE_PATH, formatted, "utf8");
  } catch (err) {
    console.error("Failed to write to webhook-debug.log:", err);
  }
}
