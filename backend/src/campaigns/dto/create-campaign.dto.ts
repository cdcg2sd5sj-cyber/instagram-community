import { IsInt, IsUrl, Max, Min } from 'class-validator'

export class CreateCampaignDto {
  @IsUrl({}, { message: 'Укажите корректную ссылку на Reels' })
  reelsUrl!: string

  @IsInt()
  @Min(5)
  @Max(200)
  totalSlots!: number
}
