import {
  type CredentialsRegistry,
  type ModelAdapter,
  ProviderModelAdapter,
  type ProviderRegistry,
  type StepInput,
  type StepPlan,
} from "@micro-harnesses/core";

export interface RuntimeModelSelection {
  provider: string;
  model?: string;
  maxTokens?: number;
}

export class RuntimeModelAdapter implements ModelAdapter {
  private readonly providers: ProviderRegistry;
  private readonly credentials: CredentialsRegistry;
  private readonly getSelection: () => RuntimeModelSelection;

  constructor(
    providers: ProviderRegistry,
    credentials: CredentialsRegistry,
    getSelection: () => RuntimeModelSelection,
  ) {
    this.providers = providers;
    this.credentials = credentials;
    this.getSelection = getSelection;
  }

  async nextStep(input: StepInput): Promise<StepPlan> {
    const selection = this.getSelection();
    const delegate = new ProviderModelAdapter({
      providerRegistry: this.providers,
      credentialsRegistry: this.credentials,
      providerId: selection.provider,
      model: selection.model,
      maxTokens: selection.maxTokens,
    });
    return await delegate.nextStep(input);
  }
}
