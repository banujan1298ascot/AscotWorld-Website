import { NextResponse } from "next/server";

/** An error with an HTTP status attached, thrown from anywhere in the server
 *  layer (auth guards, service functions) and translated by apiErrorResponse
 *  at the route handler boundary. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Shared error -> HTTP response mapping for route handlers. */
export function apiErrorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(error);
  return NextResponse.json({ error: "Internal server error." }, { status: 500 });
}
