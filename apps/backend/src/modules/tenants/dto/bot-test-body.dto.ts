import { Type } from 'class-transformer';
import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';

export class BotTestHistoryItemDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  content!: string;
}

export class BotTestBodyDto {
  @IsString()
  @IsNotEmpty()
  message!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BotTestHistoryItemDto)
  history?: BotTestHistoryItemDto[];
}
