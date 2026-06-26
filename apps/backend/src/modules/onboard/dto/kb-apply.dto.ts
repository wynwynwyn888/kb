import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

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
  operatorNote?: string;
}
