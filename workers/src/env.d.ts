interface Env {
  readonly ANTHROPIC_API_KEY?: string;
  readonly LLM_BASE_URL?: string;
  readonly LLM_API_KEY?: string;
  readonly OPENAI_API_KEY?: string;
  readonly VOICE_BASE_URL?: string;
  readonly VOICE_API_KEY?: string;
  readonly TYPESAFE_API_KEY?: string;
  readonly CF_ACCOUNT_ID?: string;
  readonly CF_API_TOKEN?: string;
  readonly CHEF_PASSWORD?: string;
  readonly CHEF_API_KEY?: string;
  readonly CHEF_HOME?: string;
  readonly REVIEWER_LORA?: string;
  readonly TRANSCRIPTS?: R2Bucket;
  readonly LOADER?: WorkerLoader;
}
