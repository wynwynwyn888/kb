import { IsArray, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class RequestChangesDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  comment!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  rejectedSections?: string[];
}
