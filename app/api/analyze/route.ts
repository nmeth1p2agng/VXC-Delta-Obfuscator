import { NextRequest, NextResponse } from "next/server";
import { analyzeLuauCompatibility } from "../../../lib/vm/compatibility-analyzer";

export const runtime = "nodejs";

const MAX_SOURCE_LENGTH = 100_000;

export async function POST(request: NextRequest) {
  try {
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid JSON request.",
        },
        { status: 400 }
      );
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        {
          success: false,
          error: "Request body must be a JSON object.",
        },
        { status: 400 }
      );
    }

    const data = body as Record<string, unknown>;
    const source = data.code ?? data.text;

    if (typeof source !== "string") {
      return NextResponse.json(
        {
          success: false,
          error: "Source code must be a string.",
        },
        { status: 400 }
      );
    }

    if (!source.trim()) {
      return NextResponse.json(
        {
          success: false,
          error: "Source code cannot be empty.",
        },
        { status: 400 }
      );
    }

    if (source.length > MAX_SOURCE_LENGTH) {
      return NextResponse.json(
        {
          success: false,
          error: `Source exceeds the ${MAX_SOURCE_LENGTH} character limit.`,
        },
        { status: 413 }
      );
    }

    const report = analyzeLuauCompatibility(source);

    return NextResponse.json(
      {
        success: true,
        analyzer: "VXC Luau Compatibility Analyzer",
        version: "5J",
        report,
        recommendation:
          report.level === "vm-supported"
            ? "The analyzer considers this source suitable for the current VM subset. Run a VM compilation test before using the output."
            : report.level === "partially-supported"
              ? "Some detected features are outside the current VM subset. Do not send this source directly to the VM."
              : "This source is not suitable for the current VM subset.",
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "An unexpected analysis error occurred.",
      },
      { status: 500 }
    );
  }
}
