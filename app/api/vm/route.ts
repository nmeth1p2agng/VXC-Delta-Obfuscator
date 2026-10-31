import { NextRequest, NextResponse } from "next/server";
import { compileToLuauVM } from "../../../lib/vm/vm-pipeline";

export const runtime = "nodejs";

const MAX_SOURCE_LENGTH = 100_000;

function errorResponse(message: string, status: number) {
  return NextResponse.json(
    {
      success: false,
      output: "",
      errors: [message],
      warnings: [],
    },
    { status }
  );
}

export async function POST(request: NextRequest) {
  try {
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return errorResponse("Invalid JSON request.", 400);
    }

    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body)
    ) {
      return errorResponse("Request body must be an object.", 400);
    }

    const data = body as {
      code?: unknown;
      text?: unknown;
      maxSteps?: unknown;
    };

    const source =
      typeof data.code === "string"
        ? data.code
        : typeof data.text === "string"
          ? data.text
          : null;

    if (source === null) {
      return errorResponse(
        "Missing source code. Use the code or text field.",
        400
      );
    }

    if (source.trim().length === 0) {
      return errorResponse("Source code cannot be empty.", 400);
    }

    if (source.length > MAX_SOURCE_LENGTH) {
      return errorResponse("Source code is too large.", 413);
    }

    let maxSteps = 100_000;

    if (data.maxSteps !== undefined) {
      if (
        typeof data.maxSteps !== "number" ||
        !Number.isInteger(data.maxSteps) ||
        data.maxSteps < 1 ||
        data.maxSteps > 1_000_000
      ) {
        return errorResponse(
          "maxSteps must be an integer between 1 and 1000000.",
          400
        );
      }

      maxSteps = data.maxSteps;
    }

    const result = compileToLuauVM(source, { maxSteps });

    return NextResponse.json(
      {
        ...result,
        errors: [],
      },
      { status: 200 }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown VM compilation error.";

    return NextResponse.json(
      {
        success: false,
        output: "",
        errors: [message],
        warnings: [],
      },
      { status: 422 }
    );
  }
}
