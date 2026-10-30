
import { tokenizeLuau } from "./tokenizer";
import { validateLuau } from "./validator";

export type CompatibilityTarget =
  | "delta-android"
  | "roblox-client"
  | "generic-luau";

export interface CompatibilityResult {
  compatible: boolean;
  target: CompatibilityTarget;
  errors: string[];
  warnings: string[];
  tokenCount: number;
  detectedGlobals: string[];
}

const KNOWN_GLOBALS = new Set([
  "game",
  "workspace",
  "script",
  "shared",
  "_G",
  "Enum",
  "Instance",
  "Vector3",
  "Vector2",
  "CFrame",
  "Color3",
  "UDim2",
  "UDim",
  "Ray",
  "RaycastParams",
  "task",
  "coroutine",
  "debug",
  "math",
  "string",
  "table",
  "bit32",
  "buffer",
  "utf8",
  "os",
  "print",
  "warn",
  "error",
  "assert",
  "pcall",
  "xpcall",
  "pairs",
  "ipairs",
  "next",
  "select",
  "type",
  "typeof",
  "tostring",
  "tonumber",
  "rawequal",
  "rawget",
  "rawset",
  "setmetatable",
  "getmetatable",
  "require",
  "request",
  "http_request",
  "getgenv",
  "getrenv",
  "getrawmetatable",
  "setreadonly",
  "isreadonly",
  "hookfunction",
  "newcclosure",
  "checkcaller",
  "identifyexecutor",
  "gethui"
]);

export function checkCompatibility(
  source: string,
  target: CompatibilityTarget = "delta-android"
): CompatibilityResult {
  const validation = validateLuau(source);

  if (!validation.valid) {
    return {
      compatible: false,
      target,
      errors: validation.errors,
      warnings: [],
      tokenCount: validation.tokenCount,
      detectedGlobals: []
    };
  }

  const tokens = tokenizeLuau(source);

  const detectedGlobals = Array.from(
    new Set(
      tokens
        .filter(token =>
          token.type === "identifier" &&
          KNOWN_GLOBALS.has(token.value)
        )
        .map(token => token.value)
    )
  );

  const warnings: string[] = [];

  if (detectedGlobals.includes("request") ||
      detectedGlobals.includes("http_request")) {
    warnings.push(
      "Executor HTTP APIs detected. Runtime availability must be tested."
    );
  }

  if (detectedGlobals.includes("getgenv") ||
      detectedGlobals.includes("getrenv")) {
    warnings.push(
      "Executor environment APIs detected. Preserve their global access."
    );
  }

  if (target === "delta-android") {
    warnings.push(
      "Delta compatibility requires testing on the actual Android runtime."
    );
  }

  return {
    compatible: true,
    target,
    errors: [],
    warnings,
    tokenCount: tokens.length,
    detectedGlobals
  };
}
