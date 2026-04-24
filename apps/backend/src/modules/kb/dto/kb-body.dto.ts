import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateKbFaqBodyDto {
  @IsString()
  @IsNotEmpty()
  tenantId!: string;

  @IsString()
  @IsNotEmpty()
  question!: string;

  @IsString()
  @IsNotEmpty()
  answer!: string;
}

export class CreateKbRichTextBodyDto {
  @IsString()
  @IsNotEmpty()
  tenantId!: string;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  content!: string;
}

export class KbFileUploadBodyDto {
  @IsString()
  @IsNotEmpty()
  tenantId!: string;
}

export class KbSearchBodyDto {
  @IsString()
  @IsNotEmpty()
  tenantId!: string;

  @IsString()
  query!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  topK?: number;

  @IsOptional()
  @IsString()
  conversationId?: string;
}
