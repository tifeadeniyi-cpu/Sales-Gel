export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = "Please sign in to continue.") {
    super(message, "unauthenticated", 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You don't have permission to do that.", readonly permission?: string) {
    super(message, "forbidden", 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found.") {
    super(message, "not_found", 404);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, fieldErrors?: Record<string, string[]>) {
    super(message, "validation_failed", 422, fieldErrors);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, "conflict", 409);
  }
}
