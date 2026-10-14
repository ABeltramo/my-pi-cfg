/**
 * Path Guard Extension
 *
 * Asks for user confirmation when the agent tries to access a path outside
 * the current workspace (the pi process working directory).
 *
 * Covers: read, write, edit, find, ls, grep (path arguments)
 * and bash (absolute paths, ~/ references, $HOME, and ../ escapes).
 *
 * Non-interactive runs (no UI) are blocked by default for safety.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import fs from "node:fs";

export default function (pi: ExtensionAPI) {
	const workspace = fs.realpathSync(process.cwd());

	// Paths that are safe to access without a prompt.
	// /tmp gets prefix matching: models often place temp files and repo
	// checkouts there. macOS temp dirs get the same treatment.
	const systemAllow = ["/dev/null", "/dev/zero", "/dev/stdin", "/dev/stdout", "/dev/stderr"];
	const allowPrefixes = ["/tmp/", "/var/folders/"];

	const isAllowed = (raw: string): boolean => {
		const resolved = path.resolve(expand(raw));
		return (
			systemAllow.includes(resolved) ||
			allowPrefixes.some((p) => resolved === p.slice(0, -1) || resolved.startsWith(p))
		);
	};

	const expand = (target: string): string =>
		target === "~" || target.startsWith("~/")
			? path.join(process.env.HOME ?? "/root", target.slice(1))
			: target;

	const isInside = (raw: string): boolean => {
		const target = expand(raw);
		try {
			const resolved = fs.realpathSync(path.resolve(target));
			return resolved === workspace || resolved.startsWith(workspace + path.sep);
		} catch {
			// Path does not exist yet (for example a write target).
			const resolved = path.resolve(target);
			return resolved === workspace || resolved.startsWith(workspace + path.sep);
		}
	};

	const guard = async (
		label: string,
		target: string,
		ctx: Parameters<Parameters<ExtensionAPI["on"]>[1]>[1],
	) => {
		if (isAllowed(target) || isInside(target)) return undefined;

		if (!ctx.hasUI) {
			return {
				block: true,
				reason: `Blocked ${label} outside workspace (no UI to confirm): ${target}`,
			};
		}

		const allowed = await ctx.ui.confirm(
			`Allow ${label} outside the workspace?\n\n  workspace: ${workspace}\n  target:    ${target}`,
			`path-guard: ${label}`,
		);
		if (!allowed) {
			return { block: true, reason: `User denied ${label} outside workspace: ${target}` };
		}
		return undefined;
	};

	pi.on("tool_call", async (event, ctx) => {
		const t = event.toolName;

		// Tools that take a direct path argument.
		if (t === "read" || t === "write" || t === "edit" || t === "find" || t === "ls") {
			const target = event.input.path as string | undefined;
			if (!target) return undefined;
			return guard(t, target, ctx);
		}

		if (t === "grep") {
			const target = (event.input.path ?? event.input.cwd) as string | undefined;
			if (!target) return undefined;
			return guard(t, target, ctx);
		}

		if (t === "bash") {
			const rawCommand = (event.input.command as string | undefined) ?? "";
			// Expand $HOME / ${HOME} so indirection cannot hide the target.
			const home = process.env.HOME ?? "/root";
			const command = rawCommand.replace(/\$\{?HOME\}?/g, home);
			// Find absolute paths, ~/ references, and ../ escapes in the command string.
			// Skip URLs and option flags.
			const candidates =
				command.match(/(?:^|[\s'"=;|&()])(\/[^\s'"|;&<>()]+|~(?:\/[^\s'"|;&<>()]+)?|\.\.[^\s'"|;&<>()]*)/g) ?? [];
			for (const raw of candidates) {
				let target = raw.trim().replace(/^['"]/, "");
				if (target.startsWith("//")) continue; // protocol-relative URL
				if (/^\/+https?:/.test(target)) continue;
				if (target.startsWith("~")) {
					target = path.join(home, target.slice(1));
				} else if (target.startsWith("..")) {
					// Resolve a relative escape against the workspace.
					target = path.resolve(workspace, target);
				}
				const blocked = await guard("bash", target, ctx);
				if (blocked) return blocked;
			}
			return undefined;
		}

		return undefined;
	});
}
