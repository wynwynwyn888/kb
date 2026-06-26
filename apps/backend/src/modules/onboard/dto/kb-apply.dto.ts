import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class KbApplyDto {
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  syncRunId!: string;

  @IsBoolean()
  confirmApply!: boolean;

  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;

  @IsOptional()
  @IsString()
  @IsIn(['BOT_PROFILE_PROMPT_ONLY', 'FAQ_KNOWLEDGE_ONLY'])
  applyScope?: string;

  @IsOptional()
  @IsString()
  operatorNote?: string;
}
