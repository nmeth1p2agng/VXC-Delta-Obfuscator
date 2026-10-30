
import { NextRequest, NextResponse } from "next/server";
import { obfuscateLuau } from "../../../../lib/obfuscator";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const source =
      typeof body.code === "string"
        ? body.code
        : typeof body.text === "string"
          ? body.text
          : null;

    if (source === null) {
      return NextResponse.json(
        {
          success: false,
          errors: ["Missing code or text field."]
        },
        { status: 400 }
      );
    }

    const result = obfuscateLuau(source, {
      target: "delta-android"
    });

    return NextResponse.json(
      result,
      { status: result.success ? 200 : 422 }
    );
  } catch {
    return NextResponse.json(
      {
        success: false,
        errors: ["Invalid JSON request."]
      },
      { status: 400 }
    );
  }
}
