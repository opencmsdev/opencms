export class OpenCMSError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class NotFoundError extends OpenCMSError {
  constructor(message: string) {
    super("not_found", message);
  }
}

export class ConflictError extends OpenCMSError {
  constructor(message: string) {
    super("conflict", message);
  }
}

export class UnauthorizedError extends OpenCMSError {
  constructor(message = "authentication required") {
    super("unauthorized", message);
  }
}

export class ForbiddenError extends OpenCMSError {
  constructor(message = "insufficient role") {
    super("forbidden", message);
  }
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export class ValidationError extends OpenCMSError {
  readonly issues: ValidationIssue[];
  constructor(message: string, issues: ValidationIssue[] = []) {
    super("validation", message);
    this.issues = issues;
  }
}
