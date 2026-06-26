import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateSessionDto {
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  projectId!: string;

  @IsOptional()
  @IsString()
  agentType?: string;
}
