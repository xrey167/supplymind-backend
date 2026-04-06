import { describe, expect, test } from 'bun:test';
import {
  notificationEmail,
  budgetWarningEmail,
  taskErrorEmail,
} from '../email.templates';
import { sendEmail } from '../email.provider';

describe('email templates', () => {
  test('notificationEmail produces valid HTML with title', () => {
    const html = notificationEmail('Test Alert', 'Something happened');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Test Alert');
    expect(html).toContain('Something happened');
    expect(html).toContain('</html>');
  });

  test('notificationEmail handles null body', () => {
    const html = notificationEmail('Title Only', null);
    expect(html).toContain('Title Only');
    expect(html).toContain('<!DOCTYPE html>');
  });

  test('notificationEmail renders metadata', () => {
    const html = notificationEmail('With Meta', null, { region: 'us-east', count: 42 });
    expect(html).toContain('region');
    expect(html).toContain('us-east');
    expect(html).toContain('42');
  });

  test('notificationEmail escapes HTML in inputs', () => {
    const html = notificationEmail('<script>alert(1)</script>', 'a<b>c');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('budgetWarningEmail includes workspace and percentage', () => {
    const html = budgetWarningEmail('ws-123', 85.5, 100);
    expect(html).toContain('ws-123');
    expect(html).toContain('85.5%');
    expect(html).toContain('$100.00');
    expect(html).toContain('Budget Warning');
  });

  test('taskErrorEmail includes task ID and error', () => {
    const html = taskErrorEmail('task-abc', 'Connection refused');
    expect(html).toContain('task-abc');
    expect(html).toContain('Connection refused');
    expect(html).toContain('Task Failed');
  });
});

describe('sendEmail', () => {
  test('returns null when RESEND_API_KEY is not set', async () => {
    const original = Bun.env.RESEND_API_KEY;
    delete Bun.env.RESEND_API_KEY;
    try {
      const result = await sendEmail({
        to: 'test@example.com',
        subject: 'Test',
        html: '<p>Hi</p>',
      });
      expect(result).toBeNull();
    } finally {
      if (original) Bun.env.RESEND_API_KEY = original;
    }
  });
});
