import { NextRequest, NextResponse } from "next/server";
import { compileHybridSource } from "../../../../lib/vm/hybrid-pipeline";

export const runtime = "nodejs";

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

    if (source.length > 100_000) {
      return NextResponse.json(
        {
          success: false,
          error: "Source exceeds the 100000 character limit.",
        },
        { status: 413 }
      );
    }

    const result = compileHybridSource(source);

    return NextResponse.json(result, {
      status: result.success ? 200 : 400,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unexpected hybrid pipeline error.",
      },
      { status: 500 }
    );
  }
}
