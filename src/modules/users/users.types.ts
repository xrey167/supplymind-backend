export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClerkWebhookEvent {
  type: string;
  data: {
    id: string;
    email_addresses?: Array<{ email_address: string; id: string }>;
    primary_email_address_id?: string;
    first_name?: string | null;
    last_name?: string | null;
    image_url?: string | null;
  };
}
