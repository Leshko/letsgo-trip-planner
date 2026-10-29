import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Member } from './member.entity';
import { Photo } from './photo.entity';
import { Timestamped } from './created-at';

@Entity()
@Index(['photoId'])
export class PhotoComment extends Timestamped {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tripId!: string;

  @Column({ type: 'uuid' })
  photoId!: string;

  @ManyToOne(() => Photo, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'photoId' })
  photo!: Photo;

  @Column({ type: 'uuid' })
  memberId!: string;

  @ManyToOne(() => Member, { onDelete: 'CASCADE', eager: true })
  @JoinColumn({ name: 'memberId' })
  member!: Member;

  @Column()
  body!: string;
}
