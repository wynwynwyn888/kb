import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ApproveSectionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
