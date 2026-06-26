import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';

export class RecommendationDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsString()
  @IsNotEmpty()
  type!: string;

  @IsString()
  @IsNotEmpty()
  riskLevel!: string;

  @IsOptional()
  @IsString()
  businessValue?: string;

  @IsOptional()
  @IsString()
  suggestedTrigger?: string;

  @IsOptional()
  @IsString()
  suggestedAction?: string;
}

export class SubmitAnalysisDto {
  @IsString()
  @IsNotEmpty()
  summary!: string;

  @IsOptional()
  @IsString()
  currentSalesWorkflow?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  leadSources?: string[];

  @IsOptional()
  @IsString()
  qualificationProcess?: string;

  @IsOptional()
  @IsString()
  bookingProcess?: string;

  @IsOptional()
  @IsString()
  followUpProcess?: string;

  @IsOptional()
  @IsString()
  handoverProcess?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  painPoints?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  conversionRisks?: string[];

  @IsOptional()
  @IsString()
  recommendedFocus?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecommendationDto)
  recommendations?: RecommendationDto[];

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
