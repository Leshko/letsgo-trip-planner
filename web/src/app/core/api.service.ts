import { HttpClient, HttpEvent, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  Activity,
  Comment,
  CostLevel,
  Idea,
  IdeaKind,
  ItineraryDay,
  ItineraryEntry,
  Lodging,
  Member,
  Photo,
  PhotoComment,
  Post,
  Session,
  TransferCode,
  Trip,
  Unfurled,
} from './models';
import { IdeaInput } from './models';

/** Thin typed wrapper over the LetsGo API. Every call returns a Promise. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api';

  private get<T>(url: string, params?: Record<string, string>) {
    return firstValueFrom(this.http.get<T>(this.base + url, { params: new HttpParams({ fromObject: params ?? {} }) }));
  }
  private post<T>(url: string, body: unknown) {
    return firstValueFrom(this.http.post<T>(this.base + url, body));
  }
  private put<T>(url: string, body: unknown) {
    return firstValueFrom(this.http.put<T>(this.base + url, body));
  }
  private patch<T>(url: string, body: unknown) {
    return firstValueFrom(this.http.patch<T>(this.base + url, body));
  }
  private delete(url: string) {
    return firstValueFrom(this.http.delete<void>(this.base + url));
  }

  // trips
  createTrip(body: {
    name: string;
    destination: string;
    startDate: string;
    endDate: string;
    memberName: string;
    emoji: string;
  }) {
    return this.post<Session>('/trips', body);
  }
  joinTrip(body: { code: string; name: string; emoji: string }) {
    return this.post<Session>('/trips/join', body);
  }
  me() {
    return this.get<{ member: Member; trip: Trip }>('/trips/me');
  }
  createTransferCode() {
    return this.post<TransferCode>('/trips/me/transfer-code', {});
  }
  redeemTransferCode(code: string) {
    return this.post<Session>('/trips/transfer', { code });
  }
  uploadAvatar(dataUrl: string) {
    return this.put<Member>('/trips/me/avatar', { dataUrl });
  }
  removeAvatar() {
    return firstValueFrom(this.http.delete<Member>(this.base + '/trips/me/avatar'));
  }
  updateProfile(body: { name?: string; emoji?: string }) {
    return this.patch<Member>('/trips/me', body);
  }
  getTrip(tripId: string) {
    return this.get<Trip>(`/trips/${tripId}`);
  }
  updateTrip(tripId: string, body: Partial<Pick<Trip, 'name' | 'destination' | 'startDate' | 'endDate'>>) {
    return this.patch<Trip>(`/trips/${tripId}`, body);
  }
  updateLodging(tripId: string, body: Partial<Lodging>) {
    return this.put<Trip>(`/trips/${tripId}/lodging`, body);
  }

  // ideas
  listIdeas(tripId: string, kind?: IdeaKind) {
    return this.get<Idea[]>(`/trips/${tripId}/ideas`, kind ? { kind } : undefined);
  }
  createIdea(tripId: string, body: { kind: IdeaKind } & Partial<IdeaInput>) {
    return this.post<Idea>(`/trips/${tripId}/ideas`, body);
  }
  unfurl(tripId: string, url: string) {
    return this.get<Unfurled>(`/trips/${tripId}/unfurl`, { url });
  }
  updateIdea(tripId: string, ideaId: string, body: Partial<IdeaInput>) {
    return this.patch<Idea>(`/trips/${tripId}/ideas/${ideaId}`, body);
  }
  deleteIdea(tripId: string, ideaId: string) {
    return this.delete(`/trips/${tripId}/ideas/${ideaId}`);
  }
  toggleVote(tripId: string, ideaId: string) {
    return this.post<Idea>(`/trips/${tripId}/ideas/${ideaId}/vote`, {});
  }
  listComments(tripId: string, ideaId: string) {
    return this.get<Comment[]>(`/trips/${tripId}/ideas/${ideaId}/comments`);
  }
  addComment(tripId: string, ideaId: string, body: string) {
    return this.post<Comment>(`/trips/${tripId}/ideas/${ideaId}/comments`, { body });
  }
  deleteComment(tripId: string, commentId: string) {
    return this.delete(`/trips/${tripId}/comments/${commentId}`);
  }

  // wall + feed
  listPosts(tripId: string) {
    return this.get<Post[]>(`/trips/${tripId}/posts`);
  }
  createPost(tripId: string, body: string) {
    return this.post<Post>(`/trips/${tripId}/posts`, { body });
  }
  react(tripId: string, postId: string, emoji: string) {
    return this.post<Post>(`/trips/${tripId}/posts/${postId}/react`, { emoji });
  }
  deletePost(tripId: string, postId: string) {
    return this.delete(`/trips/${tripId}/posts/${postId}`);
  }
  activity(tripId: string, limit = 40) {
    return this.get<Activity[]>(`/trips/${tripId}/activity`, { limit: String(limit) });
  }

  // itinerary
  itinerary(tripId: string) {
    return this.get<ItineraryDay[]>(`/trips/${tripId}/itinerary`);
  }
  addEntry(tripId: string, body: { date: string; startTime?: string; title?: string; notes?: string; ideaId?: string }) {
    return this.post<ItineraryEntry>(`/trips/${tripId}/itinerary`, body);
  }
  updateEntry(tripId: string, entryId: string, body: Partial<Pick<ItineraryEntry, 'date' | 'startTime' | 'title' | 'notes'>>) {
    return this.patch<ItineraryEntry>(`/trips/${tripId}/itinerary/${entryId}`, body);
  }
  deleteEntry(tripId: string, entryId: string) {
    return this.delete(`/trips/${tripId}/itinerary/${entryId}`);
  }
  reorder(tripId: string, date: string, entryIds: string[]) {
    return this.put<ItineraryDay[]>(`/trips/${tripId}/itinerary/reorder`, { date, entryIds });
  }

  // photos
  listPhotos(tripId: string) {
    return this.get<Photo[]>(`/trips/${tripId}/photos`);
  }
  /** Multipart upload with progress events; the auth interceptor adds the bearer. */
  uploadPhoto(tripId: string, form: FormData): Observable<HttpEvent<Photo>> {
    return this.http.post<Photo>(`${this.base}/trips/${tripId}/photos`, form, { reportProgress: true, observe: 'events' });
  }
  updatePhotoCaption(tripId: string, photoId: string, caption: string) {
    return this.patch<Photo>(`/trips/${tripId}/photos/${photoId}`, { caption });
  }
  deletePhoto(tripId: string, photoId: string) {
    return this.delete(`/trips/${tripId}/photos/${photoId}`);
  }
  listPhotoComments(tripId: string, photoId: string) {
    return this.get<PhotoComment[]>(`/trips/${tripId}/photos/${photoId}/comments`);
  }
  addPhotoComment(tripId: string, photoId: string, body: string) {
    return this.post<PhotoComment>(`/trips/${tripId}/photos/${photoId}/comments`, { body });
  }
  deletePhotoComment(tripId: string, commentId: string) {
    return this.delete(`/trips/${tripId}/photo-comments/${commentId}`);
  }
}
