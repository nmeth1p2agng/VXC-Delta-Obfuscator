import { tokenizeLuau } from "../tokenizer";

export interface GuiProtectionAnalysis {
  detected: boolean;
  instances: number;
  guiClasses: string[];
  eventConnections: number;
  guiEvents: string[];
  tweenCalls: number;
  inputHandlers: number;
  localDeclarations: number;
  protectedByPipeline: string[];
  preservedApiNames: string[];
  warnings: string[];
}

const GUI_CLASSES = new Set([
  "ScreenGui", "BillboardGui", "SurfaceGui", "Frame", "ScrollingFrame",
  "CanvasGroup", "TextLabel", "TextButton", "TextBox", "ImageLabel",
  "ImageButton", "ViewportFrame", "VideoFrame", "UIStroke", "UICorner",
  "UIGradient", "UIPadding", "UIScale", "UIAspectRatioConstraint",
  "UIListLayout", "UIGridLayout", "UITableLayout", "UIPageLayout",
  "UITextSizeConstraint", "UISizeConstraint"
]);

const GUI_EVENTS = new Set([
  "Activated", "MouseButton1Click", "MouseButton1Down", "MouseButton1Up",
  "MouseEnter", "MouseLeave", "InputBegan", "InputChanged", "InputEnded",
  "TouchTap", "FocusLost", "Focused", "Changed", "AncestryChanged",
  "GetPropertyChangedSignal"
]);

const INPUT_EVENTS = new Set([
  "InputBegan", "InputChanged", "InputEnded", "MouseButton1Click",
  "MouseButton1Down", "MouseButton1Up", "Activated", "TouchTap"
]);

const PRESERVED_API = new Set([
  "Instance", "new", "Connect", "Once", "Disconnect", "Wait",
  "GetPropertyChangedSignal", "FindFirstChild", "WaitForChild",
  "GetService", "TweenService", "Create", "Play", "Cancel",
  "UserInputService", "ContextActionService", "RunService",
  "Players", "LocalPlayer", "PlayerGui", "Parent", "Name", "ClassName",
  "Position", "Size", "AnchorPoint", "Visible", "Active", "Draggable",
  "Text", "TextColor3", "BackgroundColor3", "BackgroundTransparency",
  "Image", "ImageColor3", "ImageTransparency", "ZIndex", "DisplayOrder",
  "MouseButton1Click", "Activated", "InputBegan", "InputChanged", "InputEnded"
]);

function isStringValue(value: string): string | null {
  if (value.length < 2) return null;
  const quote = value[0];
  if ((quote !== "\"" && quote !== "'") || value[value.length - 1] !== quote) return null;
  const body = value.slice(1, -1);
  if (body.includes("\\")) return null;
  return body;
}

/**
 * Performs a conservative, token-based inventory of Roblox GUI constructs.
 * It intentionally does not rewrite Roblox properties/events: those names are
 * runtime API contracts and changing them would break GUI behavior.
 */
export function analyzeGuiProtection(source: string): GuiProtectionAnalysis {
  const tokens = tokenizeLuau(source);
  const guiClasses = new Set<string>();
  const guiEvents = new Set<string>();
  const warnings: string[] = [];
  let instances = 0;
  let eventConnections = 0;
  let tweenCalls = 0;
  let inputHandlers = 0;
  let localDeclarations = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const previous = tokens[i - 1];
    const next = tokens[i + 1];

    if (token.type === "keyword" && token.value === "local") localDeclarations++;

    const stringValue = token.type === "string" ? isStringValue(token.value) : null;
    if (stringValue && GUI_CLASSES.has(stringValue)) guiClasses.add(stringValue);

    if (token.type === "identifier" && token.value === "Instance" && next?.value === "." && tokens[i + 2]?.value === "new") {
      instances++;
    }

    if (token.type === "identifier" && GUI_EVENTS.has(token.value)) {
      guiEvents.add(token.value);
      if (INPUT_EVENTS.has(token.value)) inputHandlers++;
    }

    if (token.type === "identifier" && (token.value === "Connect" || token.value === "Once") && previous?.value === ".") {
      eventConnections++;
    }

    if (token.type === "identifier" && (token.value === "Create" || token.value === "GetTweenInfo") && previous?.value === ".") {
      tweenCalls++;
    }

    // Count common GUI class strings passed to Instance.new without requiring
    // a particular whitespace or quote style.
    if (token.type === "identifier" && token.value === "new" && previous?.value === "." && tokens[i - 2]?.value === "Instance") {
      const argument = tokens[i + 2];
      const className = argument?.type === "string" ? isStringValue(argument.value) : null;
      if (className && GUI_CLASSES.has(className)) guiClasses.add(className);
    }
  }

  const detected = instances > 0 || guiClasses.size > 0 || eventConnections > 0 || guiEvents.size > 0 || tweenCalls > 0;
  if (detected) {
    warnings.push("GUI constructs detected. Identifier, string, and number passes are applied by the main pipeline; Roblox API/property/event names are intentionally preserved.");
  }
  if (detected && localDeclarations > 0) {
    warnings.push("Local GUI variables are only renamed when the scope analyzer can prove their references safely; unsupported syntax is left unchanged.");
  }
  if (guiEvents.size > 0) {
    warnings.push("Event and callback behavior is preserved; event names and callback invocation contracts are not rewritten.");
  }

  return {
    detected,
    instances,
    guiClasses: Array.from(guiClasses).sort(),
    eventConnections,
    guiEvents: Array.from(guiEvents).sort(),
    tweenCalls,
    inputHandlers,
    localDeclarations,
    protectedByPipeline: ["scope-safe local identifiers", "string literals supported by string protection", "numeric literals supported by number protection"],
    preservedApiNames: Array.from(PRESERVED_API).sort(),
    warnings
  };
}
