import { IsBoolean, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

const SAVEABLE = ['OPENAI', 'MINIMAX', 'ANTHROPIC', 'GOOGLE', 'AZURE', 'CUSTOM'] as const;

export class SaveAgencyAiConfigBodyDto {
  @IsString()
  @IsIn(SAVEABLE)
  provider!: string;

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsString()
  endpoint?: string;

  @IsString()
  @IsNotEmpty()
  defaultModel!: string;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  maxTokens?: number;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  temperature?: number;

  @IsOptional()
  @IsString()
  minimaxGroupId?: string;

  /** When true, sets agencies.active_ai_provider to this row's provider. */
  @IsOptional()
  @IsBoolean()
  setAsActive?: boolean;
}

const LIVE_PROVIDERS = ['OPENAI', 'MINIMAX'] as const;

export class SetActiveProviderBodyDto {
  @IsString()
  @IsIn(LIVE_PROVIDERS)
  provider!: (typeof LIVE_PROVIDERS)[number];
}
