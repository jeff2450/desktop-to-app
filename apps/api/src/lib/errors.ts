export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, message: string, code = "API_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class PlanLimitError extends ApiError {
  constructor(message: string) {
    super(402, message, "PLAN_LIMIT");
  }
}

export class ValidationError extends ApiError {
  constructor(message: string) {
    super(400, message, "VALIDATION_ERROR");
  }
}
