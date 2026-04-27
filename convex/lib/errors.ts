export class AppError extends Error {
  constructor(
    public readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function notFound(resource: string): AppError {
  return new AppError("not_found", `${resource} not found`);
}

export function forbidden(message = "forbidden"): AppError {
  return new AppError("forbidden", message);
}

export function badRequest(message = "bad_request"): AppError {
  return new AppError("bad_request", message);
}
