// SPDX-License-Identifier: GPL-3.0-only
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type DigestLevel = "none" | "normal" | "heavy";
export interface Config {
	cacheDir: string;
	maxContextChars: number;
	digestLevel: DigestLevel;
	/** Maximum PDF pages analyzed per digest. 0 means unlimited. */
	maxPdfPages: number;
	/** Maximum extracted source characters analyzed per digest. 0 means unlimited. */
	maxSourceChars: number;
	/** Per nested digest model request timeout in milliseconds. 0 uses provider/pi defaults. */
	digestTimeoutMs: number;
}

export const DEFAULT_CONFIG: Config = {
	cacheDir: join(homedir(), ".pi", "agent", "zotero-pi-cache"),
	maxContextChars: 180000,
	digestLevel: "normal",
	maxPdfPages: 160,
	maxSourceChars: 480000,
	digestTimeoutMs: 600000,
};

function expandHome(path: string) { return path.startsWith("~/") ? join(homedir(), path.slice(2)) : resolve(path); }
async function readJson(path: string) {
	try { return JSON.parse(await readFile(path, "utf8")); }
	catch (error: any) {
		if (error.code === "ENOENT") return {};
		throw new Error(`zotero-pi: Cannot read ${path}: ${error.message}`);
	}
}
function validate(data: any, source: string): Partial<Config> {
	if (data.cacheDir !== undefined && typeof data.cacheDir !== "string") throw new Error(`zotero-pi: ${source}: cacheDir must be a path string.`);
	if (data.maxContextChars !== undefined && (!Number.isInteger(data.maxContextChars) || data.maxContextChars < 1000)) throw new Error(`zotero-pi: ${source}: maxContextChars must be an integer >= 1000.`);
	if (data.digestLevel !== undefined && !["none", "normal", "heavy"].includes(data.digestLevel)) throw new Error(`zotero-pi: ${source}: digestLevel must be "none", "normal", or "heavy".`);
	for (const key of ["maxPdfPages", "maxSourceChars"] as const) {
		if (data[key] !== undefined && (!Number.isInteger(data[key]) || data[key] < 0)) throw new Error(`zotero-pi: ${source}: ${key} must be an integer >= 0 (0 = unlimited).`);
	}
	if (data.digestTimeoutMs !== undefined && (!Number.isInteger(data.digestTimeoutMs) || data.digestTimeoutMs < 0)) throw new Error(`zotero-pi: ${source}: digestTimeoutMs must be an integer >= 0.`);
	const allowed = ["cacheDir", "maxContextChars", "digestLevel", "maxPdfPages", "maxSourceChars", "digestTimeoutMs"];
	const unknown = Object.keys(data).filter(key => !allowed.includes(key) && !["bibliography", "collections", "longDocumentPageThreshold"].includes(key));
	if (unknown.length) throw new Error(`zotero-pi: ${source}: unknown settings: ${unknown.join(", ")}. Supported: ${allowed.join(", ")}.`);
	return data;
}

export function configPaths(cwd: string, projectTrusted: boolean) {
	const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
	return {
		global: join(agentDir, "zotero-pi.json"),
		project: projectTrusted ? join(cwd, ".pi", "zotero-pi.json") : undefined,
	};
}

export async function loadConfig(cwd: string, projectTrusted: boolean): Promise<Config> {
	const paths = configPaths(cwd, projectTrusted);
	const global = validate(await readJson(paths.global), paths.global);
	const project = paths.project ? validate(await readJson(paths.project), paths.project) : {};
	const merged: Config = { ...DEFAULT_CONFIG, ...global, ...project };
	merged.cacheDir = expandHome(merged.cacheDir);
	return merged;
}
