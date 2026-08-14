import type { CallToolResult } from "@modelcontextprotocol/server";
import { OpenCMSError, ValidationError } from "@opencms/core";

function asStructured(data: unknown): Record<string, unknown> {
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return { result: data as never };
}

export function ok(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: asStructured(data),
  };
}

export function fail(err: unknown): CallToolResult {
  if (err instanceof ValidationError) {
    const payload = { error: err.code, message: err.message, issues: err.issues };
    return { isError: true, content: [{ type: "text", text: JSON.stringify(payload) }] };
  }
  if (err instanceof OpenCMSError) {
    const payload = { error: err.code, message: err.message };
    return { isError: true, content: [{ type: "text", text: JSON.stringify(payload) }] };
  }
  console.error(err);
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: "internal", message: "internal server error" }) }],
  };
}
