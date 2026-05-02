import type { NotificationRequest } from "./domain";

export interface NotificationGateway {
  requestPermission(): Promise<"granted" | "denied" | "deferred">;
  schedule(request: NotificationRequest): Promise<void>;
  pending(): NotificationRequest[];
}

class InMemoryNotificationGateway implements NotificationGateway {
  private queue: NotificationRequest[] = [];

  async requestPermission(): Promise<"granted" | "denied" | "deferred"> {
    // Expo Notifications can be wired here without changing callers.
    return "deferred";
  }

  async schedule(request: NotificationRequest): Promise<void> {
    this.queue = [request, ...this.queue].slice(0, 10);
  }

  pending(): NotificationRequest[] {
    return this.queue;
  }
}

export const notificationGateway = new InMemoryNotificationGateway();
