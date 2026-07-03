export class HarnessError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "HarnessError";
  }
}

export class AuthError extends HarnessError {
  constructor(message: string) {
    super("AUTH_ERROR", message);
    this.name = "AuthError";
  }
}

export class ProviderError extends HarnessError {
  constructor(message: string) {
    super("PROVIDER_ERROR", message);
    this.name = "ProviderError";
  }
}

export class PolicyDeniedError extends HarnessError {
  constructor(message: string) {
    super("POLICY_DENIED", message);
    this.name = "PolicyDeniedError";
  }
}

export class ToolTimeoutError extends HarnessError {
  constructor(message: string) {
    super("TOOL_TIMEOUT", message);
    this.name = "ToolTimeoutError";
  }
}
