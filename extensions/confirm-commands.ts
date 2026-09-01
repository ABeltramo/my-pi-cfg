import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

interface PermissionSettings {
  permissions: {
    allow: string[];
  };
}

export default function (pi: ExtensionAPI) {
  // Use .claude/settings.local.json for compatibility with Claude Code
  const getSettingsPath = (cwd: string) => path.join(cwd, ".claude", "settings.local.json");

  const loadSettings = (settingsPath: string): PermissionSettings => {
    try {
      if (fs.existsSync(settingsPath)) {
        const content = fs.readFileSync(settingsPath, "utf-8");
        const json = JSON.parse(content);
        if (json && json.permissions && Array.isArray(json.permissions.allow)) {
          return json;
        }
      }
    } catch (e) {
      // Silently fail and return empty settings
    }
    return { permissions: { allow: [] } };
  };

  const saveSettings = (settingsPath: string, settings: PermissionSettings) => {
    try {
      const dir = path.dirname(settingsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      let currentSettings: PermissionSettings = { permissions: { allow: [] } };
      if (fs.existsSync(settingsPath)) {
        try {
          const content = fs.readFileSync(settingsPath, "utf-8");
          currentSettings = JSON.parse(content);
        } catch (e) {}
      }

      const combinedAllow = Array.from(new Set([
        ...(currentSettings.permissions?.allow || []),
        ...(settings.permissions?.allow || [])
      ]));

      const finalSettings = {
        ...currentSettings,
        permissions: {
          ...currentSettings.permissions,
          allow: combinedAllow
        }
      };

      fs.writeFileSync(settingsPath, JSON.stringify(finalSettings, null, 2));
    } catch (e) {
      console.error("Failed to save permissions settings:", e);
    }
  };

  let allowAllToolCallsUntilTextReply = false;

  const isAllowed = (command: string, allowList: string[]): boolean => {
    return allowList.some(pattern => {
      const match = pattern.match(/^(\w+)\((.*)\)$/);
      if (!match) return false;

      const [_, tool, cmdPattern] = match;
      if (tool !== "Bash") return false;

      const escapedPattern = cmdPattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*");

      const regex = new RegExp(`^${escapedPattern}$`);
      return regex.test(command);
    });
  };

  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant") {
      return;
    }

    const hasTextReply = event.message.content.some(
      (block) => block.type === "text" && block.text.trim().length > 0
    );
    if (hasTextReply) {
      allowAllToolCallsUntilTextReply = false;
    }
  });

  pi.on("agent_end", () => {
    allowAllToolCallsUntilTextReply = false;
  });

  pi.on("tool_call", async (event, ctx) => {
    if (allowAllToolCallsUntilTextReply) {
      return;
    }

    if (isToolCallEventType("bash", event)) {
      const command = event.input.command;
      const settingsPath = getSettingsPath(ctx.cwd);
      const settings = loadSettings(settingsPath);

      if (isAllowed(command, settings.permissions.allow)) {
        return;
      }

      // To allow editing, we use ctx.ui.input which provides a text editor field
      // But first, we show a selector to decide the action.
      const action = await ctx.ui.select(
        "Bash Command Permission",
        [
          "Yes (Run once)",
          "Yes (Run until text reply)",
          "No (Cancel)",
          "Always allow (Edit pattern)",
        ]
      ) as string;

      if (action === "Yes (Run until text reply)") {
        allowAllToolCallsUntilTextReply = true;
        return;
      }

      // Handle cancellation (Esc/Ctrl+C) and explicit denial.
      if (!action || action === "No (Cancel)") {
        let reason = "";

        if (action === "No (Cancel)") {
          const enteredReason = await ctx.ui.input(
            "Why are you denying this command? (optional)",
            "Tell the agent what it must do instead..."
          );
          reason = enteredReason?.trim() ?? "";
        }

        return {
          block: true,
          reason: reason
            ? `User denied permission for this command. Reason: ${reason}`
            : "User denied permission for this command."
        };
      }

      if (action === "Always allow (Edit pattern)") {
        // Open an input field with the command pre-filled for the user to edit into a pattern
        const editedPattern = await ctx.ui.input(
          "Edit pattern (e.g. 'Bash(curl -X POST *)')",
          `Bash(${command})`
        );

        if (editedPattern && editedPattern.trim().length > 0) {
          // The user should have typed something like "Bash(curl *)"
          // We wrap it in the required Bash(...) format if they only typed the inner part
          let finalPattern = editedPattern.trim();
          if (!finalPattern.startsWith("Bash(")) {
            finalPattern = `Bash(${finalPattern})`;
          }

          saveSettings(settingsPath, { permissions: { allow: [finalPattern] } });
          ctx.ui.notify(`Added pattern: ${finalPattern}`, "success");
          return;
        } else {
          // If they cancelled the input, treat it as a denial
          return {
            block: true,
            reason: "User cancelled pattern editing."
          };
        }
      }

      // If choice is "Yes (Run once)", we just let it fall through and execute.
    }
  });
}
