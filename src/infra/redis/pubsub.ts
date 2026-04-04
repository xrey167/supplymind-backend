import type { EventBus, BusEvent } from '../../events/bus';
import type Redis from 'ioredis';

export class RedisPubSub {
  private outboundIds: string[] = [];
  private inboundListenerAttached = false;

  constructor(
    private bus: EventBus,
    private publisher: Pick<Redis, 'publish'>,
    private subscriber?: Pick<Redis, 'psubscribe' | 'on'>,
  ) {}

  /** Forward events matching a bus pattern to Redis channels */
  bridgeToRedis(pattern: string): string {
    const id = this.bus.subscribe(pattern, async (event) => {
      // Skip events that came from Redis to prevent infinite re-broadcast
      if (event.source.startsWith('redis:')) return;
      const message = JSON.stringify({
        id: event.id,
        topic: event.topic,
        data: event.data,
        source: event.source,
        timestamp: event.timestamp,
        correlationId: event.correlationId,
      });
      await this.publisher.publish(event.topic, message);
    }, { name: `redis-bridge:${pattern}` });
    this.outboundIds.push(id);
    return id;
  }

  /** Subscribe to Redis channels and inject into the bus */
  bridgeFromRedis(pattern: string): void {
    if (!this.subscriber) throw new Error('No Redis subscriber provided');
    this.subscriber.psubscribe(pattern);

    // Only attach the pmessage listener once — it handles all patterns
    if (!this.inboundListenerAttached) {
      this.inboundListenerAttached = true;
      this.subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
        try {
          const parsed = JSON.parse(message);
          this.bus.publish(channel, parsed.data, {
            source: `redis:${parsed.source ?? 'external'}`,
            correlationId: parsed.correlationId,
          });
        } catch (err) {
          this.bus.publish('error.redis.parse', {
            channel,
            message: message.slice(0, 500),
            error: err instanceof Error ? err.message : String(err),
          }, { source: 'redis-bridge' });
        }
      });
    }
  }
}
