import { NextRequest, NextResponse } from "next/server";
import { analyzeLuauCompatibility } from "../../../../lib/vm/compatibility-analyzer";
import { validateVMCompiler } from "../../../../lib/vm/compiler-validation";

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
          error: "Source exceeds the 100000 character limit.",
        },
        { status: 413 }
      );
    }

    const compatibility = analyzeLuauCompatibility(source);
    const compiler = validateVMCompiler(source);

    return NextResponse.json({
      success: true,
      analyzer: "VXC VM Compiler Validation",
      version: "5K",
      compatibility,
      compiler,
      vmReady:
        compatibility.structurallyValid &&
        compiler.supported,
      recommendation: compiler.supported
        ? "Compiler accepted this source. It is ready for the next VM pipeline test, but runtime execution still needs testing."
        : "The current VM compiler cannot compile this source. Do not send it to the VM execution pipeline.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unexpected validation error.",
      },
      { status: 500 }
    );
  }
}
