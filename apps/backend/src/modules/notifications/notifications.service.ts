// Notifications service - handles user notifications

import { Injectable } from '@nestjs/common';

@Injectable()
export class NotificationsService {
  // TODO: Implement notification management
  // - Store notifications in Postgres
  // - Create notifications from various events (handover, quota, etc.)
  // - Mark as read
  // - Unread count for UI badge

  async create(notification: {
    userId: string;
    type: string;
    title: string;
    message: string;
    data?: Record<string, unknown>;
  }) {
    throw new Error('Not implemented');
  }

  async getUnreadCount(userId: string): Promise<number> {
    throw new Error('Not implemented');
  }
}