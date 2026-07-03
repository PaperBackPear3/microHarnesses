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

export class ValidationError extends HarnessError {
  constructor(message: string) {
    super("VALIDATION_ERROR", message);
    this.name = "ValidationError";
  }
}

export class UnknownToolError extends HarnessError {
  constructor(message: string) {
    super("UNKNOWN_TOOL", message);
    this.name = "UnknownToolError";
  }
}

export class DuplicateToolError extends HarnessError {
  constructor(message: string) {
    super("DUPLICATE_TOOL", message);
    this.name = "DuplicateToolError";
  }
}

export class PluginLoadError extends HarnessError {
  constructor(message: string) {
    super("PLUGIN_LOAD_ERROR", message);
    this.name = "PluginLoadError";
  }
}

export class PluginCapabilityError extends HarnessError {
  constructor(message: string) {
    super("PLUGIN_CAPABILITY_DENIED", message);
    this.name = "PluginCapabilityError";
  }
}

export class ConfigError extends HarnessError {
  constructor(message: string) {
    super("CONFIG_ERROR", message);
    this.name = "ConfigError";
  }
}
