import { IsInt, IsString, MinLength } from 'class-validator'

export class CompleteTaskDto {
  @IsInt()
  campaignId!: number

  @IsString()
  @MinLength(1)
  comment!: string
}
